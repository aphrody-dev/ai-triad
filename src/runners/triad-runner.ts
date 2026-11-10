import { existsSync } from "node:fs";
import { homedir } from "node:os";
import {
  loadMergedEnv,
  redactTextSecrets,
  resolveBinaryCatalog,
  type TriadAgentId,
} from "../discovery.ts";

export interface TriadRunRequest {
  prompt: string;
  systemPrompt?: string;
  agent?: TriadAgentId;
  model?: string;
  cwd?: string;
  outputFormat?: "text" | "json" | "stream-json";
  mcpConfigPath?: string;
  worktree?: string | boolean;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  mode?: "accept-edits" | "auto" | "plan";
  review?: boolean;
  timeoutMs?: number;
}

export interface TriadRunResult {
  ok: boolean;
  agent: TriadAgentId | string;
  model: string;
  output: string;
  structured?: unknown;
  exitCode: number;
  durationMs: number;
  quotaLimited?: boolean;
  fallbackTrail?: string[];
  error?: string;
}

export interface CouncilMemberFinding {
  agent: TriadAgentId;
  ok: boolean;
  durationMs: number;
  output: string;
  error?: string;
}

export interface CouncilConsensusReport {
  prompt: string;
  agents: TriadAgentId[];
  succeededCount: number;
  totalDurationMs: number;
  findings: CouncilMemberFinding[];
  consensusSummary: string;
}

const QUOTA_ERROR_RE =
  /(rate[ _-]?limit|429|quota|insufficient_quota|credit balance|too many requests|resource_exhausted|overloaded)/i;

export function buildAgentCommand(
  agent: "claude" | "codex" | "agy" | "gemini",
  req: TriadRunRequest,
  home = homedir(),
): string[] {
  const catalog = resolveBinaryCatalog(home);
  const fullPrompt = req.systemPrompt
    ? `${req.systemPrompt}\n\n${req.prompt}`
    : req.prompt;
  const fmt = req.outputFormat ?? "json";

  switch (agent) {
    case "claude": {
      const args = [
        catalog.claude!.executable,
        "-p",
        fullPrompt,
        "--output-format",
        fmt,
      ];
      if (req.model) args.push("--model", req.model);
      if (req.mcpConfigPath) args.push("--mcp-config", req.mcpConfigPath);
      if (req.effort) args.push("--effort", req.effort);
      if (req.worktree) {
        args.push("--worktree");
        if (typeof req.worktree === "string") args.push(req.worktree);
      }
      return args;
    }

    case "codex": {
      const args = [catalog.codex!.executable];
      if (req.review) {
        args.push("exec", "review");
      } else {
        args.push("exec", fullPrompt, "--json", "--skip-git-repo-check");
      }
      if (req.model) args.push("-m", req.model);
      if (req.cwd) args.push("-C", req.cwd);
      return args;
    }

    case "agy": {
      const args = [
        catalog.agy!.executable,
        "-p",
        fullPrompt,
        "--output-format",
        fmt,
        "--mode",
        req.mode ?? "accept-edits",
      ];
      if (req.model) args.push("--model", req.model);
      if (req.effort) args.push("--effort", req.effort);
      return args;
    }

    case "gemini": {
      const args = [catalog.gemini!.executable, "-p", fullPrompt, "-o", fmt];
      if (req.model) args.push("-m", req.model);
      return args;
    }
  }
}

