import { useState, useEffect, useRef } from 'react';
import { Brain, X, Plus, ArrowDown, Trash2, Loader2, MessageSquare } from 'lucide-react';
import { api } from '../hooks/useApi.js';
import { toast } from '../lib/toast.js';

/**
 * Thought Stack — interrupt-recovery working memory.
 *
 * LIFO stack for "I need to remember what I was doing when someone
 * interrupted me." Push before the interruption, pop when you return.
 *
 * Global overlay, triggered by Ctrl+T. Accessible from anywhere.
 */
export default function ThoughtStackModal({ open, onClose }) {
  const [thoughts, setThoughts] = useState([]);
  const [text, setText] = useState('');
  const [context, setContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(null); // id currently being operated on
  const inputRef = useRef(null);

  async function fetchThoughts() {
    setLoading(true);
    try {
      const data = await api.getThoughts();
      setThoughts(Array.isArray(data) ? data : []);
    } catch {} finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    fetchThoughts();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function handlePush(e) {
    e?.preventDefault?.();
    if (!text.trim()) return;
    try {
      const thought = await api.pushThought({
        text: text.trim(),
        context: context.trim() || undefined,
      });
      setThoughts((prev) => [thought, ...prev]);
      setText('');
      setContext('');
      toast.success('Thought pushed', `#${thought.id} on the stack.`, 2500);
      setTimeout(() => inputRef.current?.focus(), 10);
    } catch (err) {
      // Error toast is already fired by api helper
    }
  }

  async function handlePop(id) {
    setWorking(id ?? 'top');
    try {
      const popped = await api.popThought(id);
      setThoughts((prev) => prev.filter((t) => t.id !== popped.id));
      toast.success('Thought popped', popped.text.slice(0, 60), 2500);
    } catch {} finally {
      setWorking(null);
    }
  }

  async function handleAbandon(id) {
    setWorking(id);
    try {
      await api.abandonThought(id, 'Abandoned from UI');
      setThoughts((prev) => prev.filter((t) => t.id !== id));
    } catch {} finally {
      setWorking(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />

      <div
        className="relative w-full max-w-lg max-h-[80vh] bg-nexus-surface border border-nexus-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-nexus-border">
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-nexus-purple" />
            <span className="text-sm font-semibold text-nexus-text">Thought Stack</span>
            <span className="text-[10px] font-mono text-nexus-text-faint ml-2">
              {thoughts.length} held
            </span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="text-[10px] font-mono text-nexus-text-faint px-1.5 py-0.5 rounded bg-nexus-bg border border-nexus-border">
              ESC
            </kbd>
            <button
              onClick={onClose}
              className="text-nexus-text-faint hover:text-nexus-text"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Push form */}
        <form onSubmit={handlePush} className="px-4 py-3 border-b border-nexus-border space-y-2">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What were you thinking about..."
              className="flex-1 bg-nexus-bg border border-nexus-border rounded-lg px-3 py-2 text-sm text-nexus-text placeholder:text-nexus-text-faint focus:border-nexus-purple focus:outline-none"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="px-3 py-2 rounded-lg bg-nexus-purple/10 text-nexus-purple border border-nexus-purple/20 text-xs font-mono hover:bg-nexus-purple/20 disabled:opacity-40 disabled:hover:bg-nexus-purple/10 flex items-center gap-1"
            >
              <Plus size={12} /> Push
            </button>
          </div>
          <input
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Context (optional) — where you were, what file, what line..."
            className="w-full bg-nexus-bg border border-nexus-border rounded-lg px-3 py-1.5 text-xs text-nexus-text placeholder:text-nexus-text-faint focus:border-nexus-purple focus:outline-none font-mono"
          />
        </form>

        {/* Stack */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-6 text-center text-xs font-mono text-nexus-text-faint">
              Loading...
            </div>
          ) : thoughts.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <MessageSquare size={20} className="mx-auto text-nexus-text-faint mb-2 opacity-40" />
              <p className="text-xs font-mono text-nexus-text-faint">
                Stack is empty. Push a thought before you get interrupted.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-nexus-border">
              {thoughts.map((t, i) => (
                <div key={t.id} className={`px-4 py-3 ${i === 0 ? 'bg-nexus-purple/5' : ''}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-[10px] font-mono text-nexus-text-faint w-6 shrink-0">
                      {i === 0 ? '▸ top' : `#${i + 1}`}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-nexus-text break-words">{t.text}</p>
                      {t.context && (
                        <p className="text-[10px] font-mono text-nexus-text-faint italic mt-1 break-words">
                          {t.context}
                        </p>
                      )}
                      {t.project && (
                        <span className="inline-block mt-1 text-[9px] font-mono text-nexus-purple">
                          {t.project}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handlePop(t.id)}
                        disabled={working === t.id}
                        title="Pop"
                        className="p-1.5 text-nexus-green hover:bg-nexus-green/10 rounded disabled:opacity-40"
                      >
                        {working === t.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <ArrowDown size={12} />
                        )}
                      </button>
                      <button
                        onClick={() => handleAbandon(t.id)}
                        disabled={working === t.id}
                        title="Abandon"
                        className="p-1.5 text-nexus-text-faint hover:text-nexus-red hover:bg-nexus-red/10 rounded disabled:opacity-40"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-nexus-border flex items-center gap-4 text-[10px] font-mono text-nexus-text-faint">
          <span>↓ pop (recover)</span>
          <span>🗑 abandon</span>
          <span className="ml-auto">Ctrl+T to toggle</span>
        </div>
      </div>
    </div>
  );
}
