/**
 * v4.9.0 #733 — regression test for the recordTaskCompletion silent attribution
 * drop. Pre-fix: if a task closed BEFORE today's session was logged, the
 * completion was silently dropped — the function filtered sessions by today's
 * date prefix and returned if no match. Post-fix: the completion is buffered in
 * _pendingTaskCompletions and drained when the next matching session is logged.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function freshStore() {
  const { NexusStore } = await import('../server/db/store.ts');
  return new NexusStore();
}

describe('recordTaskCompletion attribution (v4.9.0 #733)', () => {
  let tmpDir: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nexus-task-comp-'));
    process.env.NEXUS_DB_PATH = join(tmpDir, 'nexus.json');
    process.env.NEXUS_DISABLE_WATCHER = '1';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...savedEnv };
  });

  it('attributes to today\'s session when one already exists', async () => {
    const store = await freshStore();
    const task = store.createTask({ title: 'first', status: 'backlog' });
    const session = store.createSession({ project: 'Nexus', summary: 'first session' });
    store.recordTaskCompletion(task.id);
    const reloaded = store.getSession(session.id);
    expect(reloaded?.completed_task_ids).toContain(task.id);
  });

  it('buffers attribution when no session today exists, then drains on next createSession', async () => {
    const store = await freshStore();
    const task = store.createTask({ title: 'closed before session log', status: 'in_progress', project: 'Nexus' });
    // Task closes BEFORE any session logged today.
    store.recordTaskCompletion(task.id);
    // Pre-fix: this completion would be lost. Post-fix: it sits in
    // _pendingTaskCompletions until logSession runs.
    const pending = (store as unknown as { data: { _pendingTaskCompletions?: Array<{ task_id: number }> } })
      .data._pendingTaskCompletions || [];
    expect(pending.map(p => p.task_id)).toContain(task.id);

    // Now log a session for the same project — drain should fire.
    const session = store.createSession({ project: 'Nexus', summary: 'late session' });
    expect(session.completed_task_ids).toContain(task.id);
    // Pending buffer should now be empty for this task.
    const stillPending = (store as unknown as { data: { _pendingTaskCompletions?: Array<{ task_id: number }> } })
      .data._pendingTaskCompletions || [];
    expect(stillPending.map(p => p.task_id)).not.toContain(task.id);
  });

  it('does NOT attribute pending completion to a different-project session', async () => {
    const store = await freshStore();
    const task = store.createTask({ title: 'foo project task', status: 'in_progress', project: 'Foo' });
    store.recordTaskCompletion(task.id);
    const session = store.createSession({ project: 'Bar', summary: 'bar session' });
    expect(session.completed_task_ids ?? []).not.toContain(task.id);
    // Still pending for next Foo session.
    const pending = (store as unknown as { data: { _pendingTaskCompletions?: Array<{ task_id: number; project: string | null }> } })
      .data._pendingTaskCompletions || [];
    expect(pending.find(p => p.task_id === task.id)?.project).toBe('Foo');
  });

  it('deduplicates repeated recordTaskCompletion calls for the same task', async () => {
    const store = await freshStore();
    const task = store.createTask({ title: 'dup test', status: 'in_progress', project: 'Nexus' });
    store.recordTaskCompletion(task.id);
    store.recordTaskCompletion(task.id);
    store.recordTaskCompletion(task.id);
    const pending = (store as unknown as { data: { _pendingTaskCompletions?: Array<{ task_id: number }> } })
      .data._pendingTaskCompletions || [];
    expect(pending.filter(p => p.task_id === task.id)).toHaveLength(1);
  });
});
