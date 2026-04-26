/**
 * v4.6.2 D1 — Knowledge-Graph Hygiene migration test.
 *
 * Verifies the migration:
 *   - renames project='claude' → 'family-coop' for Alpha/Beta protocol decisions
 *   - renames project='claude-md' → 'Nexus' (synthetic-project leak fix)
 *   - splits project='general' by content prefix into Shadowrun/Firewall-Godot/noosphere
 *   - moves general cc-memory imports to Nexus
 *   - deletes junk decisions (e.g. content === '--help')
 *   - strips path-encoded tags (/^[A-Z]--/)
 *   - is idempotent (running twice doesn't re-stamp or duplicate work)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const TEMP_DB = join(import.meta.dirname, '.test-graph-hygiene.json');
process.env.NEXUS_DB_PATH = TEMP_DB;

const { NexusStore } = await import('../server/db/store.ts');

function seed() {
  writeFileSync(TEMP_DB, JSON.stringify({
    tasks: [],
    activity: [],
    sessions: [
      { id: 1, project: 'claude', summary: 'Alpha/Beta agent protocol initialized', created_at: '2026-04-06T22:00:00Z' },
      { id: 2, project: 'claude-md', summary: 'Notes session', created_at: '2026-04-23T10:00:00Z' },
      { id: 3, project: 'Nexus', summary: 'Untouched', created_at: '2026-04-25T10:00:00Z' },
    ],
    usage: [],
    gpu_history: [],
    scratchpads: [],
    bookmarks: [],
    ledger: [
      // claude → family-coop (Alpha/Beta protocol signals)
      { id: 100, project: 'claude', decision: 'Alpha/Beta cooperative agent protocol uses shared NAS folder.', context: '', tags: [], lifecycle: 'validated', created_at: '2026-04-06T22:00:00Z' },
      // claude with NO Alpha/Beta signals → leave alone (conservative)
      { id: 101, project: 'claude', decision: 'Generic claude note unrelated to agent protocol', context: '', tags: [], lifecycle: 'active', created_at: '2026-04-06T22:00:00Z' },
      // claude-md → Nexus
      { id: 102, project: 'claude-md', decision: 'Reference note from Claude-MD dir', context: '', tags: ['cc-memory', 'reference', 'C--Users-kronos-Claude-MD'], lifecycle: 'reference', created_at: '2026-04-23T10:00:00Z' },
      // general SR3/Shadowrun → Shadowrun
      { id: 103, project: 'general', decision: 'SR3 Digital Table is a Shadowrun 3E LAN web app', context: '', tags: [], lifecycle: 'validated', created_at: '2026-04-06T22:00:00Z' },
      // general Firewall-Godot → Firewall-Godot
      { id: 104, project: 'general', decision: 'Firewall-Godot: Extropia is the hub station', context: '', tags: [], lifecycle: 'validated', created_at: '2026-04-06T22:00:00Z' },
      // general Noosphere → noosphere
      { id: 105, project: 'general', decision: 'Noosphere uses Hebbian learning', context: '', tags: [], lifecycle: 'validated', created_at: '2026-04-06T22:00:00Z' },
      // general cc-memory → Nexus
      { id: 106, project: 'general', decision: 'Some imported memory note', context: '', tags: ['cc-memory', 'reference', 'C--Projects'], lifecycle: 'reference', created_at: '2026-04-06T22:00:00Z' },
      // general junk (--help) → DELETE
      { id: 107, project: 'general', decision: '--help', context: '', tags: [], lifecycle: 'proposed', created_at: '2026-04-06T22:00:00Z' },
      // general truly-general → leave alone (no D1 or D2 pattern matches)
      { id: 108, project: 'general', decision: 'Some miscellaneous note about workflow that does not fit any project', context: '', tags: ['process'], lifecycle: 'proposed', created_at: '2026-04-06T22:00:00Z' },
      // path-tag scrubbing on a Nexus-project decision
      { id: 109, project: 'Nexus', decision: 'A real Nexus decision', context: '', tags: ['nexus', 'C--', 'C--Projects'], lifecycle: 'active', created_at: '2026-04-25T10:00:00Z' },
    ],
    graph_edges: [],
    advice: [],
    thoughts: [
      { id: 50, project: 'claude', text: 'Outbox check for alpha agent', status: 'active' },
      { id: 51, project: 'claude-md', text: 'Notes thought', status: 'active' },
    ],
  }));
  return new NexusStore();
}

afterAll(() => {
  try { unlinkSync(TEMP_DB); } catch {}
});

describe('v4.6.2 D1 migration', () => {
  it('renames Alpha/Beta claude decisions to family-coop', () => {
    const store = seed();
    expect(store.getDecisionById(100)?.project).toBe('family-coop');
  });

  it('leaves non-Alpha/Beta claude decisions alone (conservative)', () => {
    const store = seed();
    expect(store.getDecisionById(101)?.project).toBe('claude');
  });

  it('renames claude-md decisions to Nexus', () => {
    const store = seed();
    expect(store.getDecisionById(102)?.project).toBe('Nexus');
  });

  it('reassigns general SR3/Shadowrun decisions to Shadowrun', () => {
    const store = seed();
    expect(store.getDecisionById(103)?.project).toBe('Shadowrun');
  });

  it('reassigns general Firewall-Godot decisions to Firewall-Godot', () => {
    const store = seed();
    expect(store.getDecisionById(104)?.project).toBe('Firewall-Godot');
  });

  it('reassigns general Noosphere decisions to noosphere', () => {
    const store = seed();
    expect(store.getDecisionById(105)?.project).toBe('noosphere');
  });

  it('moves general cc-memory imports to Nexus', () => {
    const store = seed();
    expect(store.getDecisionById(106)?.project).toBe('Nexus');
  });

  it('deletes "--help" junk decisions', () => {
    const store = seed();
    expect(store.getDecisionById(107) ?? null).toBeNull();
  });

  it('leaves truly-general decisions alone (no clear pattern)', () => {
    const store = seed();
    expect(store.getDecisionById(108)?.project).toBe('general');
  });

  it('strips path-encoded tags (/^[A-Z]--/) from all decisions', () => {
    const store = seed();
    const dec109 = store.getDecisionById(109);
    expect(dec109?.tags).toEqual(['nexus']);
    const dec102 = store.getDecisionById(102);
    expect(dec102?.tags).toEqual(['cc-memory', 'reference']);
    const dec106 = store.getDecisionById(106);
    expect(dec106?.tags).toEqual(['cc-memory', 'reference']);
  });

  it('renames Alpha/Beta claude sessions to family-coop', () => {
    const store = seed();
    const sessions = store.getSessions({ limit: 10 });
    const s1 = sessions.find((s) => s.id === 1);
    expect(s1?.project).toBe('family-coop');
  });

  it('renames claude-md sessions to Nexus', () => {
    const store = seed();
    const sessions = store.getSessions({ limit: 10 });
    const s2 = sessions.find((s) => s.id === 2);
    expect(s2?.project).toBe('Nexus');
  });

  it('renames matching claude thoughts to family-coop', () => {
    const store = seed();
    const t = store.data.thoughts.find((x: { id: number }) => x.id === 50);
    expect(t?.project).toBe('family-coop');
  });

  it('renames claude-md thoughts to Nexus', () => {
    const store = seed();
    const t = store.data.thoughts.find((x: { id: number }) => x.id === 51);
    expect(t?.project).toBe('Nexus');
  });

  it('stamps _appliedMigrations[v4.6.2-D1]', () => {
    const store = seed();
    expect(store.data._appliedMigrations?.['v4.6.2-D1']).toBeDefined();
  });

  it('is idempotent — re-running does not re-mutate', () => {
    const store = seed(); // first migration run
    const beforeCount = store.data.ledger.length;
    const beforeStamp = store.data._appliedMigrations?.['v4.6.2-D1'];

    // Construct a second store from the same on-disk file (simulates restart)
    const store2 = new NexusStore();
    expect(store2.data.ledger.length).toBe(beforeCount);
    expect(store2.data._appliedMigrations?.['v4.6.2-D1']).toBe(beforeStamp);
    // Spot-check that values haven't drifted
    expect(store2.getDecisionById(100)?.project).toBe('family-coop');
    expect(store2.getDecisionById(102)?.project).toBe('Nexus');
    expect(store2.getDecisionById(107) ?? null).toBeNull();
  });
});
