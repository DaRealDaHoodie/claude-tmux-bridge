# Claude Code MCP — tmux Bridge

An MCP server that connects Claude Desktop to an interactive Claude Code session running in a tmux terminal. Instead of spawning a one-shot process per prompt, it communicates with a persistent, visible session — so you can watch Claude work in real time while Desktop orchestrates the tasks.

## How It Works

```
Claude Desktop  →  claude_code MCP tool  →  tmux session  →  Claude Code (interactive)
                        (this repo)
```

- **Claude Desktop** holds your project's GDD, design decisions, and full context. It generates prompts and knows what needs to be done next.
- **Claude Code** runs interactively in a tmux terminal you can watch. It has access to all your configured MCP tools (Roblox Studio, Godot, Blender, etc.) and retains conversation history between calls.
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

## Session Naming

The tmux session name is always `claude-{basename_of_workFolder}`:

| workFolder | Session name |
|---|---|
| `/Users/you/my-roblox-game` | `claude-my-roblox-game` |
| `/Users/you/other-project` | `claude-other-project` |
| *(not provided)* | `claude-code` |

## Tool Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `prompt` | string | yes | The prompt to send to Claude Code |
| `workFolder` | string | no | Project path — used to identify the session |
| `timeout` | number | no | Max seconds to wait (default: 300) |

## Behaviour

- **Session not found** — auto-creates the tmux session rooted at `workFolder`
- **Claude Code not running** — auto-launches `claude` in the session and waits up to 30s for it to be ready
- **Session busy** — rejects with a "still busy" message; does not queue
- **Timeout** — returns a message; session stays marked busy until Claude finishes
- **Conversation history** — fully preserved between calls (same interactive session)

### Watching Claude work

The session runs in the background automatically. If you want to watch:

```bash
tmux attach -t claude-my-roblox-game
# Detach anytime with Ctrl+B D
```

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
