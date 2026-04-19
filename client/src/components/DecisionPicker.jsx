import { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../hooks/useApi.js';

/**
 * Shared decision-picker combobox — v4.4.1 #285.
 *
 * Type-to-search across decision ID, text, project, and tags. User picks a
 * decision from the dropdown or types a raw ID. Used by Blast Radius (#285)
 * and Conflicts Flag form (#306).
 *
 * Props:
 *   value: current string value (controlled)
 *   onChange: (string) => void — raw input changes
 *   onSelect: (decision) => void — invoked when user picks one
 *   placeholder: input placeholder
 *   autoFocus: optional
 *
 * Behavior:
 *   - Fetches ledger once on mount (cached server-side anyway)
 *   - Dropdown shows up to 8 matches sorted by ID desc (most-recent first)
 *   - Click or Enter selects; Escape closes
 *   - Numeric input jumps directly to that ID if it exists
 */
export default function DecisionPicker({ value, onChange, onSelect, placeholder = 'Decision ID or text...', autoFocus = false }) {
  const [decisions, setDecisions] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api.getLedger({ limit: 500 }).then(d => { if (alive) setDecisions(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const matches = useMemo(() => {
    if (!value.trim()) return [];
    const q = value.trim().toLowerCase();
    // Pure numeric → exact ID match first, then substring
    if (/^\d+$/.test(q)) {
      const exactId = Number(q);
      const exact = decisions.filter(d => d.id === exactId);
      const near = decisions.filter(d => String(d.id).includes(q) && d.id !== exactId);
      return [...exact, ...near].slice(0, 8);
    }
    // Text search across decision + project + tags
    return decisions
      .filter(d => {
        const hay = `${d.decision} ${d.project || ''} ${(d.tags || []).join(' ')}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => b.id - a.id) // most recent first
      .slice(0, 8);
  }, [value, decisions]);

  // Close dropdown on outside click
  useEffect(() => {
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(matches.length - 1, i + 1));
      setOpen(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && open && matches[activeIdx]) {
      e.preventDefault();
      pick(matches[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  function pick(decision) {
    onChange(String(decision.id));
    setOpen(false);
    if (onSelect) onSelect(decision);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActiveIdx(0); }}
        onFocus={() => value && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full bg-nexus-bg border border-nexus-border rounded-lg px-3 py-2 text-sm text-nexus-text font-mono focus:border-nexus-amber focus:outline-none"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-nexus-surface border border-nexus-border rounded-lg shadow-lg overflow-hidden">
          {matches.map((d, i) => (
            <button
              key={d.id}
              type="button"
              onClick={() => pick(d)}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full text-left px-3 py-2 text-xs font-mono flex items-baseline gap-2 transition-colors ${i === activeIdx ? 'bg-nexus-amber/10 text-nexus-text' : 'text-nexus-text-dim hover:bg-nexus-amber/5'}`}
            >
              <span className="text-nexus-amber shrink-0">#{d.id}</span>
              <span className="text-[10px] text-nexus-text-faint shrink-0">[{d.project || 'general'}]</span>
              <span className="truncate">{d.decision}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
