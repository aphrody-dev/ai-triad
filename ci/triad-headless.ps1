$ErrorActionPreference = "Stop"
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
