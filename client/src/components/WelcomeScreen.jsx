import { useState, useEffect, useCallback } from 'react';
import { api } from '../hooks/useApi.js';

const INIT_STEPS = [
  { key: 'system', label: 'System core', icon: '⚙' },
  { key: 'database', label: 'Chart room', icon: '◈' },
  { key: 'gpu', label: 'CUDA engine', icon: '▣' },
  { key: 'ai', label: 'Overseer AI', icon: '◉' },
  { key: 'git', label: 'Git fleet', icon: '⊕' },
  { key: 'projects', label: 'Territories', icon: '◇' },
  { key: 'usage', label: 'Fuel gauge', icon: '▽' },
];

function getDetail(key, check) {
  if (!check) return '';
  switch (key) {
    case 'system': return check.hostname || '';
    case 'database': return `${check.tasks || 0} tasks, ${check.sessions || 0} sessions`;
    case 'gpu': return check.name ? check.name.split(' ').slice(-2).join(' ') : '';
    case 'ai': return check.provider ? `${check.provider} (${check.models?.[0]?.split('/').pop() || ''})` : '';
    case 'git': return `${check.repos || 0} repos, ${check.totalUncommitted || 0} uncommitted`;
    case 'projects': return `${check.count || 0} territories`;
    case 'usage': return check.session != null ? `Session ${check.session}% | Weekly ${check.weekly}%` : 'Not tracked';
    default: return '';
  }
}

export default function WelcomeScreen({ connected, onReady }) {
  const [checks, setChecks] = useState(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [done, setDone] = useState(false);

  const dismiss = useCallback(() => {
    if (onReady) onReady();
  }, [onReady]);

  useEffect(() => {
    if (!connected) return;
    api.getInit()
      .then(data => setChecks(data.checks))
      .catch(() => setChecks({}));
  }, [connected]);

  useEffect(() => {
    if (!checks) return;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      setVisibleCount(step);
      if (step >= INIT_STEPS.length) {
        clearInterval(timer);
        setTimeout(() => setDone(true), 300);
        setTimeout(() => dismiss(), 1800);
      }
    }, 180);
    return () => clearInterval(timer);
  }, [checks, dismiss]);

  useEffect(() => {
    const fallback = setTimeout(() => dismiss(), 8000);
    return () => clearTimeout(fallback);
  }, [dismiss]);

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-nexus-bg cursor-pointer" onClick={dismiss}>
      <div className={`text-6xl mb-6 text-nexus-amber ${!done ? 'animate-compass' : ''}`}>◈</div>

      <h1 className="text-3xl font-light tracking-[0.3em] text-nexus-text mb-1">
        N E X U S
      </h1>
      <p className="text-[10px] font-mono text-nexus-text-faint tracking-[0.25em] mb-2">
        THE CARTOGRAPHER — v4.2
      </p>
      <p className="text-[9px] font-mono text-nexus-text-faint mb-8">
        7 modules · 22 MCP tools · knowledge graph · local AI overseer
      </p>

      <div className="w-72 space-y-1.5">
        {INIT_STEPS.map((step, i) => {
          const check = checks?.[step.key];
          const visible = i < visibleCount;
          const isOk = check?.ok;

          return (
            <div
              key={step.key}
              className={`flex items-center gap-3 px-3 py-1.5 rounded transition-all duration-300 ${
                visible ? 'opacity-100' : 'opacity-20'
              }`}
            >
              <span className={`text-xs w-4 text-center ${visible ? (isOk ? 'text-nexus-green' : isOk === false ? 'text-nexus-amber' : 'text-nexus-text-faint') : 'text-nexus-text-faint'}`}>
                {visible && check ? (isOk ? '✓' : '!') : step.icon}
              </span>
              <span className={`text-xs font-mono ${visible && isOk ? 'text-nexus-green' : visible && isOk === false ? 'text-nexus-amber' : 'text-nexus-text-dim'}`}>
                {step.label}
              </span>
              {visible && check && (
                <span className="text-[9px] font-mono text-nexus-text-faint ml-auto">
                  {getDetail(step.key, check)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full transition-colors duration-500 ${
          done ? 'bg-nexus-green' : connected ? 'bg-nexus-amber animate-nexus-pulse' : 'bg-nexus-red'
        }`} />
        <span className="text-xs font-mono text-nexus-text-faint">
          {done ? 'All instruments nominal. Welcome aboard, Captain.' :
           connected ? 'Running pre-flight checks...' :
           'Establishing bearings...'}
        </span>
      </div>

      {done && (
        <p className="mt-4 text-[9px] font-mono text-nexus-text-faint animate-nexus-pulse">
          click anywhere to enter
        </p>
      )}
    </div>
  );
}
