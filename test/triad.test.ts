import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  buildAuthorizationUrl,
  computePkceChallengeS256,
  generatePkcePair,
  initiateDeviceCodeFlow,
  inspectCrossAuthStatus,
  pollDeviceTokenOnce,
  sealTokenPayload,
  unsealTokenPayload,
} from "../src/auth/cross-auth.ts";
import { generateCiTemplates } from "../src/ci/templates.ts";
import {
  discoverBinaries,
  redactSecret,
  redactTextSecrets,
  runCommandCapture,
  type TriadAgentId,
} from "../src/discovery.ts";
import {
  buildAgentCommand,
  routeTask,
  runCouncil,
  type TriadRunRequest,
  type TriadRunResult,
} from "../src/runners/triad-runner.ts";
import {
  createGatewayFetchHandler,
  dispatchTriadMcpRpc,
  TRIAD_MCP_PROTOCOL_VERSION,
} from "../src/server/gateway.ts";

describe("RFC 7636 PKCE S256 & RFC 8628 Device Authorization", () => {
  test("computes exact RFC 7636 Appendix B S256 test vector", () => {
    const rfcVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expectedChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(computePkceChallengeS256(rfcVerifier)).toBe(expectedChallenge);
  });

  test("generates URL-safe PKCE pair and builds OAuth 2.1 authorization URL", () => {
    const pair = generatePkcePair(32);
    expect(pair.codeChallengeMethod).toBe("S256");
    expect(pair.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(computePkceChallengeS256(pair.codeVerifier)).toBe(
      pair.codeChallenge,
    );

    const { url, state } = buildAuthorizationUrl({
      authorizationEndpoint: "https://auth.example.com/oauth2/authorize",
      clientId: "triad-cli",
      redirectUri: "http://127.0.0.1:4319/callback",
      codeChallenge: pair.codeChallenge,
      scope: ["openid", "profile"],
      resource: "https://api.example.com/v1",
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("triad-cli");
    expect(parsed.searchParams.get("code_challenge")).toBe(pair.codeChallenge);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBe(state);
    expect(parsed.searchParams.get("resource")).toBe(
      "https://api.example.com/v1",
    );
  });

  test("handles RFC 8628 Device Authorization initiation and polling states", async () => {
    const mockFetch = (async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.endsWith("/device/code")) {
        return Response.json({
          device_code: "dev_12345",
          user_code: "ABCD-EFGH",
          verification_uri: "https://auth.example.com/activate",
          expires_in: 600,
          interval: 5,
        });
      }
      return Response.json({ error: "authorization_pending" }, { status: 400 });
    }) as unknown as typeof fetch;

    const deviceRes = await initiateDeviceCodeFlow(
      {
        deviceAuthorizationEndpoint: "https://auth.example.com/device/code",
        clientId: "triad-device",
        scope: "openid",
      },
      mockFetch,
    );
    expect(deviceRes.user_code).toBe("ABCD-EFGH");
    expect(deviceRes.interval).toBe(5);

    const pollPending = await pollDeviceTokenOnce({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "triad-device",
      deviceCode: deviceRes.device_code,
      intervalSeconds: 5,
      fetchImpl: mockFetch,
    });
    expect(pollPending).toEqual({ status: "pending", intervalSeconds: 5 });
  });

  test("seals and unseals AES-GCM token vault payloads cleanly", async () => {
    const plain = JSON.stringify({ provider: "codex", scope: "openid" });
    const sealed = await sealTokenPayload(plain, "machine-key-material-test");
    expect(sealed.ciphertextB64).not.toContain("codex");
    const unsealed = await unsealTokenPayload(
      sealed.ciphertextB64,
      sealed.ivB64,
      "machine-key-material-test",
    );
    expect(unsealed).toBe(plain);
  });
});

describe("Cross-Auth Redaction & Leak Safety", () => {
  test("redacts raw tokens in strings and env files without leaking values", async () => {
    const fakeAnthropic = "sk-ant-api03-FAKE_FIXTURE_1234567890ABCDEF";
    const fakeOpenAi = "sk-proj-FAKE_FIXTURE_9876543210ZYXWVU";
    const fakeGithub = "ghp_FAKE_FIXTURE_GITHUBTOKEN1234567890";

    expect(redactSecret(fakeAnthropic)).toBe(
      `SET [redacted, len=${fakeAnthropic.length}]`,
    );
    const scrubbed = redactTextSecrets(
      `Authorization: Bearer ${fakeOpenAi} and key=${fakeGithub}`,
    );
    expect(scrubbed).not.toContain("FAKE_FIXTURE");
    expect(scrubbed).toContain("[REDACTED:len=");

    const tempDir = join(tmpdir(), `triad-auth-test-${crypto.randomUUID()}`);
    mkdirSync(join(tempDir, ".claude"), { recursive: true });
    const envPath = join(tempDir, ".env.mock");
    writeFileSync(
      envPath,
      `ANTHROPIC_API_KEY=${fakeAnthropic}\nOPENAI_API_KEY=${fakeOpenAi}\nGITHUB_TOKEN=${fakeGithub}\n`,
      "utf8",
    );
    writeFileSync(
      join(tempDir, ".claude", ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: fakeAnthropic } }),
      "utf8",
    );

    const statuses = await inspectCrossAuthStatus({
      home: tempDir,
      envFilePath: envPath,
      skipCliProbes: true,
    });
    const serialized = JSON.stringify(statuses);
    expect(serialized).not.toContain(fakeAnthropic);
    expect(serialized).not.toContain(fakeOpenAi);
    expect(serialized).not.toContain(fakeGithub);
    expect(serialized).toContain("claudeAiOauth");
  });
});

