import { inspectCrossAuthStatus } from "../auth/cross-auth.ts";
import { discoverBinaries, type TriadAgentId } from "../discovery.ts";
import {
  routeTask,
  runAgent,
  runCouncil,
  type TriadRunRequest,
  type TriadRunResult,
} from "../runners/triad-runner.ts";
import { generateCiTemplates } from "../ci/templates.ts";

export const TRIAD_MCP_PROTOCOL_VERSION = "2025-03-26";

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface GatewayExecutorHooks {
  runAgentFn?: (
    agent: TriadAgentId,
    req: TriadRunRequest,
  ) => Promise<TriadRunResult>;
  routeTaskFn?: (req: TriadRunRequest) => Promise<TriadRunResult>;
}

export const TRIAD_MCP_TOOLS = [
  {
    name: "triad_ask_claude",
    description:
      "Invoke Anthropic Claude Code headlessly (`claude -p --output-format json`) with optional model, effort, MCP config, or isolated git worktree.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Prompt to send to Claude Code",
        },
        model: {
          type: "string",
          description: "Optional Claude model override",
        },
        effort: {
          type: "string",
          enum: ["low", "medium", "high", "xhigh", "max"],
        },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "triad_ask_codex",
    description:
      "Invoke OpenAI Codex CLI headlessly (`codex exec --json --skip-git-repo-check` or `codex exec review`) for code analysis, patches, or reviews.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Prompt to send to Codex CLI" },
        model: { type: "string", description: "Optional OpenAI/Codex model" },
        review: {
          type: "boolean",
          description: "Run non-interactive `codex exec review` mode",
        },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "triad_ask_agy",
    description:
      "Invoke Google Antigravity CLI headlessly (`agy -p --output-format json --mode accept-edits`) or Gemini CLI.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Prompt to send to Antigravity CLI",
        },
        model: { type: "string", description: "Optional Gemini/AGY model" },
        mode: {
          type: "string",
          enum: ["accept-edits", "auto", "plan"],
          default: "accept-edits",
        },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "triad_council_review",
    description:
      "Run OpenAI Codex, Google Antigravity, and Anthropic Claude Code in parallel and synthesize a structured multi-model consensus report.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Code review or architectural verification prompt",
        },
        agents: {
          type: "array",
          items: {
            type: "string",
            enum: ["codex", "agy", "claude", "gemini", "pi-opencode", "ai-os"],
          },
          default: ["codex", "agy", "claude"],
        },
        cwd: { type: "string" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "triad_auth_status",
    description:
      "Inspect redacted read-only authentication readiness across Claude Code, Codex, Antigravity/Gemini, Sovereign Rust Auth, GitHub, Cloudflare, GCP, and Vercel.",
    inputSchema: {
      type: "object",
      properties: {
        skipCliProbes: {
          type: "boolean",
          default: false,
        },
      },
    },
  },
] as const;

export function parseOpenAiPrompt(body: Record<string, unknown>): {
  prompt: string;
  systemPrompt?: string;
  model: string;
  stream: boolean;
} {
  const model = typeof body.model === "string" ? body.model : "triad/auto";
  const stream = body.stream === true;
  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<Record<string, unknown>>)
    : [];

  const sysParts: string[] = [];
  const userParts: string[] = [];

  for (const msg of messages) {
    const role = typeof msg.role === "string" ? msg.role : "user";
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = (msg.content as Array<Record<string, unknown>>)
        .map((c) => (typeof c.text === "string" ? c.text : ""))
        .filter(Boolean)
        .join("\n");
    }
    if (!text) continue;
    if (role === "system" || role === "developer") {
      sysParts.push(text);
    } else {
      userParts.push(role === "assistant" ? `[Assistant]: ${text}` : text);
    }
  }

  return {
    model,
    stream,
    systemPrompt: sysParts.length > 0 ? sysParts.join("\n") : undefined,
    prompt: userParts.join("\n\n") || String(body.prompt ?? ""),
  };
}

