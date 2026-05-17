/**
 * v4.9.1 #742 — route tests for previously-uncovered surfaces.
 *
 * The v4.8.2 audit catalogued 13/38 routes with integration specs. This file
 * adds:
 *   - handover.ts (4 endpoints) — the Captain's flagship v4.6.0 protocol that
 *     had ZERO tests despite being the primary cross-session continuity API.
 *   - usage.ts (5 endpoints) — every fuel call goes through this; auto-derives
 *     weekly day/hour from the user's reported reset; sliding-window logic
 *     touched by the v4.5.11+ rewrite.
 *   - estimator.ts (3 endpoints) — feeds nexus fuel/workload/quick.
 *
 * plan.ts and autoSummary.ts route specs require mocking detectAI(); deferred
 * to a follow-up so this file stays hermetic + AI-free.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmpDir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'nexus-routes-def-'));
  process.env.NEXUS_DB_PATH = join(tmpDir, 'nexus.json');
  process.env.NEXUS_DISABLE_WATCHER = '1';
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

async function makeApp() {
  const { NexusStore } = await import('../server/db/store.ts');
  const { createHandoverRoutes } = await import('../server/routes/handover.ts');
  const { createUsageRoutes } = await import('../server/routes/usage.ts');
  const { createEstimatorRoutes } = await import('../server/routes/estimator.ts');
  const store = new NexusStore();
  const broadcast = () => {};
  const app = express();
  app.use(express.json());
  app.use('/api/handover', createHandoverRoutes(store, broadcast));
  app.use('/api/usage', createUsageRoutes(store, broadcast));
  app.use('/api/estimator', createEstimatorRoutes(store));
  return { app, store };
}

// ─── /api/handover ─────────────────────────────────────────────────
describe('handover routes (v4.6.0 #398, v4.9.1 #742 coverage)', () => {
  it('GET / lists handovers (object keyed by project name)', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/api/handover');
    expect(res.status).toBe(200);
    // getAllHandovers() returns a Record<project, HandoverEntry>; we just
    // assert the shape exists and is an object, not an array.
    expect(res.body.handovers).toBeDefined();
    expect(typeof res.body.handovers).toBe('object');
  });

  it('GET /:project returns 404 for a project with no handover', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/api/handover/never-existed-project');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no handover/i);
  });

  it('PUT /:project creates a handover; GET /:project then returns it', async () => {
    const { app } = await makeApp();
    const put = await request(app).put('/api/handover/test-proj').send({ content: 'first draft', updated_by: 'test' });
    expect(put.status).toBe(200);
    expect(put.body.content).toBe('first draft');
    expect(put.body.updated_by).toBe('test');
    expect(typeof put.body.updated_at).toBe('string');
    const get = await request(app).get('/api/handover/test-proj');
    expect(get.status).toBe(200);
    expect(get.body.project).toBe('test-proj');
    expect(get.body.content).toBe('first draft');
  });

  it('PUT /:project replaces existing content', async () => {
    const { app } = await makeApp();
    await request(app).put('/api/handover/test-proj').send({ content: 'v1' });
    await request(app).put('/api/handover/test-proj').send({ content: 'v2' });
    const get = await request(app).get('/api/handover/test-proj');
    expect(get.body.content).toBe('v2');
  });

  it('PUT /:project rejects non-string content with 400', async () => {
    const { app } = await makeApp();
    const res = await request(app).put('/api/handover/test-proj').send({ content: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/content/i);
  });

  it('DELETE /:project removes the handover, then GET returns 404', async () => {
    const { app } = await makeApp();
    await request(app).put('/api/handover/test-proj').send({ content: 'doomed' });
    const del = await request(app).delete('/api/handover/test-proj');
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);
    const get = await request(app).get('/api/handover/test-proj');
    expect(get.status).toBe(404);
  });

  it('DELETE /:project returns 404 when no handover exists', async () => {
    const { app } = await makeApp();
    const res = await request(app).delete('/api/handover/never-existed-project');
    expect(res.status).toBe(404);
  });
});

// ─── /api/usage ────────────────────────────────────────────────────
describe('usage routes (v4.9.1 #742 coverage)', () => {
  it('GET /latest returns tracked:false on a fresh store', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/api/usage/latest');
    expect(res.status).toBe(200);
    expect(res.body.tracked).toBe(false);
    expect(res.body.timing).toBeDefined();
    expect(res.body.timing.session).toBeDefined();
    expect(res.body.timing.weekly).toBeDefined();
  });

  it('POST / logs a usage reading and GET /latest reflects it', async () => {
    const { app } = await makeApp();
    const post = await request(app).post('/api/usage').send({ session_percent: 72, weekly_percent: 85, note: 'route test' });
    expect(post.status).toBe(201);
    const latest = await request(app).get('/api/usage/latest');
    expect(latest.body.tracked).toBe(true);
    expect(latest.body.session_percent).toBe(72);
    expect(latest.body.weekly_percent).toBe(85);
    expect(latest.body.note).toBe('route test');
  });

  it('POST / rejects an empty body with 400 (no fuel signal)', async () => {
    const { app } = await makeApp();
    const res = await request(app).post('/api/usage').send({});
    expect(res.status).toBe(400);
  });

  it('POST / rejects out-of-range session_percent via Zod (v4.8.0 #219)', async () => {
    const { app } = await makeApp();
    const res = await request(app).post('/api/usage').send({ session_percent: 150 });
    expect(res.status).toBe(400);
  });

  it('POST / with reset_in_minutes advances the session timing window', async () => {
    const { app } = await makeApp();
    await request(app).post('/api/usage').send({ session_percent: 90, reset_in_minutes: 180 });
    const latest = await request(app).get('/api/usage/latest');
    expect(latest.body.timing.session.startedAt).not.toBeNull();
    expect(latest.body.timing.session.countdownMs).toBeGreaterThan(0);
  });

  it('GET / returns the usage history', async () => {
    const { app } = await makeApp();
    await request(app).post('/api/usage').send({ session_percent: 80 });
    await request(app).post('/api/usage').send({ session_percent: 70 });
    const res = await request(app).get('/api/usage?limit=10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── /api/estimator ────────────────────────────────────────────────
describe('estimator routes (v4.9.1 #742 coverage)', () => {
  it('GET / returns the fuel-estimate shape', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/api/estimator');
    expect(res.status).toBe(200);
    // tracked false on a fresh store; tracked true after a usage log.
    expect(typeof res.body.tracked).toBe('boolean');
  });

  it('GET / reports tracked:true after a usage reading', async () => {
    const { app } = await makeApp();
    await request(app).post('/api/usage').send({ session_percent: 60, weekly_percent: 75 });
    const res = await request(app).get('/api/estimator');
    expect(res.body.tracked).toBe(true);
    expect(res.body.reported?.session).toBe(60);
    expect(res.body.reported?.weekly).toBe(75);
  });
});
