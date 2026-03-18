# Claude Code MCP — tmux Bridge

An MCP server that connects Claude Desktop to an interactive Claude Code session running in a tmux terminal. Instead of spawning a one-shot process per prompt, it communicates with a persistent, visible session — so you can watch Claude work in real time while Desktop orchestrates the tasks.

## How It Works

```
Claude Desktop  →  claude_code MCP tool  →  tmux session  →  Claude Code (interactive)
                        (this repo)
```

- **Claude Desktop** holds your project context, design decisions, and task history. It generates prompts and knows what needs to be done next.
- **Claude Code** runs interactively in a tmux terminal you can watch. It has access to all your configured MCP tools and retains full conversation history between calls.
- **This server** is the pipe between them — it delivers Desktop's prompts to Code's session and brings the response back.

## Requirements

- macOS
- Node.js v20 or later
- [tmux](https://formulae.brew.sh/formula/tmux) — `brew install tmux`
- Claude Code CLI — `npm install -g @anthropic-ai/claude-code`

## Setup

### 1. Install this server

```bash
git clone https://github.com/DaRealDaHoodie/claude-tmux-bridge.git
cd claude-tmux-bridge
npm install
npm run build
```

### 2. Configure Claude Desktop

Add this server to your Claude Desktop MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "claude-tmux-bridge": {
      "command": "node",
      "args": ["/path/to/claude-tmux-bridge/dist/server.js"]
    }
  }
}
```

Restart Claude Desktop after saving.

## Using the Tool

Once configured, Claude Desktop has access to the `claude_code` tool. When sending a prompt tell Desktop:

- **What to do** — the task or question for Claude Code
- **Which project** — pass `workFolder` as the absolute path to your project directory

Example instruction to Desktop:
> Use the claude_code tool with workFolder `/Users/you/my-project` and ask Claude Code to implement the feature we just designed.

Everything else is automatic — the tmux session and Claude Code instance are created on first use.

## Session Naming

The tmux session name is derived from your project folder's basename:

| workFolder | Session name |
|---|---|
| `/Users/you/my-project` | `claude-my-project` |
| `/Users/you/other-project` | `claude-other-project` |
| *(not provided)* | `claude-code` |

## Watching Claude Work

Sessions run in the background automatically. Attach any time to watch:

```bash
tmux attach -t claude-my-project
# Detach with Ctrl+B D
```

## Tool Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `prompt` | string | yes | The prompt to send to Claude Code |
| `workFolder` | string | no | Absolute path to project — determines the session |
| `timeout` | number | no | Max seconds to wait for a response (default: 300) |

## Behaviour

- **Session not found** — auto-creates the tmux session rooted at `workFolder`
- **Claude Code not running** — auto-launches `claude` in the session and waits up to 30s for it to be ready
- **Session busy** — rejects with a "still busy" message; does not queue
- **Timeout** — auto-recovers on next call by checking if Claude has since finished
- **Conversation history** — fully preserved between calls (same interactive session)

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MCP_CLAUDE_DEBUG` | `false` | Set to `true` for verbose debug logging |
| `MCP_STARTUP_DELAY_MS` | `1000` | Wait after sending prompt before polling starts |
| `MCP_POLL_INTERVAL_MS` | `1500` | How often to poll the pane for output changes |
| `MCP_STABLE_THRESHOLD_MS` | `3000` | Fallback: ms of no change before declaring done |
| `MCP_CLAUDE_READY_TIMEOUT` | `30000` | Max ms to wait for Claude Code to start up |

## Multiple Projects

Each project gets its own named tmux session. You can have multiple sessions open simultaneously — just pass the correct `workFolder` and Desktop will target the right one.

## License

MIT
