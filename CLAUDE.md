# Claude Code MCP — tmux Bridge

## What This Is

This is an MCP server that connects Claude Desktop to an interactive Claude Code session running in a named tmux pane. It delivers prompts from Desktop to Code and returns the response — maintaining full conversation history and tool access between calls.

## How to Use This Tool (for Claude Desktop)

This server exposes one tool: `claude_code`.

### When to use it
Use `claude_code` whenever the user wants Claude Code to execute a task — writing code, editing files, running commands, working with git, or using any tools Claude Code has access to (MCP tools, bash, file system, etc.).

### Required parameters
- `prompt` — the full task description to send to Claude Code
- `workFolder` — absolute path to the user's project directory (determines which tmux session to target)

### How to write a good prompt for Claude Code
- Be explicit and step-by-step for complex tasks
- Include relevant file names, function names, or error messages
- Reference what was previously done if continuing a task
- Claude Code retains full conversation history — you don't need to re-explain the whole project each time, just what's new

### Example tool call
```
claude_code(
  prompt: "Add input validation to the login form in src/auth/login.ts — reject empty username and password and show an inline error message",
  workFolder: "/Users/you/my-project"
)
```

### Session behaviour
- Sessions are created automatically on first use
- Claude Code launches automatically with full permissions
- One prompt at a time per session — if busy, wait and retry
- If a call times out, just retry — the bridge auto-recovers

## Architecture

- Single tool: `claude_code`
- Session naming: `claude-{basename_of_workFolder}` or `claude-code`
- Prompt delivery: temp file → `tmux load-buffer` → `paste-buffer` → Enter
- Completion detection: Claude Code `>` prompt detection (primary) + 3s stability fallback
- Busy tracking: in-memory `Set<string>` per session; concurrent calls rejected
- Timeout recovery: auto-checks pane idle state on next call, clears stale flag if done

## Key Files

- `src/server.ts` — Full implementation
- `package.json` — Package config (v2.2.0+)
- `.github/workflows/ci.yml` — Build-only CI

## Development Commands

```bash
npm install       # Install dependencies
npm run build     # Compile TypeScript → dist/
npm run dev       # Run directly with tsx (no build step)
npm start         # Run compiled dist/server.js
```

## Best Practices (for contributors)

- macOS only — no Windows/Linux support needed
- Keep the server stateless except for `busySessions` and `timedOutSessions`
- All tmux calls use `shell: false` via `spawnAsync` — never use shell interpolation
- Claude Code is launched with `--dangerously-skip-permissions` so it runs non-interactively
