/**
 * Tests for v4.7.5 (#217 part 3) — cli/nexus.js split into per-group files.
 *
 * Catches the most likely regression class for a module split: a command
 * silently dropped during the move (renamed export, missing key in the
 * registry, etc.). The registry shape is asserted directly so adding/
 * removing a command updates the test count.
 *
 * Pure node import — no fetch, no spawning, no live dashboard required.
 */
import { describe, it, expect } from 'vitest';

const { taskCommands } = await import('../cli/commands/tasks.js');
const { sessionCommands } = await import('../cli/commands/sessions.js');
const { ledgerCommands } = await import('../cli/commands/ledger.js');
const { gitCommands } = await import('../cli/commands/git.js');
const { handoverCommands } = await import('../cli/commands/handover.js');

// ──────────────────────────────────────────────────────────
// Per-group exports — shape matches the v4.7.5 split plan
// ──────────────────────────────────────────────────────────

describe('cli/commands/tasks.js', () => {
  it('exports the expected commands', () => {
    // v4.9.1 #740 — added 'update-task' and 'delete-task' CLI mirrors.
    expect(Object.keys(taskCommands).sort()).toEqual(['delete-task', 'done', 'quick', 'task', 'tasks', 'update-task']);
  });
  it('every export is an async function', () => {
    for (const [name, fn] of Object.entries(taskCommands)) {
      expect(typeof fn).toBe('function');
      expect(fn.constructor.name).toBe('AsyncFunction');
    }
  });
});

describe('cli/commands/sessions.js', () => {
  it('exports the expected commands', () => {
    // v4.9.1 #740 — added 'list-sessions' CLI mirror.
    expect(Object.keys(sessionCommands).sort()).toEqual(
      ['activity', 'context', 'digest', 'handoff', 'list-sessions', 'log', 'note', 'session', 'summarize'].sort(),
    );
  });
  it('every export is an async function', () => {
    for (const [, fn] of Object.entries(sessionCommands)) {
      expect(typeof fn).toBe('function');
      expect(fn.constructor.name).toBe('AsyncFunction');
    }
  });
});

describe('cli/commands/ledger.js', () => {
  it('exports the expected commands', () => {
    // v4.9.1 #740 — added 'update-decision' CLI mirror.
    expect(Object.keys(ledgerCommands).sort()).toEqual(
      ['decisions', 'find', 'graph', 'impact', 'link', 'record', 'search', 'seek', 'update-decision'].sort(),
    );
  });
  it('every export is an async function', () => {
    for (const [, fn] of Object.entries(ledgerCommands)) {
      expect(typeof fn).toBe('function');
      expect(fn.constructor.name).toBe('AsyncFunction');
    }
  });
});

describe('cli/commands/handover.js', () => {
  it('exports the expected commands (v4.9.1 #740)', () => {
    expect(Object.keys(handoverCommands).sort()).toEqual(['list-handovers', 'read-handover', 'update-handover']);
  });
  it('every export is an async function', () => {
    for (const [, fn] of Object.entries(handoverCommands)) {
      expect(typeof fn).toBe('function');
      expect(fn.constructor.name).toBe('AsyncFunction');
    }
  });
});

describe('cli/commands/git.js', () => {
  it('exports the expected commands (incl. hyphenated commit-all)', () => {
    expect(Object.keys(gitCommands).sort()).toEqual(['commit-all', 'repos', 'sync']);
  });
  it('every export is an async function', () => {
    for (const [, fn] of Object.entries(gitCommands)) {
      expect(typeof fn).toBe('function');
      expect(fn.constructor.name).toBe('AsyncFunction');
    }
  });
});

// ──────────────────────────────────────────────────────────
// No-duplicates: command names must be unique across groups
// ──────────────────────────────────────────────────────────

describe('cross-group registry', () => {
  it('no command name appears in two groups', () => {
    const groups = { taskCommands, sessionCommands, ledgerCommands, gitCommands, handoverCommands };
    const seen = new Map(); // name → group
    for (const [groupName, group] of Object.entries(groups)) {
      for (const cmd of Object.keys(group)) {
        if (seen.has(cmd)) {
          throw new Error(`Command "${cmd}" appears in both ${seen.get(cmd)} and ${groupName}`);
        }
        seen.set(cmd, groupName);
      }
    }
    // Sanity: total command count across all extracted groups
    expect(seen.size).toBe(
      Object.keys(taskCommands).length +
      Object.keys(sessionCommands).length +
      Object.keys(ledgerCommands).length +
      Object.keys(gitCommands).length +
      Object.keys(handoverCommands).length,
    );
  });
});

// ──────────────────────────────────────────────────────────
// Foundation lib smoke — imports work, exports are the expected shape
// ──────────────────────────────────────────────────────────

describe('cli/lib/format.js', () => {
  it('exports color helpers, status colors, and formatters', async () => {
    const fmt = await import('../cli/lib/format.js');
    expect(typeof fmt.dim).toBe('function');
    expect(typeof fmt.amber).toBe('function');
    expect(typeof fmt.green).toBe('function');
    expect(typeof fmt.blue).toBe('function');
    expect(typeof fmt.red).toBe('function');
    expect(typeof fmt.formatTask).toBe('function');
    expect(typeof fmt.timeSince).toBe('function');
    expect(typeof fmt.progressBar).toBe('function');
    expect(typeof fmt.STATUS_COLORS).toBe('object');
    // Color helpers wrap with ANSI escape codes
    expect(fmt.dim('x')).toBe('\x1b[2mx\x1b[0m');
    expect(fmt.amber('y')).toBe('\x1b[33my\x1b[0m');
    // formatTask renders the expected shape
    const t = { id: 42, status: 'in_progress', title: 'Test task' };
    const out = fmt.formatTask(t);
    expect(out).toContain('#42');
    expect(out).toContain('[in_progress]');
    expect(out).toContain('Test task');
    // progressBar produces 20 chars by default
    expect(fmt.progressBar(50).length).toBe(20);
    expect(fmt.progressBar(0).length).toBe(20);
    expect(fmt.progressBar(100).length).toBe(20);
  });
});

describe('cli/lib/api.js', () => {
  it('exports api(), BASE, NEXUS_VERSION', async () => {
    const apiMod = await import('../cli/lib/api.js');
    expect(typeof apiMod.api).toBe('function');
    expect(typeof apiMod.BASE).toBe('string');
    expect(apiMod.BASE).toMatch(/^https?:\/\//);
    expect(typeof apiMod.NEXUS_VERSION).toBe('string');
    // Version is either a real semver or 'unknown' (when bundled without package.json)
    expect(apiMod.NEXUS_VERSION).toMatch(/^\d+\.\d+\.\d+|unknown$/);
  });
});
