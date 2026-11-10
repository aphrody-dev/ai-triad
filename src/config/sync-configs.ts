import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface SyncConfigReport {
  updatedFiles: string[];
  backupsCreated: string[];
}

function ensureDirFor(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function backupOnce(filePath: string, backups: string[]): void {
  if (!existsSync(filePath)) return;
  const bakPath = `${filePath}.triad.bak`;
  if (!existsSync(bakPath)) {
    copyFileSync(filePath, bakPath);
    backups.push(bakPath);
  }
}

function stripLeadingLineComments(jsonc: string): {
  headerComments: string;
  jsonBody: string;
} {
  const lines = jsonc.split(/\r?\n/);
  const header: string[] = [];
  let i = 0;
  while (i < lines.length && lines[i]!.trim().startsWith("//")) {
    header.push(lines[i]!);
    i++;
  }
  return {
    headerComments: header.length > 0 ? `${header.join("\n")}\n` : "",
    jsonBody: lines.slice(i).join("\n"),
  };
}

const CODEX_MANAGED_START = "# >>> SOVEREIGN AI-TRIAD MANAGED START >>>";
const CODEX_MANAGED_END = "# <<< SOVEREIGN AI-TRIAD MANAGED END <<<";

function buildCodexManagedBlock(): string {
  return `${CODEX_MANAGED_START}
[mcp_servers.ai_os]
command = "C:/Users/aphro/.local/bin/ai-os.exe"
args = ["mcp-stdio"]

[mcp_servers.ai_triad]
command = "C:/Users/aphro/.local/bin/triad.exe"
args = ["mcp-stdio"]

[mcp_servers.native_hardware_cuda]
command = "bun"
args = ["run", "C:/Users/aphro/.gemini/mcp-servers/native-hardware-cuda/index.ts"]

[mcp_servers.github]
command = "bun"
args = ["run", "C:/Users/aphro/.gemini/mcp-servers/github/index.ts"]

[mcp_servers.figma_material_icons]
command = "bun"
args = ["run", "C:/Users/aphro/.gemini/mcp-servers/figma/index.ts"]

[model_providers.sovereign_aios]
name = "Sovereign AI-OS Router"
base_url = "http://127.0.0.1:4318/v1"
wire_api = "responses"

[model_providers.sovereign_triad]
name = "Sovereign AI-Triad Unified Hub"
base_url = "http://127.0.0.1:4319/v1"
wire_api = "responses"

[model_providers.ring3_cuda]
name = "Ring-3 Sovereign CUDA sm_89 Daemon"
base_url = "http://127.0.0.1:8787/v1"
wire_api = "responses"

[model_providers.rust_gateway]
name = "Sovereign Rust OAuth2/Gateway"
base_url = "http://127.0.0.1:4320/v1"
wire_api = "responses"

[profiles.local_legacy]
model = "qwen3-coder-next-abliterated"
model_provider = "ring3_cuda"
approval_policy = "never"
sandbox_mode = "workspace-write"

[profiles.triad_legacy]
model = "triad/auto"
model_provider = "sovereign_triad"
approval_policy = "never"
sandbox_mode = "workspace-write"
${CODEX_MANAGED_END}`;
}

function upsertManagedSection(existing: string, block: string): string {
  const startIdx = existing.indexOf(CODEX_MANAGED_START);
  const endIdx = existing.indexOf(CODEX_MANAGED_END);
  if (startIdx >= 0 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx).trimEnd();
    const after = existing.slice(endIdx + CODEX_MANAGED_END.length).trimStart();
    return (
      [before, block, after].filter((s) => s.length > 0).join("\n\n") + "\n"
    );
  }
  const trimmed = existing.trim();
  return trimmed.length > 0 ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

function collectTrustedWorkspaces(srcRoot: string): string[] {
  const paths = new Set<string>([
    srcRoot,
    join(srcRoot, "apps", "aphrody"),
    join(srcRoot, "apps", "shenron"),
    join(srcRoot, "apps", "rosegriffon"),
    join(srcRoot, "infra"),
    join(srcRoot, "third_party", "bun"),
    join(srcRoot, "third_party", "ai-ecosystem"),
  ]);

  for (const sub of ["packages", "crates", "apps"]) {
    const dir = join(srcRoot, sub);
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          paths.add(join(dir, entry.name));
        }
      }
    } catch {
      // Ignore unreadable directory
    }
  }
  return Array.from(paths);
}

