// One-off data migration: eliminate phantom projects 'claude' + 'general'.
// 'claude' → 'family-coop' (rename). 'general' → split per decision content.
// Stamps _appliedMigrations['data-phantom-projects-2026-04-22'].

import fs from 'fs';

const PATH = 'C:/Users/kronos/.nexus/nexus.json';
const d = JSON.parse(fs.readFileSync(PATH, 'utf8'));

const LEDGER_REASSIGN = {
  // 5 Shadowrun
  61: 'Shadowrun', 62: 'Shadowrun', 63: 'Shadowrun', 64: 'Shadowrun', 65: 'Shadowrun',
  // 6 Firewall-Godot
  70: 'Firewall-Godot', 71: 'Firewall-Godot', 72: 'Firewall-Godot',
  73: 'Firewall-Godot', 74: 'Firewall-Godot', 75: 'Firewall-Godot',
  // 5 noosphere
  69: 'noosphere', 77: 'noosphere', 78: 'noosphere', 79: 'noosphere', 80: 'noosphere',
  // 1 Nexus
  76: 'Nexus',
};
const LEDGER_DELETE = new Set([81]);   // "--help" junk
const THOUGHTS_DELETE = new Set([14]); // stale auto-resolve test stub

const before = {
  ledger: d.ledger.length,
  ledger_claude: d.ledger.filter(x => x.project === 'claude').length,
  ledger_general: d.ledger.filter(x => x.project === 'general').length,
  sessions_claude: d.sessions.filter(x => x.project === 'claude').length,
  sessions_general: d.sessions.filter(x => x.project === 'general').length,
  thoughts_general: d.thoughts.filter(x => x.project === 'general').length,
};

// 1. Ledger: rename claude → family-coop; reassign general per map; delete junk
d.ledger = d.ledger.filter(x => !LEDGER_DELETE.has(x.id));
for (const dec of d.ledger) {
  if (dec.project === 'claude') dec.project = 'family-coop';
  else if (dec.project === 'general' && LEDGER_REASSIGN[dec.id]) {
    dec.project = LEDGER_REASSIGN[dec.id];
  }
}

// 2. Sessions: claude → family-coop; general → Nexus (all 18 are Nexus dev work)
for (const s of d.sessions) {
  if (s.project === 'claude') s.project = 'family-coop';
  else if (s.project === 'general') s.project = 'Nexus';
}

// 3. Thoughts: delete stale stub
d.thoughts = d.thoughts.filter(x => !THOUGHTS_DELETE.has(x.id));

// 4. Stamp migration
d._appliedMigrations = d._appliedMigrations || {};
d._appliedMigrations['data-phantom-projects-2026-04-22'] = new Date().toISOString();

// 5. Log activity
d.activity = d.activity || [];
const nextActId = Math.max(0, ...d.activity.map(a => a.id || 0)) + 1;
// Activity schema: { id, type, message, meta, created_at }. Message carries
// [ProjectName] prefix so pulse/projects filter matches (pulse.ts:59).
d.activity.push({
  id: nextActId,
  type: 'system',
  message: '[Nexus] Phantom projects cleanup — renamed claude→family-coop (11 items), split general→Shadowrun/Firewall-Godot/noosphere/Nexus (17 items), deleted 2 junk entries',
  meta: '{}',
  created_at: new Date().toISOString(),
});

fs.writeFileSync(PATH, JSON.stringify(d, null, 2));

const after = {
  ledger: d.ledger.length,
  ledger_claude: d.ledger.filter(x => x.project === 'claude').length,
  ledger_general: d.ledger.filter(x => x.project === 'general').length,
  sessions_claude: d.sessions.filter(x => x.project === 'claude').length,
  sessions_general: d.sessions.filter(x => x.project === 'general').length,
  thoughts_general: d.thoughts.filter(x => x.project === 'general').length,
};

console.log('BEFORE:', before);
console.log('AFTER: ', after);
console.log('Stamp: ', d._appliedMigrations['data-phantom-projects-2026-04-22']);
