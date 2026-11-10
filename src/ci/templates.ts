import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface CiTemplateBundle {
  githubActionsYaml: string;
  sovereignForgeToml: string;
  powershellScript: string;
  posixScript: string;
}

export function generateCiTemplates(): CiTemplateBundle {
  const githubActionsYaml = `name: Sovereign AI Triad Verification
on:
  pull_request:
    branches: [main]
  workflow_dispatch:
    inputs:
      prompt:
        description: "Verification prompt for Triad Council"
        required: false
        default: "Review changed TypeScript and Rust files for safety, memory, and regression issues."

permissions:
  contents: read
  pull-requests: write

jobs:
  triad-council:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Bun v1.4.4
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Run Format, Typecheck, and Unit Tests
        working-directory: packages/ai-triad
        run: |
          bun fmt --check
          bun check
          bun test

      - name: Headless Multi-CLI Review (Claude + Codex + Antigravity)
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
          GEMINI_API_KEY: \${{ secrets.GEMINI_API_KEY }}
        run: |
          if command -v claude >/dev/null 2>&1 && [ -n "\${ANTHROPIC_API_KEY:-}" ]; then
            claude -p "\${{ inputs.prompt || 'Audit PR diff for regressions' }}" --output-format json > claude-review.json
          fi
          if command -v codex >/dev/null 2>&1 && [ -n "\${OPENAI_API_KEY:-}" ]; then
            codex exec review --json > codex-review.jsonl || true
          fi
          if command -v agy >/dev/null 2>&1 && [ -n "\${GEMINI_API_KEY:-}" ]; then
            agy -p "\${{ inputs.prompt || 'Audit PR diff for regressions' }}" --output-format json --mode plan > agy-review.json
          fi
`;

  const sovereignForgeToml = `# Sovereign Forge (frg) Pipeline — AI Triad Autonomous Gate
[pipeline]
name = "ai-triad-gate"
workspace = "C:/src/packages/ai-triad"

[[stages]]
name = "static-verification"
commands = [
  "bun fmt --check",
  "bun check",
  "bun test"
]

[[stages]]
name = "triad-council-audit"
commands = [
  "triad doctor",
  "claude -p \\"Verify zero secret leaks and strict TypeScript types\\" --output-format json",
  "codex exec \\"Verify Rust and Bun ABI boundaries\\" --json --skip-git-repo-check",
  "agy -p \\"Verify MCP 2025-03-26 and ACP protocol conformance\\" --output-format json --mode plan"
]
`;

  const powershellScript = `$ErrorActionPreference = "Stop"
param(
  [string]$Prompt = "Run concise security and type-safety review of current git diff."
)

Write-Host "[Triad CI] Running headless Claude, Codex, and Antigravity checks..."
if (Get-Command claude.exe -ErrorAction SilentlyContinue) {
  & claude.exe -p $Prompt --output-format json | Out-File -Encoding utf8 triad-claude.json
}
if (Get-Command codex.cmd -ErrorAction SilentlyContinue) {
  & codex.cmd exec $Prompt --json --skip-git-repo-check | Out-File -Encoding utf8 triad-codex.jsonl
}
if (Get-Command agy.cmd -ErrorAction SilentlyContinue) {
  & agy.cmd -p $Prompt --output-format json --mode plan | Out-File -Encoding utf8 triad-agy.json
}
Write-Host "[Triad CI] Completed."
`;

  const posixScript = `#!/usr/bin/env sh
set -eu
PROMPT="\${1:-Run concise security and type-safety review of current git diff.}"

echo "[Triad CI] Running headless Claude, Codex, and Antigravity checks..."
if command -v claude >/dev/null 2>&1; then
  claude -p "$PROMPT" --output-format json > triad-claude.json
fi
if command -v codex >/dev/null 2>&1; then
  codex exec "$PROMPT" --json --skip-git-repo-check > triad-codex.jsonl
fi
if command -v agy >/dev/null 2>&1; then
  agy -p "$PROMPT" --output-format json --mode plan > triad-agy.json
fi
echo "[Triad CI] Completed."
`;

  return {
    githubActionsYaml,
    sovereignForgeToml,
    powershellScript,
    posixScript,
  };
}

export function writeCiTemplatesToDir(outRoot: string): string[] {
  const bundle = generateCiTemplates();
  const files: Array<{ path: string; content: string }> = [
    {
      path: join(outRoot, ".github", "workflows", "triad-agent.yml"),
      content: bundle.githubActionsYaml,
    },
    {
      path: join(outRoot, "ci", "forge-triad.toml"),
      content: bundle.sovereignForgeToml,
    },
    {
      path: join(outRoot, "ci", "triad-headless.ps1"),
      content: bundle.powershellScript,
    },
    {
      path: join(outRoot, "ci", "triad-headless.sh"),
      content: bundle.posixScript,
    },
  ];

  const written: string[] = [];
  for (const f of files) {
    mkdirSync(dirname(f.path), { recursive: true });
    writeFileSync(f.path, f.content, "utf8");
    written.push(f.path);
  }
  return written;
}
