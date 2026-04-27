/**
 * Nexus theme palette — mirrors the --color-nexus-* tokens in src/index.css.
 *
 * Used for SVG stroke/fill in Graph.jsx (where CSS variables can't be directly
 * read without getComputedStyle — see audit I5). Keep in sync with index.css.
 *
 * Version: v4.3.5 (factored out of Graph.jsx inline constants)
 */

// Core palette tokens (match src/index.css :root).
export const THEME = {
  bg:           '#0a0e1a',
  surface:      '#111827',
  surfaceHover: '#1a2235',
  border:       '#1e293b',
  borderBright: '#334155',
  text:         '#e2e8f0',
  textDim:      '#94a3b8',
  textFaint:    '#64748b',
  amber:        '#f59e0b',
  amberDim:     '#b45309',
  blue:         '#3b82f6',
  blueLight:    '#60a5fa',
  green:        '#22c55e',
  red:          '#ef4444',
  purple:       '#a855f7',
  // Extended palette for project tagging (Graph module)
  cyan:         '#06b6d4',
  pink:         '#ec4899',
  lime:         '#84cc16',
  teal:         '#14b8a6',
  gray:         '#6b7280',
  slate:        '#64748b',
  white:        '#ffffff',
};

// Rotating palette for project-tagged nodes in the Graph module.
export const PROJECT_PALETTE = [
  { name: 'amber',  stroke: THEME.amber,  fill: THEME.amber },
  { name: 'green',  stroke: THEME.green,  fill: THEME.green },
  { name: 'blue',   stroke: THEME.blue,   fill: THEME.blue },
  { name: 'purple', stroke: THEME.purple, fill: THEME.purple },
  { name: 'red',    stroke: THEME.red,    fill: THEME.red },
  { name: 'cyan',   stroke: THEME.cyan,   fill: THEME.cyan },
  { name: 'pink',   stroke: THEME.pink,   fill: THEME.pink },
  { name: 'lime',   stroke: THEME.lime,   fill: THEME.lime },
];

// Decision lifecycle color mapping (Graph module).
export const LIFECYCLE_COLORS = {
  validated:  THEME.green,
  proposed:   THEME.blueLight,
  deprecated: THEME.gray,
  active:     THEME.amber,
};

// Edge-type visual styles for the decision graph. Mirrors the 7 rel types from
// server/types.ts GraphEdge.rel. Keep in sync with server validation.
// v4.6.5 #282 — `tooltip` field added so legend hover explains semantic meaning.
export const EDGE_STYLES = {
  led_to:      { stroke: THEME.amber,  dash: 'none',  label: 'Led to',
    tooltip: 'A causally led to B. Use when one decision directly produced the next (build-on, follow-up).' },
  depends_on:  { stroke: THEME.blue,   dash: '6,3',   label: 'Depends on',
    tooltip: 'B requires A to be valid. If A is removed/changed, B is at risk. Strongest dependency edge.' },
  contradicts: { stroke: THEME.red,    dash: '2,3',   label: 'Contradicts',
    tooltip: 'A and B oppose each other (different paths chosen, or same question answered two ways). Resolve via Conflicts tab.' },
  replaced:    { stroke: THEME.gray,   dash: '8,4',   label: 'Replaced',
    tooltip: 'B supersedes A. Use after a decision is revised — keep the original for history but signal it should not be acted on.' },
  related:     { stroke: THEME.slate,  dash: '2,2',   label: 'Related',
    tooltip: 'Weak association — same domain or shared keywords, but no causal/dependency tie. Auto-link uses this by default.' },
  informs:     { stroke: THEME.purple, dash: '4,2',   label: 'Informs',
    tooltip: 'A provides context for B without being a hard requirement. Lighter than depends_on.' },      // v4.3
  experimental:{ stroke: THEME.teal,   dash: '1,3',   label: 'Experimental',
    tooltip: 'Tentative link, revisit later. Use when you want to capture a hunch without committing to a stronger relation.' }, // v4.3
};
