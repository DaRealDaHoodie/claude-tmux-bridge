# Changelog

## [2.3.0] - 2026-03-19

### Added
- `clearContext` parameter — sends `/clear` before the prompt, wiping conversation history. Use when starting a new feature or work session.
- `compact` parameter — sends `/compact` before the prompt, summarising history via the Claude API. Use when context is growing but continuity still matters. Takes precedence over `clearContext` if both are set.
- CLAUDE.md guidance for Claude Desktop on when to use each parameter, with examples.

## [2.2.1] - 2026-03-17

### Added
- Complete test suite: 29 tests across two files
  - `helpers.test.ts` — unit tests for `sessionName`, `isAtClaudePrompt`, `extractNewContent`
  - `tool-handler.test.ts` — integration tests for the MCP tool handler (session auto-create, auto-start, busy detection, timeout, recovery)
- Exported `_markBusyForTesting` and `_markTimedOutForTesting` helpers for reliable test isolation

### Changed
- Simplified `vitest.config.unit.ts` — removed old e2e exclusions, added `mockReset`/`clearMocks`/`restoreMocks`
- Cleaned up `package.json` test scripts — removed stale e2e scripts, all scripts now point to unit config
- Removed old test suite files (were written for spawn-based architecture)

## [2.2.0] - 2026-03-17

### Changed
- **Primary completion signal**: detect Claude Code's `>` idle prompt directly instead of waiting for full stability timeout — dramatically reduces latency on short and medium tasks
- **Reduced defaults**: `STARTUP_DELAY_MS` 2000→1000, `STABLE_THRESHOLD_MS` 5000→3000
- **Tunable via env vars**: `MCP_STARTUP_DELAY_MS`, `MCP_POLL_INTERVAL_MS`, `MCP_STABLE_THRESHOLD_MS`, `MCP_CLAUDE_READY_TIMEOUT`

## [2.1.0] - 2026-03-17

### Added
- Auto-create tmux session if it doesn't exist (rooted at `workFolder`)
- Auto-launch Claude Code in the session if it isn't running, with up to 30s startup polling
- Sessions and Claude Code now spin up fully automatically on first use

## [2.0.0] - 2026-03-17

Complete architectural rewrite — tmux bridge replaces one-shot spawn mode.

### Changed
- Claude Code now runs as a persistent interactive session in a named tmux pane
- Prompts are delivered via `tmux load-buffer` + `paste-buffer` (handles all special characters safely)
- Completion detected by content-stability polling (fallback: 3s of no change = done)
- Per-session busy tracking; concurrent calls are rejected with a clear message
- Conversation history is fully preserved between calls
- Session naming derived from `workFolder` basename: `claude-{basename}`

### Removed
- Windows support (`start.bat`)
- All screenshot/image assets
- `zod` production dependency (was only used in old tests)
- Old test suite (written for spawn-based architecture)
