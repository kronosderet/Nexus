import { Activity, Compass, ScrollText, PenTool, BookOpen, Search, Brain, Terminal, BookMarked } from 'lucide-react';
import UsageGauge from './UsageGauge.jsx';

const ICON_MAP = {
  activity: Activity,
  compass: Compass,
  'scroll-text': ScrollText,
  'pen-tool': PenTool,
  'book-open': BookOpen,
  'brain': Brain,
  'book-marked': BookMarked,
  'terminal': Terminal,
};

export default function Sidebar({ modules, active, onSelect, connected, onSearchClick, ws }) {
  return (
    <aside className="w-56 bg-nexus-surface border-r border-nexus-border flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b border-nexus-border">
        <div className="flex items-center gap-3">
          <span className="text-2xl text-nexus-amber">◈</span>
          <div>
            <h1 className="text-sm font-semibold tracking-[0.2em] text-nexus-text">NEXUS</h1>
            <p className="text-[10px] font-mono text-nexus-text-faint tracking-wider">THE CARTOGRAPHER</p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 pt-2">
        <button
          onClick={onSearchClick}
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
      <nav className="flex-1 p-2 space-y-1">
        {Object.entries(modules).map(([key, mod]) => {
          const Icon = ICON_MAP[mod.icon];
          const isActive = active === key;
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
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

      {/* Usage gauge */}
      <UsageGauge ws={ws} />

      {/* Status footer */}
      <div className="p-4 border-t border-nexus-border">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-nexus-green animate-nexus-pulse' : 'bg-nexus-red'}`} />
          <span className="text-xs font-mono text-nexus-text-faint">
            {connected ? 'All instruments nominal' : 'Reconnecting...'}
          </span>
        </div>
      </div>
    </aside>
  );
}
