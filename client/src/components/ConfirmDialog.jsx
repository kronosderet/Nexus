/**
 * Shared confirmation modal — replaces window.confirm + window.prompt.
 *
 * v4.9.1 #760 — four callsites converted:
 *   - Fleet.jsx        commit-message prompt
 *   - Overseer.jsx     commit-message prompt (InlineCommitRow)
 *   - Handover.jsx     delete-card confirm
 *   - graph/Contradictions  delete-edge confirm
 *
 * Why: window.confirm/prompt block the event loop, can't be styled, have no
 * a11y (no focus trap, no aria-modal labeling, no ESC handling consistency),
 * and on Win11 IoT render as bland system dialogs that look out of place.
 *
 * API:
 *   open             — controls visibility
 *   title            — short heading
 *   message          — body text
 *   inputLabel       — if set, render a text <input>; onConfirm receives its value
 *   inputDefault     — initial value for the input
 *   inputPlaceholder — input placeholder text
 *   confirmLabel     — default "Confirm"
 *   cancelLabel      — default "Cancel"
 *   danger           — when true, confirm button is red (use for destructive ops)
 *   onConfirm        — called with the input value (or undefined for pure confirm)
 *   onCancel         — fires on Cancel button OR ESC OR backdrop click
 *
 * Focus: the input (when present) or the cancel button receives initial focus.
 * ESC and backdrop click cancel; Enter on the input confirms.
 */
import { useState, useEffect, useRef } from 'react';
import { X, AlertTriangle } from 'lucide-react';

export default function ConfirmDialog({
  open,
  title,
  message,
  inputLabel,
  inputDefault = '',
  inputPlaceholder,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}) {
  const [value, setValue] = useState(inputDefault);
  const inputRef = useRef(null);
  const cancelRef = useRef(null);

  // Reset value + focus on open. Without this the value would persist between
  // openings, which is wrong if the same dialog is reused for different targets.
  useEffect(() => {
    if (!open) return;
    setValue(inputDefault);
    const focusTarget = inputLabel ? inputRef.current : cancelRef.current;
    setTimeout(() => focusTarget?.focus(), 50);
  }, [open, inputDefault, inputLabel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const handleConfirm = () => {
    if (inputLabel) {
      const trimmed = value.trim();
      if (!trimmed) return; // require non-empty input for prompt-style use
      onConfirm?.(trimmed);
    } else {
      onConfirm?.();
    }
  };

  const confirmClasses = danger
    ? 'bg-nexus-red/10 border-nexus-red/30 text-nexus-red hover:bg-nexus-red/20'
    : 'bg-nexus-amber/10 border-nexus-amber/30 text-nexus-amber hover:bg-nexus-amber/20';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-nexus-surface border border-nexus-border rounded-xl shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-nexus-border">
          <div className="flex items-center gap-2">
            {danger && <AlertTriangle size={16} className="text-nexus-red" />}
            <h2 className="text-sm font-mono uppercase tracking-wider text-nexus-text">{title}</h2>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="text-nexus-text-faint hover:text-nexus-text transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {message && <p className="text-xs text-nexus-text-dim leading-relaxed">{message}</p>}
          {inputLabel && (
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-nexus-text-faint mb-1">
                {inputLabel}
              </label>
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); } }}
                placeholder={inputPlaceholder}
                aria-label={inputLabel}
                className="w-full px-3 py-2 text-sm bg-nexus-bg border border-nexus-border rounded focus:outline-none focus:border-nexus-amber"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-nexus-border">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-mono rounded border border-nexus-border text-nexus-text-dim hover:text-nexus-text hover:border-nexus-border-bright transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors ${confirmClasses}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
