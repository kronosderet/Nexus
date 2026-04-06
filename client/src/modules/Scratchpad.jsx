import { useState, useEffect, useRef } from 'react';
import { api } from '../hooks/useApi.js';
import { PenTool, Plus, Save, FileText, ChevronDown, Eye, EyeOff, BookMarked, Copy, Trash2 } from 'lucide-react';
import NexusEditor from '../components/NexusEditor.jsx';
import MarkdownPreview from '../components/MarkdownPreview.jsx';

const LANGUAGES = [
  { key: 'markdown', label: 'Markdown' },
  { key: 'javascript', label: 'JavaScript' },
  { key: 'python', label: 'Python' },
  { key: 'json', label: 'JSON' },
  { key: 'html', label: 'HTML' },
  { key: 'css', label: 'CSS' },
];

export default function Scratchpad() {
  const [pads, setPads] = useState([]);
  const [activePad, setActivePad] = useState(null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newName, setNewName] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const [snippets, setSnippets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nexus-snippets') || '[]'); } catch { return []; }
  });
  const saveTimerRef = useRef(null);

  function saveSnippet() {
    const selection = window.getSelection()?.toString();
    const text = selection || content;
    if (!text.trim()) return;
    const name = prompt('Snippet name:');
    if (!name) return;
    const next = [...snippets, { id: Date.now(), name, content: text.slice(0, 2000), language: currentLang }];
    setSnippets(next);
    localStorage.setItem('nexus-snippets', JSON.stringify(next));
  }

  function insertSnippet(snippet) {
    setContent(content + '\n' + snippet.content);
    handleContentChange(content + '\n' + snippet.content);
    setShowSnippets(false);
  }

  function deleteSnippet(id) {
    const next = snippets.filter(s => s.id !== id);
    setSnippets(next);
    localStorage.setItem('nexus-snippets', JSON.stringify(next));
  }

  async function fetchPads() {
    const data = await api.getScratchpads();
    setPads(data);
    if (data.length > 0 && !activePad) {
      setActivePad(data[0]);
      setContent(data[0].content);
    }
  }

  useEffect(() => { fetchPads(); }, []);

  function handleContentChange(val) {
    setContent(val);
    setSaved(false);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (activePad) {
        setSaving(true);
        await api.updateScratchpad(activePad.id, { content: val });
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    }, 1000);
  }

  async function handleSave() {
    if (!activePad) return;
    clearTimeout(saveTimerRef.current);
    setSaving(true);
    await api.updateScratchpad(activePad.id, { content });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    const pad = await api.createScratchpad({ name: newName.trim() });
    setPads((prev) => [pad, ...prev]);
    setActivePad(pad);
    setContent(pad.content);
    setNewName('');
    setShowNew(false);
  }

  async function handleLanguageChange(lang) {
    setShowLangPicker(false);
    if (!activePad) return;
    const updated = await api.updateScratchpad(activePad.id, { language: lang });
    setActivePad(updated);
    setPads((prev) => prev.map(p => p.id === updated.id ? updated : p));
  }

  function selectPad(pad) {
    // Save current before switching
    if (activePad && content !== activePad.content) {
      api.updateScratchpad(activePad.id, { content });
    }
    setActivePad(pad);
    setContent(pad.content);
  }

  const currentLang = activePad?.language || 'markdown';

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <PenTool size={18} className="text-nexus-amber" />
          Scratchpad
        </h2>
        <p className="text-xs font-mono text-nexus-text-faint mt-1">
          {saving ? 'Marking on the map...' : saved ? 'Marked on the map.' : 'Charting notes. Auto-saves.'}
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 mb-3 border-b border-nexus-border pb-2">
        {/* Pad tabs */}
        {pads.map((pad) => (
          <button
            key={pad.id}
            onClick={() => selectPad(pad)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
              activePad?.id === pad.id
                ? 'bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20'
                : 'text-nexus-text-faint hover:text-nexus-text hover:bg-nexus-surface border border-transparent'
            }`}
          >
            <FileText size={10} />
            {pad.name}
          </button>
        ))}

        {/* New pad */}
        {showNew ? (
          <input
            autoFocus
            className="bg-nexus-bg border border-nexus-border rounded-md px-2 py-1 text-xs text-nexus-text font-mono focus:border-nexus-amber focus:outline-none w-32"
            placeholder="Name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') setShowNew(false);
            }}
            onBlur={() => { if (!newName.trim()) setShowNew(false); }}
          />
        ) : (
          <button
            onClick={() => setShowNew(true)}
            className="p-1.5 text-nexus-text-faint hover:text-nexus-amber transition-colors"
            title="New scratchpad"
          >
            <Plus size={14} />
          </button>
        )}

        <div className="flex-1" />

        {/* Language picker */}
        <div className="relative">
          <button
            onClick={() => setShowLangPicker(!showLangPicker)}
            className="flex items-center gap-1 px-2 py-1 text-xs font-mono text-nexus-text-faint hover:text-nexus-text border border-nexus-border rounded-md hover:border-nexus-border-bright transition-colors"
          >
            {LANGUAGES.find(l => l.key === currentLang)?.label || currentLang}
            <ChevronDown size={10} />
          </button>
          {showLangPicker && (
            <div className="absolute right-0 top-full mt-1 bg-nexus-surface border border-nexus-border rounded-lg shadow-xl z-10 py-1 min-w-[120px]">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.key}
                  onClick={() => handleLanguageChange(lang.key)}
                  className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors ${
                    currentLang === lang.key
                      ? 'text-nexus-amber bg-nexus-amber/10'
                      : 'text-nexus-text-dim hover:text-nexus-text hover:bg-nexus-surface-hover'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Snippets */}
        <div className="relative">
          <button
            onClick={() => setShowSnippets(!showSnippets)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-nexus-text-faint hover:text-nexus-amber transition-colors"
            title="Snippet library"
          >
            <BookMarked size={12} />
          </button>
          {showSnippets && (
            <div className="absolute right-0 top-full mt-1 bg-nexus-surface border border-nexus-border rounded-lg shadow-xl z-10 py-1 min-w-[200px] max-h-[300px] overflow-y-auto">
              <button
                onClick={saveSnippet}
                className="w-full text-left px-3 py-1.5 text-xs font-mono text-nexus-amber hover:bg-nexus-amber/10 flex items-center gap-2 border-b border-nexus-border"
              >
                <Plus size={10} /> Save selection as snippet
              </button>
              {snippets.length === 0 && (
                <div className="px-3 py-2 text-[10px] font-mono text-nexus-text-faint">No snippets yet.</div>
              )}
              {snippets.map((s) => (
                <div key={s.id} className="flex items-center gap-1 px-3 py-1.5 hover:bg-nexus-surface-hover group">
                  <button
                    onClick={() => insertSnippet(s)}
                    className="flex-1 text-left text-xs font-mono text-nexus-text-dim hover:text-nexus-text truncate"
                    title={s.content.slice(0, 100)}
                  >
                    {s.name}
                  </button>
                  <button
                    onClick={() => deleteSnippet(s.id)}
                    className="opacity-0 group-hover:opacity-100 text-nexus-text-faint hover:text-nexus-red"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview toggle (markdown only) */}
        {currentLang === 'markdown' && (
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
              showPreview ? 'text-nexus-amber' : 'text-nexus-text-faint hover:text-nexus-amber'
            }`}
            title="Toggle markdown preview"
          >
            {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        )}

        {/* Save */}
        <button
          onClick={handleSave}
          className="flex items-center gap-1 px-2 py-1 text-xs text-nexus-text-faint hover:text-nexus-amber transition-colors"
          title="Save (auto-saves after 1s)"
        >
          <Save size={12} />
        </button>
      </div>

      {/* Editor + Preview */}
      <div className={`flex-1 flex gap-3 min-h-0 ${showPreview ? '' : ''}`}>
        <NexusEditor
          value={content}
          onChange={handleContentChange}
          language={currentLang}
          className={showPreview ? 'w-1/2' : 'flex-1'}
        />
        {showPreview && (
          <div className="w-1/2 border border-nexus-border rounded-lg overflow-auto">
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>
    </div>
  );
}
