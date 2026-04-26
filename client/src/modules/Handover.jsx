import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../hooks/useApi.js';
import { useNexusFleet } from '../context/useNexus.js';
import { BookMarked, Pencil, Save, X, RefreshCw, FileText, Trash2 } from 'lucide-react';

/**
 * v4.6.0 #398 — Continuous Handover module.
 *
 * One card per known project. Each card:
 *   - displays the current handover content (markdown, rendered as <pre>)
 *   - shows updated_at relative + updated_by label
 *   - inline edit (textarea) with Save / Cancel
 *   - empty state with "Write first handover" affordance
 *
 * Reads /api/handover (all) on mount; refreshes after each save. Discovers
 * additional projects from fleet data so cards exist even before a first write.
 */

function relativeAge(isoStr) {
  if (!isoStr) return '';
  const ms = Date.now() - new Date(isoStr).getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h ago`;
  return `${Math.round(ms / 86400000)}d ago`;
}

function HandoverCard({ project, entry, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const startEdit = () => {
    setDraft(entry?.content || '');
    setErr(null);
    setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setDraft(''); setErr(null); };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await onSave(project, draft);
      setEditing(false);
    } catch (e) {
      setErr(e.message || 'save failed');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete the handover card for ${project}? This cannot be undone.`)) return;
    setBusy(true); setErr(null);
    try { await onDelete(project); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const charCount = (entry?.content || '').length;
  const wordCount = entry?.content ? entry.content.trim().split(/\s+/).filter(Boolean).length : 0;
  // ~500-word soft cap from the task brief; warn when exceeded.
  const overSoftCap = wordCount > 500;

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-nexus-text flex items-center gap-2">
            <BookMarked size={13} className="text-nexus-amber" />
            {project}
          </h3>
          <p className="text-[10px] font-mono text-nexus-text-faint mt-0.5">
            {entry
              ? `updated ${relativeAge(entry.updated_at)}${entry.updated_by ? ' · ' + entry.updated_by : ''} · ${charCount} chars · ${wordCount} words${overSoftCap ? ' (over 500-word soft cap)' : ''}`
              : 'no handover written yet'}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!editing && (
            <button
              onClick={startEdit}
              disabled={busy}
              className="p-1 rounded text-nexus-text-faint hover:text-nexus-amber hover:bg-nexus-amber/10 transition-colors"
              title={entry ? 'Edit handover' : 'Write first handover'}
            >
              <Pencil size={11} />
            </button>
          )}
          {!editing && entry && (
            <button
              onClick={remove}
              disabled={busy}
              className="p-1 rounded text-nexus-text-faint hover:text-nexus-red hover:bg-nexus-red/10 transition-colors"
              title="Delete handover for this project"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Content / editor */}
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Write the handover for ${project}.\n\nWhat the next instance needs to know — current state, what's in flight, what to pick up next, gotchas. Markdown. ~500-word soft cap.`}
            className="flex-1 min-h-[280px] bg-nexus-bg border border-nexus-border rounded-lg p-3 text-xs font-mono text-nexus-text focus:border-nexus-amber focus:outline-none resize-y"
            spellCheck={false}
          />
          <div className="flex items-center justify-between mt-3 gap-3">
            <span className="text-[10px] font-mono text-nexus-text-faint">
              {draft.length} chars · {draft.trim().split(/\s+/).filter(Boolean).length} words
            </span>
            <div className="flex items-center gap-2">
              {err && <span className="text-[10px] font-mono text-nexus-red">{err}</span>}
              <button
                onClick={cancelEdit}
                disabled={busy}
                className="px-3 py-1 rounded border border-nexus-border text-nexus-text-faint hover:text-nexus-text text-[11px] font-mono"
              >
                <X size={10} className="inline mr-1" /> Cancel
              </button>
              <button
                onClick={save}
                disabled={busy || !draft.trim()}
                className="px-3 py-1 rounded bg-nexus-amber/10 border border-nexus-amber/30 text-nexus-amber hover:bg-nexus-amber/20 text-[11px] font-mono disabled:opacity-50"
              >
                <Save size={10} className="inline mr-1" /> {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </>
      ) : entry?.content ? (
        <pre className="flex-1 text-xs font-mono text-nexus-text-dim whitespace-pre-wrap leading-relaxed bg-nexus-bg/40 border border-nexus-border/50 rounded-lg p-3 overflow-auto max-h-[400px]">
          {entry.content}
        </pre>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-nexus-bg/40 border border-dashed border-nexus-border rounded-lg p-6">
          <button
            onClick={startEdit}
            className="text-[11px] font-mono text-nexus-text-faint hover:text-nexus-amber flex items-center gap-1.5"
          >
            <FileText size={12} /> Write first handover for {project}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Handover() {
  const { fleet: fleetSlice } = useNexusFleet();
  const fleetProjects = useMemo(
    () => (fleetSlice?.data?.projects || []).map(p => p.name).filter(Boolean),
    [fleetSlice?.data?.projects]
  );
  const [handovers, setHandovers] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await api.getAllHandovers();
      setHandovers(r.handovers || {});
    } catch (e) {
      setErr(e.message || 'failed to load handovers');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(async (project, content) => {
    const entry = await api.putHandover(project, content, 'dashboard');
    setHandovers(prev => ({ ...prev, [project]: entry }));
  }, []);
  const remove = useCallback(async (project) => {
    await api.deleteHandover(project);
    setHandovers(prev => { const next = { ...prev }; delete next[project]; return next; });
  }, []);

  // Project list = fleet projects ∪ handover keys (so cards appear even when
  // no card exists yet, AND legacy handovers for unknown projects still show).
  const allProjects = useMemo(() => {
    const set = new Set([...fleetProjects, ...Object.keys(handovers)]);
    return Array.from(set).sort((a, b) => {
      // Nexus first; rest alphabetical.
      if (a === 'Nexus') return -1;
      if (b === 'Nexus') return 1;
      return a.localeCompare(b);
    });
  }, [fleetProjects, handovers]);

  return (
    <div className="animate-page-mount">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
            <BookMarked size={18} className="text-nexus-amber" />
            Handover
          </h2>
          <p className="text-xs font-mono text-nexus-text-faint mt-1">
            One card per project. Each instance writes the next handover before docking; the next reads on session start (auto-injected by <code className="text-nexus-amber">nexus_brief</code>). ~500-word soft cap. Markdown.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-lg border border-nexus-border hover:border-nexus-amber/30 hover:text-nexus-amber text-nexus-text-dim transition-colors disabled:opacity-50"
          title="Reload all handovers"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {err && (
        <div className="mb-4 px-3 py-2 rounded border border-nexus-red/30 bg-nexus-red/5 text-[11px] font-mono text-nexus-red">
          {err}
        </div>
      )}

      {allProjects.length === 0 ? (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-8 text-center">
          <FileText size={20} className="mx-auto text-nexus-text-faint mb-2 opacity-50" />
          <p className="text-xs font-mono text-nexus-text-dim">No projects discovered yet.</p>
          <p className="text-[10px] font-mono text-nexus-text-faint mt-1">
            Cards appear automatically when projects show up in the Fleet view.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {allProjects.map(project => (
            <HandoverCard
              key={project}
              project={project}
              entry={handovers[project] || null}
              onSave={save}
              onDelete={remove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