describe("Quota-Aware Router, Council Consensus & CLI Command Builders", () => {
  test("builds official CLI headless commands for claude, codex, agy, and gemini", () => {
    const claudeCmd = buildAgentCommand("claude", {
      prompt: "Audit file",
      outputFormat: "json",
      effort: "high",
      worktree: "feat-audit",
    });
    expect(claudeCmd).toEqual(
      expect.arrayContaining([
        "-p",
        "Audit file",
        "--output-format",
        "json",
        "--effort",
        "high",
        "--worktree",
        "feat-audit",
      ]),
    );

    const codexCmd = buildAgentCommand("codex", { prompt: "Fix bug" });
    expect(codexCmd).toEqual(
      expect.arrayContaining([
        "exec",
        "Fix bug",
        "--json",
        "--skip-git-repo-check",
      ]),
    );

    const agyCmd = buildAgentCommand("agy", {
      prompt: "Plan architecture",
      mode: "plan",
    });
    expect(agyCmd).toEqual(
      expect.arrayContaining([
        "-p",
        "Plan architecture",
        "--output-format",
        "json",
        "--mode",
        "plan",
      ]),
    );
  });

  test("routeTask falls back automatically on HTTP 429 quota exhaustion", async () => {
    const res = await routeTask(
      { prompt: "Implement parser" },
      {
        chain: ["agy", "claude", "codex"],
        executor: async (backend) => {
          if (backend === "agy") {
            return {
              ok: false,
              agent: "agy",
              model: "agy",
              output: "",
              exitCode: 429,
              durationMs: 12,
              quotaLimited: true,
              error: "HTTP 429 resource_exhausted",
            };
          }
          return {
            ok: true,
            agent: backend,
            model: `${backend}-pro`,
            output: `Solved by ${backend}`,
            exitCode: 0,
            durationMs: 25,
          };
        },
      },
    );

    expect(res.ok).toBe(true);
    expect(res.agent).toBe("claude");
    expect(res.fallbackTrail).toEqual(["agy:quota-429", "claude:ok"]);
  });

  test("runCouncil executes codex, agy, and claude in parallel and synthesizes consensus", async () => {
    const report = await runCouncil(
      "Review memory safety",
      ["codex", "agy", "claude"],
      {
        executor: async (agent) => ({
          ok: true,
          agent,
          model: agent,
          output: `${agent.toUpperCase()} verified zero leaks.`,
          exitCode: 0,
          durationMs: 10,
        }),
      },
    );

    expect(report.succeededCount).toBe(3);
    expect(report.consensusSummary).toContain("[CODEX]");
    expect(report.consensusSummary).toContain("[AGY]");
    expect(report.consensusSummary).toContain("[CLAUDE]");
  });
});

