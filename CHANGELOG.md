# Changelog\n\n## [2.2.0] - 2026-03-18\n\n### Changed\n- **Primary completion signal**: detect Claude Code's `>` idle prompt directly instead of waiting for full stability timeout — dramatically reduces latency on short and medium tasks\n- **Reduced defaults**: `STARTUP_DELAY_MS` 2000→1000, `STABLE_THRESHOLD_MS` 5000→3000\n- **Tunable via env vars**: `MCP_STARTUP_DELAY_MS`, `MCP_POLL_INTERVAL_MS`, `MCP_STABLE_THRESHOLD_MS`, `MCP_CLAUDE_READY_TIMEOUT`

## [2.1.0] - 2026-03-18

### Added
- Auto-create tmux session if it doesn't exist (rooted at `workFolder`)
- Auto-launch Claude Code in the session if it isn't running, with up to 30s startup polling
- Sessions and Claude Code now spin up fully automatically on first use

## [2.0.0] - 2026-03-17

Complete architectural rewrite — tmux bridge replaces one-shot spawn mode.

### Changed
- Claude Code now runs as a persistent interactive session in a named tmux pane
- Prompts are delivered via `tmux load-buffer` + `paste-buffer` (handles all special characters safely)
- Completion detected by content-stability polling (5s of no change = done)
- Per-session busy tracking; concurrent calls are rejected with a clear message
- Conversation history is fully preserved between calls
- Session naming derived from `workFolder` basename: `claude-{basename}`
- Removed `--dangerously-skip-permissions` one-shot mode entirely

### Removed
- Windows support (`start.bat`)
- All screenshot/image assets
- `zod` production dependency (was only used in old tests)
- Old test suite (written for spawn-based architecture; will be rewritten)
