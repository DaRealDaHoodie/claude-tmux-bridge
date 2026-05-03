# Codex MCP — tmux Bridge

## What This Is

This is an MCP server that connects Codex Desktop to an interactive Codex session running in a named tmux pane. It delivers prompts from Desktop to Code and returns the response — maintaining full conversation history and tool access between calls.

## How to Use This Tool (for Codex Desktop)

This server exposes one tool: `Codex`.

### When to use it
Use `Codex` whenever the user wants Codex to execute a task — writing code, editing files, running commands, working with git, or using any tools Codex has access to (MCP tools, bash, file system, etc.).

### Required parameters
- `prompt` — the full task description to send to Codex
- `workFolder` — absolute path to the user's project directory (determines which tmux session to target)

### Optional parameters
- `timeout` — max seconds to wait for a response (default: 300)
- `clearContext` — send `/clear` before the prompt; wipes conversation history entirely. Fast (< 1s).
- `compact` — send `/compact` before the prompt; summarises history via the Codex API, keeping key context while freeing space. Slower (30–60s). Takes precedence over `clearContext` if both are set.

### When to use clearContext
Use `clearContext: true` when:
- Starting a completely new feature, system, or unrelated task
- Beginning a fresh work session on a project you've worked on before
- Codex warns that the context window is getting large
- The previous task is fully done and the next task has no dependency on it

### When to use compact
Use `compact: true` when:
- Context is growing large but the conversation history is still relevant
- You're mid-task and want to keep continuity without hitting context limits
- Codex's responses are getting slower or less accurate due to context size

### How to write a good prompt for Codex
- Be explicit and step-by-step for complex tasks
- Include relevant file names, function names, or error messages
- Reference what was previously done if continuing a task
- Codex retains full conversation history — you don't need to re-explain the whole project each time, just what's new
- Never re-paste the full GDD or project context on every call — Code already has it

### Example tool calls
```
Codex(
  prompt: "Add input validation to the login form in src/auth/login.ts — reject empty username and password and show an inline error message",
  workFolder: "/Users/you/my-project"
)
```
```
Codex(
  prompt: "Starting a new session — build the inventory system as described in the GDD",
  workFolder: "/Users/you/my-project",
  clearContext: true
)
```
```
Codex(
  prompt: "Continue adding the crafting UI — keep the item database we built in mind",
  workFolder: "/Users/you/my-project",
  compact: true
)
```

### Session behaviour
- Sessions are created automatically on first use
- Codex launches automatically with full permissions
- One prompt at a time per session — if busy, wait and retry
- If a call times out, just retry — the bridge auto-recovers

## Architecture

- Single tool: `Codex`
- Session naming: `Codex-{basename_of_workFolder}` or `Codex`
- Prompt delivery: temp file → `tmux load-buffer` → `paste-buffer` → Enter
- Completion detection: Codex `>` prompt detection (primary) + 3s stability fallback
- Busy tracking: in-memory `Set<string>` per session; concurrent calls rejected
- Timeout recovery: auto-checks pane idle state on next call, clears stale flag if done
- Context management: optional `/clear` (instant wipe) or `/compact` (API summarisation) before each prompt

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
- Codex is launched with `--dangerously-skip-permissions` so it runs non-interactively