function extractTextFromCliOutput(
  agent: string,
  rawStdout: string,
): { text: string; structured?: unknown } {
  const trimmed = rawStdout.trim();
  if (!trimmed) return { text: "" };

  // Handle single JSON object (claude --output-format json, agy --output-format json, gemini -o json)
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed.result === "string") {
        return { text: parsed.result, structured: parsed };
      }
      if (typeof parsed.response === "string") {
        return { text: parsed.response, structured: parsed };
      }
      if (typeof parsed.output === "string") {
        return { text: parsed.output, structured: parsed };
      }
      if (typeof parsed.text === "string") {
        return { text: parsed.text, structured: parsed };
      }
      return { text: trimmed, structured: parsed };
    } catch {
      // Could be NDJSON stream-json or codex --json
    }
  }

  // Handle NDJSON (codex exec --json or stream-json)
  if (agent === "codex" || trimmed.includes("\n{")) {
    const lines = trimmed.split(/\r?\n/);
    const chunks: string[] = [];
    const events: unknown[] = [];
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("{")) continue;
      try {
        const ev = JSON.parse(l) as Record<string, unknown>;
        events.push(ev);
        if (typeof ev.text === "string") chunks.push(ev.text);
        else if (typeof ev.result === "string") chunks.push(ev.result);
        else if (
          ev.item &&
          typeof ev.item === "object" &&
          typeof (ev.item as Record<string, unknown>).text === "string"
        ) {
          chunks.push((ev.item as Record<string, unknown>).text as string);
        } else if (
          ev.msg &&
          typeof ev.msg === "object" &&
          typeof (ev.msg as Record<string, unknown>).message === "string"
        ) {
          chunks.push((ev.msg as Record<string, unknown>).message as string);
        }
      } catch {
        // Ignore non-JSON log line
      }
    }
    if (chunks.length > 0) {
      return { text: chunks.join("\n").trim(), structured: events };
    }
  }

  return { text: trimmed };
}

export async function runCliSubprocess(
  agent: "claude" | "codex" | "agy" | "gemini",
  req: TriadRunRequest,
  home = homedir(),
): Promise<TriadRunResult> {
  const started = Date.now();
  const cmd = buildAgentCommand(agent, req, home);
  const exe = cmd[0]!;
  if (!existsSync(exe)) {
    return {
      ok: false,
      agent,
      model: req.model ?? agent,
      output: "",
      exitCode: 127,
      durationMs: Date.now() - started,
      error: `Executable not found: ${exe}`,
    };
  }

  const env = loadMergedEnv();
  const proc = Bun.spawn(cmd, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    cwd: req.cwd ?? process.cwd(),
    env,
  });

  const timeoutMs = req.timeoutMs ?? 90_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
    new Response(proc.stdout).bytes(),
    new Response(proc.stderr).bytes(),
    proc.exited,
  ]);
  clearTimeout(timer);

  const decoder = new TextDecoder();
  const rawOut = decoder.decode(stdoutBytes);
  const rawErr = decoder.decode(stderrBytes);
  const combined = `${rawOut}\n${rawErr}`;
  const quotaLimited = QUOTA_ERROR_RE.test(combined);
  const parsed = extractTextFromCliOutput(agent, rawOut);

  const ok = !timedOut && exitCode === 0 && parsed.text.length > 0;
  return {
    ok,
    agent,
    model: req.model ?? `${agent}-default`,
    output: redactTextSecrets(parsed.text || rawOut.trim()),
    structured: parsed.structured,
    exitCode: timedOut ? 124 : exitCode,
    durationMs: Date.now() - started,
    quotaLimited,
    error: ok
      ? undefined
      : timedOut
        ? `Timed out after ${timeoutMs}ms`
        : redactTextSecrets(rawErr.trim() || `Exited with code ${exitCode}`),
  };
}