export function parseAnthropicMessagesRequest(body: Record<string, unknown>): {
  prompt: string;
  systemPrompt?: string;
  model: string;
  stream: boolean;
} {
  const model = typeof body.model === "string" ? body.model : "triad/claude";
  const stream = body.stream === true;
  let systemPrompt: string | undefined;
  if (typeof body.system === "string") {
    systemPrompt = body.system;
  } else if (Array.isArray(body.system)) {
    systemPrompt = (body.system as Array<Record<string, unknown>>)
      .map((b) => (typeof b.text === "string" ? b.text : ""))
      .filter(Boolean)
      .join("\n");
  }

  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<Record<string, unknown>>)
    : [];
  const parts: string[] = [];
  for (const m of messages) {
    const role = typeof m.role === "string" ? m.role : "user";
    if (typeof m.content === "string") {
      parts.push(
        role === "assistant" ? `[Assistant]: ${m.content}` : m.content,
      );
    } else if (Array.isArray(m.content)) {
      const blocks = (m.content as Array<Record<string, unknown>>)
        .map((b) => (typeof b.text === "string" ? b.text : ""))
        .filter(Boolean)
        .join("\n");
      if (blocks) {
        parts.push(role === "assistant" ? `[Assistant]: ${blocks}` : blocks);
      }
    }
  }

  return {
    model,
    stream,
    systemPrompt,
    prompt: parts.join("\n\n"),
  };
}

export function parseOpenAiResponsesRequest(body: Record<string, unknown>): {
  prompt: string;
  systemPrompt?: string;
  model: string;
  stream: boolean;
} {
  const model = typeof body.model === "string" ? body.model : "triad/codex";
  const stream = body.stream === true;
  const systemPrompt =
    typeof body.instructions === "string" ? body.instructions : undefined;

  let prompt = "";
  if (typeof body.input === "string") {
    prompt = body.input;
  } else if (Array.isArray(body.input)) {
    const chunks: string[] = [];
    for (const item of body.input as Array<Record<string, unknown>>) {
      if (typeof item.content === "string") {
        chunks.push(item.content);
      } else if (Array.isArray(item.content)) {
        for (const sub of item.content as Array<Record<string, unknown>>) {
          if (typeof sub.text === "string") chunks.push(sub.text);
        }
      } else if (typeof item.text === "string") {
        chunks.push(item.text);
      }
    }
    prompt = chunks.join("\n\n");
  }

  return { model, stream, systemPrompt, prompt };
}

async function executeTriadModelRoute(
  model: string,
  prompt: string,
  systemPrompt?: string,
  hooks?: GatewayExecutorHooks,
): Promise<{ text: string; resolvedModel: string; agent: string }> {
  const execAgent = hooks?.runAgentFn ?? runAgent;
  const execRoute = hooks?.routeTaskFn ?? routeTask;
  const normalized = model.toLowerCase();

  if (normalized === "triad/council" || normalized === "council") {
    const council = await runCouncil(prompt, ["codex", "agy", "claude"], {
      executor: execAgent,
    });
    return {
      text: council.consensusSummary,
      resolvedModel: "triad/council",
      agent: "council",
    };
  }

  if (normalized.startsWith("triad/claude") || normalized.includes("claude")) {
    const subModel = normalized.startsWith("triad/claude:")
      ? model.slice("triad/claude:".length)
      : undefined;
    const res = await execAgent("claude", {
      prompt,
      systemPrompt,
      model: subModel,
    });
    return {
      text: res.ok ? res.output : `Error: ${res.error ?? "claude failed"}`,
      resolvedModel: model,
      agent: "claude",
    };
  }

  if (normalized.startsWith("triad/codex") || normalized.includes("codex")) {
    const subModel = normalized.startsWith("triad/codex:")
      ? model.slice("triad/codex:".length)
      : undefined;
    const res = await execAgent("codex", {
      prompt,
      systemPrompt,
      model: subModel,
    });
    return {
      text: res.ok ? res.output : `Error: ${res.error ?? "codex failed"}`,
      resolvedModel: model,
      agent: "codex",
    };
  }

  if (
    normalized.startsWith("triad/agy") ||
    normalized.includes("antigravity")
  ) {
    const res = await execAgent("agy", { prompt, systemPrompt });
    return {
      text: res.ok ? res.output : `Error: ${res.error ?? "agy failed"}`,
      resolvedModel: model,
      agent: "agy",
    };
  }

  if (normalized.startsWith("triad/gemini") || normalized.includes("gemini")) {
    const res = await execAgent("gemini", { prompt, systemPrompt });
    return {
      text: res.ok ? res.output : `Error: ${res.error ?? "gemini failed"}`,
      resolvedModel: model,
      agent: "gemini",
    };
  }

  const routed = await execRoute({ prompt, systemPrompt });
  return {
    text: routed.ok
      ? routed.output
      : `Error: ${routed.error ?? "all backends unavailable"}`,
    resolvedModel: model,
    agent: String(routed.agent),
  };
}

