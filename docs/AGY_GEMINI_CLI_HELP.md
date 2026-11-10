# Google Antigravity CLI (v1.5.5) & Gemini CLI (v0.66.0) Live Help Corpus

Captured directly from `C:\Users\aphro\AppData\Local\agy\bin\agy.exe` (`agy.cmd`) and `C:\Users\aphro\.bun\bin\gemini.exe`.

## `agy --help`

```text
Usage of agy.exe:
  --add-dir                       Add a directory to the workspace (repeatable) (default [])
  --agent                         Agent for the current CLI session
  -c                              Short alias for --continue
  --continue                      Continue the most recent conversation
  --conversation                  Resume a previous conversation by ID
  --dangerously-skip-permissions  Auto-approve all tool permission requests without prompting
  --disable-slash-commands        Disable slash command and skill expansion in print mode
  --effort                        Reasoning effort for the current CLI session (low|medium|high|xhigh|max)
  -i                              Short alias for --prompt-interactive
  --input-format                  Input format for print mode (text, stream-json). stream-json reads one NDJSON message per line from stdin and runs a turn for each; it requires --output-format stream-json (default text)
  --json-schema                   Optional JSON schema string or path to a schema file to enforce structured output (for stream-json, only applicable to the final result)
  --log-file                      Override CLI log file path
  --mode                          Set the agent execution mode for this session (accept-edits, auto, plan)
  --model                         Model for the current CLI session
  --new-project                   Create a new project for this session
  --output-format                 Output format for print mode (text, json, stream-json) (default text)
  -p                              Short alias for --print
  --print                         Run a single prompt non-interactively and print the response
  --print-timeout                 Optional time limit for print mode; 0 waits until the turn completes (default 0s)
  --project                       Project ID or project name for the current CLI session
  --prompt                        Alias for --print
  --prompt-interactive            Run an initial prompt interactively and continue the session
  --remote-agent                  Run this session's conversations using remote agents; --project then names a remote project by ID or name, otherwise they open in this machine's default remote project
  --remote-control                Create a remote connection for the CLI session on start up
  --sandbox                       Run in a sandbox with terminal restrictions enabled
  --settings                      Settings for this session only, never saved: a JSON object of settings.json keys, inline or as a file path

Available subcommands:
  acp             Start the Agent Client Protocol (ACP) stdio server
  agent           List available agents
  agents          List available agents
  changelog       Show changelog and release notes
  help            Show help for subcommands
  install         Configure environment paths and shell settings
  mcp             Manage MCP servers (add, remove, list, enable, disable)
  mic-serve       Serve this machine's microphone to a CLI on another host
  models          List available models
  plugin          Manage plugins (install, uninstall, list, enable, disable)
  plugins         Alias for plugin
  remote-control  Manage the remote-control background daemon (start, status, stop)
  update          Update CLI
```

## `agy mcp --help`

```text
Usage: agy.exe mcp <subcommand> [flags] [args]

Available subcommands:
  add      Add or update an MCP server configuration
  remove   Remove an MCP server configuration
  list     List all configured MCP servers
  enable   Enable an MCP server
  disable  Disable an MCP server

Run "agy.exe mcp <subcommand> --help" for flags, argument rules, and examples.
```

## `agy acp --help`

