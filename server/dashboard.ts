#!/usr/bin/env node
/**
 * Nexus Dashboard — standalone launcher.
 *
 * Starts the Express server + serves the built React client.
 * Reads from ~/.nexus/nexus.json (same data the plugin uses).
 * Invoked by the /nexus-dashboard skill or `npx tsx server/dashboard.ts`.
 *
 * Usage: NEXUS_DB_PATH=~/.nexus/nexus.json node server/dashboard.ts
 */

import { homedir } from 'os';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

// Ensure ~/.nexus/ exists and point the store there
const NEXUS_HOME = process.env.NEXUS_HOME || join(homedir(), '.nexus');
if (!existsSync(NEXUS_HOME)) mkdirSync(NEXUS_HOME, { recursive: true });
process.env.NEXUS_DB_PATH = process.env.NEXUS_DB_PATH || join(NEXUS_HOME, 'nexus.json');

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3001');

// Import the main server setup (reuses all existing routes)
// We just need to override the static file path to point at the built client
async function start() {
  const express = (await import('express')).default;
  const cors = (await import('cors')).default;
  const { createServer } = await import('http');
  const { WebSocketServer } = await import('ws');

  const { NexusStore } = await import('./db/store.ts');
  const { createTaskRoutes } = await import('./routes/tasks.ts');
  const { createActivityRoutes } = await import('./routes/activity.ts');
  const { createSessionRoutes } = await import('./routes/sessions.ts');
  const { createSearchRoutes } = await import('./routes/search.ts');
  const { createUsageRoutes, buildTimingInfo } = await import('./routes/usage.ts');
  const { createEstimatorRoutes } = await import('./routes/estimator.ts');
  const { createLedgerRoutes } = await import('./routes/ledger.ts');
  const { createImpactRoutes } = await import('./routes/impact.ts');
  const { createGuardRoutes } = await import('./routes/guard.ts');
  const { createCritiqueRoutes } = await import('./routes/critique.ts');
  const { createThoughtRoutes } = await import('./routes/thoughts.ts');
  const { createPredictRoutes } = await import('./routes/predict.ts');
  const { createBookmarkRoutes } = await import('./routes/bookmarks.ts');
  const { createOverseerRoutes } = await import('./routes/overseer.ts');
  const { createPulseRoutes } = await import('./routes/pulse.ts');
  const { createClockRoutes } = await import('./routes/clock.ts');
  const { createDigestRoutes } = await import('./routes/digest.ts');
  const { createInitRoutes } = await import('./routes/init.ts');
  const { createActionRoutes } = await import('./routes/actions.ts');
  const { createHeatmapRoutes } = await import('./routes/heatmap.ts');
  const { createAdviceRoutes } = await import('./routes/advice.ts');
  const { createScratchpadRoutes } = await import('./routes/scratchpad.ts');
  const { createFuelIntelRoutes } = await import('./routes/fuelIntel.ts');
  const { createPlanRoutes } = await import('./routes/plan.ts');
  const { createAutoSummaryRoutes } = await import('./routes/autoSummary.ts');
  const { createRemediateRoutes } = await import('./routes/remediate.ts');
  const { createFocusRoutes } = await import('./routes/focus.ts');
  const { createBudgetRoutes } = await import('./routes/budget.ts');
  const { createGitHubRoutes } = await import('./routes/github.ts');
  const { createSmartSearchRoutes } = await import('./routes/smartSearch.ts');
  const { createEmbeddingRoutes } = await import('./routes/embeddings.ts');

  const store = new NexusStore();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // Serve built client
  const clientDist = join(__dirname, '..', 'client', 'dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
  }

  // WebSocket
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  const clients = new Set();
  wss.on('connection', (ws) => { clients.add(ws); ws.on('close', () => clients.delete(ws)); });
  const broadcast = (data: any) => {
    const msg = JSON.stringify(data);
    for (const ws of clients) { try { (ws as any).send(msg); } catch {} }
  };

  // Mount all API routes
  app.use('/api/tasks', createTaskRoutes(store, broadcast));
  app.use('/api/activity', createActivityRoutes(store));
  app.use('/api/sessions', createSessionRoutes(store, broadcast));
  app.use('/api/search', createSearchRoutes(store));
  app.use('/api/usage', createUsageRoutes(store, broadcast));
  app.use('/api/estimator', createEstimatorRoutes(store));
  app.use('/api/ledger', createLedgerRoutes(store, broadcast));
  app.use('/api/impact', createImpactRoutes(store));
  app.use('/api/guard', createGuardRoutes(store));
  app.use('/api/critique', createCritiqueRoutes(store));
  app.use('/api/thoughts', createThoughtRoutes(store, broadcast));
  app.use('/api/predict', createPredictRoutes(store, broadcast));
  app.use('/api/bookmarks', createBookmarkRoutes(store));
  app.use('/api/overseer', createOverseerRoutes(store, broadcast));
  app.use('/api/pulse', createPulseRoutes(store));
  app.use('/api/clock', createClockRoutes(store, buildTimingInfo));
  app.use('/api/digest', createDigestRoutes(store));
  app.use('/api/init', createInitRoutes(store));
  app.use('/api/actions', createActionRoutes(store, broadcast));
  app.use('/api/heatmap', createHeatmapRoutes(store));
  app.use('/api/advice', createAdviceRoutes(store));
  app.use('/api/scratchpads', createScratchpadRoutes(store));
  app.use('/api/fuel-intel', createFuelIntelRoutes(store));
  app.use('/api/plan', createPlanRoutes(store));
  app.use('/api/auto-summary', createAutoSummaryRoutes(store, broadcast));
  app.use('/api/remediate', createRemediateRoutes(store, broadcast));
  app.use('/api/focus', createFocusRoutes(store));
  app.use('/api/budget', createBudgetRoutes(store));
  app.use('/api/github', createGitHubRoutes(store, broadcast));
  app.use('/api/smart-search', createSmartSearchRoutes(store));
  app.use('/api/embeddings', createEmbeddingRoutes(store));

  // Status endpoint
  app.get('/api/status', (_req, res) => res.json({ status: 'online', version: '4.1.0', mode: 'dashboard', message: 'All instruments nominal, Captain.' }));

  // SPA fallback (Express 5 uses {*path} not *)
  app.use((_req, res) => {
    const indexPath = join(clientDist, 'index.html');
    if (existsSync(indexPath)) res.sendFile(indexPath);
    else res.status(404).json({ error: 'Dashboard not built. Run: cd client && npm run build' });
  });

  server.listen(PORT, () => {
    console.log(`
  ┌──────────────────────────────────────────┐
  │                                          │
  │   ◈  N E X U S  Dashboard                │
  │   The Cartographer                       │
  │                                          │
  │   http://localhost:${PORT}                   │
  │   Data: ${process.env.NEXUS_DB_PATH}
  │                                          │
  └──────────────────────────────────────────┘
`);
    // Try to open browser
    const url = `http://localhost:${PORT}`;
    try {
      if (process.platform === 'win32') exec(`start ${url}`);
      else if (process.platform === 'darwin') exec(`open ${url}`);
      else exec(`xdg-open ${url}`);
    } catch {}
  });

  store.addActivity('system', 'Dashboard online. Setting course.');
}

start().catch((err) => {
  console.error('◈ Dashboard failed to start:', err.message);
  process.exit(1);
});