export function formatOpenAiChatResponse(
  model: string,
  content: string,
  agent: string,
): Record<string, unknown> {
  return {
    id: `chatcmpl_${crypto.randomUUID().replace(/-/g, "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: `triad-${agent}`,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: Math.ceil(content.length / 4),
      completion_tokens: Math.ceil(content.length / 4),
      total_tokens: Math.ceil(content.length / 2),
    },
  };
}

export function formatAnthropicMessageResponse(
  model: string,
  content: string,
): Record<string, unknown> {
  return {
    id: `msg_${crypto.randomUUID().replace(/-/g, "")}`,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: content }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 32,
      output_tokens: Math.max(1, Math.ceil(content.length / 4)),
    },
  };
}

export function formatOpenAiResponsesPayload(
  model: string,
  content: string,
): Record<string, unknown> {
  const msgId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
  return {
    id: `resp_${crypto.randomUUID().replace(/-/g, "")}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    output_text: content,
    output: [
      {
        id: msgId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: content,
            annotations: [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 32,
      output_tokens: Math.max(1, Math.ceil(content.length / 4)),
      total_tokens: 32 + Math.max(1, Math.ceil(content.length / 4)),
    },
  };
}

export async function dispatchTriadMcpRpc(
  req: JsonRpcRequest,
  hooks?: GatewayExecutorHooks,
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const method = req.method ?? "";
  const params = req.params ?? {};

  if (method.startsWith("notifications/")) {
    return null;
  }

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: TRIAD_MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: "sovereign-ai-triad",
            version: "1.0.0",
          },
        },
      };

    case "ping":
      return { jsonrpc: "2.0", id, result: {} };

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: TRIAD_MCP_TOOLS },
      };

    case "tools/call": {
      const toolName = typeof params.name === "string" ? params.name : "";
      const args =
        params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};
      const execAgent = hooks?.runAgentFn ?? runAgent;

      if (toolName === "triad_auth_status") {
        const statuses = await inspectCrossAuthStatus({
          skipCliProbes: args.skipCliProbes === true,
        });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              { type: "text", text: JSON.stringify(statuses, null, 2) },
            ],
          },
        };
      }

      if (toolName === "triad_council_review") {
        const prompt = String(args.prompt ?? "");
        const agents = Array.isArray(args.agents)
          ? (args.agents as TriadAgentId[])
          : (["codex", "agy", "claude"] as TriadAgentId[]);
        const report = await runCouncil(prompt, agents, {
          cwd: typeof args.cwd === "string" ? args.cwd : undefined,
          executor: execAgent,
        });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: report.consensusSummary }],
            isError: report.succeededCount === 0,
          },
        };
      }

      const agentMap: Record<string, TriadAgentId> = {
        triad_ask_claude: "claude",
        triad_ask_codex: "codex",
        triad_ask_agy: "agy",
      };
      const target = agentMap[toolName];
      if (!target) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown MCP tool: ${toolName}` },
        };
      }

      const res = await execAgent(target, {
        prompt: String(args.prompt ?? ""),
        model: typeof args.model === "string" ? args.model : undefined,
        cwd: typeof args.cwd === "string" ? args.cwd : undefined,
        review: args.review === true,
        effort:
          typeof args.effort === "string"
            ? (args.effort as TriadRunRequest["effort"])
            : undefined,
        mode:
          typeof args.mode === "string"
            ? (args.mode as TriadRunRequest["mode"])
            : undefined,
      });

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: res.ok ? res.output : `Error: ${res.error ?? "failed"}`,
            },
          ],
          isError: !res.ok,
        },
      };
    }

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

export async function runTriadMcpStdio(
  hooks?: GatewayExecutorHooks,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const rpc = JSON.parse(line) as JsonRpcRequest;
        const resp = await dispatchTriadMcpRpc(rpc, hooks);
        if (resp) {
          process.stdout.write(`${JSON.stringify(resp)}\n`);
        }
      } catch {
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          })}\n`,
        );
      }
    }
  }
}

