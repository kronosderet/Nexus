import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { NexusStore } from './db/store.ts';
import { SERVER_VERSION } from './lib/version.ts';
import { createTaskRoutes } from './routes/tasks.ts';
import { createActivityRoutes } from './routes/activity.ts';
import { createPulseRoutes } from './routes/pulse.ts';
import { createScratchpadRoutes } from './routes/scratchpad.ts';
import { createSessionRoutes } from './routes/sessions.ts';
import { createSearchRoutes } from './routes/search.ts';
import { createDigestRoutes } from './routes/digest.ts';
import { createNotifyRoutes } from './routes/notify.ts';
import { createActionRoutes } from './routes/actions.ts';
import { createUsageRoutes, buildTimingInfo } from './routes/usage.ts';
import { createHeatmapRoutes } from './routes/heatmap.ts';
import { createGitHubRoutes } from './routes/github.ts';
import { createWebhookRoutes } from './routes/webhooks.ts';
import { createAIRoutes } from './routes/ai.ts';
import { createOverseerRoutes } from './routes/overseer.ts';
import { createFocusRoutes } from './routes/focus.ts';
import { createBudgetRoutes } from './routes/budget.ts';
import { createInitRoutes } from './routes/init.ts';
import { createClockRoutes } from './routes/clock.ts';
import { createRemediateRoutes } from './routes/remediate.ts';
import { createEmbeddingRoutes } from './routes/embeddings.ts';
import { createSmartSearchRoutes } from './routes/smartSearch.ts';
import { readFileSync, existsSync } from 'fs';
import { createEstimatorRoutes } from './routes/estimator.ts';
import { createFuelIntelRoutes } from './routes/fuelIntel.ts';
import { createPlanRoutes } from './routes/plan.ts';
import { createPlansRoutes } from './routes/plans.ts';
import { createMemoryRoutes } from './routes/memory.ts';
import { createPredictRoutes } from './routes/predict.ts';
import { createAutoSummaryRoutes } from './routes/autoSummary.ts';
import { createAdviceRoutes } from './routes/advice.ts';
import { createThoughtRoutes } from './routes/thoughts.ts';
import { createCritiqueRoutes } from './routes/critique.ts';
import { createGuardRoutes } from './routes/guard.ts';
import { createLedgerRoutes } from './routes/ledger.ts';
import { createImpactRoutes } from './routes/impact.ts';
import { createBookmarkRoutes } from './routes/bookmarks.ts';
import { startFileWatcher } from './watchers/fileWatcher.ts';
import { startGpuPoller } from './watchers/gpuPoller.ts';
import { startOverseerPoller } from './watchers/overseerPoller.ts';
import { attachTerminal } from './routes/terminal.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

// ── Database ──────────────────────────────────────────────
const store = new NexusStore();

// ── Express ───────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve built client in production
app.use(express.static(join(__dirname, '..', 'client', 'dist')));

// ── WebSocket ─────────────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
const termWss = new WebSocketServer({ noServer: true });
attachTerminal(termWss);

// Route WebSocket upgrades by path
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/terminal') {
    termWss.handleUpgrade(req, socket, head, (ws) => termWss.emit('connection', ws, req));
  } else if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({
    type: 'nexus_hello',
    payload: { message: 'Bearings restored. All instruments nominal.', timestamp: new Date().toISOString() }
  }));
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data: unknown) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    const sock = ws as { readyState?: number; send?: (s: string) => void };
    if (sock.readyState === 1 && sock.send) sock.send(msg);
  }
}

// ── Routes ────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    message: 'All instruments nominal.',
    version: SERVER_VERSION,
    uptime: process.uptime(),
  });
});

