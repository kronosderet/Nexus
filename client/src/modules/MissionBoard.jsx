import { useState, useEffect, useRef } from 'react';
import { api } from '../hooks/useApi.js';
import { Compass, Plus, Trash2, GripVertical } from 'lucide-react';

const COLUMNS = [
  { key: 'backlog', label: 'Backlog', color: 'border-nexus-text-faint' },
  { key: 'in_progress', label: 'In Progress', color: 'border-nexus-amber' },
  { key: 'review', label: 'Review', color: 'border-nexus-blue' },
  { key: 'done', label: 'Done', color: 'border-nexus-green' },
];

function TaskCard({ task, onUpdate, onDelete, onDragStart }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(task.id));
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(task.id);
      }}
      className="bg-nexus-surface border border-nexus-border rounded-lg p-3 hover:border-nexus-border-bright transition-colors group cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <GripVertical size={12} className="text-nexus-text-faint opacity-0 group-hover:opacity-50 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-nexus-text truncate">{task.title}</p>
          {task.description && (
            <p className="text-xs text-nexus-text-faint mt-1 line-clamp-2">{task.description}</p>
          )}
        </div>
        <button
          onClick={() => onDelete(task.id)}
          className="opacity-0 group-hover:opacity-100 p-1 text-nexus-text-faint hover:text-nexus-red transition-all"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {/* Quick status dots */}
      <div className="flex gap-1 mt-2 ml-5">
        {COLUMNS.map((col) => (
          <button
            key={col.key}
            onClick={() => task.status !== col.key && onUpdate(task.id, { status: col.key })}
            className={`w-2 h-2 rounded-full transition-all ${
              task.status === col.key
                ? `${col.color.replace('border', 'bg')} scale-125`
                : 'bg-nexus-border hover:bg-nexus-border-bright'
            }`}
            title={col.label}
          />
        ))}
      </div>
    </div>
  );
}

function DropZone({ status, children, onDrop, isDragging }) {
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); }}
      onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const taskId = parseInt(e.dataTransfer.getData('text/plain'));
        if (taskId) onDrop(taskId, status);
      }}
      className={`min-h-[200px] rounded-lg transition-colors ${
        over ? 'bg-nexus-amber/5 ring-1 ring-nexus-amber/20' : ''
      } ${isDragging ? 'ring-1 ring-nexus-border ring-dashed' : ''}`}
    >
      {children}
    </div>
  );
}

export default function MissionBoard({ ws }) {
  const [tasks, setTasks] = useState([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [addingTo, setAddingTo] = useState(null);
  const [draggingId, setDraggingId] = useState(null);

  async function fetchTasks() {
    try {
      const data = await api.getTasks();
      setTasks(data);
    } catch {}
  }

  useEffect(() => { fetchTasks(); }, []);

  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => {
      if (msg.type === 'task_update') {
        setTasks((prev) => {
          const idx = prev.findIndex((t) => t.id === msg.payload.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = msg.payload;
            return next;
          }
          return [...prev, msg.payload];
        });
      }
      if (msg.type === 'task_deleted') {
        setTasks((prev) => prev.filter((t) => t.id !== msg.payload.id));
      }
    });
  }, [ws]);

  // Clear drag state when drag ends anywhere
  useEffect(() => {
    const clear = () => setDraggingId(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  async function handleAdd(status) {
    if (!newTaskTitle.trim()) return;
    await api.createTask({ title: newTaskTitle.trim(), status });
    setNewTaskTitle('');
    setAddingTo(null);
    fetchTasks();
  }

  async function handleUpdate(id, updates) {
    await api.updateTask(id, updates);
  }

  async function handleDelete(id) {
    await api.deleteTask(id);
  }

  async function handleDrop(taskId, newStatus) {
    // Optimistic update
    setTasks((prev) => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    await api.updateTask(taskId, { status: newStatus });
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <Compass size={18} className="text-nexus-amber" />
          Mission Board
        </h2>
        <p className="text-xs font-mono text-nexus-text-faint mt-1">
          {tasks.length === 0
            ? 'Calm waters. No active missions. Plot a course?'
            : `${tasks.filter(t => t.status !== 'done').length} active bearings plotted. Drag to replot.`}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.key);
          return (
            <DropZone
              key={col.key}
              status={col.key}
              onDrop={handleDrop}
              isDragging={draggingId !== null}
            >
              {/* Column header */}
              <div className={`border-t-2 ${col.color} pt-2 mb-3`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">
                    {col.label}
                  </span>
                  <span className="text-xs font-mono text-nexus-text-faint">{colTasks.length}</span>
                </div>
              </div>

              {/* Cards */}
              <div className="space-y-2">
                {colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                    onDragStart={setDraggingId}
                  />
                ))}
              </div>

              {/* Add task */}
              {addingTo === col.key ? (
                <div className="mt-2">
                  <input
                    autoFocus
                    className="w-full bg-nexus-bg border border-nexus-border rounded-lg px-3 py-2 text-sm text-nexus-text placeholder:text-nexus-text-faint focus:border-nexus-amber focus:outline-none"
                    placeholder="New bearing..."
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAdd(col.key);
                      if (e.key === 'Escape') { setAddingTo(null); setNewTaskTitle(''); }
                    }}
                    onBlur={() => { if (!newTaskTitle.trim()) setAddingTo(null); }}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setAddingTo(col.key)}
                  className="mt-2 w-full flex items-center justify-center gap-1 py-2 text-xs text-nexus-text-faint hover:text-nexus-amber border border-dashed border-nexus-border hover:border-nexus-amber/30 rounded-lg transition-colors"
                >
                  <Plus size={12} />
                  Plot
                </button>
              )}
            </DropZone>
          );
        })}
      </div>
    </div>
  );
}
