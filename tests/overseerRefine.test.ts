// v4.4.7 #343 — unit tests for the refine-mode helpers.
// These are pure functions, so we can test them without spinning up the
// express router or hitting LM Studio. The route integration (actual AI call)
// is covered by the smoke-test-bundle scripts, not here.

import { describe, it, expect } from 'vitest';
import { formatHistory, buildSlimContext } from '../server/routes/overseer.ts';

describe('formatHistory', () => {
  it('returns empty string on missing/empty history', () => {
    expect(formatHistory(undefined as unknown as Array<{ role: string; text: string }>)).toBe('');
    expect(formatHistory([])).toBe('');
  });

  it('renders turns with [You] / [Overseer] role labels', () => {
    const out = formatHistory([
      { role: 'user', text: 'What should I ship?' },
      { role: 'overseer', text: 'Close out Tier 2.' },
    ]);
    expect(out).toContain('[You]: What should I ship?');
    expect(out).toContain('[Overseer]: Close out Tier 2.');
    expect(out).toMatch(/^Prior conversation:/);
    expect(out).toMatch(/\n\n$/); // trailing double newline separator
  });

  it('caps history at last 8 turns (4 Q/A pairs)', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'overseer',
      text: `turn-${i}`,
    }));
    const out = formatHistory(many);
    // Should contain the most recent 8 turns (turn-12 through turn-19)
    expect(out).toContain('turn-19');
    expect(out).toContain('turn-12');
    // Should NOT contain earlier turns
    expect(out).not.toContain('turn-11');
    expect(out).not.toContain('turn-0');
  });

  it('truncates individual turn text to 2000 chars', () => {
    const long = 'x'.repeat(5000);
    const out = formatHistory([{ role: 'user', text: long }]);
    // Output line should contain only 2000 xs
    const xs = (out.match(/x/g) || []).length;
    expect(xs).toBeLessThanOrEqual(2000);
    expect(xs).toBeGreaterThan(1900); // close to the cap
  });

  it('passes through unknown roles as-is', () => {
    const out = formatHistory([{ role: 'system', text: 'hello' }]);
    expect(out).toContain('[system]: hello');
  });
});

describe('buildSlimContext', () => {
  it('returns "(no state)" when ctx has no tasks and no usage', () => {
    const out = buildSlimContext({ tasks: [], usage: null });
    expect(out).toBe('(no state)');
  });

  it('omits done tasks from the Active count', () => {
    const out = buildSlimContext({
      tasks: [
        { status: 'done', project: 'Nexus' },
        { status: 'backlog', project: 'Nexus' },
        { status: 'in_progress', project: 'Nexus' },
      ],
      usage: null,
    });
    expect(out).toContain('Nexus (2)'); // two non-done, one done
  });

  it('buckets tasks by project and sorts by count desc', () => {
    const out = buildSlimContext({
      tasks: [
        { status: 'backlog', project: 'A' },
        { status: 'backlog', project: 'B' },
        { status: 'backlog', project: 'B' },
        { status: 'backlog', project: 'B' },
      ],
      usage: null,
    });
    // B has 3, A has 1; B should appear first
    const bIdx = out.indexOf('B (3)');
    const aIdx = out.indexOf('A (1)');
    expect(bIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeLessThan(aIdx);
  });

  it('defaults missing project to Nexus', () => {
    const out = buildSlimContext({
      tasks: [{ status: 'backlog' }, { status: 'backlog' }],
      usage: null,
    });
    expect(out).toContain('Nexus (2)');
  });

  it('includes fuel line when usage is present', () => {
    const out = buildSlimContext({
      tasks: [],
      usage: { session_percent: 83, weekly_percent: 44 },
    });
    expect(out).toContain('Fuel: session 83%, weekly 44%');
  });

  it('is much shorter than the full context dump would be for the same input', () => {
    // Sanity check: the whole point of slim is that it's small.
    const out = buildSlimContext({
      tasks: Array.from({ length: 50 }, (_, i) => ({ status: 'backlog', project: `P${i % 5}` })),
      usage: { session_percent: 90, weekly_percent: 50 },
    });
    // 5 projects + 1 fuel line + wrapping. Should stay well under 300 chars.
    expect(out.length).toBeLessThan(300);
  });
});