```text
Usage: agy.exe acp [flags]

Start the Agent Client Protocol (ACP) stdio server

Flags:
  --add-dir                         Add a directory to the workspace (repeatable) (default [])
  --agent                           Agent for the ACP session
  --app-data-dir                    Path where application data is stored (default antigravity-cli)
  --app_data_dir                    Path where application data is stored (default antigravity-cli)
  --cli_dir_name                    Subdirectory under app_data_dir for CLI settings and logs
  --cli_log_file                    Override ACP log file path
  --cloud_code_endpoint             CCPA API URL (default https://daily-cloudcode-pa.googleapis.com)
  --dangerously-skip-permissions    Auto-approve all tool permission requests
  --disable-telemetry               If true, disable telemetry
  --disable_telemetry               If true, disable telemetry
  --gemini-dir                      Path where Gemini files are stored (default .gemini)
  --gemini_dir                      Path where Gemini files are stored (default .gemini)
  -h                                Show help
  --help                            Show help
  --ide-mcp-port                    Port for host IDE tools MCP server (requires 'nc' in $PATH) (default 0)
  --ide_mcp_port                    Port for host IDE tools MCP server (requires 'nc' in $PATH) (default 0)
  --include-default-customizations  Include default customizations (default true)
  --is_google3_workspace            Whether running in Google environment
  --is_google_internal              Deprecated: use is_google3_workspace
  --log-file                        Override ACP log file path
  --login                           Log in with Google interactively, then exit (ACP terminal auth)
  --override_user_agent_name        Override user agent name for HTTP requests
  --process-per-session             Serve each session from an isolated worker process
  --sandbox                         Run in a sandbox with terminal restrictions enabled
  --stdio                           Use stdio JSON-RPC transport (default)
  --use_stubby_auth                 Use LOAS auth
  --worker                          Serve a single session for an ACP front process (internal)
```

## `agy models --help`

```text
Usage: agy.exe models [flags]

List available models

Flags:
  -h      Show help
  --help  Show help
```

## `agy plugin --help`

```text
Usage: agy.exe plugin <command> [arguments]

Commands:
  list [--json]          List installed plugins
  import [source]        Import plugins from gemini or claude
  install <target>       Install a plugin (supports plugin[@marketplace])
  uninstall <name>       Uninstall a plugin
  enable <name>          Enable a plugin
  disable <name>         Disable a plugin
  validate [path] [--strict] [--json]
                         Check a plugin's manifest and files
  link <mp> <target>     Generate link to a marketplace
  help                   Show this help
```

## `agy agents --help`

```text
Usage: agy.exe agent [flags]

List available agents

Flags:
  -h      Show help
  --help  Show help
```

## `agy remote-control --help`

```text
Usage: agy.exe remote-control <subcommand>

Available subcommands:
  start    Register and start the remote-control daemon
  status   Show the daemon's status
  stop     Stop the daemon and unregister it

Run "agy.exe remote-control <subcommand> --help" for flags.
```

## `gemini --help`

```text
Usage: gemini [options] [command]

Gemini CLI - Defaults to interactive mode. Use -p/--prompt for non-interactive (headless) mode.

Commands:
  gemini mcp                   Manage MCP servers
  gemini extensions <command>  Manage Gemini CLI extensions.  [aliases: extension]
  gemini skills <command>      Manage agent skills.  [aliases: skill]
  gemini hooks <command>       Manage Gemini CLI hooks.  [aliases: hook]
  gemini gemma                 Manage local Gemma model routing
  gemini [query..]             Launch Gemini CLI  [default]

Positionals:
  query  Initial prompt. Runs in interactive mode by default; use -p/--prompt for non-interactive.

Options:
  -d, --debug                     Run in debug mode (open debug console with F12)  [boolean] [default: false]
  -m, --model                     Model  [string]
  -p, --prompt                    Run in non-interactive (headless) mode with the given prompt. Appended to input on stdin (if any).  [string]
  -i, --prompt-interactive        Execute the provided prompt and continue in interactive mode  [string]
      --skip-trust                Trust the current workspace for this session.  [boolean] [default: false]
  -w, --worktree                  Start Gemini in a new git worktree. If no name is provided, one is generated automatically.  [string]
  -s, --sandbox                   Run in sandbox?  [boolean]
  -y, --yolo                      Automatically accept all actions (aka YOLO mode, see https://www.youtube.com/watch?v=xvFZjo5PgG0 for more details)?  [boolean] [default: false]
      --approval-mode             Set the approval mode: default (prompt for approval), auto_edit (auto-approve edit tools), yolo (auto-approve all tools), plan (read-only mode)  [string] [choices: "default", "auto_edit", "yolo", "plan"]
      --policy                    Additional policy files or directories to load (comma-separated or multiple --policy)  [array]
      --admin-policy              Additional admin policy files or directories to load (comma-separated or multiple --admin-policy)  [array]
      --acp                       Starts the agent in ACP mode  [boolean]
      --experimental-acp          Starts the agent in ACP mode (deprecated, use --acp instead)  [boolean]
      --allowed-mcp-server-names  Allowed MCP server names  [array]
      --allowed-tools             [DEPRECATED: Use Policy Engine instead See https://geminicli.com/docs/core/policy-engine] Tools that are allowed to run without confirmation  [array]
  -e, --extensions                A list of extensions to use. If not provided, all extensions are used.  [array]
  -l, --list-extensions           List all available extensions and exit.  [boolean]
  -r, --resume                    Resume a previous session. Use "latest" for most recent or index number (e.g. --resume 5)  [string]
      --session-file              Load a session from a JSON file  [string]
      --session-id                Start a new session with a manually provided UUID.  [string]
      --list-sessions             List available sessions for the current project and exit.  [boolean]
      --delete-session            Delete a session by index number (use --list-sessions to see available sessions).  [string]
      --include-directories       Additional directories to include in the workspace (comma-separated or multiple --include-directories)  [array]
      --screen-reader             Enable screen reader mode for accessibility.  [boolean]
  -o, --output-format             The format of the CLI output.  [string] [choices: "text", "json", "stream-json"]
      --raw-output                Disable sanitization of model output (e.g. allow ANSI escape sequences). WARNING: This can be a security risk if the model output is untrusted.  [boolean]
      --accept-raw-output-risk    Suppress the security warning when using --raw-output.  [boolean]
  -v, --version                   Show version number  [boolean]
  -h, --help                      Show help  [boolean]
```