function renderWebGuiHtml(): string {
  const ci = generateCiTemplates();
  const escapedGha = ci.githubActionsYaml
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sovereign AI Triad Control Plane</title>
  <style>
    :root {
      --bg: #0b0e14;
      --surface: #131822;
      --surface-elevated: #1b2230;
      --border: #2a3448;
      --text: #e6edf3;
      --muted: #8b98ab;
      --accent: #6ea8fe;
      --ok: #3fb950;
      --warn: #d29922;
      --font: "Segoe UI Variable", system-ui, -apple-system, sans-serif;
      --mono: "Cascadia Code", ui-monospace, SFMono-Regular, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      line-height: 1.5;
    }
    header {
      padding: 20px 32px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h1 { margin: 0; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em; }
    .badge {
      background: var(--surface-elevated);
      border: 1px solid var(--border);
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 0.8rem;
      font-family: var(--mono);
      color: var(--accent);
    }
    main {
      max-width: 1360px;
      margin: 0 auto;
      padding: 24px 32px;
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 20px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }
    .col-6 { grid-column: span 6; }
    .col-12 { grid-column: span 12; }
    h2 { margin: 0 0 14px 0; font-size: 1rem; color: var(--accent); }
    table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
    th, td {
      text-align: left;
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      font-family: var(--mono);
    }
    th { color: var(--muted); font-weight: 500; }
    .pill-ok { color: var(--ok); font-weight: 600; }
    .pill-warn { color: var(--warn); font-weight: 600; }
    textarea, select, button {
      font-family: var(--mono);
      font-size: 0.88rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface-elevated);
      color: var(--text);
      padding: 10px 12px;
    }
    textarea { width: 100%; min-height: 92px; margin-bottom: 10px; }
    button {
      background: #1f6feb;
      border-color: #388bfd;
      cursor: pointer;
      font-weight: 600;
    }
    pre {
      background: #080a0f;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      overflow-x: auto;
      font-family: var(--mono);
      font-size: 0.8rem;
      max-height: 300px;
    }
    @media (max-width: 960px) {
      .col-6 { grid-column: span 12; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Sovereign AI Triad Gateway (Codex + Antigravity + Claude Code)</h1>
    <span class="badge">OpenAI + Anthropic + Responses + MCP 2025-03-26</span>
  </header>
  <main>
    <section class="card col-6">
      <h2>Live CLI Toolchain Matrix</h2>
      <table id="bins-table">
        <thead><tr><th>ID</th><th>Version</th><th>Status</th></tr></thead>
        <tbody><tr><td colspan="3">Loading...</td></tr></tbody>
      </table>
    </section>
    <section class="card col-6">
      <h2>Cross-Auth &amp; OAuth 2.1 / PKCE Readiness (Redacted)</h2>
      <table id="auth-table">
        <thead><tr><th>Provider</th><th>Mechanism</th><th>Ready</th></tr></thead>
        <tbody><tr><td colspan="3">Loading...</td></tr></tbody>
      </table>
    </section>
    <section class="card col-6">
      <h2>Provider Routing Table</h2>
      <table>
        <thead><tr><th>Model Route</th><th>Protocol</th><th>Target / Fallback</th></tr></thead>
        <tbody>
          <tr><td>triad/auto</td><td>Chat / Responses / Messages</td><td>agy -&gt; claude -&gt; codex -&gt; rust-gateway -&gt; ring3-local</td></tr>
          <tr><td>triad/claude</td><td>claude.exe -p --output-format json</td><td>Anthropic Claude Code v2.1+</td></tr>
          <tr><td>triad/codex</td><td>codex.exe exec --json</td><td>OpenAI Codex CLI (Rust)</td></tr>
          <tr><td>triad/agy</td><td>agy.exe -p --output-format json</td><td>Google Antigravity CLI + ACP</td></tr>
          <tr><td>triad/council</td><td>Parallel Consensus</td><td>codex + agy + claude parallel synthesis</td></tr>
        </tbody>
      </table>
    </section>
    <section class="card col-6">
      <h2>Interactive Triad Council / Router Runner</h2>
      <textarea id="prompt-box" placeholder="Enter prompt for Triad router or Council..."></textarea>
      <div style="display:flex; gap:10px; align-items:center;">
        <select id="model-select">
          <option value="triad/auto">triad/auto (Quota-Aware Fallback)</option>
          <option value="triad/council">triad/council (Parallel Codex + AGY + Claude)</option>
          <option value="triad/claude">triad/claude</option>
          <option value="triad/codex">triad/codex</option>
          <option value="triad/agy">triad/agy</option>
        </select>
        <button id="run-btn" type="button">Execute Prompt</button>
      </div>
      <pre id="output-pre">Ready.</pre>
    </section>
    <section class="card col-12">
      <h2>Reproducible CI/CD Headless Pipeline (.github/workflows/triad-agent.yml)</h2>
      <pre>${escapedGha}</pre>
    </section>
  </main>
  <script>
    async function refreshStatus() {
      const res = await fetch('/api/status');
      const data = await res.json();
      const binsBody = document.querySelector('#bins-table tbody');
      binsBody.innerHTML = data.binaries.map(b =>
        '<tr><td>' + b.id + '</td><td>' + b.version + '</td><td class="' + (b.installed ? 'pill-ok' : 'pill-warn') + '">' + (b.installed ? 'READY' : 'MISSING') + '</td></tr>'
      ).join('');
      const authBody = document.querySelector('#auth-table tbody');
      authBody.innerHTML = data.auth.map(a =>
        '<tr><td>' + a.provider + '</td><td>' + a.mechanism + '</td><td class="' + (a.ready ? 'pill-ok' : 'pill-warn') + '">' + (a.ready ? 'READY' : 'UNSET') + '</td></tr>'
      ).join('');
    }
    document.querySelector('#run-btn').addEventListener('click', async () => {
      const prompt = document.querySelector('#prompt-box').value;
      const model = document.querySelector('#model-select').value;
      const pre = document.querySelector('#output-pre');
      pre.textContent = 'Running ' + model + '...';
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] })
      });
      const json = await res.json();
      pre.textContent = (json.choices && json.choices[0] && json.choices[0].message.content) || JSON.stringify(json, null, 2);
    });
    refreshStatus();
  </script>
