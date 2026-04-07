import { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';

const SHORTCUT_SECTIONS = [
  {
    title: 'Navigation',
    items: [
      { keys: ['Ctrl', '1'], label: 'Compass' },
      { keys: ['Ctrl', '2'], label: 'System Pulse' },
      { keys: ['Ctrl', '3'], label: 'Fuel' },
      { keys: ['Ctrl', '4'], label: 'Graph' },
      { keys: ['Ctrl', '5'], label: 'Overseer' },
      { keys: ['Ctrl', '6'], label: 'Missions' },
      { keys: ['Ctrl', '7'], label: 'Activity' },
      { keys: ['Ctrl', '8'], label: 'Sessions' },
      { keys: ['Ctrl', '9'], label: 'Bookmarks' },
      { keys: ['Ctrl', '0'], label: 'Terminal' },
    ],
  },
  {
    title: 'Global',
    items: [
      { keys: ['Ctrl', 'K'], label: 'Search' },
      { keys: ['Ctrl', 'T'], label: 'Thought Stack' },
      { keys: ['Ctrl', '/'], label: 'This help' },
      { keys: ['Esc'], label: 'Close modal' },
    ],
  },
  {
    title: 'In Missions',
    items: [
      { keys: ['Drag'], label: 'Move task between columns' },
      { keys: ['Click dot'], label: 'Quick status change' },
      { keys: ['Enter'], label: 'Save new task' },
    ],
  },
  {
    title: 'In Terminal',
    items: [
      { keys: ['Click chip'], label: 'Run quick command' },
      { keys: ['Enter'], label: 'Submit command' },
    ],
  },
];

function Kbd({ children }) {
  return (
    <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-nexus-bg border border-nexus-border text-nexus-text-dim">
      {children}
    </kbd>
  );
}

export default function ShortcutHelpModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" onClick={onClose}>
      <div className="fixed inset-0 bg-black/60" />

      <div
        className="relative w-full max-w-2xl max-h-[80vh] bg-nexus-surface border border-nexus-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-nexus-border">
          <div className="flex items-center gap-2">
            <Keyboard size={16} className="text-nexus-amber" />
            <span className="text-sm font-semibold text-nexus-text">Keyboard Shortcuts</span>
          </div>
          <button
            onClick={onClose}
            className="text-nexus-text-faint hover:text-nexus-text"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          {SHORTCUT_SECTIONS.map((section) => (
            <div key={section.title}>
              <h3 className="text-[10px] font-mono text-nexus-amber uppercase tracking-[0.2em] mb-2">
                {section.title}
              </h3>
              <div className="space-y-1.5">
                {section.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-nexus-text-dim">{item.label}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.keys.map((k, j) => (
                        <span key={j} className="flex items-center gap-1">
                          {j > 0 && <span className="text-[10px] text-nexus-text-faint">+</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-nexus-border text-[10px] font-mono text-nexus-text-faint">
          Press <Kbd>Ctrl</Kbd> + <Kbd>/</Kbd> anywhere to toggle this help.
        </div>
      </div>
    </div>
  );
}