## `gemini mcp --help`

```text
gemini mcp

Manage MCP servers

Commands:
  gemini mcp add <name> <commandOrUrl> [args...]  Add a server
  gemini mcp remove <name>                        Remove a server
  gemini mcp list                                 List all configured MCP servers
  gemini mcp enable <name>                        Enable an MCP server
  gemini mcp disable <name>                       Disable an MCP server

Options:
  -d, --debug  Run in debug mode (open debug console with F12)  [boolean] [default: false]
  -h, --help   Show help  [boolean]
```

## `gemini skills --help`

```text
gemini skills <command>

Manage agent skills.

Commands:
  gemini skills list [--all]                         Lists discovered agent skills.
  gemini skills enable <name>                        Enables an agent skill.
  gemini skills disable <name> [--scope]             Disables an agent skill.
  gemini skills install <source> [--scope] [--path]  Installs an agent skill from a git repository URL or a local path.
  gemini skills link <path>                          Links an agent skill from a local path. Updates to the source will be reflected immediately.
  gemini skills uninstall <name> [--scope]           Uninstalls an agent skill by name.

Options:
  -d, --debug  Run in debug mode (open debug console with F12)  [boolean] [default: false]
  -h, --help   Show help  [boolean]
```

## `gemini extensions --help`

```text
gemini extensions <command>

Manage Gemini CLI extensions.

Commands:
  gemini extensions install <source> [--auto-update] [--pre-release]  Installs an extension from a git repository URL or a local path.
  gemini extensions uninstall [names..]                               Uninstalls one or more extensions.
  gemini extensions list                                              Lists installed extensions.
  gemini extensions update [<name>] [--all]                           Updates all extensions or a named extension to the latest version.
  gemini extensions disable [--scope] <name>                          Disables an extension.
  gemini extensions enable [--scope] <name>                           Enables an extension.
  gemini extensions link <path>                                       Links an extension from a local path. Updates made to the local path will always be reflected.
  gemini extensions new <path> [template]                             Create a new extension from a boilerplate example.
  gemini extensions validate <path>                                   Validates an extension from a local path.
  gemini extensions config [name] [setting]                           Configure extension settings.

Options:
  -d, --debug  Run in debug mode (open debug console with F12)  [boolean] [default: false]
  -h, --help   Show help  [boolean]
```

