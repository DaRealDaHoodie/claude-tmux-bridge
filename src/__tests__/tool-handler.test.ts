import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ─── Set timing constants to near-zero before module loads ───────────────────
process.env.MCP_STARTUP_DELAY_MS     = '0';
process.env.MCP_POLL_INTERVAL_MS     = '10';
process.env.MCP_STABLE_THRESHOLD_MS  = '20';
process.env.MCP_CLAUDE_READY_TIMEOUT = '150';

// ─── Mock external modules ───────────────────────────────────────────────────

vi.mock('node:child_process');
vi.mock('node:fs/promises');

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: { _tag: 'listTools' },
  CallToolRequestSchema:  { _tag: 'callTool' },
  ErrorCode: {
    InternalError: 'InternalError',
    InvalidParams: 'InvalidParams',
    MethodNotFound: 'MethodNotFound',
  },
  McpError: class McpError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  },
}));

// Capture setRequestHandler calls so we can invoke handlers directly in tests
let listToolsHandler: (req: unknown) => Promise<unknown>;
let callToolHandler:  (req: unknown) => Promise<unknown>;

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn((schema: { _tag: string }, handler: (r: unknown) => Promise<unknown>) => {
      if (schema._tag === 'listTools') listToolsHandler = handler;
      if (schema._tag === 'callTool')  callToolHandler  = handler;
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    close:   vi.fn().mockResolvedValue(undefined),
    onerror: undefined,
  })),
}));

// ─── Import server and mocks after module mocks are registered ───────────────

const { spawn }                      = await import('node:child_process');
const { mkdtemp, writeFile, unlink } = await import('node:fs/promises');
const {
  _clearSessionsForTesting,
  _markBusyForTesting,
  _markTimedOutForTesting,
  sessionName,
} = await import('../server.js');

const mockSpawn   = vi.mocked(spawn);
const mockMkdtemp = vi.mocked(mkdtemp);
const mockWrite   = vi.mocked(writeFile);
const mockUnlink  = vi.mocked(unlink);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a fake child process that emits stdout + close on the next tick. */
function makeProcess(stdout = '', exitCode = 0) {
  const proc = new EventEmitter() as NodeJS.EventEmitter & {
    stdout: EventEmitter; stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    proc.emit('close', exitCode);
  });
  return proc as ReturnType<typeof spawn>;
}

/**
 * Build a capture-pane mock that returns each value in `sequence` in order,
 * then repeats the last value for all subsequent calls.
 * Other tmux commands fall through to `defaultFn` (defaults to success).
 */
function buildSpawnMock(
  captureSequence: string[],
  overrides: Record<string, { stdout?: string; exitCode?: number }> = {},
) {
  let captureIdx = 0;
  mockSpawn.mockImplementation((_cmd: unknown, args: unknown) => {
    const argStr = (args as string[]).join(' ');

    // Check overrides first
    for (const [key, val] of Object.entries(overrides)) {
      if (argStr.includes(key)) return makeProcess(val.stdout ?? '', val.exitCode ?? 0);
    }

    if (argStr.includes('capture-pane')) {
      const content = captureSequence[Math.min(captureIdx++, captureSequence.length - 1)];
      return makeProcess(content, 0);
    }

    return makeProcess('', 0);
  });
}

