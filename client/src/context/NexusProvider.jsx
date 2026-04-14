/**
 * NexusProvider — centralized state for all dashboard modules.
 *
 * 3 grouped contexts (Core, Fuel, Fleet) with lazy loading,
 * stale-while-revalidate, and centralized WebSocket invalidation.
 * Eliminates ~18 redundant API calls across 8 modules.
 */
import { createContext, useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../hooks/useApi.js';

// ── Contexts ─────────────────────────────────────────
export const NexusCoreCtx = createContext(null);
export const NexusFuelCtx = createContext(null);
export const NexusFleetCtx = createContext(null);

// ── Slice factory ────────────────────────────────────
function useSlice(fetchFn, pollMs = null) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const initialized = useRef(false);
  const inflight = useRef(false);

  const doFetch = useCallback(async (isInit = false) => {
    if (inflight.current) return;
    inflight.current = true;
    if (isInit) setLoading(true);
    try {
      const result = await fetchFn();
      setData(result);
    } catch {}
    finally {
      inflight.current = false;
      setLoading(false);
    }
  }, [fetchFn]);

  const ensure = useCallback(() => {
    if (initialized.current) return;
    initialized.current = true;
    doFetch(true);
  }, [doFetch]);

  const refresh = useCallback(() => { if (initialized.current) doFetch(); }, [doFetch]);
  const markStale = useCallback(() => { if (initialized.current) doFetch(); }, [doFetch]);

  // Optimistic patch (for tasks)
  const patch = useCallback((fn) => setData(prev => prev ? fn(prev) : prev), []);

  // Safety-net polling
  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(() => { if (initialized.current) doFetch(); }, pollMs);
    return () => clearInterval(id);
  }, [pollMs, doFetch]);

  return { data, loading, ensure, refresh, markStale, patch };
}

// ── WS invalidation map ──────────────────────────────
const WS_MAP = {
  task_update:      ['tasks'],
  task_deleted:     ['tasks'],
  activity:         ['activity'],
  thought:          ['thoughts'],
  session_created:  ['sessions'],
  usage_update:     ['estimator', 'workload', 'timing'],
  gpu_snapshot:     ['pulse'],
  decision_update:  ['graph'],
  reload:           ['tasks', 'activity', 'sessions', 'thoughts', 'estimator', 'workload', 'timing', 'pulse', 'fleet', 'graph'],
};

// ── Provider ─────────────────────────────────────────
export default function NexusProvider({ ws, children }) {
  // Core slices
  const tasks     = useSlice(useCallback(() => api.getTasks(), []));
  const activity  = useSlice(useCallback(() => api.getActivity(200), []));
  const sessions  = useSlice(useCallback(() => api.getSessions(), []));
  const thoughts  = useSlice(useCallback(() => api.getThoughts(), []));

  // Fuel slices
  const estimator = useSlice(useCallback(() => api.getEstimator(), []), 120000);
  const workload  = useSlice(useCallback(() => api.getEstimatorWorkload(), []));
  const timing    = useSlice(useCallback(() => api.getUsageLatest(), []));
  const history   = useSlice(useCallback(() => api.getEstimatorHistory(), []));

  // Fleet slices
  const pulse     = useSlice(useCallback(() => api.getPulse(), []), 60000);
  const fleet     = useSlice(useCallback(async () => {
    const [projects, overview] = await Promise.all([api.getProjectHealth(), api.getFleetOverview().catch(() => null)]);
    return { projects, overview };
  }, []));
  const graph     = useSlice(useCallback(async () => {
    const [full, centrality, contradictions, holes] = await Promise.all([
      api.getGraphFull(), api.getImpactCentrality(),
      api.getImpactContradictions().catch(() => null), api.getImpactHoles().catch(() => null),
    ]);
    return { graph: full, centrality, contradictions, holes };
  }, []));

  // Slice lookup for WS invalidation
  const slices = useRef({});
  slices.current = { tasks, activity, sessions, thoughts, estimator, workload, timing, pulse, fleet, graph };

  // Centralized WebSocket listener
  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => {
      const targets = WS_MAP[msg.type];
      if (!targets) return;

      // Optimistic updates
      if (msg.type === 'task_update' && msg.payload) {
        tasks.patch(prev => {
          const idx = prev.findIndex(t => t.id === msg.payload.id);
          if (idx >= 0) { const next = [...prev]; next[idx] = msg.payload; return next; }
          return [...prev, msg.payload];
        });
        return;
      }
      if (msg.type === 'task_deleted' && msg.payload) {
        tasks.patch(prev => prev.filter(t => t.id !== msg.payload.id));
        return;
      }
      if (msg.type === 'activity' && msg.payload) {
        activity.patch(prev => [msg.payload, ...prev].slice(0, 200));
        return;
      }
      if (msg.type === 'session_created' && msg.payload) {
        sessions.patch(prev => [msg.payload, ...prev]);
        return;
      }

      // Mark stale + refetch for non-optimistic updates
      for (const name of targets) {
        slices.current[name]?.markStale();
      }
    });
  }, [ws]);

  // Context values
  const coreVal = {
    tasks, activity, sessions, thoughts,
    _ensureAll: () => { tasks.ensure(); activity.ensure(); sessions.ensure(); thoughts.ensure(); },
  };
  const fuelVal = {
    estimator, workload, timing, history,
    _ensureAll: () => { estimator.ensure(); workload.ensure(); timing.ensure(); history.ensure(); },
  };
  const fleetVal = {
    pulse, fleet, graph,
    _ensureAll: () => { pulse.ensure(); fleet.ensure(); graph.ensure(); },
  };

  return (
    <NexusCoreCtx.Provider value={coreVal}>
      <NexusFuelCtx.Provider value={fuelVal}>
        <NexusFleetCtx.Provider value={fleetVal}>
          {children}
        </NexusFleetCtx.Provider>
      </NexusFuelCtx.Provider>
    </NexusCoreCtx.Provider>
  );
}
