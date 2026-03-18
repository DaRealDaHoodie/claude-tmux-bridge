import { describe, it, expect } from 'vitest';
import { sessionName, isAtClaudePrompt, extractNewContent } from '../server.js';

// ─── sessionName ─────────────────────────────────────────────────────────────

describe('sessionName', () => {
  it('returns claude-code when no workFolder given', () => {
    expect(sessionName()).toBe('claude-code');
    expect(sessionName(undefined)).toBe('claude-code');
  });

  it('derives name from basename of path', () => {
    expect(sessionName('/Users/foo/my-project')).toBe('claude-my-project');
  });

  it('strips trailing slashes before extracting basename', () => {
    expect(sessionName('/Users/foo/my-project/')).toBe('claude-my-project');
    expect(sessionName('/Users/foo/my-project///')).toBe('claude-my-project');
  });

  it('replaces special characters with hyphens', () => {
    expect(sessionName('/Users/foo/my project')).toBe('claude-my-project');
    expect(sessionName('/Users/foo/my@project!')).toBe('claude-my-project-');
  });

  it('preserves allowed characters: letters, digits, hyphen, underscore, dot', () => {
    expect(sessionName('/Users/foo/my_project.v2')).toBe('claude-my_project.v2');
  });

  it('handles single-segment paths', () => {
    expect(sessionName('/project')).toBe('claude-project');
  });
});

// ─── isAtClaudePrompt ────────────────────────────────────────────────────────

describe('isAtClaudePrompt', () => {
  it('returns true when last line is just >', () => {
    expect(isAtClaudePrompt('some output\n>')).toBe(true);
  });

  it('returns true when > has surrounding whitespace', () => {
    expect(isAtClaudePrompt('some output\n  >  \n')).toBe(true);
  });

  it('returns true when > appears within the last 3 lines', () => {
    expect(isAtClaudePrompt('line1\n>\nline3\n')).toBe(true);
  });

  it('returns false when content is mid-response with no prompt', () => {
    expect(isAtClaudePrompt('Writing file src/index.ts...\nDone.\n')).toBe(false);
  });

  it('returns false when > appears only deep in the content not near the end', () => {
    const content = '>\nline2\nline3\nline4\nline5\n';
    expect(isAtClaudePrompt(content)).toBe(false);
  });

  it('returns false for empty content', () => {
    expect(isAtClaudePrompt('')).toBe(false);
    expect(isAtClaudePrompt('   ')).toBe(false);
  });
});

// ─── extractNewContent ───────────────────────────────────────────────────────

describe('extractNewContent', () => {
  it('returns the suffix when after starts with before', () => {
    const before = 'line1\nline2\n';
    const after  = 'line1\nline2\nline3\nline4\n';
    expect(extractNewContent(before, after)).toBe('line3\nline4');
  });

  it('finds anchor in after when content has scrolled', () => {
    const before = 'old scrolled content\nanchor line';
    const after  = 'anchor line\nnew response here\n>';
    expect(extractNewContent(before, after)).toContain('new response here');
  });

  it('returns trimmed full after content when anchor not found', () => {
    const before = 'totally different content that scrolled away completely';
    const after  = 'fresh pane content\nresponse\n>';
    expect(extractNewContent(before, after)).toBe('fresh pane content\nresponse\n>');
  });

  it('returns trimmed after when before is empty', () => {
    expect(extractNewContent('', 'response\n>')).toBe('response\n>');
  });

  it('trims whitespace from extracted content', () => {
    const before = 'before\n';
    const after  = 'before\n\n  response  \n\n';
    expect(extractNewContent(before, after)).toBe('response');
  });
});
