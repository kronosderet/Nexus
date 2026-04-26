---
description: Launch the Nexus visual dashboard — Command, Fuel, Graph, Overseer, Log modules in the browser
---

The Nexus dashboard provides a visual cockpit for the metabrain. To start it:

1. The user needs the full Nexus repo cloned. If they don't have it, tell them:
   ```
   git clone https://github.com/kronosderet/Nexus
   cd Nexus
   npm install && cd server && npm install && cd ../client && npm install && cd ..
   cd client && npm run build && cd ..
   ```

2. Start the dashboard:
   ```bash
   npx tsx server/dashboard.ts
   ```
   This starts the Express server at http://localhost:3001 serving the React dashboard.
   It reads data from ~/.nexus/nexus.json (same data the plugin uses).

3. Open http://localhost:3001 in the browser.

The dashboard shows 8 modules:
- **Command** (^1) — Strategic view + Kanban board with task management
- **Dashboard** (^2) — System pulse, GPU, calendar, digest
- **Fleet** (^3) — Per-project cards with sparklines + inline git actions
- **Fuel** (^4) — Session/weekly fuel gauges, burn rate, capacity estimates
- **Graph** (^5) — Knowledge Graph visualization with blast radius analysis
- **Overseer** (^6) — Local AI strategic advisor
- **Log** (^7) — Activity stream + session history
- **Handover** (^8) — Continuous per-project handover cards (v4.6.0+)

The dashboard is OPTIONAL — all Nexus features work without it through the MCP tools.