function callTool(args: Record<string, unknown>) {
  return callToolHandler({ params: { name: 'claude_code', arguments: args } });
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  _clearSessionsForTesting();
  mockMkdtemp.mockResolvedValue('/tmp/claude-mcp-test' as never);
  mockWrite.mockResolvedValue(undefined as never);
  mockUnlink.mockResolvedValue(undefined as never);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('claude_code tool handler', () => {

  it('lists the claude_code tool with prompt as a required field', async () => {
    const result = await listToolsHandler({}) as { tools: Array<{ name: string; inputSchema: { required: string[] } }> };
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('claude_code');
    expect(result.tools[0].inputSchema.required).toContain('prompt');
  });

  it('throws InvalidParams when prompt is missing', async () => {
    await expect(callTool({})).rejects.toThrow('prompt (string) is required');
  });

  it('throws MethodNotFound for an unknown tool name', async () => {
    await expect(
      callToolHandler({ params: { name: 'no_such_tool', arguments: { prompt: 'hi' } } })
    ).rejects.toThrow();
  });

  it('auto-creates session and starts Claude when session does not exist', async () => {
    // Sequence: ready-check polls (node + stable content), before snapshot, response with prompt
    buildSpawnMock(
      ['Claude UI\n>', 'Claude UI\n>', 'before content', 'before content', 'response done\n>'],
      {
        'has-session': { exitCode: 1 }, // session not found → triggers create
        'pane_current_command': { stdout: 'node' },
      },
    );

    const result = await callTool({ prompt: 'hello', workFolder: '/Users/foo/new-project' }) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBeTruthy();
    // Verify new-session was called
    expect(mockSpawn).toHaveBeenCalledWith(
      'tmux',
      expect.arrayContaining(['new-session']),
      expect.anything(),
    );
  });

  it('returns a tmux install hint when session creation fails', async () => {
    mockSpawn.mockImplementation((_cmd: unknown, args: unknown) => {
      const argStr = (args as string[]).join(' ');
      if (argStr.includes('has-session')) return makeProcess('', 1);
      if (argStr.includes('new-session')) return makeProcess('command not found', 1);
      return makeProcess('', 0);
    });

    const result = await callTool({ prompt: 'hello', workFolder: '/Users/foo/project' }) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toMatch(/brew install tmux/);
  });

  it('auto-starts Claude when session exists but Claude is not running', async () => {
    let cmdCallCount = 0;
    buildSpawnMock(
      ['Claude UI\n>', 'Claude UI\n>', 'before content', 'before content', 'response\n>'],
      {
        'has-session': { exitCode: 0 },
        // pane_current_command: return 'bash' first (not running), then 'node' after start
        'pane_current_command': { stdout: '' }, // overridden below
      },
    );

    mockSpawn.mockImplementation((_cmd: unknown, args: unknown) => {
      const argStr = (args as string[]).join(' ');
      if (argStr.includes('has-session'))          return makeProcess('', 0);
      if (argStr.includes('pane_current_command')) {
        cmdCallCount++;
        return makeProcess(cmdCallCount === 1 ? 'bash' : 'node', 0);
      }
      if (argStr.includes('capture-pane'))         return makeProcess('Claude ready\n>', 0);
      return makeProcess('', 0);
    });

    const result = await callTool({ prompt: 'go', workFolder: '/Users/foo/project' }) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBeTruthy();
    expect(mockSpawn).toHaveBeenCalledWith(
      'tmux',
      expect.arrayContaining(['send-keys', 'claude --dangerously-skip-permissions']),
      expect.anything(),
    );
  });

  it('returns a startup-timeout message when Claude does not become ready', async () => {
    mockSpawn.mockImplementation((_cmd: unknown, args: unknown) => {
      const argStr = (args as string[]).join(' ');
      if (argStr.includes('has-session'))          return makeProcess('', 0);
      if (argStr.includes('pane_current_command')) return makeProcess('bash', 0); // never claude
      if (argStr.includes('capture-pane'))         return makeProcess('$ ', 0);
      return makeProcess('', 0);
    });

    const result = await callTool({ prompt: 'go', workFolder: '/Users/foo/project' }) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toMatch(/did not become ready/);
  });

  it('returns busy message when a session is already processing', async () => {
    // Mark the session busy directly — avoids racing two async calls and test contamination
    const session = sessionName('/Users/foo/busy-project');
    _markBusyForTesting(session);

    mockSpawn.mockImplementation((_cmd: unknown, args: unknown) => {
      const argStr = (args as string[]).join(' ');
      if (argStr.includes('has-session'))          return makeProcess('', 0);
      if (argStr.includes('pane_current_command')) return makeProcess('node', 0);
      return makeProcess('', 0);
    });

    const result = await callTool({ prompt: 'second', workFolder: '/Users/foo/busy-project' }) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toMatch(/busy/i);
  });

  it('completes immediately when Claude prompt is detected in output', async () => {
    // capture-pane sequence: before → working → response with > (triggers prompt detection)
    buildSpawnMock(
      ['before content', 'Claude is working...', 'All done!\n>'],
      {
        'has-session': { exitCode: 0 },
        'pane_current_command': { stdout: 'node' },
      },
    );

    const result = await callTool({ prompt: 'do something', workFolder: '/Users/foo/prompt-test' }) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toContain('All done!');
  });

  it('falls back to stability detection when Claude prompt is not present', async () => {
    // Sequence: before-snapshot, initial (different → everChanged=true), then stable content repeats.
    // The last element is repeated for all subsequent polls, triggering stability detection.
    buildSpawnMock(
      ['before content', 'Claude is working...', 'response without prompt marker'],
      {
        'has-session': { exitCode: 0 },
        'pane_current_command': { stdout: 'node' },
      },
    );

    const result = await callTool({ prompt: 'do something', workFolder: '/Users/foo/stable-test' }) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBeTruthy();
  });

  it('returns timeout message when response exceeds timeout limit', async () => {
    let captureCount = 0;
    mockSpawn.mockImplementation((_cmd: unknown, args: unknown) => {
      const argStr = (args as string[]).join(' ');
      if (argStr.includes('has-session'))          return makeProcess('', 0);
      if (argStr.includes('pane_current_command')) return makeProcess('node', 0);
      if (argStr.includes('capture-pane'))         return makeProcess(`tick-${captureCount++}`, 0);
      return makeProcess('', 0);
    });

    const result = await callTool({
      prompt: 'slow task',
      workFolder: '/Users/foo/timeout-test',
      timeout: 0.05,
    }) as { content: Array<{ text: string }> };

    expect(result.content[0].text).toMatch(/timeout/i);
  });

  it('auto-recovers on retry after a previous timeout', async () => {
    // Mark session as timed-out directly — avoids running a slow first call
    const session = sessionName('/Users/foo/recover-test');
    _markTimedOutForTesting(session);

    // isPaneIdle gets two identical captures → idle=true → flags cleared → normal flow.
    // Then before-snapshot, content changes mid-response, ends with prompt.
    buildSpawnMock(
      ['stable\n>', 'stable\n>', 'before\n>', 'working...', 'response\n>'],
      {
        'has-session': { exitCode: 0 },
        'pane_current_command': { stdout: 'node' },
      },
    );

    const recovered = await callTool({
      prompt: 'retry',
      workFolder: '/Users/foo/recover-test',
    }) as { content: Array<{ text: string }> };
    expect(recovered.content[0].text).not.toMatch(/still busy/i);
  });
});
