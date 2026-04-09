import { useState, useEffect, useRef } from 'react';
import { Search, X, Compass, ScrollText, BookOpen } from 'lucide-react';
import { api } from '../hooks/useApi.js';

const TYPE_ICONS = {
  task: Compass,
  activity: ScrollText,
  session: BookOpen,
};

const TYPE_COLORS = {
  task: 'text-nexus-blue',
  activity: 'text-nexus-text-faint',
  session: 'text-nexus-green',
};

export default function SearchModal({ open, onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.search(query);
        // Filter out scratchpad results — no UI for them anymore
        setResults(data.filter(r => r.type !== 'scratchpad'));
        setSelected(0);
      } catch {} finally {
        setLoading(false);
      }
    }, 200);
  }, [query]);

  function handleKeyDown(e) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && results[selected]) {
      onNavigate(results[selected]);
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose} role="presentation">
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative w-full max-w-lg bg-nexus-surface border border-nexus-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-nexus-border">
          <Search size={16} className="text-nexus-text-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-sm text-nexus-text placeholder:text-nexus-text-faint focus:outline-none"
            placeholder="Search tasks, sessions, activity..."
          />
          <kbd className="text-[10px] font-mono text-nexus-text-faint px-1.5 py-0.5 rounded bg-nexus-bg border border-nexus-border">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto">
          {loading && (
            <div className="px-4 py-6 text-center text-xs font-mono text-nexus-text-faint">
              Scanning the horizon...
            </div>
          )}

          {!loading && query && results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs font-mono text-nexus-text-faint">
              Nothing on the charts for "{query}".
            </div>
          )}

          {!loading && results.map((r, i) => {
            const Icon = TYPE_ICONS[r.type] || ScrollText;
            const color = TYPE_COLORS[r.type] || 'text-nexus-text-faint';
            return (
              <button
                key={`${r.type}-${r.id}`}
                onClick={() => { onNavigate(r); onClose(); }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === selected ? 'bg-nexus-amber/10' : 'hover:bg-nexus-surface-hover'
                }`}
              >
                <Icon size={14} className={color} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-nexus-text truncate">{r.title}</p>
                </div>
                <span className={`text-[10px] font-mono ${color}`}>{r.type}</span>
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-nexus-border flex gap-4 text-[10px] font-mono text-nexus-text-faint">
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>esc close</span>
          </div>
        )}
      </div>
    </div>
  );
}
