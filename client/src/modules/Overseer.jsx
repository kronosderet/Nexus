import { useState, useEffect } from 'react';
import { api } from '../hooks/useApi.js';
import { Brain, RefreshCw, AlertTriangle, Shield, Send, Loader2, Play, CheckCircle2, XCircle } from 'lucide-react';

const RISK_ICONS = {
  critical: { color: 'text-nexus-red', bg: 'bg-nexus-red/10 border-nexus-red/20' },
  warning: { color: 'text-nexus-amber', bg: 'bg-nexus-amber/10 border-nexus-amber/20' },
  info: { color: 'text-nexus-blue', bg: 'bg-nexus-blue/10 border-nexus-blue/20' },
};

function RiskCard({ risk }) {
  const [running, setRunning] = useState(null); // which action is running
  const [result, setResult] = useState(null);
  const style = RISK_ICONS[risk.level] || RISK_ICONS.info;

  async function executeFix(action, project, param, label) {
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
  }

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
        <div className="flex gap-1 mt-1.5 ml-5">
          {actions.map((a, i) => (
            <button
              key={i}
              onClick={() => a.action && executeFix(a.action, a.project, a.param, a.label)}
              disabled={running !== null}
              className="flex items-center gap-1 text-[10px] font-mono text-nexus-amber hover:text-nexus-text border border-nexus-amber/20 rounded px-1.5 py-0.5 hover:bg-nexus-amber/10 transition-colors disabled:opacity-50"
            >
              {running === a.label ? <Loader2 size={8} className="animate-spin" /> : <Play size={8} />}
              {a.label}
            </button>
          ))}
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
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const [context, setContext] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [gpuInfo, setGpuInfo] = useState(null);

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
      if (data.error) { setAnalysis(data.error); }
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

  async function askOverseer() {
    if (!question.trim()) return;
    setAsking(true);
    setAnswer(null);
    try {
      const data = await api.askOverseer({ question });
      setAnswer(data.answer || data.error);
    } catch (err) {
      setAnswer(`Error: ${err.message}`);
    } finally {
      setAsking(false);
    }
  }

  useEffect(() => {
    fetchRisks();
    // Fetch AI model + GPU info on mount
    api.getOverseerStatus().then(setAiStatus).catch(() => {});
    api.getGpuDetail().then(setGpuInfo).catch(() => {});
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
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {loading ? 'Analyzing...' : 'Analyze Fleet'}
              </button>
            </div>

            {!analysis && !loading && (
              <div className="text-center py-8">
                <Brain size={32} className="mx-auto text-nexus-text-faint mb-3 opacity-30" />
                <p className="text-sm text-nexus-text-faint">Click "Analyze Fleet" to get strategic guidance.</p>
                <p className="text-xs text-nexus-text-faint mt-1">The Overseer examines all projects, tasks, sessions, and git state.</p>
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

          {/* Ask the Overseer */}
          <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Send size={14} className="text-nexus-amber" />
              <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Ask the Overseer</span>
            </div>
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && askOverseer()}
                maxLength={5000}
                placeholder="What should I prioritize this week? / Is Firewall at risk? / ..."
                className="flex-1 bg-nexus-bg border border-nexus-border rounded-lg px-3 py-2 text-sm text-nexus-text placeholder:text-nexus-text-faint focus:border-nexus-amber focus:outline-none"
              />
              <button
                onClick={askOverseer}
                disabled={asking || !question.trim()}
                className="px-4 py-2 rounded-lg bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20 text-xs font-mono hover:bg-nexus-amber/20 transition-colors disabled:opacity-50"
              >
                {asking ? <Loader2 size={14} className="animate-spin" /> : 'Ask'}
              </button>
            </div>
            {answer && (
              <div className="mt-3 p-3 bg-nexus-bg rounded-lg">
                <AnalysisBlock text={answer} />
              </div>
            )}
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
        </div>
      </div>
    </div>
  );
}
