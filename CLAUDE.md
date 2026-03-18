# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Repository Purpose

This is a tmux bridge MCP server. It connects Claude Desktop to an interactive Claude Code session running in a named tmux pane. The server delivers prompts from Desktop to Code and returns the response — no one-shot spawning, no `--dangerously-skip-permissions`.

## Key Files

- `src/server.ts` — Full implementation: session detection, prompt delivery, completion polling
- `package.json` — Package config (v2.0.0+)
- `.github/workflows/ci.yml` — Build-only CI (npm install + tsc)

## Development Commands

```bash
npm install       # Install dependencies
npm run build     # Compile TypeScript → dist/
npm run dev       # Run directly with tsx (no build step)
npm start         # Run compiled dist/server.js
```

## Architecture

- Single tool: `claude_code`
- Session naming: `claude-{basename_of_workFolder}` or `claude-code`
- Prompt delivery: temp file → `tmux load-buffer` → `paste-buffer` → Enter
- Completion detection: poll `capture-pane` every 1.5s; 5s of no change = done
- Busy tracking: in-memory `Set<string>` per session; concurrent calls rejected

## Best Practices

- This runs macOS only — no Windows/Linux support needed
- Keep the server stateless except for the `busySessions` set
- All tmux calls use `shell: false` via `spawnAsync` — never use shell interpolation
- Do not add `--dangerously-skip-permissions` back — the interactive session handles permissions
