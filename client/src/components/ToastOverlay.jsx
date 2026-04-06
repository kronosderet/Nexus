import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

export default function ToastOverlay({ ws }) {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => {
      if (msg.type === 'notification') {
        const id = Date.now();
        setToasts((prev) => [...prev, { id, ...msg.payload }]);
        // Auto-dismiss after 5s
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 5000);
      }
    });
  }, [ws]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-nexus-surface border border-nexus-amber/30 rounded-lg p-3 shadow-xl animate-[slideIn_0.3s_ease-out] flex items-start gap-3"
        >
          <span className="text-nexus-amber text-lg shrink-0">◈</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono text-nexus-amber">{toast.title}</p>
            <p className="text-sm text-nexus-text mt-0.5">{toast.message}</p>
          </div>
          <button
            onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            className="text-nexus-text-faint hover:text-nexus-text shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
