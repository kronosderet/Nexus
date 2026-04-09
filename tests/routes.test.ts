import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

// Point the store at a temp file so tests don't touch real data
const TEMP_DB = join(import.meta.dirname, '.test-nexus.json');
process.env.NEXUS_DB_PATH = TEMP_DB;

// Must import AFTER setting env var
const { NexusStore } = await import('../server/db/store.ts');
const { createTaskRoutes } = await import('../server/routes/tasks.ts');
const { createActivityRoutes } = await import('../server/routes/activity.ts');
const { createSessionRoutes } = await import('../server/routes/sessions.ts');
const { createLedgerRoutes } = await import('../server/routes/ledger.ts');
const { createThoughtRoutes } = await import('../server/routes/thoughts.ts');
const { createGuardRoutes } = await import('../server/routes/guard.ts');
const { createCritiqueRoutes } = await import('../server/routes/critique.ts');
const { createBookmarkRoutes } = await import('../server/routes/bookmarks.ts');
const { createImpactRoutes } = await import('../server/routes/impact.ts');
const { createSearchRoutes } = await import('../server/routes/search.ts');

// ── Test app factory ────────────────────────────────────
function createTestApp() {
  // Fresh empty DB for each suite
  writeFileSync(TEMP_DB, JSON.stringify({
    tasks: [], activity: [], sessions: [], usage: [],
    gpu_history: [], scratchpads: [], bookmarks: [],
    ledger: [], graph_edges: [], advice: [], thoughts: [],
  }));

  const store = new NexusStore();
  const broadcast = () => {}; // no-op

  const app = express();
  app.use(express.json());
  app.use('/api/tasks', createTaskRoutes(store, broadcast));
  app.use('/api/activity', createActivityRoutes(store, broadcast));
  app.use('/api/sessions', createSessionRoutes(store, broadcast));
  app.use('/api/ledger', createLedgerRoutes(store, broadcast));
  app.use('/api/thoughts', createThoughtRoutes(store, broadcast));
  app.use('/api/guard', createGuardRoutes(store));
  app.use('/api/critique', createCritiqueRoutes(store));
  app.use('/api/bookmarks', createBookmarkRoutes(store, broadcast));
  app.use('/api/impact', createImpactRoutes(store));
  app.use('/api/search', createSearchRoutes(store));

  return { app, store };
}

afterAll(() => {
  try { unlinkSync(TEMP_DB); } catch {}
});