export function syncAllTriadConfigs(options?: {
  home?: string;
  srcRoot?: string;
}): SyncConfigReport {
  const home = options?.home ?? homedir();
  const srcRoot =
    options?.srcRoot ?? (process.platform === "win32" ? "C:\\src" : "/src");
  const updatedFiles: string[] = [];
  const backupsCreated: string[] = [];

  // 1. Codex: ~/.codex/config.toml + local.config.toml + triad.config.toml + AGENTS.md
  const codexDir = join(home, ".codex");
  const codexConfigPath = join(codexDir, "config.toml");
  ensureDirFor(codexConfigPath);
  backupOnce(codexConfigPath, backupsCreated);
  const existingCodexToml = existsSync(codexConfigPath)
    ? readFileSync(codexConfigPath, "utf8")
    : "";
  const cleanedCodexToml = existingCodexToml
    .replace(/\[profiles\.local\][\s\S]*?(?=\n\[|$)/g, "")
    .replace(/\[profiles\.triad\][\s\S]*?(?=\n\[|$)/g, "");
  writeFileSync(
    codexConfigPath,
    upsertManagedSection(cleanedCodexToml, buildCodexManagedBlock()),
    "utf8",
  );
  updatedFiles.push(codexConfigPath);

  const codexLocalProfilePath = join(codexDir, "local.config.toml");
  writeFileSync(
    codexLocalProfilePath,
    `# Codex Profile V2: codex -p local
model = "qwen3-coder-next-abliterated"
model_provider = "ring3_cuda"
approval_policy = "never"
sandbox_mode = "workspace-write"
`,
    "utf8",
  );
  updatedFiles.push(codexLocalProfilePath);

  const codexTriadProfilePath = join(codexDir, "triad.config.toml");
  writeFileSync(
    codexTriadProfilePath,
    `# Codex Profile V2: codex -p triad
model = "triad/auto"
model_provider = "sovereign_triad"
approval_policy = "never"
sandbox_mode = "workspace-write"
`,
    "utf8",
  );
  updatedFiles.push(codexTriadProfilePath);

  const codexAgentsPath = join(codexDir, "AGENTS.md");
  writeFileSync(
    codexAgentsPath,
    `# Sovereign Codex Operating Contract (\`~/.codex/AGENTS.md\`)

- **Monorepo Root**: \`C:\\src\` (\`apps/\`, \`packages/\`, \`crates/\`, \`infra/\`, \`third_party/\`).
- **Toolchain**: Pure Bun v1.4.4 (\`bun fmt\`, \`bun check\`, \`bun test\`, \`bun build --compile\`) and Rust.
- **Safety & Secret Hygiene**: Never modify \`C:\\Windows\\System32\`. Never print or commit raw secrets from \`C:\\src\\.env\`. Zero emojis in code, docs, or commits.
- **Cross-AI MCP Federation**: Use \`ai_triad\` MCP tools (\`triad_ask_claude\`, \`triad_ask_agy\`, \`triad_council_review\`, \`triad_auth_status\`) and \`ai_os\` tools directly inside Codex sessions.
`,
    "utf8",
  );
  updatedFiles.push(codexAgentsPath);

  // 2. Claude Code: ~/.claude/mcp_sovereign.json + ~/.claude.json + ~/.claude/settings.json
  const sovereignMcpServers = {
    "ai-os": {
      type: "stdio",
      command: "C:/Users/aphro/.local/bin/ai-os.exe",
      args: ["mcp-stdio"],
    },
    "ai-triad": {
      type: "stdio",
      command: "C:/Users/aphro/.local/bin/triad.exe",
      args: ["mcp-stdio"],
    },
    "native-hardware-cuda": {
      type: "stdio",
      command: "bun",
      args: [
        "run",
        "C:/Users/aphro/.gemini/mcp-servers/native-hardware-cuda/index.ts",
      ],
    },
    github: {
      type: "stdio",
      command: "bun",
      args: ["run", "C:/Users/aphro/.gemini/mcp-servers/github/index.ts"],
    },
    "figma-material-icons": {
      type: "stdio",
      command: "bun",
      args: ["run", "C:/Users/aphro/.gemini/mcp-servers/figma/index.ts"],
    },
  };

  const claudeMcpSovereignPath = join(home, ".claude", "mcp_sovereign.json");
  ensureDirFor(claudeMcpSovereignPath);
  writeFileSync(
    claudeMcpSovereignPath,
    `${JSON.stringify({ mcpServers: sovereignMcpServers }, null, 2)}\n`,
    "utf8",
  );
  updatedFiles.push(claudeMcpSovereignPath);

  const claudeRootJsonPath = join(home, ".claude.json");
  if (existsSync(claudeRootJsonPath)) {
    backupOnce(claudeRootJsonPath, backupsCreated);
    const claudeRootObj = JSON.parse(
      readFileSync(claudeRootJsonPath, "utf8"),
    ) as Record<string, unknown>;
    const existingMcp =
      claudeRootObj.mcpServers && typeof claudeRootObj.mcpServers === "object"
        ? (claudeRootObj.mcpServers as Record<string, unknown>)
        : {};
    claudeRootObj.mcpServers = {
      ...existingMcp,
      "ai-os": sovereignMcpServers["ai-os"],
      "ai-triad": sovereignMcpServers["ai-triad"],
      "native-hardware-cuda": sovereignMcpServers["native-hardware-cuda"],
    };
    writeFileSync(
      claudeRootJsonPath,
      `${JSON.stringify(claudeRootObj, null, 2)}\n`,
      "utf8",
    );
    updatedFiles.push(claudeRootJsonPath);
  }

  const claudeSettingsPath = join(home, ".claude", "settings.json");
  if (existsSync(claudeSettingsPath)) {
    backupOnce(claudeSettingsPath, backupsCreated);
    const settingsObj = JSON.parse(
      readFileSync(claudeSettingsPath, "utf8"),
    ) as Record<string, unknown>;

    if (
      settingsObj.enabledPlugins &&
      typeof settingsObj.enabledPlugins === "object"
    ) {
      const ep = settingsObj.enabledPlugins as Record<string, unknown>;
      for (const k of Object.keys(ep)) {
        if (k.endsWith("@yolo-plugins")) {
          delete ep[k];
        }
      }
    }

    if (
      settingsObj.extraKnownMarketplaces &&
      typeof settingsObj.extraKnownMarketplaces === "object"
    ) {
      const mkt = settingsObj.extraKnownMarketplaces as Record<string, unknown>;
      delete mkt["yolo-plugins"];
      if (mkt.shenron && typeof mkt.shenron === "object") {
        const sh = mkt.shenron as Record<string, unknown>;
        if (sh.source && typeof sh.source === "object") {
          (sh.source as Record<string, unknown>).path = join(
            srcRoot,
            "apps",
            "shenron",
          );
        }
      }
    }

    if (Array.isArray(settingsObj.extraPlugins)) {
      settingsObj.extraPlugins = (settingsObj.extraPlugins as string[]).filter(
        (p) => !p.toLowerCase().includes("yolo-plugins"),
      );
      if ((settingsObj.extraPlugins as string[]).length === 0) {
        delete settingsObj.extraPlugins;
      }
    }

    writeFileSync(
      claudeSettingsPath,
      `${JSON.stringify(settingsObj, null, 2)}\n`,
      "utf8",
    );
    updatedFiles.push(claudeSettingsPath);
  }

  // 3. Root C:\src\CLAUDE.md and C:\src\GEMINI.md
  const rootClaudeMdPath = join(srcRoot, "CLAUDE.md");
  writeFileSync(
    rootClaudeMdPath,
    `# C:\\src Sovereign Monorepo — Claude Code Contract (\`CLAUDE.md\`)

See [\`AGENTS.md\`](./AGENTS.md) for the canonical cross-agent operating contract.

## Canonical Workspace Layout
- \`apps/\`: Production applications (\`apps/aphrody\`, \`apps/shenron\`, \`apps/rosegriffon\`).
- \`packages/\`: Pure Bun v1.4.4 TypeScript packages (\`packages/ai-os\`, \`packages/ai-triad\`, \`packages/env-kit\`, \`packages/forge\`, \`packages/google-design\`, \`packages/pi-opencode\`, \`packages/wck\`).
- \`crates/\`: Systems Rust crates (\`crates/ring3-agent\`, \`crates/bench\`, \`crates/depot\`, \`crates/gamescope-rs\`, \`crates/unix\`, \`crates/wayland\`, \`crates/xtask\`).
- \`infra/\`: Mesh networking and sovereign infrastructure (\`infra/mesh-vn\`).
- \`third_party/\`: Upstream forks and shallow ecosystem mirrors (\`third_party/bun\`, \`third_party/ai-ecosystem/*\`).

## Mandatory Verification & Rules
- Format with \`bun fmt\`, typecheck with \`bun check\`, and test with \`bun test\`.
- Never touch \`C:\\Windows\\System32\`. Install userland binaries in \`C:\\Users\\aphro\\.local\\bin\`.
- Never print, log, or commit raw secrets from \`C:\\src\\.env\`. Zero emojis anywhere.
- Cross-AI delegation is available via MCP server \`ai-triad\` (\`triad_ask_codex\`, \`triad_ask_agy\`, \`triad_council_review\`).
`,
    "utf8",
  );
  updatedFiles.push(rootClaudeMdPath);

  const rootGeminiMdPath = join(srcRoot, "GEMINI.md");
  writeFileSync(
    rootGeminiMdPath,
    `# C:\\src Sovereign Monorepo — Google Antigravity & Gemini Contract (\`GEMINI.md\`)

See [\`AGENTS.md\`](./AGENTS.md) for the canonical cross-agent operating contract.

## Canonical Workspace Layout
- \`apps/\`: Production platforms (\`apps/aphrody\`, \`apps/shenron\`, \`apps/rosegriffon\`).
- \`packages/\`: Pure Bun v1.4.4 Full-Rust packages (\`packages/ai-os\`, \`packages/ai-triad\`, \`packages/env-kit\`, \`packages/forge\`, \`packages/google-design\`, \`packages/pi-opencode\`, \`packages/wck\`).
- \`crates/\`: Native Rust systems crates (\`crates/ring3-agent\`, \`crates/bench\`, \`crates/depot\`, \`crates/gamescope-rs\`, \`crates/unix\`, \`crates/wayland\`, \`crates/xtask\`).
- \`infra/\`: Sovereign WireGuard/MASQUE mesh (\`infra/mesh-vn\`).
- \`third_party/\`: Upstream sources and AI ecosystem (\`third_party/bun\`, \`third_party/ai-ecosystem/*\`).

## Mandatory Verification & Rules
- Always run \`bun fmt\`, \`bun check\`, and \`bun test\`.
- Never modify \`C:\\Windows\\System32\`; userland binaries belong in \`C:\\Users\\aphro\\.local\\bin\`.
- Never print, log, or commit raw secrets from \`C:\\src\\.env\`. Zero emojis anywhere.
- Cross-AI delegation is wired via MCP server \`ai-triad\` (\`triad_ask_claude\`, \`triad_ask_codex\`, \`triad_council_review\`).
`,
    "utf8",
  );
  updatedFiles.push(rootGeminiMdPath);

  // 4. Antigravity CLI & Gemini CLI
  const agyMcpTargets = [
    join(home, ".gemini", "antigravity-cli", "mcp_config.json"),
    join(home, ".gemini", "config", "mcp_config.json"),
    join(home, ".gemini", "settings.json"),
  ];
  for (const targetMcpPath of agyMcpTargets) {
    ensureDirFor(targetMcpPath);
    backupOnce(targetMcpPath, backupsCreated);
    const mcpObj = existsSync(targetMcpPath)
      ? (JSON.parse(readFileSync(targetMcpPath, "utf8")) as Record<
          string,
          unknown
        >)
      : {};
    const servers =
      mcpObj.mcpServers && typeof mcpObj.mcpServers === "object"
        ? (mcpObj.mcpServers as Record<string, unknown>)
        : {};
    mcpObj.mcpServers = {
      ...servers,
      "ai-os": {
        command: "C:/Users/aphro/.local/bin/ai-os.exe",
        args: ["mcp-stdio"],
      },
      "ai-triad": {
        command: "C:/Users/aphro/.local/bin/triad.exe",
        args: ["mcp-stdio"],
      },
    };
    writeFileSync(
      targetMcpPath,
      `${JSON.stringify(mcpObj, null, 2)}\n`,
      "utf8",
    );
    updatedFiles.push(targetMcpPath);
  }

  const agySettingsPath = join(
    home,
    ".gemini",
    "antigravity-cli",
    "settings.json",
  );
  ensureDirFor(agySettingsPath);
  backupOnce(agySettingsPath, backupsCreated);
  const agySettingsObj = existsSync(agySettingsPath)
    ? (JSON.parse(readFileSync(agySettingsPath, "utf8")) as Record<
        string,
        unknown
      >)
    : {};
  const existingTrusted = Array.isArray(agySettingsObj.trustedWorkspaces)
    ? (agySettingsObj.trustedWorkspaces as string[])
    : [];
  const mergedTrusted = Array.from(
    new Set([...existingTrusted, ...collectTrustedWorkspaces(srcRoot)]),
  );
  agySettingsObj.trustedWorkspaces = mergedTrusted;
  writeFileSync(
    agySettingsPath,
    `${JSON.stringify(agySettingsObj, null, 2)}\n`,
    "utf8",
  );
  updatedFiles.push(agySettingsPath);

  // Validate ~/.gemini/projects.json (Gemini CLI requires values matching /^[a-z0-9-]+$/)
  const geminiProjectsPath = join(home, ".gemini", "projects.json");
  ensureDirFor(geminiProjectsPath);
  const rawProjects = existsSync(geminiProjectsPath)
    ? (() => {
        try {
          return JSON.parse(readFileSync(geminiProjectsPath, "utf8")) as {
            projects?: Record<string, string>;
          };
        } catch {
          return { projects: {} };
        }
      })()
    : { projects: {} };
  const cleanProjects: Record<string, string> = {};
  for (const [projPath, slug] of Object.entries(rawProjects.projects ?? {})) {
    const normalizedPath = projPath.toLowerCase();
    const sanitizedSlug = String(slug)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (sanitizedSlug) {
      cleanProjects[normalizedPath] = sanitizedSlug;
    }
  }
  cleanProjects["c:\\src"] = cleanProjects["c:\\src"] ?? "src";
  cleanProjects["c:\\src\\apps\\shenron"] = "apps-shenron";
  cleanProjects["c:\\src\\apps\\aphrody"] = "apps-aphrody";
  cleanProjects["c:\\src\\apps\\rosegriffon"] = "apps-rosegriffon";
  cleanProjects["c:\\src\\packages\\ai-triad"] = "ai-triad";
  writeFileSync(
    geminiProjectsPath,
    `${JSON.stringify({ projects: cleanProjects }, null, 2)}\n`,
    "utf8",
  );
  updatedFiles.push(geminiProjectsPath);

  // 5. OpenCode (~/.config/opencode/opencode.jsonc)
  const opencodePath = join(home, ".config", "opencode", "opencode.jsonc");
  if (existsSync(opencodePath)) {
    backupOnce(opencodePath, backupsCreated);
    const { headerComments, jsonBody } = stripLeadingLineComments(
      readFileSync(opencodePath, "utf8"),
    );
    const ocObj = JSON.parse(jsonBody) as Record<string, unknown>;
    const ocMcp =
      ocObj.mcp && typeof ocObj.mcp === "object"
        ? (ocObj.mcp as Record<string, unknown>)
        : {};
    ocObj.mcp = {
      ...ocMcp,
      ai_os: {
        type: "local",
        command: ["C:/Users/aphro/.local/bin/ai-os.exe", "mcp-stdio"],
        enabled: true,
      },
      ai_triad: {
        type: "local",
        command: ["C:/Users/aphro/.local/bin/triad.exe", "mcp-stdio"],
        enabled: true,
      },
    };
    const ocProviders =
      ocObj.providers && typeof ocObj.providers === "object"
        ? (ocObj.providers as Record<string, unknown>)
        : {};
    ocObj.providers = {
      ...ocProviders,
      ai_triad: {
        name: "Sovereign AI Triad Unified Router (:4319)",
        baseUrl: "http://127.0.0.1:4319/v1",
        apiKey: "triad-local",
        models: [
          "triad/auto",
          "triad/claude",
          "triad/codex",
          "triad/agy",
          "triad/council",
        ],
      },
    };
    writeFileSync(
      opencodePath,
      `${headerComments}${JSON.stringify(ocObj, null, 2)}\n`,
      "utf8",
    );
    updatedFiles.push(opencodePath);
  }

  // 6. Zed (%APPDATA%/Zed/settings.json)
  const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
  const zedSettingsPath = join(appData, "Zed", "settings.json");
  if (existsSync(zedSettingsPath)) {
    backupOnce(zedSettingsPath, backupsCreated);
    const { headerComments, jsonBody } = stripLeadingLineComments(
      readFileSync(zedSettingsPath, "utf8"),
    );
    const zedObj = JSON.parse(jsonBody) as Record<string, unknown>;
    const lm =
      zedObj.language_models && typeof zedObj.language_models === "object"
        ? (zedObj.language_models as Record<string, unknown>)
        : {};
    const oaiCompat =
      lm.openai_compatible && typeof lm.openai_compatible === "object"
        ? (lm.openai_compatible as Record<string, unknown>)
        : {};
    lm.openai_compatible = {
      ...oaiCompat,
      ai_triad: {
        api_url: "http://127.0.0.1:4319/v1",
        available_models: [
          {
            name: "triad/auto",
            display_name:
              "AI Triad Auto Router (AGY -> Claude -> Codex -> Local)",
            max_tokens: 200000,
          },
          {
            name: "triad/council",
            display_name: "AI Triad Parallel Council (Codex + AGY + Claude)",
            max_tokens: 200000,
          },
        ],
      },
    };
    zedObj.language_models = lm;

    const ctxServers =
      zedObj.context_servers && typeof zedObj.context_servers === "object"
        ? (zedObj.context_servers as Record<string, unknown>)
        : {};
    zedObj.context_servers = {
      ...ctxServers,
      "ai-os": {
        source: "custom",
        enabled: true,
        command: {
          path: "C:/Users/aphro/.local/bin/ai-os.exe",
          args: ["mcp-stdio"],
          env: {},
        },
      },
      "ai-triad": {
        source: "custom",
        enabled: true,
        command: {
          path: "C:/Users/aphro/.local/bin/triad.exe",
          args: ["mcp-stdio"],
          env: {},
        },
      },
    };

    writeFileSync(
      zedSettingsPath,
      `${headerComments}${JSON.stringify(zedObj, null, 2)}\n`,
      "utf8",
    );
    updatedFiles.push(zedSettingsPath);
  }

  return { updatedFiles, backupsCreated };
}