## Google Antigravity Python SDK Reference (`google-antigravity`)

# Google Antigravity SDK

The Google Antigravity SDK is a Python SDK for building AI agents powered by
Antigravity and Gemini. It provides a secure, scalable, and stateful
infrastructure layer that abstracts the agentic loop, letting you focus on what
your agent _does_ rather than how it runs.

## Installation

```sh
pip install google-antigravity
```

> [!IMPORTANT]
> The Google Antigravity SDK relies on a compiled runtime binary that is
> included in the platform-specific wheels published to
> [PyPI](https://pypi.org/project/google-antigravity/). **Cloning this
> repository alone is not sufficient to run the SDK.** Always install from
> PyPI with `pip install google-antigravity` to obtain the binary.

## Quickstart

Get started by running one of the [`examples/`](examples/), such as the
`hello_world` example with:

```sh
export GEMINI_API_KEY="your_api_key_here"
python ./examples/getting_started/hello_world.py
```

## Gemini Enterprise Agent Platform (formerly Vertex AI)

To use the SDK with Gemini Enterprise Agent Platform (formerly Vertex AI),
the SDK supports two authentication modes:

### 1. Express Mode (API Key)

For fast setup without requiring Google Cloud projects, regional configuration,
or Application Default Credentials (ADC), provide an API key with `vertex=True`:

```python
from google.antigravity import Agent, LocalAgentConfig

config = LocalAgentConfig(
    vertex=True,
    api_key="your_api_key_here",
)

async with Agent(config) as agent:
    response = await agent.chat("Hello!")
    print(await response.text())
```

### 2. Standard Mode (Project & Location with ADC)

For enterprise deployments routing to regional endpoints, configure
`LocalAgentConfig` with `vertex=True`, `project`, and `location`. By default,
this mode authenticates via Application Default Credentials (ADC).

```python
from google.antigravity import Agent, LocalAgentConfig

config = LocalAgentConfig(
    vertex=True,
    project="your-gcp-project",
    location="us-central1",
)

async with Agent(config) as agent:
    response = await agent.chat("Hello!")
    print(await response.text())
```

Alternatively, you can leave these fields unset in `LocalAgentConfig` and
export the environment variables instead:

```sh
# Either GOOGLE_GENAI_USE_VERTEXAI or GOOGLE_GENAI_USE_ENTERPRISE enable Vertex.
export GOOGLE_GENAI_USE_VERTEXAI=True
export GOOGLE_CLOUD_PROJECT="your-gcp-project"
export GOOGLE_CLOUD_LOCATION="us-central1"
```

Explicit kwargs always take precedence over env vars.

Ensure you have authenticated locally before running the agent in Standard Mode:

```sh
gcloud auth application-default login
```

See [vertex.py](./examples/getting_started/vertex.py) for a complete example.

## Concepts

### Simple Agent

The `Agent` class is the easiest way to get started. It manages the full
lifecycle — binary discovery, tool wiring, hook registration, and policy
defaults — behind a single async context manager.

The `system_instructions` parameter is optional.

```python
import asyncio
from google.antigravity import Agent, LocalAgentConfig

async def main():
    config = LocalAgentConfig(
        system_instructions="You are an expert assistant for codebase navigation.",
        # api_key="your_api_key_here",
    )
    async with Agent(config) as agent:
        response = await agent.chat("What files are in the current directory?")
        print(await response.text())

async def run():
    await main()

if __name__ == "__main__":
    asyncio.run(run())
```

### Streaming Responses

To stream agent output in real-time (e.g., for fluid UI or console applications), simply iterate over the `ChatResponse` object using an `async for` loop. The stream wrapper natively yields conversational `str` text tokens as they arrive, with zero network overhead:

```python
import asyncio
import sys
from google.antigravity import Agent, LocalAgentConfig

async def main():
    config = LocalAgentConfig()
    async with Agent(config) as agent:
        # Returns instantly — does not block
        response = await agent.chat("Write a short poem about space.")

        async for token in response:
            sys.stdout.write(token)
            sys.stdout.flush()
```
