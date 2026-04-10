import { watch } from 'chokidar';
import { basename, relative, dirname } from 'path';
import type { NexusStore } from '../db/store.ts';
import { PROJECTS_DIR } from '../../lib/config.ts';

type BroadcastFn = (data: any) => void;

// Ignore noisy paths
const IGNORED = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/*.db',
  '**/*.db-journal',
  '**/nexus.json',
  '**/.next/**',
  '**/__pycache__/**',
  '**/*.pyc',
];

export function startFileWatcher(store: NexusStore, broadcast: BroadcastFn) {
  const watcher = watch(PROJECTS_DIR, {
    ignored: IGNORED,
    persistent: true,
    ignoreInitial: true,
    depth: 4,                // don't go too deep
    awaitWriteFinish: {      // debounce rapid saves
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  // Debounce: batch changes within 1s window
  let pending: { type: string; project: string; file: string; path: string }[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function queueChange(type: string, filePath: string) {
    const rel = relative(PROJECTS_DIR, filePath).replace(/\\/g, '/');
    const project = rel.split('/')[0];
    const file = rel.split('/').slice(1).join('/');

    pending.push({ type, project, file, path: rel });

    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => flush(), 1000);
  }

  function flush() {
    if (pending.length === 0) return;

    // Group by project
    const byProject: Record<string, typeof pending> = {};
    for (const c of pending) {
      if (!byProject[c.project]) byProject[c.project] = [];
      byProject[c.project].push(c);
    }

    for (const [project, changes] of Object.entries(byProject)) {
      const fileCount = changes.length;
      const types = [...new Set(changes.map(c => c.type))];
      const typeLabel = types.length === 1 ? types[0] : 'changed';

      let message: string;
      if (fileCount === 1) {
        message = `Terrain shift -- [${project}] ${changes[0].file} ${changes[0].type}`;
      } else {
        message = `Terrain shift -- [${project}] ${fileCount} files ${typeLabel}`;
      }

      const entry = store.addActivity('file_change', message, { changes });
      broadcast({ type: 'activity', payload: entry });
    }

    pending = [];
  }

  watcher
    .on('add', (p: string) => queueChange('added', p))
    .on('change', (p: string) => queueChange('modified', p))
    .on('unlink', (p: string) => queueChange('removed', p))
    .on('addDir', (p: string) => {
      // Only log new top-level project dirs
      const rel = relative(PROJECTS_DIR, p).replace(/\\/g, '/');
      if (!rel.includes('/')) {
        const entry = store.addActivity('file_change', `New territory surveyed -- ${rel}`);
        broadcast({ type: 'activity', payload: entry });
      }
    });

  console.log('  ◈ File watcher active. Monitoring terrain shifts...');
  return watcher;
}
