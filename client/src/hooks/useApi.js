import { useState, useCallback } from 'react';

const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
  return res.json();
}

export const api = {
  // Tasks
  getTasks: () => request('/tasks'),
  createTask: (body) => request('/tasks', { method: 'POST', body }),
  updateTask: (id, body) => request(`/tasks/${id}`, { method: 'PATCH', body }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),

  // Activity
  getActivity: (limit = 50) => request(`/activity?limit=${limit}`),

  // Pulse
  getPulse: () => request('/pulse'),
  getGpuDetail: () => request('/pulse/gpu'),
  getProjectHealth: () => request('/pulse/projects'),

  // Sessions
  getSessions: (project) => request(`/sessions${project ? `?project=${encodeURIComponent(project)}` : ''}`),
  getSessionContext: (project) => request(`/sessions/context/${encodeURIComponent(project)}`),
  createSession: (body) => request('/sessions', { method: 'POST', body }),

  // Usage
  getUsageLatest: () => request('/usage/latest'),
  logUsage: (body) => request('/usage', { method: 'POST', body }),
  getUsageHistory: (limit = 100) => request(`/usage?limit=${limit}`),

  // GPU history
  getGpuHistory: (hours = 1) => request(`/pulse/gpu/history?hours=${hours}`),

  // Search
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),

  // Scratchpads
  getScratchpads: () => request('/scratchpads'),
  getScratchpad: (id) => request(`/scratchpads/${id}`),
  createScratchpad: (body) => request('/scratchpads', { method: 'POST', body }),
  updateScratchpad: (id, body) => request(`/scratchpads/${id}`, { method: 'PATCH', body }),

  // Status
  getStatus: () => request('/status'),
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
