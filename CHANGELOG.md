# Changelog

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
