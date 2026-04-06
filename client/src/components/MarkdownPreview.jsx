import { useMemo } from 'react';

// Lightweight markdown-to-HTML (no deps, handles common cases)
function renderMarkdown(src) {
  if (!src) return '';
  let html = src
    // Code blocks (```lang ... ```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="md-code-block"><code>${escHtml(code.trim())}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
    // Headers
    .replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link" target="_blank">$1</a>')
    // Unordered lists
    .replace(/^[-*] (.+)$/gm, '<li class="md-li">$1</li>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote class="md-blockquote">$1</blockquote>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr class="md-hr" />')
    // Line breaks -> paragraphs
    .replace(/\n\n/g, '</p><p class="md-p">')
    .replace(/\n/g, '<br/>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li class="md-li">.*?<\/li>\s*)+)/g, '<ul class="md-ul">$1</ul>');

  return `<p class="md-p">${html}</p>`;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function MarkdownPreview({ content }) {
  const html = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div
      className="md-preview prose-nexus p-4 overflow-auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