// ── Tasks ─────────────────────────────────────────────────
describe('Tasks API', () => {
  const { app } = createTestApp();

  it('POST /api/tasks creates a task', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'Test task' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Test task');
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('backlog');
  });

  it('POST /api/tasks rejects empty title', async () => {
    const res = await request(app).post('/api/tasks').send({ title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('POST /api/tasks rejects whitespace-only title', async () => {
    const res = await request(app).post('/api/tasks').send({ title: '   ' });
    expect(res.status).toBe(400);
  });

  it('GET /api/tasks returns array', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('PATCH /api/tasks/:id updates status', async () => {
    const create = await request(app).post('/api/tasks').send({ title: 'Update me' });
    const res = await request(app).patch(`/api/tasks/${create.body.id}`).send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');
  });

  it('PATCH /api/tasks/:id returns 404 for missing task', async () => {
    const res = await request(app).patch('/api/tasks/99999').send({ status: 'done' });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/tasks/:id removes task', async () => {
    const create = await request(app).post('/api/tasks').send({ title: 'Delete me' });
    const res = await request(app).delete(`/api/tasks/${create.body.id}`);
    expect(res.status).toBe(200);
  });
});

// ── Activity ──────────────────────────────────────────────
describe('Activity API', () => {
  const { app } = createTestApp();

  it('POST /api/activity logs an entry', async () => {
    const res = await request(app).post('/api/activity').send({ type: 'test', message: 'Hello' });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Hello');
  });

  it('POST /api/activity handles malformed meta gracefully', async () => {
    const res = await request(app).post('/api/activity').send({ type: 'test', message: 'Bad meta', meta: '{broken' });
    expect(res.status).toBe(201); // should not crash
  });

  it('GET /api/activity returns array with limit', async () => {
    const res = await request(app).get('/api/activity?limit=5');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── Sessions ──────────────────────────────────────────────
describe('Sessions API', () => {
  const { app } = createTestApp();

  it('POST /api/sessions creates a session', async () => {
    const res = await request(app).post('/api/sessions').send({
      project: 'TestProject',
      summary: 'Did some work',
      decisions: ['Used TypeScript'],
      blockers: [],
      tags: ['test'],
      files_touched: ['foo.ts'],
    });
    expect(res.status).toBe(201);
    expect(res.body.project).toBe('TestProject');
    expect(res.body.decisions).toContain('Used TypeScript');
  });

  it('POST /api/sessions rejects missing project', async () => {
    const res = await request(app).post('/api/sessions').send({ summary: 'No project' });
    expect(res.status).toBe(400);
  });

  it('POST /api/sessions rejects missing summary', async () => {
    const res = await request(app).post('/api/sessions').send({ project: 'X' });
    expect(res.status).toBe(400);
  });

  it('GET /api/sessions returns array', async () => {
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('PATCH /api/sessions/:id uses allowlist', async () => {
    const create = await request(app).post('/api/sessions').send({
      project: 'X', summary: 'Original',
    });
    const res = await request(app).patch(`/api/sessions/${create.body.id}`).send({
      summary: 'Updated',
      _dangerousField: 'should not persist',
    });
    expect(res.status).toBe(200);
    expect(res.body.summary).toBe('Updated');
    expect(res.body._dangerousField).toBeUndefined();
  });
});

// ── Ledger ────────────────────────────────────────────────
describe('Ledger API', () => {
  const { app } = createTestApp();

  it('POST /api/ledger records a decision', async () => {
    const res = await request(app).post('/api/ledger').send({
      decision: 'Use PostgreSQL for sessions',
      project: 'TestProject',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.decision).toBe('Use PostgreSQL for sessions');
  });

  it('POST /api/ledger rejects empty decision', async () => {
    const res = await request(app).post('/api/ledger').send({ decision: '', project: 'X' });
    expect(res.status).toBe(400);
  });

  it('POST /api/ledger rejects whitespace-only decision', async () => {
    const res = await request(app).post('/api/ledger').send({ decision: '   ', project: 'X' });
    expect(res.status).toBe(400);
  });

  it('GET /api/ledger returns decisions', async () => {
    const res = await request(app).get('/api/ledger');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/ledger/link creates an edge', async () => {
    const d1 = await request(app).post('/api/ledger').send({ decision: 'Decision A', project: 'X' });
    const d2 = await request(app).post('/api/ledger').send({ decision: 'Decision B', project: 'X' });
    const res = await request(app).post('/api/ledger/link').send({
      from: d1.body.id,
      to: d2.body.id,
      rel: 'led_to',
    });
    expect(res.status).toBe(201);
  });

  it('GET /api/ledger/graph/full returns nodes and edges', async () => {
    const res = await request(app).get('/api/ledger/graph/full');
    expect(res.status).toBe(200);
    expect(res.body.nodes).toBeDefined();
    expect(res.body.edges).toBeDefined();
  });
});

// ── Thoughts ──────────────────────────────────────────────
describe('Thoughts API', () => {
  const { app } = createTestApp();

  it('POST /api/thoughts pushes a thought', async () => {
    const res = await request(app).post('/api/thoughts').send({ text: 'Remember this' });
    expect(res.status).toBe(201);
    expect(res.body.text).toBe('Remember this');
  });

  it('POST /api/thoughts rejects empty text', async () => {
    const res = await request(app).post('/api/thoughts').send({ text: '' });
    expect(res.status).toBe(400);
  });

  it('POST /api/thoughts rejects whitespace-only text', async () => {
    const res = await request(app).post('/api/thoughts').send({ text: '   ' });
    expect(res.status).toBe(400);
  });

  it('GET /api/thoughts returns active thoughts', async () => {
    const res = await request(app).get('/api/thoughts');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/thoughts/pop pops the top', async () => {
    await request(app).post('/api/thoughts').send({ text: 'First' });
    await request(app).post('/api/thoughts').send({ text: 'Second' });
    const res = await request(app).post('/api/thoughts/pop').send({});
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('Second'); // LIFO
  });

  it('POST /api/thoughts/pop returns 404 when empty', async () => {
    const { app: freshApp } = createTestApp();
    const res = await request(freshApp).post('/api/thoughts/pop').send({});
    expect(res.status).toBe(404);
  });
});

// ── Guard ─────────────────────────────────────────────────
describe('Guard API', () => {
  const { app } = createTestApp();

  it('GET /api/guard?title=... returns redundancy check', async () => {
    // Seed a task to match against
    await request(app).post('/api/tasks').send({ title: 'Build authentication system' });
    const res = await request(app).get('/api/guard?title=Build+auth+system');
    expect(res.status).toBe(200);
    expect(res.body.similarTasks).toBeDefined();
    expect(res.body.warning).toBeDefined();
  });

  it('GET /api/guard without title returns 400', async () => {
    const res = await request(app).get('/api/guard');
    expect(res.status).toBe(400);
  });
});

// ── Critique ──────────────────────────────────────────────
describe('Critique API', () => {
  const { app } = createTestApp();

  it('GET /api/critique returns structure', async () => {
    const res = await request(app).get('/api/critique');
    expect(res.status).toBe(200);
    expect(res.body.slowTasks).toBeDefined();
    expect(res.body.insights).toBeDefined();
  });
});

// ── Bookmarks ─────────────────────────────────────────────
describe('Bookmarks API', () => {
  const { app } = createTestApp();

  it('POST /api/bookmarks creates a bookmark', async () => {
    const res = await request(app).post('/api/bookmarks').send({
      title: 'GitHub', url: 'https://github.com', category: 'tools',
    });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('GitHub');
  });

  it('GET /api/bookmarks returns array', async () => {
    const res = await request(app).get('/api/bookmarks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('DELETE /api/bookmarks/:id removes bookmark', async () => {
    const create = await request(app).post('/api/bookmarks').send({
      title: 'Del', url: 'https://x.com', category: 'test',
    });
    const res = await request(app).delete(`/api/bookmarks/${create.body.id}`);
    expect(res.status).toBe(200);
  });
});

// ── Impact ────────────────────────────────────────────────
describe('Impact API', () => {
  const { app } = createTestApp();

  it('GET /api/impact/centrality returns rankings', async () => {
    const res = await request(app).get('/api/impact/centrality');
    expect(res.status).toBe(200);
    expect(res.body.centrality).toBeDefined();
    expect(res.body.averageConnections).toBeDefined();
  });

  it('GET /api/impact/contradictions returns list', async () => {
    const res = await request(app).get('/api/impact/contradictions');
    expect(res.status).toBe(200);
    expect(res.body.contradictions).toBeDefined();
    expect(res.body.total).toBeDefined();
  });

  it('GET /api/impact/holes returns per-project analysis', async () => {
    const res = await request(app).get('/api/impact/holes');
    expect(res.status).toBe(200);
    expect(res.body.projectAnalysis).toBeDefined();
    expect(res.body.totalFragmented).toBeDefined();
  });

  it('GET /api/impact/blast/:id returns 404 for missing decision', async () => {
    const res = await request(app).get('/api/impact/blast/99999');
    expect(res.status).toBe(404);
  });

  it('GET /api/impact/blast/:id works for existing decision', async () => {
    // Seed a decision
    const d = await request(app).post('/api/ledger').send({ decision: 'Test blast', project: 'X' });
    const res = await request(app).get(`/api/impact/blast/${d.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.blastRadius).toBeDefined();
    expect(res.body.warning).toBeDefined();
  });
});

// ── Search ────────────────────────────────────────────────
describe('Search API', () => {
  const { app } = createTestApp();

  it('GET /api/search?q=... returns results', async () => {
    await request(app).post('/api/tasks').send({ title: 'Refactor authentication' });
    const res = await request(app).get('/api/search?q=authentication');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
