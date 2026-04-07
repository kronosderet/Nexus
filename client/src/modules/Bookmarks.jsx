import { useState, useEffect, useRef } from 'react';
import { Bookmark, Plus, Trash2, ExternalLink } from 'lucide-react';

const SEED_BOOKMARKS = [
  { title: 'GitHub Nexus', url: 'https://github.com/kronosderet/Nexus', category: 'repos' },
  { title: 'LM Studio', url: 'http://localhost:1234', category: 'tools' },
  { title: 'Nexus Dashboard', url: 'http://localhost:5173', category: 'tools' },
  { title: 'Claude API Docs', url: 'https://docs.claude.com', category: 'docs' },
  { title: 'Vite Docs', url: 'https://vite.dev', category: 'docs' },
];

export default function BookmarksModule() {
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', url: '', category: '' });
  const [hoveredId, setHoveredId] = useState(null);
  const seedingRef = useRef(false);

  async function fetchBookmarks() {
    setLoading(true);
    try {
      const res = await fetch('/api/bookmarks');
      const data = await res.json();
      if (Array.isArray(data) && data.length === 0 && !seedingRef.current) {
        // Seed defaults on first load (guarded against StrictMode double-mount)
        seedingRef.current = true;
        const created = [];
        for (const seed of SEED_BOOKMARKS) {
          const r = await fetch('/api/bookmarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(seed),
          });
          if (r.ok) created.push(await r.json());
        }
        setBookmarks(created);
      } else {
        setBookmarks(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch bookmarks', err);
      setBookmarks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchBookmarks(); }, []);

  async function handleCreate(e) {
    e?.preventDefault?.();
    if (!form.title.trim() || !form.url.trim()) return;
    const body = {
      title: form.title.trim(),
      url: form.url.trim(),
      category: form.category.trim() || 'general',
    };
    const res = await fetch('/api/bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const created = await res.json();
      setBookmarks((prev) => [created, ...prev]);
      setForm({ title: '', url: '', category: '' });
      setShowForm(false);
    }
  }

  async function handleDelete(id) {
    const res = await fetch(`/api/bookmarks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
    }
  }

  // Group bookmarks by category
  const grouped = bookmarks.reduce((acc, b) => {
    const key = b.category || 'general';
    if (!acc[key]) acc[key] = [];
    acc[key].push(b);
    return acc;
  }, {});
  const categories = Object.keys(grouped).sort();

  if (loading) {
    return (
      <div className="flex items-center gap-3 justify-center h-64">
        <div className="text-2xl animate-compass text-nexus-amber">◈</div>
        <span className="font-mono text-sm text-nexus-text-dim">Loading bookmarks...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
            <Bookmark size={18} className="text-nexus-amber" />
            Bookmarks
          </h2>
          <p className="text-xs font-mono text-nexus-text-faint mt-1">
            {bookmarks.length} link{bookmarks.length === 1 ? '' : 's'} across {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20 hover:bg-nexus-amber/20 transition-colors"
        >
          <Plus size={12} /> Add bookmark
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 bg-nexus-surface border border-nexus-border rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-3"
        >
          <input
            autoFocus
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Title"
            className="bg-nexus-bg border border-nexus-border rounded-lg px-3 py-2 text-sm text-nexus-text font-mono focus:border-nexus-amber focus:outline-none"
          />
          <input
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="https://..."
            className="bg-nexus-bg border border-nexus-border rounded-lg px-3 py-2 text-sm text-nexus-text font-mono focus:border-nexus-amber focus:outline-none"
          />
          <div className="flex gap-2">
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="Category"
              className="flex-1 bg-nexus-bg border border-nexus-border rounded-lg px-3 py-2 text-sm text-nexus-text font-mono focus:border-nexus-amber focus:outline-none"
            />
            <button
              type="submit"
              className="px-3 py-2 rounded-lg bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20 text-xs font-mono hover:bg-nexus-amber/20 transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      )}

      {/* Empty state */}
      {bookmarks.length === 0 && (
        <div className="text-center py-16 bg-nexus-surface border border-nexus-border rounded-xl">
          <Bookmark size={32} className="mx-auto text-nexus-text-faint mb-3" />
          <p className="text-sm font-mono text-nexus-text-dim">No bookmarks yet. Add your first one.</p>
        </div>
      )}

      {/* Grouped bookmark list */}
      {categories.map((cat) => (
        <div key={cat} className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-nexus-purple/10 text-nexus-purple border border-nexus-purple/20">
              {cat}
            </span>
            <span className="text-[10px] font-mono text-nexus-text-faint">
              {grouped[cat].length} link{grouped[cat].length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="space-y-1">
            {grouped[cat].map((b) => (
              <div
                key={b.id}
                onMouseEnter={() => setHoveredId(b.id)}
                onMouseLeave={() => setHoveredId(null)}
                className="group flex items-center gap-3 px-3 py-2 rounded-lg bg-nexus-surface border border-nexus-border hover:border-nexus-border-bright transition-colors"
              >
                <a
                  href={b.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center gap-2 min-w-0"
                >
                  <ExternalLink size={12} className="text-nexus-amber shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-nexus-text truncate group-hover:text-nexus-amber transition-colors">
                      {b.title}
                    </div>
                    <div className="text-[10px] font-mono text-nexus-text-faint truncate">
                      {b.url}
                    </div>
                  </div>
                </a>
                <button
                  onClick={() => handleDelete(b.id)}
                  className={`p-1.5 rounded-md text-nexus-text-faint hover:text-nexus-red hover:bg-nexus-red/10 transition-all ${
                    hoveredId === b.id ? 'opacity-100' : 'opacity-0'
                  }`}
                  title="Delete bookmark"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
