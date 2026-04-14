import { useState, useEffect } from 'react';
import { Activity, Compass, ScrollText, Search, Brain, GitBranch, Fuel, Ship, Menu, X } from 'lucide-react';

const ICON_MAP = {
  activity: Activity,
  compass: Compass,
  'scroll-text': ScrollText,
  'brain': Brain,
  'fuel': Fuel,
  'git-branch': GitBranch,
  'ship': Ship,
};

export default function Sidebar({ modules, active, onSelect, connected, onSearchClick }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-close drawer when user selects a module
  function handleSelect(key) {
    onSelect(key);
    setMobileOpen(false);
  }

  // Close on Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e) => e.key === 'Escape' && setMobileOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const navContent = (
    <>
      {/* Logo */}
      <div className="p-4 border-b border-nexus-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl text-nexus-amber">◈</span>
          <div>
            <h1 className="text-sm font-semibold tracking-[0.2em] text-nexus-text">NEXUS</h1>
            <p className="text-[10px] font-mono text-nexus-text-faint tracking-wider">THE CARTOGRAPHER</p>
          </div>
        </div>
        {/* Close button (mobile drawer only) */}
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden p-1 text-nexus-text-faint hover:text-nexus-amber transition-colors"
          aria-label="Close navigation"
        >
          <X size={16} />
        </button>
      </div>

      {/* Search */}
      <div className="px-2 pt-2">
        <button
          onClick={() => { onSearchClick(); setMobileOpen(false); }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-nexus-text-faint hover:text-nexus-text hover:bg-nexus-surface-hover border border-nexus-border transition-colors"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="text-[10px] font-mono opacity-40 px-1 py-0.5 rounded bg-nexus-bg border border-nexus-border">
            ^K
          </kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {Object.entries(modules).map(([key, mod]) => {
          const Icon = ICON_MAP[mod.icon];
          const isActive = active === key;
          return (
            <button
              key={key}
              onClick={() => handleSelect(key)}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20'
                  : 'text-nexus-text-dim hover:bg-nexus-surface-hover hover:text-nexus-text border border-transparent'
              }`}
            >
              {Icon && <Icon size={16} />}
              <span className="flex-1 text-left">{mod.label}</span>
              {mod.shortcut && (
                <kbd className="text-[10px] font-mono opacity-40 px-1 py-0.5 rounded bg-nexus-bg border border-nexus-border">
                  ^{mod.shortcut}
                </kbd>
              )}
            </button>
          );
        })}
      </nav>

      {/* Status footer */}
      <div className="p-4 border-t border-nexus-border">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-nexus-green animate-nexus-pulse' : 'bg-nexus-red'}`} />
          <span className="text-xs font-mono text-nexus-text-faint">
            {connected ? 'All instruments nominal' : 'Reconnecting...'}
          </span>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button (fixed top-left, only <md) */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-30 p-2 rounded-lg bg-nexus-surface border border-nexus-border text-nexus-amber hover:bg-nexus-surface-hover transition-colors"
        aria-label="Open navigation"
      >
        <Menu size={16} />
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar: static on md+, slide-in drawer on mobile */}
      <aside
        className={`bg-nexus-surface border-r border-nexus-border flex flex-col transition-transform duration-200 ease-out
          md:static md:w-56 md:translate-x-0
          fixed inset-y-0 left-0 w-64 z-50 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {navContent}
      </aside>
    </>
  );
}
