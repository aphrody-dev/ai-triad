import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type TriadAgentId =
  "claude" | "codex" | "agy" | "gemini" | "pi-opencode" | "ai-os";

export interface BinaryInfo {
  id: string;
  label: string;
  executable: string;
  shimPath?: string;
  installed: boolean;
  version: string;
  configDir: string;
}

const SECRET_KEY_RE =
  /(TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|AUTH|CREDENTIAL|DATABASE_URL|ADMIN_KEY|NUGET_API_KEY|SESSION_KEY|REFRESH_TOKEN|ACCESS_TOKEN|ID_TOKEN)/i;

const SECRET_VAL_RE =
  /^(sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,}|figd_[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|vcp_[A-Za-z0-9_-]{8,}|ctx7sk-[A-Za-z0-9_-]{8,}|ya29\.[A-Za-z0-9_-]{8,})/;

export function isSensitiveKey(key: string, value = ""): boolean {
  if (
    key.endsWith("_DIR") ||
    key.endsWith("_PATH") ||
    key.endsWith("_HOME") ||
    (key.endsWith("_URL") && !/DATABASE_URL|WEBHOOK_URL/i.test(key))
  ) {
    return SECRET_VAL_RE.test(value);
  }
  return SECRET_KEY_RE.test(key) || SECRET_VAL_RE.test(value);
}

export function redactSecret(value: string | undefined | null): string {
  if (!value || value.length === 0) return "UNSET";
  return `SET [redacted, len=${value.length}]`;
}

export function redactTextSecrets(text: string): string {
  return text
    .replace(
      /\b(sk-[A-Za-z0-9_-]{10,}|AIza[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,}|figd_[A-Za-z0-9_-]{10,}|vcp_[A-Za-z0-9_-]{10,}|ctx7sk-[A-Za-z0-9_-]{10,}|ya29\.[A-Za-z0-9_.-]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})\b/g,
      (match) => `[REDACTED:len=${match.length}]`,
    )
    .replace(
      /(Bearer\s+)([A-Za-z0-9_.-]{12,})/gi,
      (_full, prefix: string, tok: string) =>
        `${prefix}[REDACTED:len=${tok.length}]`,
    );
}

export function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice(7).trim()
      : trimmed;
    const eqIdx = normalized.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = normalized.slice(0, eqIdx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let rawVal = normalized.slice(eqIdx + 1).trim();
    if (
      (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
      (rawVal.startsWith("'") && rawVal.endsWith("'"))
    ) {
      rawVal = rawVal.slice(1, -1);
    } else {
      const commentIdx = rawVal.search(/\s+#/);
      if (commentIdx >= 0) rawVal = rawVal.slice(0, commentIdx).trim();
    }
    out[key] = rawVal;
  }
  return out;
}

export function loadMergedEnv(
  envFilePath = process.platform === "win32" ? "C:\\src\\.env" : "/src/.env",
): Record<string, string> {
  const merged: Record<string, string> = {};
  if (existsSync(envFilePath)) {
    try {
      const parsed = parseDotEnv(readFileSync(envFilePath, "utf8"));
      for (const [k, v] of Object.entries(parsed)) {
        merged[k] = v;
      }
    } catch {
      // Ignore unreadable env file
    }
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") {
      merged[k] = v;
    }
  }
  return merged;
}

export function resolveCodexExecutable(home = homedir()): string {
  if (process.platform !== "win32") {
    const unixCandidate = join(home, ".local", "bin", "codex");
    return existsSync(unixCandidate) ? unixCandidate : "codex";
  }

  const localAppData =
    process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  const primary = join(
    localAppData,
    "Programs",
    "OpenAI",
    "Codex",
    "bin",
    "codex.exe",
  );
  if (existsSync(primary)) return primary;

  const vscodeExtRoot = join(home, ".vscode", "extensions");
  if (existsSync(vscodeExtRoot)) {
    try {
      const matches = readdirSync(vscodeExtRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith("openai.chatgpt-"))
        .map((d) => d.name)
        .sort()
        .reverse();
      for (const extDir of matches) {
        const candidate = join(
          vscodeExtRoot,
          extDir,
          "bin",
          "windows-x86_64",
          "codex.exe",
        );
        if (existsSync(candidate)) return candidate;
      }
    } catch {
      // Ignore directory enumeration failure
    }
  }

  const shim = join(home, ".local", "bin", "codex.cmd");
  return existsSync(shim) ? shim : primary;
}

