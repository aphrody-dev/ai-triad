#!/usr/bin/env sh
set -eu
PROMPT="${1:-Run concise security and type-safety review of current git diff.}"

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