describe("Gateway Multi-Protocol Translation & MCP 2025-03-26", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";

  const mockHooks = {
    runAgentFn: async (
      agent: TriadAgentId,
      req: TriadRunRequest,
    ): Promise<TriadRunResult> => ({
      ok: true,
      agent,
      model: req.model ?? agent,
      output: `[${agent}] processed: ${req.prompt}`,
      exitCode: 0,
      durationMs: 5,
    }),
    routeTaskFn: async (req: TriadRunRequest): Promise<TriadRunResult> => ({
      ok: true,
      agent: "agy",
      model: "triad/auto",
      output: `[auto->agy] processed: ${req.prompt}`,
      exitCode: 0,
      durationMs: 5,
    }),
  };

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: createGatewayFetchHandler(mockHooks),
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("translates OpenAI /v1/chat/completions cleanly", async () => {
    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "triad/claude",
        messages: [
          { role: "system", content: "Be concise." },
          { role: "user", content: "Hello Claude" },
        ],
      }),
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      object: string;
      choices: Array<{ message: { content: string } }>;
    };
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0]!.message.content).toContain(
      "[claude] processed: Hello Claude",
    );
  });

  test("translates Anthropic /v1/messages cleanly", async () => {
    const resp = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "triad/codex",
        system: "Act as Rust reviewer",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Check lifetimes" }],
          },
        ],
      }),
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      type: string;
      content: Array<{ type: string; text: string }>;
    };
    expect(json.type).toBe("message");
    expect(json.content[0]!.text).toContain(
      "[codex] processed: Check lifetimes",
    );
  });

  test("translates OpenAI /v1/responses cleanly for Codex custom providers", async () => {
    const resp = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "triad/agy",
        instructions: "System rule",
        input: "Verify WebGPU shader",
      }),
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      object: string;
      status: string;
      output_text: string;
    };
    expect(json.object).toBe("response");
    expect(json.status).toBe("completed");
    expect(json.output_text).toContain("[agy] processed: Verify WebGPU shader");
  });

  test("handles MCP 2025-03-26 initialize, tools/list, and tools/call over HTTP and direct RPC", async () => {
    const initResp = await dispatchTriadMcpRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      mockHooks,
    );
    expect(
      (initResp?.result as { protocolVersion: string }).protocolVersion,
    ).toBe(TRIAD_MCP_PROTOCOL_VERSION);

    const listHttp = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const listJson = (await listHttp.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    const toolNames = listJson.result.tools.map((t) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "triad_ask_claude",
        "triad_ask_codex",
        "triad_ask_agy",
        "triad_council_review",
        "triad_auth_status",
      ]),
    );

    const callHttp = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "triad_ask_codex",
          arguments: { prompt: "Inspect crate" },
        },
      }),
    });
    const callJson = (await callHttp.json()) as {
      result: { content: Array<{ text: string }> };
    };
    expect(callJson.result.content[0]!.text).toContain(
      "[codex] processed: Inspect crate",
    );
  });

  test("serves M3/Fluent WebGUI dashboard at GET / and CI templates", async () => {
    const htmlResp = await fetch(`${baseUrl}/`);
    expect(htmlResp.status).toBe(200);
    const html = await htmlResp.text();
    expect(html).toContain("Sovereign AI Triad Gateway");

    const ci = generateCiTemplates();
    expect(ci.githubActionsYaml).toContain("claude -p");
    expect(ci.githubActionsYaml).toContain("codex exec");
    expect(ci.githubActionsYaml).toContain("agy -p");
  });
});

describe("Live Workstation CLI Discovery", () => {
  test("discovers installed claude, codex, agy, and gemini binaries and --help", () => {
    const bins = discoverBinaries();
    const byId = Object.fromEntries(bins.map((b) => [b.id, b]));
    expect(byId.claude?.installed).toBe(true);
    expect(byId.codex?.installed).toBe(true);
    expect(byId.agy?.installed).toBe(true);
    expect(byId.gemini?.installed).toBe(true);

    const codexHelp = runCommandCapture([byId.codex!.executable, "--help"]);
    expect(codexHelp.exitCode).toBe(0);
    expect(codexHelp.stdout).toContain("Codex CLI");
  });
});
