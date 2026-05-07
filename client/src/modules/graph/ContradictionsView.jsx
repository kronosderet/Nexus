/**
 * ContradictionsView — Conflicts tab. Active conflict resolution + Overseer
 * scan + suggested-contradiction review + manual flagging.
 *
 * Extracted from Graph.jsx in v4.7.2 (#217 part 2). Lifts the entire
 * Contradictions sub-tree (~470L) into one file: the main `ContradictionsView`
 * (default export) plus four private helpers `ResolveConflictCard`,
 * `ScanContradictionsPanel`, `SuggestedContradictionCard`, and
 * `FlagContradictionForm`. Render code unchanged; only imports moved.
 *
 * Render contract: receives `data` shaped like `/api/impact/contradictions`
 * (total, contradictions[], suggestions[], activeConflicts[], historical{})
 * plus an `onRefresh` callback invoked after any mutation so the parent
 * Graph slice refetches.
 */
import { useState, useEffect } from 'react';
import { AlertTriangle, Sparkles, Check, X, Loader2 } from 'lucide-react';
import { api } from '../../hooks/useApi.js';
import DecisionPicker from '../../components/DecisionPicker.jsx';

// v4.6.5 #311 — Structured resolution card for an active rel='contradicts' edge.
// Three actions: Deprecate (mark one side deprecated), Mark as evolution
// (change edge to rel='replaced' showing B supersedes A), Keep both (delete
// the edge — false positive). All write through existing /api/ledger routes.
function ResolveConflictCard({ conflict, onResolved }) {
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const a = conflict.from_decision;
  const b = conflict.to_decision;
  const edgeId = conflict.edge.id;

  const deprecate = async (which) => {
    setBusy('deprecate-' + which); setErr(null);
    try {
      const target = which === 'a' ? a.id : b.id;
      await api.updateDecision(target, { lifecycle: 'deprecated', deprecated: true });
      if (onResolved) onResolved();
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };
  const markEvolution = async (direction) => {
    setBusy('evolution'); setErr(null);
    try {
      // direction='a-to-b': edge from→to stays, rel becomes replaced (a was replaced by b)
      // direction='b-to-a': we'd need to flip from/to. Simplest: delete + recreate.
      if (direction === 'a-to-b') {
        await api.updateEdge(edgeId, { rel: 'replaced', note: `Marked as evolution (${a.id} → ${b.id})` });
      } else {
        await api.removeEdge(edgeId);
        await api.linkDecisions({ from: b.id, to: a.id, rel: 'replaced', note: `Marked as evolution (${b.id} → ${a.id})` });
      }
      if (onResolved) onResolved();
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };
  const keepBoth = async () => {
    if (!window.confirm('Delete this conflict edge? Both decisions stay active.')) return;
    setBusy('keep'); setErr(null);
    try {
      await api.removeEdge(edgeId);
      if (onResolved) onResolved();
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };

  return (
    <div className="bg-nexus-red/5 border border-nexus-red/20 rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] font-mono text-nexus-red uppercase tracking-wider">Conflict</span>
        <span className="text-[9px] font-mono text-nexus-text-faint">edge #{edgeId} · {a.project}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
        <div className="bg-nexus-bg/40 border border-nexus-border rounded p-2">
          <p className="text-[9px] font-mono text-nexus-text-faint mb-1">A · #{a.id}</p>
          <p className="text-xs text-nexus-text-dim leading-snug">{String(a.decision || '').slice(0, 220)}</p>
        </div>
        <div className="bg-nexus-bg/40 border border-nexus-border rounded p-2">
          <p className="text-[9px] font-mono text-nexus-text-faint mb-1">B · #{b.id}</p>
          <p className="text-xs text-nexus-text-dim leading-snug">{String(b.decision || '').slice(0, 220)}</p>
        </div>
      </div>
      {conflict.edge.note && (
        <p className="text-[10px] font-mono text-nexus-text-faint italic mb-2">note: {conflict.edge.note}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-nexus-red/10">
        <span className="text-[9px] font-mono text-nexus-text-faint mr-1">Resolve:</span>
        <button onClick={() => deprecate('a')} disabled={!!busy}
          className="text-[10px] font-mono px-2 py-1 rounded border border-nexus-amber/30 text-nexus-amber hover:bg-nexus-amber/10 disabled:opacity-50"
          title={`Mark #${a.id} as deprecated (B is the surviving choice)`}>
          {busy === 'deprecate-a' ? '…' : 'Deprecate A'}
        </button>
        <button onClick={() => deprecate('b')} disabled={!!busy}
          className="text-[10px] font-mono px-2 py-1 rounded border border-nexus-amber/30 text-nexus-amber hover:bg-nexus-amber/10 disabled:opacity-50"
          title={`Mark #${b.id} as deprecated (A is the surviving choice)`}>
          {busy === 'deprecate-b' ? '…' : 'Deprecate B'}
        </button>
        <span className="w-px h-4 bg-nexus-border mx-1" />
        <button onClick={() => markEvolution('a-to-b')} disabled={!!busy}
          className="text-[10px] font-mono px-2 py-1 rounded border border-nexus-blue/30 text-nexus-blue hover:bg-nexus-blue/10 disabled:opacity-50"
          title={`Change edge to rel=replaced (#${a.id} was replaced by #${b.id})`}>
          {busy === 'evolution' ? '…' : 'Evolution: A → B'}
        </button>
        <button onClick={() => markEvolution('b-to-a')} disabled={!!busy}
          className="text-[10px] font-mono px-2 py-1 rounded border border-nexus-blue/30 text-nexus-blue hover:bg-nexus-blue/10 disabled:opacity-50"
          title={`Change edge to rel=replaced (#${b.id} was replaced by #${a.id})`}>
          B → A
        </button>
        <span className="w-px h-4 bg-nexus-border mx-1" />
        <button onClick={keepBoth} disabled={!!busy}
          className="text-[10px] font-mono px-2 py-1 rounded border border-nexus-border text-nexus-text-faint hover:text-nexus-text disabled:opacity-50"
          title="False positive — remove the conflict edge, both decisions stay active.">
          {busy === 'keep' ? '…' : 'Keep both'}
        </button>
        {err && <span className="text-[9px] font-mono text-nexus-red ml-2">{err}</span>}
      </div>
    </div>
  );
}

export default function ContradictionsView({ data, onRefresh }) {
  // v4.4.4 #309 — lifetime counter row. Even when active=0, show how many conflicts
  // have ever been flagged and how many resolved (one side marked deprecated) so the
  // tab communicates state instead of looking dead. `historical` is computed server-side.
  const hist = data?.historical;
  const suggestions = data?.suggestions || [];
  const activeConflicts = data?.activeConflicts || [];
  return (
    <div className="space-y-4">
      {/* v4.4.8 #307 — Overseer scan panel. Async runs the LLM contradiction scan,
          polls for completion, then refreshes the graph slice so suggestions appear
          inline. Lives at the top of the view because it's the primary "act on this
          tab" affordance now. */}
      <ScanContradictionsPanel onComplete={onRefresh} />

      {/* v4.4.8 #307 — suggestions section. Shows Overseer-proposed contradictions
          with accept/dismiss. Only renders when there are active suggestions. */}
      {suggestions.length > 0 && (
        <div className="bg-nexus-surface border border-nexus-blue/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={14} className="text-nexus-blue" />
            <h3 className="text-xs font-mono text-nexus-blue uppercase tracking-wider">Suggested by Overseer</h3>
            <span className="text-[10px] font-mono text-nexus-text-faint ml-auto">{suggestions.length} pending review</span>
          </div>
          <div className="space-y-2">
            {/* v4.5.0 — staggered reveal so fresh Overseer suggestions appear with flow */}
            {suggestions.map((s, i) => (
              <div
                key={s.id}
                className="animate-row-reveal"
                style={{ animationDelay: `${Math.min(i * 40, 160)}ms` }}
              >
                <SuggestedContradictionCard suggestion={s} onDecision={onRefresh} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* v4.6.5 #311 — Active conflict resolution. Lists rel='contradicts'
          edges where neither side is deprecated, with three resolution actions
          per conflict (Deprecate A/B, Mark as evolution A→B/B→A, Keep both). */}
      {activeConflicts.length > 0 && (
        <div className="bg-nexus-surface border border-nexus-red/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-nexus-red" />
            <h3 className="text-xs font-mono text-nexus-red uppercase tracking-wider">Active conflicts ({activeConflicts.length})</h3>
            <span className="text-[10px] font-mono text-nexus-text-faint ml-auto">resolve to clear</span>
          </div>
          <div className="space-y-2">
            {activeConflicts.map((c) => (
              <ResolveConflictCard key={c.edge.id} conflict={c} onResolved={onRefresh} />
            ))}
          </div>
        </div>
      )}

      {/* v4.4.4 #309 — always-visible historical counter row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-3 text-center">
          <p className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider mb-1">Active</p>
          <p className={`text-xl font-light tabular-nums ${data?.total > 0 ? 'text-nexus-amber' : 'text-nexus-green'}`}>{data?.total ?? 0}</p>
        </div>
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-3 text-center" title="Conflicts ever flagged — potential auto-detected plus manually marked via rel=contradicts edges.">
          <p className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider mb-1">Ever flagged</p>
          <p className="text-xl font-light tabular-nums text-nexus-text-dim">{hist?.total ?? 0}</p>
        </div>
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-3 text-center" title="Flagged conflicts where at least one decision was later marked deprecated — the opposition no longer applies to an active decision.">
          <p className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider mb-1">Resolved</p>
          <p className="text-xl font-light tabular-nums text-nexus-green">{hist?.resolved ?? 0}</p>
        </div>
      </div>

      {/* v4.4.4 #308 — expanded educational copy. The v4.3.10 version answered "what
          is this tab" but not "how do I use it" or "why should I care". Three Q/A
          blocks cover: definition, motivation, workflow. Still dismissible feel via
          the "No conflicts flagged" lead when empty. */}
      {data?.total === 0 && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-nexus-amber shrink-0 mt-0.5" />
            <div className="space-y-3 text-xs font-mono text-nexus-text-faint leading-relaxed">
              <p className="text-sm text-nexus-text font-sans">No active conflicts.</p>

              <div>
                <p className="text-nexus-text-dim mb-1">What is a conflict?</p>
                <p>
                  Two decisions that oppose each other — different paths chosen at different times, or the same question answered two ways across projects.
                  Conflicts are tracked via <code className="mx-0.5 px-1 py-0.5 rounded bg-nexus-bg text-nexus-amber">rel=&lsquo;contradicts&rsquo;</code> edges in the knowledge graph.
                </p>
              </div>

              <div>
                <p className="text-nexus-text-dim mb-1">Why should I care?</p>
                <p>
                  Without this view, contradictions sit silently in the Ledger — you rediscover them only when re-reading. Flagging makes them visible next session,
                  so you (or the Overseer) can either reconcile the two, mark the old one deprecated, or split the context by project.
                </p>
              </div>

              <div>
                <p className="text-nexus-text-dim mb-1">How do I use it?</p>
                <p>
                  Use the form below to flag a conflict — pick the two decisions, optionally add a note explaining the contradiction. The counter row above tracks
                  lifetime flags and resolutions. Useful when: you changed direction, two projects took opposing paths, or a decision was superseded without being marked deprecated.
                </p>
              </div>

              {/* v4.6.5 #312 — example patterns from real codebases. Helps users
                  recognize what counts as a conflict in practice, not just abstract theory. */}
              <div>
                <p className="text-nexus-text-dim mb-1">In this codebase, conflicts look like:</p>
                <ul className="list-none space-y-0.5 ml-1">
                  <li>· two projects took opposing paths (REST vs GraphQL, monolith vs microservice)</li>
                  <li>· a v3 decision and v4 decision answer the same question two ways without `replaced` linking them</li>
                  <li>· an early "rough" choice (e.g. "use SQLite") and a later refinement ("Postgres for prod") that left the rough one un-deprecated</li>
                  <li>· cross-project: SR3 picks server-authoritative dice while another project chose client-side roll-and-verify</li>
                  <li>· two architects answered the same async question independently (different fuel models, different fuel countdowns)</li>
                </ul>
                <p className="text-[10px] mt-1 italic">When you spot one, flag it below. Once flagged, the panel above offers Deprecate / Mark as evolution / Keep both.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* v4.4.1 #306 — manual "Flag contradiction" form. Two DecisionPickers + note + submit.
          Creates a rel='contradicts' edge via /api/ledger/link. Tab was previously read-only. */}
      <FlagContradictionForm onFlagged={onRefresh} />

      {data?.contradictions?.map((c, i) => (
        <div key={i} className="bg-nexus-red/5 border border-nexus-red/20 rounded-lg p-3">
          <p className="text-xs text-nexus-text-dim">{c.message}</p>
          {c.trigger && <span className="text-[10px] font-mono text-nexus-red mt-1 inline-block">Trigger: {c.trigger}</span>}
        </div>
      ))}
    </div>
  );
}

// v4.4.8 #307 — Overseer scan panel. Kicks off the async contradiction scan
// and polls until the Overseer returns, then calls onComplete so the parent
// ContradictionsView refetches and renders the new suggestions. The scan itself
// persists results server-side (via _suggestedContradictions), so the client
// only needs to poll for completion and trigger a refresh.
function ScanContradictionsPanel({ onComplete }) {
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [elapsed, setElapsed] = useState(0);
  const [taskId, setTaskId] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function startScan() {
    setStatus('running');
    setError(null);
    setResult(null);
    setElapsed(0);
    try {
      const start = await api.scanContradictions({
        max_pairs: 20,
        similarity_threshold: 0.65,
        confidence_threshold: 0.55,
      });
      if (start.error) {
        setStatus('error'); setError(start.error); return;
      }
      setTaskId(start.taskId);
    } catch (e) {
      setStatus('error');
      setError(e.message || 'Failed to start scan');
    }
  }

  // Poll every 3s while running. Stop when done/error or taskId cleared.
  useEffect(() => {
    if (!taskId || status !== 'running') return;
    const started = Date.now();
    const tick = setInterval(async () => {
      setElapsed(Math.round((Date.now() - started) / 1000));
      try {
        const poll = await api.getScanContradictionsResult(taskId);
        if (poll.status === 'done') {
          clearInterval(tick);
          setStatus('done');
          try { setResult(JSON.parse(poll.answer || '{}')); } catch { setResult({}); }
          // Refresh parent so the hydrated /impact/contradictions response with
          // fresh suggestions lands in the Graph slice.
          if (onComplete) onComplete();
        } else if (poll.status === 'error') {
          clearInterval(tick);
          setStatus('error');
          setError(poll.error || 'Overseer error');
        }
      } catch (e) {
        clearInterval(tick);
        setStatus('error');
        setError(e.message);
      }
    }, 3000);
    return () => clearInterval(tick);
  }, [taskId, status, onComplete]);

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-nexus-blue" />
          <span className="text-xs font-mono text-nexus-blue uppercase tracking-wider">Overseer Scan</span>
          <span className="text-[10px] font-mono text-nexus-text-faint hidden sm:inline">
            Find contradictions via embedding pairing + LLM classification
          </span>
        </div>
        <button
          onClick={startScan}
          disabled={status === 'running'}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-lg border border-nexus-blue/30 text-nexus-blue hover:bg-nexus-blue/10 transition-colors disabled:opacity-50 ${status === 'running' ? 'animate-shimmer-sweep' : ''}`}
          title="Scans same-project decision pairs with cosine similarity ≥0.65; asks the Overseer to classify each. Stores accepted/dismissed decisions so pairs don't re-surface."
        >
          {status === 'running' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {status === 'running' ? `Scanning… (${elapsed}s)` : 'Scan for contradictions'}
        </button>
      </div>
      {status === 'done' && result && (
        <p className="text-[10px] font-mono text-nexus-text-faint mt-2">
          {result.suggestions?.length > 0
            ? `◈ ${result.suggestions.length} new suggestion${result.suggestions.length === 1 ? '' : 's'} · evaluated ${result.pairs_evaluated ?? '?'} pairs.`
            : result.note || `No new contradictions found${result.pairs_evaluated ? ` (evaluated ${result.pairs_evaluated} pairs)` : ''}.`}
        </p>
      )}
      {status === 'error' && (
        <p className="text-[10px] font-mono text-nexus-red mt-2">◈ {error}</p>
      )}
    </div>
  );
}

// v4.4.8 #307 — card rendering for a single Overseer-proposed contradiction.
// Accept promotes to a real `rel='contradicts'` edge; dismiss marks as handled
// so the same pair doesn't re-surface on the next scan.
function SuggestedContradictionCard({ suggestion, onDecision }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // v4.5.0 — brief success flash after accept/dismiss before the card unmounts
  // when the parent refetches. Gives the user confirmation their click registered.
  const [flashClass, setFlashClass] = useState('');
  const confPct = Math.round((suggestion.confidence || 0) * 100);
  const simPct = Math.round((suggestion.similarity || 0) * 100);

  async function act(action) {
    setBusy(true); setError(null);
    try {
      if (action === 'accept') await api.acceptSuggestedContradiction(suggestion.id);
      else await api.dismissSuggestedContradiction(suggestion.id);
      setFlashClass('animate-success-flash');
      // Let the flash play briefly before the parent refresh unmounts us.
      setTimeout(() => { if (onDecision) onDecision(); }, 350);
    } catch (e) {
      setError(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`bg-nexus-bg border border-nexus-blue/20 rounded-lg p-3 ${flashClass}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-nexus-blue/10 text-nexus-blue border border-nexus-blue/20" title="Overseer confidence × cosine similarity at pairing time">
          {confPct}% · sim {simPct}%
        </span>
        <span className="text-[10px] font-mono text-nexus-text-faint">
          #{suggestion.from_id} ↔ #{suggestion.to_id}
        </span>
      </div>
      <p className="text-xs text-nexus-text-dim italic mb-2 leading-relaxed">&ldquo;{suggestion.reason}&rdquo;</p>
      <div className="space-y-1 mb-3">
        <p className="text-[11px] text-nexus-text">
          <span className="font-mono text-nexus-text-faint">A </span>
          {suggestion.from_decision?.decision?.slice(0, 160)}
          {suggestion.from_decision?.lifecycle && (
            <span className="ml-1 text-[9px] font-mono text-nexus-text-faint">· {suggestion.from_decision.lifecycle}</span>
          )}
        </p>
        <p className="text-[11px] text-nexus-text">
          <span className="font-mono text-nexus-text-faint">B </span>
          {suggestion.to_decision?.decision?.slice(0, 160)}
          {suggestion.to_decision?.lifecycle && (
            <span className="ml-1 text-[9px] font-mono text-nexus-text-faint">· {suggestion.to_decision.lifecycle}</span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => act('accept')}
          disabled={busy}
          className="flex items-center gap-1 px-2.5 py-1 rounded border border-nexus-red/30 text-nexus-red text-[10px] font-mono hover:bg-nexus-red/10 transition-colors disabled:opacity-50"
          title="Promote to a rel='contradicts' edge in the Ledger"
        >
          <Check size={10} /> Flag as conflict
        </button>
        <button
          onClick={() => act('dismiss')}
          disabled={busy}
          className="flex items-center gap-1 px-2.5 py-1 rounded border border-nexus-border text-nexus-text-faint text-[10px] font-mono hover:text-nexus-text hover:border-nexus-text-faint transition-colors disabled:opacity-50"
          title="Hide this suggestion. The same pair won't re-surface in future scans."
        >
          <X size={10} /> Dismiss
        </button>
        {busy && <Loader2 size={10} className="animate-spin text-nexus-blue" />}
        {error && <span className="text-[10px] font-mono text-nexus-red">{error}</span>}
      </div>
    </div>
  );
}

function FlagContradictionForm({ onFlagged }) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'ok'|'err', msg }

  async function submit() {
    const from = parseInt(fromId, 10);
    const to = parseInt(toId, 10);
    if (!from || !to || from === to) {
      setStatus({ type: 'err', msg: 'Pick two different decisions.' });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await api.linkDecisions({ from, to, rel: 'contradicts', note: note.trim() || undefined });
      setStatus({ type: 'ok', msg: `Flagged #${from} ↔ #${to} as contradicting.` });
      setFromId(''); setToId(''); setNote('');
      if (onFlagged) onFlagged();
    } catch (e) {
      setStatus({ type: 'err', msg: (e?.message || 'Failed to flag').slice(0, 140) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={14} className="text-nexus-amber" />
        <h3 className="text-xs font-mono text-nexus-amber uppercase tracking-wider">Flag a contradiction</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <div>
          <span className="text-[10px] font-mono text-nexus-text-faint block mb-1">Decision A</span>
          <DecisionPicker value={fromId} onChange={setFromId} placeholder="Pick or type ID..." />
        </div>
        <div>
          <span className="text-[10px] font-mono text-nexus-text-faint block mb-1">Decision B (contradicts A)</span>
          <DecisionPicker value={toId} onChange={setToId} placeholder="Pick or type ID..." />
        </div>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note — why does A contradict B?"
        className="w-full mb-3 bg-nexus-bg border border-nexus-border rounded-lg px-3 py-2 text-xs text-nexus-text font-mono focus:border-nexus-amber focus:outline-none"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy || !fromId || !toId}
          className="px-4 py-1.5 rounded bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/30 text-xs font-mono hover:bg-nexus-amber/20 disabled:opacity-50"
        >
          {busy ? 'Flagging…' : 'Flag contradiction'}
        </button>
        {status && (
          <span className={`text-[10px] font-mono ${status.type === 'ok' ? 'text-nexus-green' : 'text-nexus-red'}`}>
            {status.msg}
          </span>
        )}
      </div>
    </div>
  );
}
