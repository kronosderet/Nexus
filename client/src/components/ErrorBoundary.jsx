import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Catches RENDER-TIME errors in child modules so one bad panel
 * doesn't take down the whole dashboard.
 *
 * Use with a `resetKey` prop (e.g. the active module name) — when the
 * key changes, the boundary resets so switching modules always recovers.
 *
 * Scope: render errors ONLY (getDerivedStateFromError). Async errors
 * (useEffect, event handlers, API calls) are NOT caught here — they're
 * handled by the toast system in useApi.js, which fires toast.error()
 * on every failed API call and then re-throws. Module-level catch blocks
 * prevent unhandled rejections after the toast surfaces the error.
 *
 * Error visibility chain:
 *   Render error → ErrorBoundary → crash screen with retry button
 *   Async/API error → useApi toast.error() → user sees toast notification
 *   Both paths are covered. No silent failures.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Log to console so devs can see the stack
    console.error('ErrorBoundary caught:', error, info);
    this.setState({ info });
  }

  componentDidUpdate(prevProps) {
    // Reset when the caller signals it (e.g. user switched modules)
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, info: null });
    }
  }

  handleReset = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="bg-nexus-surface border border-nexus-red/30 rounded-xl p-6">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle size={20} className="text-nexus-red shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-nexus-text mb-1">
                Charts washed overboard.
              </h2>
              <p className="text-xs font-mono text-nexus-text-faint">
                A module crashed. The rest of the bridge is still up.
              </p>
            </div>
          </div>

          <div className="bg-nexus-bg border border-nexus-border rounded-lg p-3 mb-4 overflow-auto max-h-48">
            <p className="text-xs font-mono text-nexus-red break-words">
              {this.state.error?.message || String(this.state.error)}
            </p>
            {this.state.info?.componentStack && (
              <pre className="text-[10px] font-mono text-nexus-text-faint mt-2 whitespace-pre-wrap">
                {this.state.info.componentStack.trim()}
              </pre>
            )}
          </div>

          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20 hover:bg-nexus-amber/20 transition-colors"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      </div>
    );
  }
}
