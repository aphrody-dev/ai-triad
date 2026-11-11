import {
  buildAuthorizationUrl,
  generatePkcePair,
  inspectCrossAuthStatus,
} from "./auth/cross-auth.ts";
import { generateCiTemplates, writeCiTemplatesToDir } from "./ci/templates.ts";
import { syncAllTriadConfigs } from "./config/sync-configs.ts";
import { discoverBinaries, type TriadAgentId } from "./discovery.ts";
import { captureAllCliHelpDocs } from "./docs/help-corpus.ts";
import { routeTask, runAgent, runCouncil } from "./runners/triad-runner.ts";
import { runTriadMcpStdio, startTriadGatewayServer } from "./server/gateway.ts";
import { renderTriadDashboard } from "./tui/dashboard.ts";

const HELP_TEXT = `Sovereign AI Triad CLI (@aphrody/ai-triad v1.0.0)
Bidirectional Cross-AI CLI / TUI / GUI / OAuth / MCP / CI Hub for Codex, Antigravity, Claude Code, OpenCode, Pi, and Zed.

Usage:
  triad <command> [options]

Commands:
  doctor | tui                 Render live ANSI dashboard of CLIs, Cross-Auth, and upstream AI repos
  auth-status [--json]         Inspect redacted read-only auth readiness across all providers
  pkce-demo [--client-id ID]   Generate RFC 7636 PKCE S256 verifier/challenge & sample OAuth 2.1 URL
  sync-configs                 Idempotently configure Codex, Claude Code, Antigravity, Gemini, OpenCode, and Zed
  capture-help                 Capture live --help & subcommand corpus into docs/*.md
  serve [--port 4319]          Start HTTP + WebGUI + OpenAI/Anthropic/Responses/MCP Gateway
  mcp-stdio                    Run MCP 2025-03-26 JSON-RPC server over stdio
  ask <agent> <prompt>         Run headless agent (claude | codex | agy | gemini | auto)
  council <prompt>             Run codex, agy, and claude in parallel and print consensus summary
  ci-gen [--out DIR]           Generate GitHub Actions, Sovereign Forge, PowerShell, and POSIX CI templates
  help | --help                Show this help text
`;

function parseFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const cmd = argv[0] ?? "help";

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    process.stdout.write("triad 1.0.0 (Bun v" + Bun.version + ")\n");
    return 0;
  }

  if (cmd === "mcp-stdio") {
    await runTriadMcpStdio();
    return 0;
  }

  if (cmd === "doctor" || cmd === "tui") {
    const noColor = argv.includes("--no-color");
    const board = await renderTriadDashboard({ noColor });
    process.stdout.write(`${board}\n`);
    return 0;
  }

  if (cmd === "auth-status") {
    const statuses = await inspectCrossAuthStatus({
      skipCliProbes: argv.includes("--fast"),
    });
    if (argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify(statuses, null, 2)}\n`);
    } else {
      for (const s of statuses) {
        process.stdout.write(
          `[${s.ready ? "READY" : "UNSET"}] ${s.provider.padEnd(20)} | ${s.mechanism.padEnd(32)} | ${s.envStatus}\n`,
        );
      }
    }
    return 0;
  }

  if (cmd === "pkce-demo") {
    const clientId =
      parseFlagValue(argv, "--client-id") ?? "sovereign-triad-cli";
    const pair = generatePkcePair(32);
    const authUrl = buildAuthorizationUrl({
      authorizationEndpoint: "http://127.0.0.1:4320/oauth/authorize",
      clientId,
      redirectUri: "http://127.0.0.1:4319/oauth/callback",
      codeChallenge: pair.codeChallenge,
      scope: ["openid", "profile", "inference"],
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          codeChallengeMethod: pair.codeChallengeMethod,
          codeChallenge: pair.codeChallenge,
          verifierLength: pair.codeVerifier.length,
          authorizationUrl: authUrl.url,
          state: authUrl.state,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  if (cmd === "sync-configs") {
    const report = syncAllTriadConfigs();
    process.stdout.write(
      `Synced ${report.updatedFiles.length} configuration files (${report.backupsCreated.length} new backups).\n`,
    );
    for (const f of report.updatedFiles) {
      process.stdout.write(`  updated: ${f}\n`);
    }
    return 0;
  }

  if (cmd === "capture-help") {
    const written = captureAllCliHelpDocs();
    process.stdout.write(
      `Captured ${written.length} Markdown reference files:\n`,
    );
    for (const f of written) {
      process.stdout.write(`  wrote: ${f}\n`);
    }
    return 0;
  }

  if (cmd === "ci-gen") {
    const outDir = parseFlagValue(argv, "--out");
    if (outDir) {
      const written = writeCiTemplatesToDir(outDir);
      process.stdout.write(
        `Generated ${written.length} CI files in ${outDir}:\n`,
      );
      for (const w of written) {
        process.stdout.write(`  wrote: ${w}\n`);
      }
    } else {
      const templates = generateCiTemplates();
      process.stdout.write(templates.githubActionsYaml);
    }
    return 0;
  }

  if (cmd === "serve") {
    const portStr = parseFlagValue(argv, "--port");
    const port = portStr ? Number.parseInt(portStr, 10) : 4319;
    const hostname = parseFlagValue(argv, "--host") ?? "127.0.0.1";
    const srv = startTriadGatewayServer({ port, hostname });
    process.stdout.write(
      `Sovereign AI Triad Gateway listening on http://${srv.hostname}:${srv.port}\n`,
    );
    await new Promise(() => {
      // Keep server alive until terminated
    });
    return 0;
  }

  if (cmd === "ask") {
    const target = argv[1] ?? "auto";
    const prompt = argv.slice(2).join(" ").trim();
    if (!prompt) {
      process.stderr.write(
        "Usage: triad ask <claude|codex|agy|gemini|auto> <prompt>\n",
      );
      return 1;
    }
    const res =
      target === "auto"
        ? await routeTask({ prompt })
        : await runAgent(target as TriadAgentId, { prompt });
    if (res.ok) {
      process.stdout.write(`${res.output}\n`);
      return 0;
    }
    process.stderr.write(`Error (${res.agent}): ${res.error ?? "failed"}\n`);
    return 1;
  }

  if (cmd === "council") {
    const prompt = argv.slice(1).join(" ").trim();
    if (!prompt) {
      process.stderr.write("Usage: triad council <prompt>\n");
      return 1;
    }
    const report = await runCouncil(prompt);
    process.stdout.write(`${report.consensusSummary}\n`);
    return report.succeededCount > 0 ? 0 : 1;
  }

  if (cmd === "binaries") {
    process.stdout.write(`${JSON.stringify(discoverBinaries(), null, 2)}\n`);
    return 0;
  }

  process.stderr.write(`Unknown command: ${cmd}\n\n${HELP_TEXT}`);
  return 1;
}

if (import.meta.main) {
  runCli().then((code) => {
    if (code !== 0) process.exit(code);
  });
}
