import { useState, useEffect } from 'react';
import { BookMarked, GitBranch, Tag, ChevronRight, RefreshCw } from 'lucide-react';

function formatDate(d) {
  return new Date(d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
}

export default function LedgerModule() {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  async function fetchLedger() {
    setLoading(true);
    const params = filter ? `?project=${encodeURIComponent(filter)}` : '';
    const data = await fetch(`/api/ledger${params}`).then(r => r.json());
    setEntries(data);
    setLoading(false);
  }

  async function extractAll() {
    await fetch('/api/ledger/extract', { method: 'POST' });
    fetchLedger();
  }

  useEffect(() => { fetchLedger(); }, [filter]);

  const projects = [...new Set(entries.map(e => e.project))];

  // Group by project
  const grouped = {};
  for (const e of entries) {
    if (!grouped[e.project]) grouped[e.project] = [];
    grouped[e.project].push(e);
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <BookMarked size={18} className="text-nexus-amber" />
          The Ledger
        </h2>
        <p className="text-xs font-mono text-nexus-text-faint mt-1">
          {entries.length === 0 ? 'No decisions recorded yet.' : `${entries.length} decisions charted across ${projects.length} projects.`}
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setFilter('')}
          className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors ${!filter ? 'bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20' : 'text-nexus-text-faint hover:text-nexus-text border border-transparent'}`}
        >All</button>
        {projects.map(p => (
          <button
            key={p}
            onClick={() => setFilter(p)}
            className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors ${filter === p ? 'bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20' : 'text-nexus-text-faint hover:text-nexus-text border border-transparent'}`}
          >{p}</button>
        ))}
        <div className="flex-1" />
        <button
          onClick={extractAll}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-nexus-text-faint hover:text-nexus-amber border border-nexus-border rounded transition-colors"
        >
          <RefreshCw size={10} /> Extract from sessions
        </button>
      </div>

      {/* Entries */}
      {loading ? (
        <div className="flex items-center gap-3 justify-center py-8">
          <div className="text-2xl animate-compass text-nexus-amber">◈</div>
          <span className="font-mono text-sm text-nexus-text-dim">Consulting the archives...</span>
        </div>
      ) : filter ? (
        // Flat list when filtering
        <div className="space-y-2">
          {entries.map(e => <DecisionCard key={e.id} entry={e} />)}
        </div>
      ) : (
        // Grouped by project
        <div className="space-y-6">
          {Object.entries(grouped).map(([project, items]) => (
            <div key={project}>
              <h3 className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider mb-2 flex items-center gap-2">
                <GitBranch size={12} className="text-nexus-purple" />
                {project} ({items.length})
              </h3>
              <div className="space-y-1.5">
                {items.slice(0, 10).map(e => <DecisionCard key={e.id} entry={e} compact />)}
                {items.length > 10 && (
                  <button onClick={() => setFilter(project)} className="text-xs font-mono text-nexus-text-faint hover:text-nexus-amber">
                    +{items.length - 10} more...
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionCard({ entry, compact = false }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-lg px-3 py-2 hover:border-nexus-border-bright transition-colors">
      <div className="flex items-start gap-2 cursor-pointer" onClick={() => setOpen(!open)}>
        <ChevronRight size={12} className={`text-nexus-text-faint mt-0.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-nexus-text">{entry.decision}</p>
          {!compact && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] font-mono text-nexus-text-faint">{formatDate(entry.created_at)}</span>
              {entry.tags?.map((t, i) => (
                <span key={i} className="flex items-center gap-0.5 text-[9px] font-mono text-nexus-purple bg-nexus-purple/10 px-1 rounded">
                  <Tag size={7} />{t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="ml-5 mt-2 space-y-1 text-xs">
          {entry.context && <p className="text-nexus-text-dim">{entry.context}</p>}
          {entry.alternatives?.length > 0 && (
            <p className="text-nexus-text-faint">
              <span className="text-nexus-amber">Alternatives considered:</span> {entry.alternatives.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
