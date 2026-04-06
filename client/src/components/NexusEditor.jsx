import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput, HighlightStyle } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { tags } from '@lezer/highlight';

// Nexus dark theme -- nautical charts under warm lamplight
const nexusTheme = EditorView.theme({
  '&': {
    backgroundColor: '#0a0e1a',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
    height: '100%',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
  '.cm-content': {
    caretColor: '#f59e0b',
    padding: '8px 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#f59e0b',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: '#f59e0b20',
  },
  '.cm-gutters': {
    backgroundColor: '#0a0e1a',
    color: '#64748b',
    border: 'none',
    paddingRight: '8px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: '#f59e0b',
  },
  '.cm-activeLine': {
    backgroundColor: '#111827',
  },
  '.cm-matchingBracket': {
    backgroundColor: '#f59e0b30',
    outline: '1px solid #f59e0b50',
  },
  '.cm-selectionMatch': {
    backgroundColor: '#3b82f620',
  },
  '.cm-line': {
    padding: '0 8px',
  },
}, { dark: true });

const nexusHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#a855f7' },
  { tag: tags.operator, color: '#94a3b8' },
  { tag: tags.special(tags.variableName), color: '#f59e0b' },
  { tag: tags.typeName, color: '#22c55e' },
  { tag: tags.atom, color: '#22c55e' },
  { tag: tags.number, color: '#f59e0b' },
  { tag: tags.definition(tags.variableName), color: '#3b82f6' },
  { tag: tags.string, color: '#22c55e' },
  { tag: tags.special(tags.string), color: '#22c55e' },
  { tag: tags.comment, color: '#64748b', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#e2e8f0' },
  { tag: tags.bracket, color: '#94a3b8' },
  { tag: tags.tagName, color: '#ef4444' },
  { tag: tags.attributeName, color: '#f59e0b' },
  { tag: tags.attributeValue, color: '#22c55e' },
  { tag: tags.heading, color: '#f59e0b', fontWeight: 'bold' },
  { tag: tags.link, color: '#3b82f6', textDecoration: 'underline' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.processingInstruction, color: '#a855f7' },
  { tag: tags.punctuation, color: '#94a3b8' },
  { tag: tags.function(tags.variableName), color: '#3b82f6' },
  { tag: tags.propertyName, color: '#e2e8f0' },
  { tag: tags.bool, color: '#f59e0b' },
  { tag: tags.null, color: '#ef4444' },
]);

const LANG_MAP = {
  javascript: javascript,
  json: json,
  python: python,
  html: html,
  css: css,
  markdown: markdown,
};

export default function NexusEditor({ value, onChange, language = 'markdown', className = '' }) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Build language extension
  const langFn = LANG_MAP[language] || markdown;

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: value || '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        rectangularSelection(),
        indentOnInput(),
        bracketMatching(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        langFn(),
        nexusTheme,
        syntaxHighlighting(nexusHighlight),
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => view.destroy();
  }, [language]); // recreate on language change

  // Sync external value changes (e.g., switching tabs)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value || '' },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={`border border-nexus-border rounded-lg overflow-hidden min-h-0 ${className}`}
      style={{ display: 'flex', flexDirection: 'column' }}
    />
  );
}
