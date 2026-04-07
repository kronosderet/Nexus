// Tiny global toast bus — imperative API usable from hooks, api helpers, or anywhere.
// ToastOverlay subscribes and renders. Nothing else needs to import React.

const listeners = new Set();
let nextId = 1;

export const toast = {
  show({ kind = 'info', title = '', message = '', ttl = 5000 } = {}) {
    const id = nextId++;
    const t = { id, kind, title, message, ttl };
    for (const cb of listeners) cb(t);
    return id;
  },
  info(title, message, ttl) { return this.show({ kind: 'info', title, message, ttl }); },
  success(title, message, ttl) { return this.show({ kind: 'success', title, message, ttl }); },
  warning(title, message, ttl) { return this.show({ kind: 'warning', title, message, ttl }); },
  error(title, message, ttl = 8000) { return this.show({ kind: 'error', title, message, ttl }); },
  subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
