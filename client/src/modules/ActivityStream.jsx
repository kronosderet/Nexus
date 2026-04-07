import { useState, useEffect, useMemo } from 'react';
import { api } from '../hooks/useApi.js';
import { ScrollText, Compass, CheckCircle2, Trash2, Settings, FileEdit, AlertTriangle, Search, Filter } from 'lucide-react';

const TYPE_CONFIG = {
  task_created: { icon: Compass, color: 'text-nexus-amber', label: 'Plotted' },
  task_done: { icon: CheckCircle2, color: 'text-nexus-green', label: 'Landmark' },
  task_moved: { icon: Compass, color: 'text-nexus-blue', label: 'Course adjusted' },
  task_deleted: { icon: Trash2, color: 'text-nexus-red', label: 'Removed' },
  system: { icon: Settings, color: 'text-nexus-purple', label: 'System' },
  file_change: { icon: FileEdit, color: 'text-nexus-amber', label: 'Terrain shift' },
  error: { icon: AlertTriangle, color: 'text-nexus-red', label: 'Uncharted' },
};

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ActivityStream({ ws }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('desc');

  async function fetchActivity() {
    try {
      const data = await api.getActivity(200);
      setEntries(data);
    } catch {} finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchActivity(); }, []);

  // Listen for real-time activity
  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => {
      if (msg.type === 'activity') {
        setEntries((prev) => [msg.payload, ...prev].slice(0, 200));
      }
    });
  }, [ws]);

  // Derived: unique types present in the current list (for the filter chips)
  const typesPresent = useMemo(() => {
    const set = new Set(entries.map((e) => e.type));
    return ['all', ...Array.from(set).sort()];
  }, [entries]);

  // Filtered + sorted
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = entries.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (q && !e.message.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortOrder === 'asc' ? ta - tb : tb - ta;
    });
    return list;
  }, [entries, search, typeFilter, sortOrder]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 h-64 justify-center">
        <div className="text-2xl animate-compass text-nexus-amber">◈</div>
        <span className="font-mono text-sm text-nexus-text-dim">Reviewing the ship's log...</span>
      </div>
    );
  }

  // Group by date
  const grouped = {};
  for (const entry of visible) {
    const dateKey = formatDate(entry.created_at);
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(entry);
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <ScrollText size={18} className="text-nexus-amber" />
          Activity Stream
        </h2>
        <p className="text-xs font-mono text-nexus-text-faint mt-1">
          {entries.length === 0
            ? "The log is empty. Calm waters."
            : `${visible.length} of ${entries.length} entries shown.`}
        </p>
      </div>

      {/* Filters */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nexus-text-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages..."
              className="w-full bg-nexus-bg border border-nexus-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-nexus-text font-mono focus:border-nexus-amber focus:outline-none"
            />
          </div>
          <button
            onClick={() => setSortOrder((s) => (s === 'desc' ? 'asc' : 'desc'))}
            className="px-3 py-1.5 rounded-lg text-[10px] font-mono text-nexus-text-faint hover:text-nexus-amber border border-nexus-border transition-colors"
            title="Toggle sort order"
          >
            {sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
          </button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter size={10} className="text-nexus-text-faint" />
          {typesPresent.map((type) => {
            const label = type === 'all' ? 'All' : (TYPE_CONFIG[type]?.label || type);
            const isActive = typeFilter === type;
            return (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono border transition-colors ${
                  isActive
                    ? 'bg-nexus-amber/10 text-nexus-amber border-nexus-amber/20'
                    : 'text-nexus-text-faint border-nexus-border hover:text-nexus-text'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-12 bg-nexus-surface border border-nexus-border rounded-xl">
          <ScrollText size={24} className="mx-auto text-nexus-text-faint mb-2 opacity-40" />
          <p className="text-xs font-mono text-nexus-text-faint">No entries match these filters.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([date, items]) => (
            <div key={date}>
              <div className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider mb-2 sticky top-0 bg-nexus-bg py-1">
                {date}
              </div>
              <div className="space-y-1">
                {items.map((entry) => {
                  const config = TYPE_CONFIG[entry.type] || TYPE_CONFIG.system;
                  const Icon = config.icon;
                  return (
                    <div key={entry.id} className="flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-nexus-surface transition-colors">
                      <span className="text-xs font-mono text-nexus-text-faint w-12 pt-0.5 shrink-0">
                        {formatTime(entry.created_at)}
                      </span>
                      <Icon size={14} className={`${config.color} mt-0.5 shrink-0`} />
                      <span className="text-sm text-nexus-text-dim">{entry.message}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
