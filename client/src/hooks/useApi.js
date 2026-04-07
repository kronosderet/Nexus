import { useState, useCallback } from 'react';
import { toast } from '../lib/toast.js';

const BASE = '/api';

async function request(path, options = {}) {
  // { silent: true } opts out of the automatic error toast for expected-to-fail calls
  const { silent, ...fetchOpts } = options;
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...fetchOpts,
      body: fetchOpts.body ? JSON.stringify(fetchOpts.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`${res.status}: ${res.statusText}${text ? ` — ${text}` : ''}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch (err) {
    if (!silent) {
      toast.error(
        `API ${path.split('?')[0]}`,
        err.message || 'Request failed.',
      );
    }
    throw err;
  }
}

export const api = {
  // ── Status ─────────────────────────────────────────────
  getStatus: () => request('/status'),
  getInit: () => request('/init'),

  // ── Tasks ──────────────────────────────────────────────
  getTasks: () => request('/tasks'),
  createTask: (body) => request('/tasks', { method: 'POST', body }),
  updateTask: (id, body) => request(`/tasks/${id}`, { method: 'PATCH', body }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),

  // ── Activity ───────────────────────────────────────────
  getActivity: (limit = 50) => request(`/activity?limit=${limit}`),

  // ── Pulse / GPU ────────────────────────────────────────
  getPulse: () => request('/pulse'),
  getGpuDetail: () => request('/pulse/gpu'),
  getGpuHistory: (hours = 1) => request(`/pulse/gpu/history?hours=${hours}`),
  getProjectHealth: () => request('/pulse/projects'),

  // ── Sessions ───────────────────────────────────────────
  getSessions: (project) => request(`/sessions${project ? `?project=${encodeURIComponent(project)}` : ''}`),
  getSessionContext: (project) => request(`/sessions/context/${encodeURIComponent(project)}`),
  createSession: (body) => request('/sessions', { method: 'POST', body }),

  // ── Usage / Fuel ───────────────────────────────────────
  getUsageLatest: () => request('/usage/latest'),
  logUsage: (body) => request('/usage', { method: 'POST', body }),
  getUsageHistory: (limit = 100) => request(`/usage?limit=${limit}`),
  getEstimator: () => request('/estimator'),
  getEstimatorWorkload: () => request('/estimator/workload'),
  getEstimatorHistory: () => request('/estimator/history'),
  getFuelIntel: () => request('/fuel-intel'),

  // ── Search ─────────────────────────────────────────────
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),
  smartSearch: (q) => request(`/smart-search?q=${encodeURIComponent(q)}`),

  // ── Bookmarks ──────────────────────────────────────────
  getBookmarks: () => request('/bookmarks'),
  createBookmark: (body) => request('/bookmarks', { method: 'POST', body }),
  deleteBookmark: (id) => request(`/bookmarks/${id}`, { method: 'DELETE' }),

  // ── Overseer ───────────────────────────────────────────
  getOverseer: () => request('/overseer'),
  getOverseerRisks: () => request('/overseer/risks'),
  askOverseer: (body) => request('/overseer/ask', { method: 'POST', body }),

  // ── Remediate ──────────────────────────────────────────
  getRemediateScan: () => request('/remediate/scan'),
  executeRemediate: (body) => request('/remediate/execute', { method: 'POST', body }),

  // ── Ledger / Graph ─────────────────────────────────────
  getGraphFull: () => request('/ledger/graph/full'),
  autoLinkGraph: () => request('/ledger/auto-link', { method: 'POST' }),

  // ── Impact ─────────────────────────────────────────────
  getImpactBlast: (id) => request(`/impact/blast/${id}`),
  getImpactCentrality: () => request('/impact/centrality'),
  getImpactContradictions: () => request('/impact/contradictions'),
  getImpactForecast: (decisionId) => request(`/impact/forecast/${decisionId}`),
  getImpactHoles: () => request('/impact/holes'),

  // ── Clock / Heatmap / Digest ───────────────────────────
  getClock: () => request('/clock'),
  getHeatmap: (days = 28) => request(`/heatmap?days=${days}`),
  getDigest: (range = 'today') => request(`/digest?range=${encodeURIComponent(range)}`),

  // ── Actions ────────────────────────────────────────────
  getActions: () => request('/actions'),
  runAction: (id) => request(`/actions/${id}/run`, { method: 'POST' }),

  // ── Thoughts (v3.0) ────────────────────────────────────
  getThoughts: (project) => request(`/thoughts${project ? `?project=${encodeURIComponent(project)}` : ''}`),
  getAllThoughts: () => request('/thoughts?all=true'),
  pushThought: (body) => request('/thoughts', { method: 'POST', body }),
  popThought: (id) => request('/thoughts/pop', { method: 'POST', body: id ? { id } : {} }),
  abandonThought: (id, reason) => request(`/thoughts/${id}/abandon`, { method: 'PATCH', body: { reason } }),

  // ── Critique (v3.0) ────────────────────────────────────
  getCritique: () => request('/critique'),

  // ── Guard (v3.0) ───────────────────────────────────────
  checkGuard: (title) => request(`/guard?title=${encodeURIComponent(title)}`),

  // ── Advice Journal (v3.0) ──────────────────────────────
  getAdvice: (params = {}) => {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', params.limit);
    if (params.source) q.set('source', params.source);
    if (params.unjudged) q.set('unjudged', 'true');
    const qs = q.toString();
    return request(`/advice${qs ? `?${qs}` : ''}`);
  },
  getAdvicePatterns: () => request('/advice/patterns'),
  updateAdviceVerdict: (id, body) => request(`/advice/${id}/verdict`, { method: 'PATCH', body }),

  // ── Predict (v3.0) ─────────────────────────────────────
  getPredict: () => request('/predict'),
  generatePredicted: (body) => request('/predict/generate', { method: 'POST', body }),

  // ── Plan (v3.0) ────────────────────────────────────────
  getPlan: () => request('/plan'),

  // ── Auto-Summary (v3.0) ────────────────────────────────
  getAutoSummary: () => request('/auto-summary'),
  runAutoSummary: (body) => request('/auto-summary', { method: 'POST', body }),
};

export function useApiCall(fn) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const execute = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn(...args);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fn]);

  return { execute, loading, error };
}
