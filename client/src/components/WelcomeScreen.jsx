import { useState, useEffect, useCallback } from 'react';
import { api } from '../hooks/useApi.js';

// v4.4.9 — tool count mirrored from the MCP TOOLS[] array. Guarded by
// tests/versionDrift.test.ts so it can't silently drift behind the real count.
const TOOL_COUNT = 27;
const MODULE_COUNT = 7;

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
  const [version, setVersion] = useState(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [done, setDone] = useState(false);

  const dismiss = useCallback(() => {
    if (onReady) onReady();
  }, [onReady]);

  useEffect(() => {
    if (!connected) return;
    // v4.4.9 — pull version from /api/init so the welcome screen never drifts
    // behind the running server. Falls back silently; no broken UI on error.
    api.getInit()
      .then(data => {
        setChecks(data.checks);
        if (data.version) setVersion(data.version);
      })
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

  // v4.4.9 — nautical boot animation. Layered:
  //   - Background: faint chart-grid radial gradient
  //   - Center: compass rose ◈ slowly spinning (existing animate-compass)
  //   - Behind compass: conic-gradient radar sweep arc
  //   - Behind compass: 3 sonar-pulse rings expanding outward (staggered)
  //   - Title: NEXUS wordmark revealed letter-by-letter
  // Each element runs independently so the composite feels alive without
  // feeling busy. No new deps — pure CSS keyframes defined in index.css.
  const title = 'NEXUS';
  return (
    <div
      className="relative h-screen flex flex-col items-center justify-center bg-nexus-bg cursor-pointer overflow-hidden"
      onClick={dismiss}
    >
      {/* Chart-grid backdrop (very faint) — two overlapping radial gradients */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-[0.08]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 50%, #f59e0b 0%, transparent 45%), ' +
            'radial-gradient(circle at 50% 50%, #3b82f6 0%, transparent 70%)',
        }}
      />

      {/* Compass + animation stack. The stack uses fixed dimensions so all
          three layers (sonar rings, radar sweep, glyph) align concentrically. */}
      <div className="relative w-40 h-40 mb-6 flex items-center justify-center">
        {/* Sonar pulse rings */}
        <div aria-hidden="true" className="absolute inset-0 rounded-full border border-nexus-amber/40 animate-sonar-pulse" />
        <div aria-hidden="true" className="absolute inset-0 rounded-full border border-nexus-amber/40 animate-sonar-pulse delay-1" />
        <div aria-hidden="true" className="absolute inset-0 rounded-full border border-nexus-amber/40 animate-sonar-pulse delay-2" />

        {/* Radar sweep wedge — a conic gradient arc that rotates. Trimmed to
            ~45° of visible sweep by the gradient stops; the rest is transparent. */}
        <div
          aria-hidden="true"
          className={`absolute inset-0 rounded-full ${!done ? 'animate-radar-sweep' : ''}`}
          style={{
            background:
              'conic-gradient(from 0deg, rgba(245,158,11,0.28) 0deg, rgba(245,158,11,0) 45deg, rgba(245,158,11,0) 360deg)',
            maskImage: 'radial-gradient(circle, transparent 40%, black 45%, black 100%)',
            WebkitMaskImage: 'radial-gradient(circle, transparent 40%, black 45%, black 100%)',
          }}
        />

        {/* Static bearing ring (N/E/S/W ticks) */}
        <div aria-hidden="true" className="absolute inset-2 rounded-full border border-nexus-border-bright" />

        {/* Compass rose glyph — spinning centerpiece */}
        <div className={`text-6xl text-nexus-amber relative z-10 ${!done ? 'animate-compass' : ''}`}>◈</div>
      </div>

      {/* NEXUS wordmark — letter-by-letter reveal with staggered delays */}
      <h1 className="text-3xl font-light text-nexus-text mb-1 flex">
        {title.split('').map((ch, i) => (
          <span
            key={i}
            className="animate-letter-reveal inline-block"
            style={{ animationDelay: `${0.15 + i * 0.12}s`, marginRight: i < title.length - 1 ? '0.3em' : 0 }}
          >
            {ch}
          </span>
        ))}
      </h1>
      <p className="text-[10px] font-mono text-nexus-text-faint tracking-[0.25em] mb-2">
        THE CARTOGRAPHER{version ? ` — v${version}` : ''}
      </p>
      <p className="text-[9px] font-mono text-nexus-text-faint mb-8">
        {MODULE_COUNT} modules · {TOOL_COUNT} MCP tools · knowledge graph · local AI overseer
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
                visible ? 'opacity-100 translate-x-0' : 'opacity-20 -translate-x-1'
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
