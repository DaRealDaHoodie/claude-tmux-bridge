#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Claude Code MCP — tmux bridge
// Communicates with an interactive `claude` session running in a tmux terminal
// instead of spawning a fresh one-shot process per call.
// ─────────────────────────────────────────────────────────────────────────────

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

// ─── Constants ───────────────────────────────────────────────────────────────

const SERVER_VERSION = '2.0.0';

/** ms to wait after sending the prompt before starting to poll */
const STARTUP_DELAY_MS = 2_000;

/** Polling interval while waiting for output to stabilise */
const POLL_INTERVAL_MS = 1_500;

/** How long output must be unchanged before we consider the response done */
const STABLE_THRESHOLD_MS = 5_000;

/**
 * pane_current_command values that indicate Claude Code is running.
 * Covers the npm-installed binary (runs as `node`) and a native binary.
 */
const CLAUDE_COMMANDS = new Set(['node', 'claude', 'claude-code']);

// ─── Globals ─────────────────────────────────────────────────────────────────

const debugMode = process.env.MCP_CLAUDE_DEBUG === 'true';

/**
 * Tracks which tmux sessions are currently processing a prompt.
 * Prevents concurrent use of the same session.
 */
const busySessions = new Set<string>();

// ─── Utilities ───────────────────────────────────────────────────────────────