export function resolveBinaryCatalog(home = homedir()): Record<
  string,
  {
    label: string;
    executable: string;
    shimPath?: string;
    configDir: string;
    versionArgs: string[];
  }
> {
  const isWin = process.platform === "win32";
  const localBin = join(home, ".local", "bin");
  const localAppData =
    process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");

  return {
    claude: {
      label: "Anthropic Claude Code",
      executable: isWin
        ? join(localBin, "claude.exe")
        : join(localBin, "claude"),
      configDir: join(home, ".claude"),
      versionArgs: ["--version"],
    },
    codex: {
      label: "OpenAI Codex CLI (Rust)",
      executable: resolveCodexExecutable(home),
      shimPath: isWin ? join(localBin, "codex.cmd") : undefined,
      configDir: join(home, ".codex"),
      versionArgs: ["--version"],
    },
    agy: {
      label: "Google Antigravity CLI",
      executable: isWin
        ? join(localAppData, "agy", "bin", "agy.exe")
        : join(localBin, "agy"),
      shimPath: isWin ? join(localBin, "agy.cmd") : undefined,
      configDir: join(home, ".gemini", "antigravity-cli"),
      versionArgs: ["--version"],
    },
    gemini: {
      label: "Google Gemini CLI",
      executable: isWin
        ? join(home, ".bun", "bin", "gemini.exe")
        : join(home, ".bun", "bin", "gemini"),
      configDir: join(home, ".gemini"),
      versionArgs: ["--version"],
    },
    opencode: {
      label: "OpenCode / Pi-OpenCode",
      executable: isWin
        ? join(localBin, "pi-opencode.exe")
        : join(localBin, "pi-opencode"),
      configDir: join(home, ".config", "opencode"),
      versionArgs: ["--help"],
    },
    aios: {
      label: "Sovereign AI-OS",
      executable: isWin ? join(localBin, "ai-os.exe") : join(localBin, "ai-os"),
      configDir: isWin ? "C:\\src\\packages\\ai-os" : "/src/packages/ai-os",
      versionArgs: ["--help"],
    },
  };
}

export function runCommandCapture(
  cmd: string[],
  options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
): { exitCode: number; stdout: string; stderr: string } {
  try {
    const proc = Bun.spawnSync(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      cwd: options?.cwd,
      env: options?.env ?? (process.env as Record<string, string>),
      timeout: options?.timeoutMs ?? 15000,
    });
    const decoder = new TextDecoder();
    return {
      exitCode: proc.exitCode,
      stdout: decoder.decode(proc.stdout).trim(),
      stderr: decoder.decode(proc.stderr).trim(),
    };
  } catch (err) {
    return {
      exitCode: 127,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

export function discoverBinaries(home = homedir()): BinaryInfo[] {
  const catalog = resolveBinaryCatalog(home);
  const results: BinaryInfo[] = [];

  for (const [id, spec] of Object.entries(catalog)) {
    const installed = existsSync(spec.executable);
    let version = "not-installed";
    if (installed) {
      if (id === "opencode" || id === "aios") {
        version = "installed (AOT)";
      } else {
        const res = runCommandCapture([spec.executable, ...spec.versionArgs], {
          timeoutMs: 8000,
        });
        const firstLine = (res.stdout || res.stderr).split(/\r?\n/)[0]?.trim();
        version = firstLine || `exit=${res.exitCode}`;
      }
    }
    results.push({
      id,
      label: spec.label,
      executable: spec.executable,
      shimPath: spec.shimPath,
      installed,
      version,
      configDir: spec.configDir,
    });
  }

  return results;
}