</body>
</html>`;
}

export function createGatewayFetchHandler(hooks?: GatewayExecutorHooks) {
  return async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const corsHeaders = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers":
        "content-type, authorization, x-api-key, anthropic-version, mcp-session-id",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method === "GET" && url.pathname === "/") {
      return new Response(renderWebGuiHtml(), {
        headers: {
          ...corsHeaders,
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json(
        {
          ok: true,
          service: "@aphrody/ai-triad",
          mcpProtocolVersion: TRIAD_MCP_PROTOCOL_VERSION,
          endpoints: [
            "/v1/chat/completions",
            "/v1/messages",
            "/v1/responses",
            "/v1/models",
            "/mcp",
          ],
        },
        { headers: corsHeaders },
      );
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      const [binaries, auth] = await Promise.all([
        Promise.resolve(discoverBinaries()),
        inspectCrossAuthStatus({ skipCliProbes: true }),
      ]);
      return Response.json({ binaries, auth }, { headers: corsHeaders });
    }

    if (req.method === "GET" && url.pathname === "/v1/models") {
      const models = [
        "triad/auto",
        "triad/claude",
        "triad/codex",
        "triad/agy",
        "triad/gemini",
        "triad/council",
      ].map((id) => ({
        id,
        object: "model",
        created: 1760000000,
        owned_by: "sovereign-ai-triad",
      }));
      return Response.json(
        { object: "list", data: models },
        { headers: corsHeaders },
      );
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      const body = (await req.json()) as Record<string, unknown>;
      const parsed = parseOpenAiPrompt(body);
      const out = await executeTriadModelRoute(
        parsed.model,
        parsed.prompt,
        parsed.systemPrompt,
        hooks,
      );
      if (parsed.stream) {
        const chunk = {
          id: `chatcmpl_${crypto.randomUUID().replace(/-/g, "")}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: out.resolvedModel,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: out.text },
              finish_reason: "stop",
            },
          ],
        };
        return new Response(
          `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
          {
            headers: {
              ...corsHeaders,
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
            },
          },
        );
      }
      return Response.json(
        formatOpenAiChatResponse(out.resolvedModel, out.text, out.agent),
        { headers: corsHeaders },
      );
    }

    if (req.method === "POST" && url.pathname === "/v1/messages") {
      const body = (await req.json()) as Record<string, unknown>;
      const parsed = parseAnthropicMessagesRequest(body);
      const out = await executeTriadModelRoute(
        parsed.model,
        parsed.prompt,
        parsed.systemPrompt,
        hooks,
      );
      return Response.json(
        formatAnthropicMessageResponse(out.resolvedModel, out.text),
        { headers: corsHeaders },
      );
    }

    if (req.method === "POST" && url.pathname === "/v1/responses") {
      const body = (await req.json()) as Record<string, unknown>;
      const parsed = parseOpenAiResponsesRequest(body);
      const out = await executeTriadModelRoute(
        parsed.model,
        parsed.prompt,
        parsed.systemPrompt,
        hooks,
      );
      return Response.json(
        formatOpenAiResponsesPayload(out.resolvedModel, out.text),
        { headers: corsHeaders },
      );
    }

    if (req.method === "POST" && url.pathname === "/mcp") {
      const sessionId =
        req.headers.get("mcp-session-id") ?? `triad_${crypto.randomUUID()}`;
      const rpc = (await req.json()) as JsonRpcRequest;
      const resp = await dispatchTriadMcpRpc(rpc, hooks);
      if (!resp) {
        return new Response(null, {
          status: 202,
          headers: { ...corsHeaders, "mcp-session-id": sessionId },
        });
      }
      return Response.json(resp, {
        headers: { ...corsHeaders, "mcp-session-id": sessionId },
      });
    }

    return Response.json(
      { error: `Not found: ${req.method} ${url.pathname}` },
      { status: 404, headers: corsHeaders },
    );
  };
}

export function startTriadGatewayServer(options?: {
  port?: number;
  hostname?: string;
  hooks?: GatewayExecutorHooks;
}) {
  const port = options?.port ?? 4319;
  const hostname = options?.hostname ?? "127.0.0.1";
  const server = Bun.serve({
    port,
    hostname,
    idleTimeout: 120,
    fetch: createGatewayFetchHandler(options?.hooks),
  });
  return server;
}
