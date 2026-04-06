import { useState, useEffect } from 'react';
import { Zap, GitBranch, Activity, CheckCircle2, Loader2 } from 'lucide-react';

const ICON_MAP = {
  'git-branch': GitBranch,
  'activity': Activity,
  'check-circle': CheckCircle2,
};

export default function QuickActions() {
  const [actions, setActions] = useState([]);
  const [running, setRunning] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    fetch('/api/actions').then(r => r.json()).then(setActions).catch(() => {});
  }, []);

  async function runAction(action) {
    setRunning(action.id);
    setLastResult(null);
    try {
      const res = await fetch(`/api/actions/${action.id}/run`, { method: 'POST' });
      const data = await res.json();
      setLastResult({ action: action.label, result: data.result });
    } catch (err) {
      setLastResult({ action: action.label, error: err.message });
    } finally {
      setRunning(null);
    }
  }

  if (actions.length === 0) return null;

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Zap size={16} className="text-nexus-amber" />
        <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Quick Actions</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {actions.map((a) => {
          const Icon = ICON_MAP[a.icon] || Zap;
          const isRunning = running === a.id;
          return (
            <button
              key={a.id}
              onClick={() => !isRunning && runAction(a)}
              disabled={isRunning}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs border border-nexus-border hover:border-nexus-amber/30 hover:bg-nexus-amber/5 text-nexus-text-dim hover:text-nexus-amber transition-colors disabled:opacity-50"
              title={a.description}
            >
              {isRunning ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
              {a.label}
            </button>
          );
        })}
      </div>

      {/* Result display */}
      {lastResult && (
        <div className="bg-nexus-bg rounded-lg p-3 text-xs font-mono">
          <span className="text-nexus-text-faint">{lastResult.action}:</span>
          {lastResult.error ? (
            <span className="text-nexus-red ml-2">{lastResult.error}</span>
          ) : (
            <pre className="mt-1 text-nexus-text-dim overflow-x-auto whitespace-pre-wrap max-h-40">
              {JSON.stringify(lastResult.result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