export async function runAgyAcpPrompt(
  prompt: string,
  options?: { cwd?: string; timeoutMs?: number; home?: string },
): Promise<TriadRunResult> {
  const started = Date.now();
  const catalog = resolveBinaryCatalog(options?.home ?? homedir());
  const agyExe = catalog.agy!.executable;
  if (!existsSync(agyExe)) {
    return {
      ok: false,
      agent: "agy",
      model: "agy-acp",
      output: "",
      exitCode: 127,
      durationMs: Date.now() - started,
      error: `AGY binary not found at ${agyExe}`,
    };
  }

  const proc = Bun.spawn([agyExe, "acp"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: options?.cwd ?? process.cwd(),
    env: loadMergedEnv(),
  });

  const timeoutMs = options?.timeoutMs ?? 30_000;
  const timer = setTimeout(() => proc.kill(), timeoutMs);

  try {
    const initMsg = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientInfo: { name: "ai-triad-acp-bridge", version: "1.0.0" },
        clientCapabilities: {},
      },
    });
    const newSessMsg = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: { cwd: options?.cwd ?? process.cwd(), mcpServers: [] },
    });

    proc.stdin.write(`${initMsg}\n${newSessMsg}\n`);
    await proc.stdin.flush();

    const decoder = new TextDecoder();
    let buffer = "";
    let sessionId = "";
    const textChunks: string[] = [];

    for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("{")) continue;
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (
          msg.id === 2 &&
          msg.result &&
          typeof (msg.result as Record<string, unknown>).sessionId === "string"
        ) {
          sessionId = (msg.result as Record<string, unknown>)
            .sessionId as string;
          const promptRpc = JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
              sessionId,
              prompt: [{ type: "text", text: prompt }],
            },
          });
          proc.stdin.write(`${promptRpc}\n`);
          await proc.stdin.flush();
        } else if (msg.method === "session/update" && msg.params) {
          const update = (msg.params as Record<string, unknown>).update as
            Record<string, unknown> | undefined;
          const content = update?.content as
            Record<string, unknown> | undefined;
          if (typeof content?.text === "string") {
            textChunks.push(content.text);
          }
        } else if (msg.id === 3) {
          proc.kill();
          clearTimeout(timer);
          return {
            ok: true,
            agent: "agy",
            model: "agy-acp-stdio",
            output: redactTextSecrets(textChunks.join("")),
            exitCode: 0,
            durationMs: Date.now() - started,
          };
        }
      }
    }

    clearTimeout(timer);
    return {
      ok: textChunks.length > 0,
      agent: "agy",
      model: "agy-acp-stdio",
      output: redactTextSecrets(textChunks.join("")),
      exitCode: 0,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    clearTimeout(timer);
    proc.kill();
    return {
      ok: false,
      agent: "agy",
      model: "agy-acp-stdio",
      output: "",
      exitCode: 1,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runHttpOpenAiCompatible(
  baseUrl: string,
  providerId: string,
  req: TriadRunRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<TriadRunResult> {
  const started = Date.now();
  const messages: Array<{ role: string; content: string }> = [];
  if (req.systemPrompt) {
    messages.push({ role: "system", content: req.systemPrompt });
  }
  messages.push({ role: "user", content: req.prompt });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 20_000);
    const resp = await fetchImpl(
      `${baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: req.model ?? "qwen3-coder-next-abliterated",
          messages,
          stream: false,
        }),
        signal: controller.signal,
      },
    );
    clearTimeout(timer);

    const quotaLimited = resp.status === 429;
    if (!resp.ok) {
      const errBody = await resp.text();
      return {
        ok: false,
        agent: providerId,
        model: req.model ?? providerId,
        output: "",
        exitCode: resp.status,
        durationMs: Date.now() - started,
        quotaLimited: quotaLimited || QUOTA_ERROR_RE.test(errBody),
        error: `HTTP ${resp.status}: ${redactTextSecrets(errBody.slice(0, 240))}`,
      };
    }

    const data = (await resp.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    return {
      ok: true,
      agent: providerId,
      model: data.model ?? req.model ?? providerId,
      output: redactTextSecrets(content),
      structured: data,
      exitCode: 0,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      agent: providerId,
      model: req.model ?? providerId,
      output: "",
      exitCode: 503,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runAgent(
  agent: TriadAgentId,
  req: TriadRunRequest,
): Promise<TriadRunResult> {
  if (
    agent === "claude" ||
    agent === "codex" ||
    agent === "agy" ||
    agent === "gemini"
  ) {
    return runCliSubprocess(agent, req);
  }
  if (agent === "ai-os") {
    return runHttpOpenAiCompatible("http://127.0.0.1:4318/v1", "ai-os", req);
  }
  return runHttpOpenAiCompatible(
    "http://127.0.0.1:8787/v1",
    "pi-opencode",
    req,
  );
}

export type RouteBackendExecutor = (
  backend: string,
  req: TriadRunRequest,
) => Promise<TriadRunResult>;

export const DEFAULT_FALLBACK_CHAIN = [
  "agy",
  "claude",
  "codex",
  "rust-gateway",
  "ring3-local",
] as const;

export async function routeTask(
  req: TriadRunRequest,
  options?: {
    chain?: readonly string[];
    executor?: RouteBackendExecutor;
  },
): Promise<TriadRunResult> {
  const chain =
    options?.chain ??
    (req.agent
      ? [req.agent, ...DEFAULT_FALLBACK_CHAIN]
      : DEFAULT_FALLBACK_CHAIN);
  const dedupedChain = Array.from(new Set(chain));
  const trail: string[] = [];

  const exec: RouteBackendExecutor =
    options?.executor ??
    (async (backend, r) => {
      switch (backend) {
        case "agy":
        case "claude":
        case "codex":
        case "gemini":
          return runCliSubprocess(backend, r);
        case "rust-gateway":
          return runHttpOpenAiCompatible(
            "http://127.0.0.1:4320/v1",
            "rust-gateway",
            r,
          );
        case "ai-os":
          return runHttpOpenAiCompatible(
            "http://127.0.0.1:4318/v1",
            "ai-os",
            r,
          );
        case "ring3-local":
        case "pi-opencode":
          return runHttpOpenAiCompatible(
            "http://127.0.0.1:8787/v1",
            "ring3-local",
            r,
          );
        default:
          return {
            ok: false,
            agent: backend,
            model: backend,
            output: "",
            exitCode: 400,
            durationMs: 0,
            error: `Unknown backend: ${backend}`,
          };
      }
    });

  let lastFailure: TriadRunResult | undefined;
  for (const backend of dedupedChain) {
    const res = await exec(backend, req);
    if (res.ok) {
      trail.push(`${backend}:ok`);
      return {
        ...res,
        fallbackTrail: trail,
      };
    }
    const reason = res.quotaLimited ? "quota-429" : `err-${res.exitCode}`;
    trail.push(`${backend}:${reason}`);
    lastFailure = res;
  }

  return {
    ...(lastFailure ?? {
      ok: false,
      agent: "none",
      model: "none",
      output: "",
      exitCode: 503,
      durationMs: 0,
      error: "No backends configured in routeTask chain",
    }),
    fallbackTrail: trail,
  };
}

export async function runCouncil(
  prompt: string,
  agents: TriadAgentId[] = ["codex", "agy", "claude"],
  options?: {
    cwd?: string;
    timeoutMs?: number;
    executor?: (
      agent: TriadAgentId,
      req: TriadRunRequest,
    ) => Promise<TriadRunResult>;
  },
): Promise<CouncilConsensusReport> {
  const started = Date.now();
  const exec = options?.executor ?? runAgent;

  const findings = await Promise.all(
    agents.map(async (agent): Promise<CouncilMemberFinding> => {
      const res = await exec(agent, {
        prompt,
        cwd: options?.cwd,
        timeoutMs: options?.timeoutMs ?? 60_000,
      });
      return {
        agent,
        ok: res.ok,
        durationMs: res.durationMs,
        output: res.output,
        error: res.error,
      };
    }),
  );

  const succeeded = findings.filter((f) => f.ok);
  const summaryLines: string[] = [
    `# Triad Council Consensus (${succeeded.length}/${findings.length} agents responded)`,
    "",
  ];

  for (const f of findings) {
    summaryLines.push(
      `## [${f.agent.toUpperCase()}] (${f.ok ? "OK" : "FAILED"}, ${f.durationMs}ms)`,
    );
    summaryLines.push(f.ok ? f.output : `Error: ${f.error ?? "unknown"}`);
    summaryLines.push("");
  }

  return {
    prompt,
    agents,
    succeededCount: succeeded.length,
    totalDurationMs: Date.now() - started,
    findings,
    consensusSummary: summaryLines.join("\n").trim(),
  };
}
