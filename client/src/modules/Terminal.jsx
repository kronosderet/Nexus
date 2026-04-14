import { useState, useEffect, useRef } from 'react';
import { Terminal as TermIcon, X, Send, Maximize2, Minimize2 } from 'lucide-react';

export default function TerminalModule() {
  const [output, setOutput] = useState([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const wsRef = useRef(null);
  const outputRef = useRef(null);
  const lineId = useRef(0);
  const inputRef = useRef(null);

  useEffect(() => {
    // Terminal WebSocket only available on dev server, not dashboard
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try {
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal`);
      wsRef.current = ws;
    } catch {
      setOutput([{ id: ++lineId.current, type: 'system', text: '◈ Terminal not available in dashboard mode. Use Claude Code terminal instead.' }]);
      return;
    }

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      if (output.length === 0) {
        setOutput([{ id: ++lineId.current, type: 'system', text: '◈ Terminal not available in dashboard mode. Use Claude Code terminal instead.' }]);
      }
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'terminal_output') {
          setOutput(prev => {
            const next = [...prev, { id: ++lineId.current, type: 'output', text: msg.data }];
            // Keep buffer bounded
            return next.length > 500 ? next.slice(-400) : next;
          });
        }
        if (msg.type === 'terminal_ready') {
          setOutput([{ id: ++lineId.current, type: 'system', text: `◈ Nexus Terminal — ${msg.cwd}` }]);
        }
        if (msg.type === 'terminal_exit') {
          setOutput(prev => [...prev, { id: ++lineId.current, type: 'system', text: `--- Shell exited (code ${msg.code}) ---` }]);
        }
      } catch {}
    };

    return () => ws.close();
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  function send(text) {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'terminal_input', data: text + '\n' }));
      setOutput(prev => [...prev, { id: ++lineId.current, type: 'input', text: `> ${text}` }]);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim()) return;
    send(input);
    setInput('');
  }

  // Quick command buttons
  const quickCmds = [
    { label: 'nexus brief', cmd: 'nexus brief' },
    { label: 'nexus tasks', cmd: 'nexus tasks' },
    { label: 'nexus overseer risks', cmd: 'nexus overseer risks' },
    { label: 'nexus gpu', cmd: 'nexus gpu' },
    { label: 'nexus repos', cmd: 'nexus repos' },
    { label: 'nexus budget', cmd: 'nexus budget' },
  ];

  return (
    <div className={`flex flex-col ${fullscreen ? 'fixed inset-0 z-40 bg-nexus-bg p-4' : 'h-[calc(100vh-3rem)]'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
            <TermIcon size={18} className="text-nexus-amber" />
            Terminal
          </h2>
          <p className="text-xs font-mono text-nexus-text-faint mt-0.5">
            {connected ? 'Bridge console active. PowerShell connected.' : 'Connecting to bridge...'}
          </p>
        </div>
        <button
          onClick={() => setFullscreen(!fullscreen)}
          className="p-1.5 text-nexus-text-faint hover:text-nexus-amber transition-colors"
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* Quick commands */}
      <div className="flex gap-1 mb-2 flex-wrap">
        {quickCmds.map((q) => (
          <button
            key={q.cmd}
            onClick={() => send(q.cmd)}
            className="px-2 py-1 text-[10px] font-mono text-nexus-text-faint border border-nexus-border rounded hover:border-nexus-amber/30 hover:text-nexus-amber transition-colors"
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* Output */}
      <div
        ref={outputRef}
        className="flex-1 bg-nexus-bg border border-nexus-border rounded-t-lg p-3 overflow-auto font-mono text-xs leading-relaxed"
        onClick={() => inputRef.current?.focus()}
      >
        {output.map((line) => (
          <div key={line.id} className={
            line.type === 'system' ? 'text-nexus-amber' :
            line.type === 'input' ? 'text-nexus-green' :
            'text-nexus-text-dim'
          }>
            <pre className="whitespace-pre-wrap break-all">{line.text}</pre>
          </div>
        ))}
        {output.length === 0 && (
          <div className="text-nexus-text-faint">
            ◈ Awaiting commands, Captain...
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex">
        <div className="flex items-center bg-nexus-surface border border-t-0 border-nexus-border rounded-b-lg w-full">
          <span className="text-nexus-amber font-mono text-xs pl-3 shrink-0">◈ &gt;</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-transparent px-2 py-2.5 font-mono text-xs text-nexus-text focus:outline-none"
            placeholder="Type a command..."
            autoFocus
            spellCheck={false}
          />
          <button
            type="submit"
            className="px-3 py-2 text-nexus-text-faint hover:text-nexus-amber transition-colors"
          >
            <Send size={12} />
          </button>
        </div>
      </form>
    </div>
  );
}
