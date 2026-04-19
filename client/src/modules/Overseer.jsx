import { useState, useEffect, useCallback } from 'react';
import { api } from '../hooks/useApi.js';
import { Brain, RefreshCw, AlertTriangle, Shield, Send, Loader2, Play, CheckCircle2, XCircle, Clock } from 'lucide-react';

const RISK_ICONS = {
  critical: { color: 'text-nexus-red', bg: 'bg-nexus-red/10 border-nexus-red/20' },
  warning: { color: 'text-nexus-amber', bg: 'bg-nexus-amber/10 border-nexus-amber/20' },
  info: { color: 'text-nexus-blue', bg: 'bg-nexus-blue/10 border-nexus-blue/20' },
};

function RiskCard({ risk }) {
  const [running, setRunning] = useState(null); // which action is running
  const [result, setResult] = useState(null);
  const style = RISK_ICONS[risk.level] || RISK_ICONS.info;

  // v4.3.5 I4: useCallback so child buttons get a stable reference across re-renders.
  const executeFix = useCallback(async (action, project, param, label) => {
    setRunning(label);
    setResult(null);
    try {
      const data = await api.executeRemediate({ action, project, param });
      setResult(data);
    } catch (err) {
      setResult({ success: false, error: err.message });
    } finally {
      setRunning(null);
    }
  }, []);

  // Parse fix into remediation action
  function getActions() {
    if (!risk.fix) return [];
    const { cmd, label } = risk.fix;
    // Map fix commands to remediation API actions
    if (cmd.includes('git status')) return [{ action: 'git-status', project: extractProject(cmd), label: 'Status' }];
    if (cmd.includes('git log')) return [{ action: 'git-log', project: extractProject(cmd), label: 'Log' }];
    if (cmd.includes('nexus done')) {
      const id = cmd.match(/done (\d+)/)?.[1];
      return [{ action: 'nexus-task-done', param: id, label: 'Mark done' }];
    }
    if (cmd.includes('nexus focus')) return [{ action: 'git-status', project: extractProject(cmd), label: 'Status' }, { action: 'git-log', project: extractProject(cmd), label: 'Log' }];
    return [{ label }];
  }

  function extractProject(cmd) {
    const match = cmd.match(/Projects\/(\S+)/) || cmd.match(/focus (\S+)/);
    return match?.[1] || '';
  }

  const actions = getActions();

  return (
    <div className={`px-3 py-2 rounded-lg border ${style.bg}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={12} className={`${style.color} mt-0.5 shrink-0`} />
        <div className="min-w-0 flex-1">
          <span className={`text-[10px] font-mono uppercase ${style.color}`}>{risk.category}</span>
          <p className="text-xs text-nexus-text-dim">{risk.message}</p>
        </div>
      </div>

      {/* Action buttons */}
      {actions.length > 0 && (
        <div className="flex gap-1 mt-1.5 ml-5" role="group" aria-label={`Remediation actions for ${risk.category || 'risk'}`}>
          {actions.map((a, i) => {
            // v4.3.5 P5: rich aria-label so screen readers get full context,
            // not just the visible short action label.
            const projectPart = a.project ? ` on project ${a.project}` : '';
            const paramPart = a.param ? ` (${a.param})` : '';
            const ariaLabel = `${a.label}${projectPart}${paramPart} — remediate: ${risk.message || risk.category || ''}`;
            const isRunning = running === a.label;
            return (
              <button
                key={i}
                onClick={() => a.action && executeFix(a.action, a.project, a.param, a.label)}
                disabled={running !== null}
                aria-label={ariaLabel}
                aria-busy={isRunning}
                className="flex items-center gap-1 text-[10px] font-mono text-nexus-amber hover:text-nexus-text border border-nexus-amber/20 rounded px-1.5 py-0.5 hover:bg-nexus-amber/10 transition-colors disabled:opacity-50"
              >
                {isRunning ? <Loader2 size={8} className="animate-spin" aria-hidden="true" /> : <Play size={8} aria-hidden="true" />}
                {a.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Execution result */}
      {result && (
        <div className={`mt-1.5 ml-5 p-2 rounded text-[10px] font-mono ${result.success ? 'bg-nexus-bg border border-nexus-border' : 'bg-nexus-red/5 border border-nexus-red/20'}`}>
          <div className="flex items-center gap-1 mb-1">
            {result.success ? <CheckCircle2 size={9} className="text-nexus-green" /> : <XCircle size={9} className="text-nexus-red" />}
            <span className={result.success ? 'text-nexus-green' : 'text-nexus-red'}>
              {result.success ? 'Executed' : 'Failed'}
            </span>
          </div>
          {result.output && (
            <pre className="text-nexus-text-dim whitespace-pre-wrap max-h-24 overflow-auto">{result.output}</pre>
          )}
          {result.error && <p className="text-nexus-red">{result.error}</p>}
        </div>
      )}
    </div>
  );
}

function AutoFixPanel() {
  const [scanning, setScanning] = useState(false);
  const [fixableRisks, setFixableRisks] = useState(null);
  const [runningAll, setRunningAll] = useState(false);
  const [results, setResults] = useState([]);

  async function scanForFixes() {
    setScanning(true);
    try {
      const data = await api.getRemediateScan();
      setFixableRisks(data.risks);
    } catch {} finally {
      setScanning(false);
    }
  }

  async function runAllFixes() {
    if (!fixableRisks) return;
    setRunningAll(true);
    setResults([]);
    const allResults = [];

    for (const risk of fixableRisks) {
      for (const action of (risk.actions || [])) {
        try {
          const data = await api.executeRemediate(action);
          allResults.push({ label: action.label, ...data });
        } catch (err) {
          allResults.push({ label: action.label, success: false, error: err.message });
        }
      }
    }
    setResults(allResults);
    setRunningAll(false);
  }

  useEffect(() => { scanForFixes(); }, []);

  if (!fixableRisks || fixableRisks.length === 0) return null;

  const totalActions = fixableRisks.reduce((n, r) => n + (r.actions?.length || 0), 0);

  return (
    <div className="mt-3 pt-3 border-t border-nexus-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">
          Auto-Remediation
        </span>
        <button
          onClick={runAllFixes}
          disabled={runningAll}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20 hover:bg-nexus-amber/20 transition-colors disabled:opacity-50"
        >
          {runningAll ? <Loader2 size={9} className="animate-spin" /> : <Play size={9} />}
          Fix all ({totalActions})
        </button>
      </div>

      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px] font-mono">
              {r.success ? <CheckCircle2 size={9} className="text-nexus-green" /> : <XCircle size={9} className="text-nexus-red" />}
              <span className={r.success ? 'text-nexus-text-dim' : 'text-nexus-red'}>{r.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalysisBlock({ text }) {
  if (!text) return null;

  // Parse sections from the analysis
  const sections = [];
  const lines = text.split('\n');
  let current = null;

  for (const line of lines) {
    const headerMatch = line.match(/^(?:#{1,3}\s*)?(?:\d+\.\s*)?([A-Z][A-Z\s&]+)[:\s]*$/);
    if (headerMatch) {
      if (current) sections.push(current);
      current = { title: headerMatch[1].trim(), lines: [] };
    } else if (current) {
      if (line.trim()) current.lines.push(line);
    } else {
      // Pre-header content
      if (line.trim()) {
        if (!current) current = { title: '', lines: [] };
        current.lines.push(line);
      }
    }
  }
  if (current) sections.push(current);

  if (sections.length === 0) {
    return <p className="text-sm text-nexus-text-dim leading-relaxed whitespace-pre-wrap">{text}</p>;
  }

  return (
    <div className="space-y-4">
      {sections.map((s, i) => (
        <div key={i}>
          {s.title && (
            <h3 className="text-xs font-mono text-nexus-amber uppercase tracking-wider mb-1.5">{s.title}</h3>
          )}
          <div className="text-sm text-nexus-text-dim leading-relaxed space-y-1">
            {s.lines.map((l, j) => {
              const isBullet = l.match(/^\s*[-*•]\s/);
              return (
                <p key={j} className={isBullet ? 'pl-3' : ''}>
                  {isBullet && <span className="text-nexus-amber mr-1">›</span>}
                  {l.replace(/^\s*[-*•]\s/, '')}
                </p>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Overseer() {
  const [analysis, setAnalysis] = useState(null);
  const [risks, setRisks] = useState(null);
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [context, setContext] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [gpuInfo, setGpuInfo] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [scans, setScans] = useState([]);

  async function fetchRisks() {
    try {
      const data = await api.getOverseerRisks();
      setRisks(data.risks);
    } catch {}
  }

  async function fetchAnalysis() {
    setLoading(true);
    try {
      const data = await api.getOverseer();
      if (data.error) { setAnalysis(typeof data.error === 'string' ? data.error : data.error.message || JSON.stringify(data.error)); }
      else {
        setAnalysis(data.analysis);
        setContext(data.context);
      }
    } catch (err) {
      setAnalysis(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // v4.4.1 #342 — dedup recent Ask questions. User-facing problem: same question fired
  // back-to-back generates redundant LLM runs (observed 4× in a row in the audit). Soft-block
  // on identical text within 30min; show an inline recency warning + "Send anyway" to override.
  const DEDUP_WINDOW_MIN = 30;
  const [dedupWarning, setDedupWarning] = useState(null); // { text, minutesAgo, forceNext }
  function findRecentMatch(q) {
    const now = Date.now();
    const normalized = q.toLowerCase().replace(/\s+/g, ' ').trim();
    // walk history backwards to find a matching user turn
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const entry = chatHistory[i];
      if (entry.role !== 'user') continue;
      const entryNormalized = (entry.text || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (entryNormalized === normalized) {
        const minutesAgo = Math.floor((now - new Date(entry.time).getTime()) / 60000);
        if (minutesAgo < DEDUP_WINDOW_MIN) return { minutesAgo, entry };
      }
    }
    return null;
  }

  async function askOverseer(opts = {}) {
    if (!question.trim()) return;
    const q = question.trim();

    // Dedup check unless force-next flag is set
    if (!opts.force) {
      const match = findRecentMatch(q);
      if (match) {
        setDedupWarning({ text: q, minutesAgo: match.minutesAgo });
        return;
      }
    }
    setDedupWarning(null);

    setAsking(true);
    setQuestion('');
    // Add question to history immediately
    setChatHistory(prev => [...prev, { role: 'user', text: q, time: new Date().toISOString() }]);
    try {
      const data = await api.askOverseer({ question: q });
      const answer = data.answer || data.error || 'No response';
      setChatHistory(prev => [...prev, { role: 'overseer', text: answer, time: new Date().toISOString(), adviceId: data.adviceId }]);
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'overseer', text: `Error: ${err.message}`, time: new Date().toISOString() }]);
    } finally {
      setAsking(false);
    }
  }

  useEffect(() => {
    fetchRisks();
    api.getOverseerStatus().then(setAiStatus).catch(() => {});
    api.getGpuDetail().then(setGpuInfo).catch(() => {});
    api.getScheduledScans(null, 10).then(setScans).catch(() => {});
    // Load previous Q&A from advice journal
    api.getAdvice({ source: 'ask', limit: 20 }).then(entries => {
      const history = [];
      for (const e of (entries || []).reverse()) {
        if (e.question) history.push({ role: 'user', text: e.question, time: e.created_at });
        if (e.recommendation) history.push({ role: 'overseer', text: e.recommendation, time: e.created_at, adviceId: e.id, outcome: e.outcome });
      }
      if (history.length > 0) setChatHistory(history);
    }).catch(() => {});
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <Brain size={18} className="text-nexus-amber" />
          Overseer
        </h2>
        <p className="text-xs font-mono text-nexus-text-faint mt-1">
          {aiStatus?.available
            ? `${aiStatus.model || 'Unknown model'} via ${aiStatus.provider || 'local AI'}${gpuInfo?.name ? ` on ${gpuInfo.name}` : ''}`
            : 'No local AI detected. Start LM Studio or Ollama.'}
          {gpuInfo?.vram && aiStatus?.available && (
            <span className="ml-2 text-nexus-text-faint/60">
              ({gpuInfo.vram.used != null ? `${Math.round(gpuInfo.vram.used / 1024 * 10) / 10}/${Math.round(gpuInfo.vram.total / 1024 * 10) / 10} GB VRAM` : ''})
            </span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main analysis panel */}
        <div className="lg:col-span-2 space-y-4">
          {/* Analysis */}
          <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Brain size={14} className="text-nexus-amber" />
                <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Strategic Analysis</span>
              </div>
              <button
                onClick={fetchAnalysis}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-lg border border-nexus-border hover:border-nexus-amber/30 hover:text-nexus-amber text-nexus-text-dim transition-colors disabled:opacity-50"
                // v4.4.2 #346 — hover tooltip previews cost + scope so users know what
                // clicking this costs (local AI runs; no Anthropic fuel, but ~1 GB VRAM
                // spike for 20-40s while the model generates).
                title="Runs the Overseer on full fleet state: all projects, tasks, sessions, decisions, git. ~20-40s, ~1 GB VRAM spike on local AI. No Anthropic fuel."
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {loading ? 'Analyzing…' : 'Analyze Fleet'}
              </button>
            </div>

            {!analysis && !loading && (
              <div className="text-center py-8">
                <Brain size={32} className="mx-auto text-nexus-text-faint mb-3 opacity-30" />
                <p className="text-sm text-nexus-text-faint">Click "Analyze Fleet" to get strategic guidance.</p>
                <p className="text-xs text-nexus-text-faint mt-1">The Overseer examines all projects, tasks, sessions, and git state.</p>
                {/* v4.4.2 #346 — explicit cost disclosure so users see what the click triggers. */}
                <p className="text-[10px] font-mono text-nexus-text-faint mt-3">
                  ~20–40s · ~1 GB VRAM spike on local AI · no Anthropic fuel
                </p>
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center py-8 gap-3">
                <div className="text-2xl animate-compass text-nexus-amber">◈</div>
                <span className="font-mono text-sm text-nexus-text-dim">The Overseer is thinking...</span>
              </div>
            )}

            {analysis && !loading && (
              <AnalysisBlock text={analysis} />
            )}

            {context && !loading && (
              <div className="mt-4 pt-3 border-t border-nexus-border flex gap-4 text-[10px] font-mono text-nexus-text-faint">
                <span>{context.openTasks} open tasks</span>
                <span>{context.repos} repos</span>
                <span>{context.sessions} sessions</span>
                {gpuInfo?.utilization != null && (
                  <span className="ml-auto">GPU {gpuInfo.utilization.gpu}% | {gpuInfo.temperature}°C</span>
                )}
              </div>
            )}
          </div>

          {/* Ask the Overseer — Chat interface */}
          <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Send size={14} className="text-nexus-amber" />
              <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Ask the Overseer</span>
              {chatHistory.length > 0 && (
                <span className="text-[9px] font-mono text-nexus-text-faint ml-auto">{Math.floor(chatHistory.filter(m => m.role === 'user').length)} questions asked</span>
              )}
            </div>

            {/* Chat history */}
            {chatHistory.length > 0 && (
              <div className="mb-3 max-h-80 overflow-y-auto space-y-2 pr-1">
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`p-2.5 rounded-lg ${
                    msg.role === 'user'
                      ? 'bg-nexus-amber/5 border border-nexus-amber/10 ml-8'
                      : 'bg-nexus-bg border border-nexus-border mr-4'
                  }`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-[9px] font-mono ${msg.role === 'user' ? 'text-nexus-amber' : 'text-nexus-text-faint'}`}>
                        {msg.role === 'user' ? 'You' : '◈ Overseer'}
                      </span>
                      {msg.outcome && (
                        <span className={`text-[8px] font-mono px-1 rounded ${
                          msg.outcome === 'worked' ? 'bg-nexus-green/10 text-nexus-green' :
                          msg.outcome === 'partial' ? 'bg-nexus-amber/10 text-nexus-amber' :
                          'bg-nexus-red/10 text-nexus-red'
                        }`}>{msg.outcome}</span>
                      )}
                      {/* v4.4.2 #345 — smart timestamp: "HH:MM" for today, "Nd · HH:MM"
                          for recent days, full date for older. Audit flagged that just
                          "22:52" was ambiguous across days. */}
                      <span className="text-[8px] font-mono text-nexus-text-faint ml-auto" title={new Date(msg.time).toLocaleString('cs-CZ')}>
                        {(() => {
                          const d = new Date(msg.time);
                          const now = new Date();
                          const timeStr = d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
                          if (d.toDateString() === now.toDateString()) return timeStr;
                          const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
                          if (d.toDateString() === yesterday.toDateString()) return `yest · ${timeStr}`;
                          const daysAgo = Math.floor((now.getTime() - d.getTime()) / 86400000);
                          if (daysAgo < 7) return `${daysAgo}d · ${timeStr}`;
                          return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }) + ' ' + timeStr;
                        })()}
                      </span>
                    </div>
                    {msg.role === 'user' ? (
                      <p className="text-xs text-nexus-text">{msg.text}</p>
                    ) : (
                      <AnalysisBlock text={msg.text} />
                    )}
                  </div>
                ))}
                {asking && (
                  <div className="p-2.5 rounded-lg bg-nexus-bg border border-nexus-border mr-4">
                    <div className="flex items-center gap-2">
                      <Loader2 size={12} className="animate-spin text-nexus-amber" />
                      <span className="text-xs font-mono text-nexus-text-faint">Overseer is thinking...</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* v4.4.1 #342 — dedup inline warning. Shown when the current question was
                asked identically in the last 30 min. User can override with "Send anyway". */}
            {dedupWarning && (
              <div className="mb-2 px-3 py-2 rounded-lg bg-nexus-amber/5 border border-nexus-amber/30 flex items-start gap-2">
                <AlertTriangle size={12} className="text-nexus-amber mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-nexus-text">
                    You asked this {dedupWarning.minutesAgo === 0 ? 'just now' : `${dedupWarning.minutesAgo} min ago`}.
                  </p>
                  <p className="text-[10px] font-mono text-nexus-text-faint">
                    Scroll up to see the previous answer, or re-send to generate a fresh one.
                  </p>
                </div>
                <button
                  onClick={() => { setDedupWarning(null); askOverseer({ force: true }); }}
                  className="text-[10px] font-mono text-nexus-amber hover:text-nexus-amber/80 px-2 py-0.5 rounded border border-nexus-amber/30 hover:bg-nexus-amber/10 shrink-0"
                >
                  Send anyway
                </button>
                <button
                  onClick={() => setDedupWarning(null)}
                  className="text-[10px] font-mono text-nexus-text-faint hover:text-nexus-text px-1 shrink-0"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Input */}
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !asking && askOverseer()}
                maxLength={5000}
                placeholder="What should I prioritize? / Is Firewall at risk? / ..."
                className="flex-1 bg-nexus-bg border border-nexus-border rounded-lg px-3 py-2 text-sm text-nexus-text placeholder:text-nexus-text-faint focus:border-nexus-amber focus:outline-none"
              />
              <button
                onClick={() => askOverseer()}
                disabled={asking || !question.trim()}
                className="px-4 py-2 rounded-lg bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20 text-xs font-mono hover:bg-nexus-amber/20 transition-colors disabled:opacity-50"
              >
                {asking ? <Loader2 size={14} className="animate-spin" /> : 'Ask'}
              </button>
            </div>
          </div>
        </div>

        {/* Risk sidebar */}
        <div>
          <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={14} className="text-nexus-amber" />
              <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Risk Scanner</span>
            </div>

            {risks === null && (
              <p className="text-xs text-nexus-text-faint">Loading...</p>
            )}
            {risks && risks.length === 0 && (
              <div className="text-center py-4">
                <Shield size={20} className="mx-auto text-nexus-green mb-2" />
                <p className="text-xs font-mono text-nexus-green">All clear. No risks detected.</p>
              </div>
            )}
            {risks && risks.length > 0 && (
              <div className="space-y-2">
                {risks.map((r, i) => <RiskCard key={i} risk={r} />)}

                {/* Scan for actionable risks via remediation API */}
                <AutoFixPanel />
              </div>
            )}
          </div>

          {/* Scheduled Scans History */}
          {scans.length > 0 && (
            <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5 mt-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock size={14} className="text-nexus-amber" />
                <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Automated Scans</span>
              </div>
              <div className="space-y-2">
                {scans.map((s, i) => (
                  <div key={i} className="px-2.5 py-2 rounded-lg bg-nexus-bg border border-nexus-border">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                        s.type === 'risk' ? 'bg-nexus-red/10 text-nexus-red border border-nexus-red/20'
                        : 'bg-nexus-blue/10 text-nexus-blue border border-nexus-blue/20'
                      }`}>{s.type === 'risk' ? 'RISK SCAN' : 'DIGEST'}</span>
                      <span className="text-[9px] font-mono text-nexus-text-faint ml-auto">
                        {new Date(s.timestamp).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {s.type === 'risk' && s.result && (
                      <p className="text-[10px] font-mono text-nexus-text-dim">
                        {s.result.risks} risks ({s.result.critical} critical, {s.result.warnings} warnings)
                      </p>
                    )}
                    {s.type === 'digest' && s.result && (
                      <p className="text-[10px] font-mono text-nexus-text-dim">
                        {s.result.summary || `${s.result.totalEvents} events, ${s.result.tasksDone} done, ${s.result.sessions} sessions`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