function debugLog(...args: unknown[]): void {
  if (debugMode) console.error('[claude-mcp]', ...args);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a command without a shell. Rejects on non-zero exit.
 * Shell is intentionally disabled — arguments are passed verbatim.
 */
function spawnAsync(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    debugLog('spawn', command, args);
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('error', (err: Error) => {
      reject(new Error(`Spawn error for "${command}": ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`"${command}" exited ${code}\nstderr: ${stderr.trim()}\nstdout: ${stdout.trim()}`));
      }
    });
  });
}

/**
 * Derive a tmux session name from an optional workFolder path.
 *   /Users/foo/my-roblox-game  →  claude-my-roblox-game
 *   (none)                     →  claude-code
 */
function sessionName(workFolder?: string): string {
  if (!workFolder) return 'claude-code';
  const base = basename(workFolder.replace(/\/+$/, ''));
  const safe = base.replace(/[^a-zA-Z0-9_.\-]/g, '-');
  return `claude-${safe}`;
}

/** Returns true if a tmux session with this name exists. */
async function sessionExists(session: string): Promise<boolean> {
  try {
    await spawnAsync('tmux', ['has-session', '-t', session]);
    return true;
  } catch {
    return false;
  }
}

/** Returns the foreground command running in pane 0 of the session. */
async function paneCommand(session: string): Promise<string> {
  const { stdout } = await spawnAsync('tmux', [
    'display-message', '-t', `${session}:0.0`, '-p', '#{pane_current_command}',
  ]);
  return stdout.trim();
}

/**
 * Capture the visible + scrollback content of the pane as plain text.
 * -S -5000 pulls up to 5000 lines of scrollback.
 */
async function capturePane(session: string): Promise<string> {
  const { stdout } = await spawnAsync('tmux', [
    'capture-pane', '-t', `${session}:0.0`, '-p', '-S', '-5000',
  ]);
  return stdout;
}

/**
 * Send a prompt to a tmux pane safely, handling all special characters.
 *
 * Uses temp-file → tmux load-buffer → paste-buffer → Enter.
 * This avoids every shell-quoting issue: the file content is treated as
 * opaque bytes by tmux and pasted literally into the pty.
 */
async function sendPrompt(session: string, prompt: string): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'claude-mcp-'));
  const tmpFile = join(tmpDir, 'prompt.txt');

  try {
    await writeFile(tmpFile, prompt, 'utf8');
    await spawnAsync('tmux', ['load-buffer', '-b', 'claude-mcp', tmpFile]);
    await spawnAsync('tmux', ['paste-buffer', '-b', 'claude-mcp', '-t', `${session}:0.0`]);
    await spawnAsync('tmux', ['send-keys', '-t', `${session}:0.0`, 'Enter']);
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

/**
 * Poll the pane until output has been stable for STABLE_THRESHOLD_MS,
 * then return the full captured content. Throws 'TIMEOUT' on timeout.
 */
async function waitForStableOutput(session: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  await sleep(STARTUP_DELAY_MS);

  let lastContent = await capturePane(session);
  let lastChangeAt = Date.now();
  let everChanged = false;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const current = await capturePane(session);

    if (current !== lastContent) {
      lastContent = current;
      lastChangeAt = Date.now();
      everChanged = true;
    } else if (everChanged && Date.now() - lastChangeAt >= STABLE_THRESHOLD_MS) {
      debugLog(`stable for ${Date.now() - lastChangeAt}ms — done`);
      return current;
    }
  }

  throw new Error('TIMEOUT');
}

/**
 * Extract the content that appeared after `before` by anchoring on the
 * tail of the before snapshot. Falls back to full after-content if the
 * anchor can't be found (e.g. pane was cleared mid-session).
 */
function extractNewContent(before: string, after: string): string {
  const anchor = before.slice(-200).trim();
  if (!anchor) return after.trim();

  const idx = after.lastIndexOf(anchor);
  if (idx === -1) return after.trim();

  return after.slice(idx + anchor.length).trim();
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

class ClaudeCodeServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      { name: 'claude_code', version: SERVER_VERSION },
      { capabilities: { tools: {} } },
    );
    this.setupHandlers();
    this.server.onerror = (err) => console.error('[MCP Error]', err);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    // ── List tools ──────────────────────────────────────────────────────────
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{
        name: 'claude_code',
        description:
          `Send a prompt to an interactive Claude Code session running in a tmux terminal.\n\n` +
          `REQUIREMENTS:\n` +
          `  • A tmux session named claude-{basename_of_workFolder} must already exist.\n` +
          `  • Claude Code must be running interactively in that session (run: claude).\n` +
          `  • Only one prompt at a time per session — concurrent calls return a busy error.\n\n` +
          `SESSION NAMING:\n` +
          `  workFolder /Users/you/my-roblox-game → session name: claude-my-roblox-game\n` +
          `  No workFolder → session name: claude-code\n\n` +
          `TO START A SESSION (user does this once per project):\n` +
          `  tmux new-session -s claude-my-project\n` +
          `  cd /path/to/project\n` +
          `  claude\n\n` +
          `Claude Code retains full conversation history between calls.\n` +
          `It has access to all configured MCP tools (Roblox Studio, Godot, Blender, etc.).`,
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'The prompt to send to the Claude Code session.',
            },
            workFolder: {
              type: 'string',
              description:
                'Absolute path to the project folder. Its basename determines the tmux session name. ' +
                'E.g. /Users/foo/my-project → session "claude-my-project". ' +
                'Omit to use the default session "claude-code".',
            },
            timeout: {
              type: 'number',
              description: 'Max seconds to wait for a response (default: 300).',
            },
          },
          required: ['prompt'],
        },
      }],
    }));

    // ── Handle calls ────────────────────────────────────────────────────────
    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      if (req.params.name !== 'claude_code') {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${req.params.name}`);
      }

      const args = req.params.arguments as {
        prompt?: unknown;
        workFolder?: unknown;
        timeout?: unknown;
      } | undefined;

      if (!args?.prompt || typeof args.prompt !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'prompt (string) is required');
      }

      const prompt = args.prompt;
      const workFolder = typeof args.workFolder === 'string' ? args.workFolder : undefined;
      const timeoutMs = (typeof args.timeout === 'number' ? args.timeout : 300) * 1_000;
      const session = sessionName(workFolder);

      debugLog(`call session=${session} timeout=${timeoutMs / 1000}s`);

      // ── a. Session must exist ──────────────────────────────────────────────
      if (!(await sessionExists(session))) {
        const createCmd = workFolder
          ? `tmux new-session -s ${session} -c "${workFolder}"`
          : `tmux new-session -s ${session}`;
        return {
          content: [{
            type: 'text',
            text:
              `No tmux session named "${session}" found.\n\n` +
              `Create one and start Claude Code:\n` +
              `  ${createCmd}\n` +
              `  claude\n\n` +
              `Attach to watch it work: tmux attach -t ${session}`,
          }],
        };
      }

      // ── b. Claude must be running in the pane ─────────────────────────────
      let cmd: string;
      try {
        cmd = await paneCommand(session);
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `Could not read pane state for session "${session}": ${err}`,
          }],
        };
      }

      if (!CLAUDE_COMMANDS.has(cmd.toLowerCase())) {
        return {
          content: [{
            type: 'text',
            text:
              `Session "${session}" exists but the foreground process is "${cmd}", not Claude Code.\n\n` +
              `Start Claude Code:\n` +
              `  tmux send-keys -t ${session} 'claude' Enter\n` +
              `Or attach and run it yourself: tmux attach -t ${session}`,
          }],
        };
      }

      // ── c. Busy check ─────────────────────────────────────────────────────
      if (busySessions.has(session)) {
        return {
          content: [{
            type: 'text',
            text:
              `Session "${session}" is currently busy. ` +
              `Wait for Claude Code to finish before sending another prompt.`,
          }],
        };
      }

      // ── d. Snapshot before ────────────────────────────────────────────────
      const before = await capturePane(session);

      // ── e. Mark busy ──────────────────────────────────────────────────────
      busySessions.add(session);

      try {
        // ── f. Send prompt ─────────────────────────────────────────────────
        await sendPrompt(session, prompt);

        // ── g. Wait for completion ─────────────────────────────────────────
        const after = await waitForStableOutput(session, timeoutMs);

        // ── h. Extract and return new content ──────────────────────────────
        busySessions.delete(session);
        const response = extractNewContent(before, after);
        return { content: [{ type: 'text', text: response || after }] };

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);

        if (msg === 'TIMEOUT') {
          // Leave busy set — Claude may still be working
          return {
            content: [{
              type: 'text',
              text:
                `Timeout: Claude Code in session "${session}" did not finish within ${timeoutMs / 1000}s.\n\n` +
                `The session remains marked busy. If Claude has actually finished, retry — ` +
                `the next call will re-check live pane state.\n\n` +
                `Consider splitting this task into smaller steps, or increase the timeout parameter.`,
            }],
          };
        }

        busySessions.delete(session);
        throw new McpError(ErrorCode.InternalError, `tmux bridge error: ${msg}`);
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`Claude Code MCP (tmux bridge) v${SERVER_VERSION} — ready`);
  }
}

new ClaudeCodeServer().run().catch(console.error);
