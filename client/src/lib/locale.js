/**
 * Tiny locale toggle (cs ↔ en) backed by localStorage.
 *
 * Introduced in v4.7.7 to close the trio of UI-audit "cs/en mix" tickets:
 *   #243 Dashboard language toggle (parent)
 *   #268 Fuel cs/en consistency (Czech dates + English "pts/sess")
 *   #365 Log cs/en consistency ("TODAY" English vs "16. 4." Czech)
 *
 * No provider needed — useSyncExternalStore subscribes every consumer to a
 * shared singleton so the toggle re-renders the whole tree without a context
 * rewrite. Default is `cs` since the project author runs in Europe/Prague.
 *
 * Render contract: components that surface dates or short labels call
 *   `formatLocaleDate(d, opts)`, `formatLocaleTime(d, opts)`, or read
 *   `LABELS[useLocale()]` for short tokens (today/yesterday/pts/sess).
 *   Server-side data (decisions, logs, store state) is locale-agnostic.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'nexus.locale';
const listeners = new Set();

function read() {
  try {
    if (typeof localStorage === 'undefined') return 'cs';
    const v = localStorage.getItem(KEY);
    return v === 'en' ? 'en' : 'cs';
  } catch {
    return 'cs';
  }
}

function emit() {
  for (const fn of listeners) fn();
}

export function getLocale() {
  return read();
}

export function setLocale(loc) {
  const next = loc === 'en' ? 'en' : 'cs';
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, next);
  } catch {}
  emit();
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLocale() {
  return useSyncExternalStore(subscribe, read, () => 'cs');
}

function tag(locale) {
  return locale === 'en' ? 'en-US' : 'cs-CZ';
}

export function formatLocaleDate(d, opts) {
  if (d == null) return '';
  return new Date(d).toLocaleDateString(tag(read()), opts);
}

export function formatLocaleTime(d, opts) {
  if (d == null) return '';
  const o = opts || { hour: '2-digit', minute: '2-digit' };
  return new Date(d).toLocaleTimeString(tag(read()), o);
}

// Short labels that drift between modules. Keep this list small — the more
// strings here, the harder cs/en parity becomes to maintain.
export const LABELS = {
  cs: {
    today:     'Dnes',
    yesterday: 'Včera',
    sessions:  'sess.',
    points:    'b.',
    thisWeek:  'tento t.',
    prior:     'minulý',
  },
  en: {
    today:     'Today',
    yesterday: 'Yesterday',
    sessions:  'sess',
    points:    'pts',
    thisWeek:  'this wk',
    prior:     'prior',
  },
};

export function useLabels() {
  return LABELS[useLocale()];
}
