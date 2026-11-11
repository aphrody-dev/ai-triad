# `@aphrody/ai-triad`

Cross-AI CLI, TUI, WebGUI, OAuth 2.1 / PKCE / RFC 8628 Device Authorization, MCP `2025-03-26`, ACP v1, and Multi-Protocol Gateway uniting **OpenAI Codex (`codex`)**, **Google Antigravity (`agy` + `gemini`)**, **Anthropic Claude Code (`claude`)**, **OpenCode**, **Pi**, and **Zed** in pure **Bun v1.4.4**.

## Quick Commands

```sh
# TUI / Diagnostics Dashboard
triad doctor

# Redacted Cross-Auth & OAuth Readiness Matrix
triad auth-status

# Idempotently sync Codex, Claude Code, Antigravity, Gemini, OpenCode, and Zed configs
triad sync-configs

# Start HTTP + WebGUI + OpenAI (/v1/chat/completions, /v1/responses) + Anthropic (/v1/messages) + MCP (/mcp) server
triad serve --port 4319

# Run MCP 2025-03-26 server over stdio (wired into Claude, Codex, Antigravity, OpenCode, and Zed)
triad mcp-stdio

# Generate GitHub Actions, Sovereign Forge, PowerShell, and POSIX CI pipelines
triad ci-gen --out C:/src/packages/ai-triad

# Regenerate live CLI --help corpus
triad capture-help
```

## Documentation Corpus

- [CLAUDE_CLI_HELP.md](./docs/CLAUDE_CLI_HELP.md)
- [CODEX_CLI_HELP.md](./docs/CODEX_CLI_HELP.md)
- [AGY_GEMINI_CLI_HELP.md](./docs/AGY_GEMINI_CLI_HELP.md)
- [CROSS_PROVIDER_ARCHITECTURE.md](./docs/CROSS_PROVIDER_ARCHITECTURE.md)