app.use('/api/tasks', createTaskRoutes(store, broadcast));
app.use('/api/activity', createActivityRoutes(store));
app.use('/api/pulse', createPulseRoutes(store));
app.use('/api/scratchpads', createScratchpadRoutes(store));
app.use('/api/sessions', createSessionRoutes(store, broadcast));
app.use('/api/search', createSearchRoutes(store));
app.use('/api/digest', createDigestRoutes(store));
app.use('/api/notify', createNotifyRoutes(store, broadcast));
app.use('/api/actions', createActionRoutes(store, broadcast));
app.use('/api/usage', createUsageRoutes(store, broadcast));
app.use('/api/heatmap', createHeatmapRoutes(store));
app.use('/api/git', createGitHubRoutes(store, broadcast));
app.use('/api/webhooks', createWebhookRoutes(store, broadcast));
app.use('/api/ai', createAIRoutes(store));
app.use('/api/overseer', createOverseerRoutes(store, broadcast));
app.use('/api/focus', createFocusRoutes(store));
app.use('/api/budget', createBudgetRoutes(store));
app.use('/api/init', createInitRoutes(store));
app.use('/api/clock', createClockRoutes(store));
app.use('/api/remediate', createRemediateRoutes(store, broadcast));
app.use('/api/embed', createEmbeddingRoutes(store));

// Shared embedding cache for smart search
const embedCachePath = join(__dirname, '..', 'nexus-embeddings.json');
let embedCache = {};
try { if (existsSync(embedCachePath)) embedCache = JSON.parse(readFileSync(embedCachePath, 'utf-8')); } catch {}
app.use('/api/smart-search', createSmartSearchRoutes(store, embedCache));
app.use('/api/estimator', createEstimatorRoutes(store));
app.use('/api/fuel-intel', createFuelIntelRoutes(store));
app.use('/api/plan', createPlanRoutes(store));
app.use('/api/cc-plans', createPlansRoutes());
app.use('/api/cc-memory', createMemoryRoutes());
app.use('/api/predict', createPredictRoutes(store, broadcast));
app.use('/api/auto-summary', createAutoSummaryRoutes(store, broadcast));
app.use('/api/advice', createAdviceRoutes(store));
app.use('/api/thoughts', createThoughtRoutes(store, broadcast));
app.use('/api/critique', createCritiqueRoutes(store));
app.use('/api/guard', createGuardRoutes(store));
app.use('/api/ledger', createLedgerRoutes(store, broadcast));
app.use('/api/impact', createImpactRoutes(store));
app.use('/api/bookmarks', createBookmarkRoutes(store));

// SPA fallback (Express 5 requires named wildcard)
app.get('/{*splat}', (req, res) => {
  res.sendFile(join(__dirname, '..', 'client', 'dist', 'index.html'));
});

// ── Launch ────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────┐');
  console.log('  │                                          │');
  console.log('  │   ◈  N E X U S  v1.0                     │');
  console.log('  │   The Cartographer — The Sentinel         │');
  console.log('  │                                          │');
  console.log('  │   Setting course.                        │');
  console.log('  │   All instruments nominal.                │');
  console.log('  │                                          │');
  console.log(`  │   http://localhost:${PORT}                   │`);
  console.log('  │                                          │');
  console.log('  └──────────────────────────────────────────┘');
  console.log('');

  store.addActivity('system', 'Nexus is online. Setting course.');
  fileWatcherRef = startFileWatcher(store, broadcast);
  gpuPollerRef = startGpuPoller(store, broadcast);
  overseerPollerRef = startOverseerPoller(store, broadcast);
});

// v4.3.5 C3 — capture watcher/interval refs so SIGINT can clean them up.
// Without this, setInterval handles and chokidar FSWatcher were leaking on shutdown.
// chokidar's FSWatcher type isn't needed globally; we just need .close() to be callable.
let fileWatcherRef: { close?: () => void } | null = null;
let gpuPollerRef: NodeJS.Timeout | null = null;
let overseerPollerRef: NodeJS.Timeout | null = null;

process.on('SIGINT', () => {
  console.log('\n  Instruments powered down. Safe harbors, Captain.\n');
  try { if (overseerPollerRef) clearInterval(overseerPollerRef); } catch {}
  try { if (gpuPollerRef) clearInterval(gpuPollerRef); } catch {}
  try { if (fileWatcherRef && typeof fileWatcherRef.close === 'function') fileWatcherRef.close(); } catch {}
  try { server.close(); } catch {}
  process.exit(0);
});
