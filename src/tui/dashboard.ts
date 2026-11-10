import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inspectCrossAuthStatus } from "../auth/cross-auth.ts";
import { discoverBinaries } from "../discovery.ts";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
};

function pad(str: string, width: number): string {
  const clean = str.replace(/\x1b\[[0-9;]*m/g, "");
  if (clean.length >= width) {
    return str.slice(0, str.length - (clean.length - width));
  }
  return str + " ".repeat(width - clean.length);
}

export function listClonedEcosystemRepos(
  ecosystemRoot = process.platform === "win32"
    ? "C:\\src\\third_party\\ai-ecosystem"
    : "/src/third_party/ai-ecosystem",
): Array<{ name: string; path: string; hasGit: boolean }> {
  if (!existsSync(ecosystemRoot)) return [];
  try {
    return readdirSync(ecosystemRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const full = join(ecosystemRoot, d.name);
        return {
          name: d.name,
          path: full,
          hasGit: existsSync(join(full, ".git")),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function renderTriadDashboard(options?: {
  noColor?: boolean;
  skipCliProbes?: boolean;
}): Promise<string> {
  const c = options?.noColor
    ? {
        reset: "",
        bold: "",
        dim: "",
        cyan: "",
        green: "",
        yellow: "",
        blue: "",
        white: "",
      }
    : ANSI;

  const binaries = discoverBinaries();
  const auth = await inspectCrossAuthStatus({
    skipCliProbes: options?.skipCliProbes,
  });
  const repos = listClonedEcosystemRepos();

  const lines: string[] = [];
  const rule = `${c.dim}${"=".repeat(88)}${c.reset}`;

  lines.push(rule);
  lines.push(
    `${c.bold}${c.cyan}SOVEREIGN AI TRIAD CONTROL PLANE${c.reset} ${c.dim}(Bun v${Bun.version} | MCP 2025-03-26 | ACP v1 | OAuth 2.1 PKCE)${c.reset}`,
  );
  lines.push(rule);
  lines.push("");

  lines.push(`${c.bold}${c.blue}[1] CLI / TUI TOOLCHAINS${c.reset}`);
  lines.push(
    `${c.dim}${pad("ID", 12)} ${pad("STATUS", 10)} ${pad("VERSION", 28)} EXECUTABLE${c.reset}`,
  );
  for (const b of binaries) {
    const badge = b.installed
      ? `${c.green}READY${c.reset}`
      : `${c.yellow}MISSING${c.reset}`;
    lines.push(
      `${pad(b.id, 12)} ${pad(badge, 10)} ${pad(b.version, 28)} ${b.executable}`,
    );
  }
  lines.push("");

  lines.push(
    `${c.bold}${c.blue}[2] CROSS-AUTH & CREDENTIAL BROKER (REDACTED)${c.reset}`,
  );
  lines.push(
    `${c.dim}${pad("PROVIDER", 22)} ${pad("READY", 8)} ${pad("MECHANISM", 34)} ENV SUMMARY${c.reset}`,
  );
  for (const a of auth) {
    const badge = a.ready
      ? `${c.green}YES${c.reset}`
      : `${c.yellow}NO${c.reset}`;
    lines.push(
      `${pad(a.provider, 22)} ${pad(badge, 8)} ${pad(a.mechanism, 34)} ${a.envStatus}`,
    );
  }
  lines.push("");

  lines.push(
    `${c.bold}${c.blue}[3] UPSTREAM OPEN-SOURCE AI ECOSYSTEM (${repos.length} REPOS)${c.reset}`,
  );
  for (const r of repos) {
    const tag = r.hasGit
      ? `${c.green}git-ok${c.reset}`
      : `${c.yellow}dir-only${c.reset}`;
    lines.push(`  - ${pad(r.name, 26)} [${tag}]  ${r.path}`);
  }
  lines.push(rule);

  return lines.join("\n");
}
