import { useState, useEffect } from 'react';
import { api } from '../hooks/useApi.js';
import { ScrollText, Compass, CheckCircle2, Trash2, Settings, FileEdit, AlertTriangle } from 'lucide-react';

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

  async function fetchActivity() {
    try {
      const data = await api.getActivity();
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
  for (const entry of entries) {
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
          {entries.length === 0 ? 'The log is empty. Calm waters.' : `${entries.length} entries in the ship's log.`}
        </p>
      </div>

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
    </div>
  );
}
