import { useState, useEffect } from 'react';
import { X, AlertTriangle, CheckCircle2, Info, AlertCircle } from 'lucide-react';
import { toast } from '../lib/toast.js';

const KIND_STYLES = {
  info:    { icon: Info,          color: 'text-nexus-blue',   border: 'border-nexus-blue/30' },
  success: { icon: CheckCircle2,  color: 'text-nexus-green',  border: 'border-nexus-green/30' },
  warning: { icon: AlertTriangle, color: 'text-nexus-amber',  border: 'border-nexus-amber/30' },
  error:   { icon: AlertCircle,   color: 'text-nexus-red',    border: 'border-nexus-red/30' },
  notification: { icon: null,     color: 'text-nexus-amber',  border: 'border-nexus-amber/30' },
};

export default function ToastOverlay({ ws }) {
  const [toasts, setToasts] = useState([]);

  function dismiss(id) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function push(t) {
    setToasts((prev) => [...prev, t]);
    if (t.ttl > 0) setTimeout(() => dismiss(t.id), t.ttl);
  }

  // Subscribe to the global toast bus
  useEffect(() => toast.subscribe(push), []);

  // Also bridge WebSocket notifications into the toast stream
  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => {
      if (msg.type === 'notification') {
        push({
          id: `ws-${Date.now()}-${Math.random()}`,
          kind: 'notification',
          title: msg.payload.title,
          message: msg.payload.message,
          ttl: 5000,
        });
      }
    });
  }, [ws]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {toasts.map((t) => {
        const style = KIND_STYLES[t.kind] || KIND_STYLES.info;
        const Icon = style.icon;
        return (
          <div
            key={t.id}
            className={`bg-nexus-surface border ${style.border} rounded-lg p-3 shadow-xl animate-[slideIn_0.3s_ease-out] flex items-start gap-3`}
            role="alert"
          >
            {Icon ? (
              <Icon size={16} className={`${style.color} shrink-0 mt-0.5`} />
            ) : (
              <span className={`${style.color} text-lg shrink-0 leading-none`}>◈</span>
            )}
            <div className="flex-1 min-w-0">
              {t.title && <p className={`text-xs font-mono ${style.color}`}>{t.title}</p>}
              {t.message && <p className="text-sm text-nexus-text mt-0.5 break-words">{t.message}</p>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-nexus-text-faint hover:text-nexus-text shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
