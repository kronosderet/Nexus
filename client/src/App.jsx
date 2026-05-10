import { useState, useEffect, lazy, Suspense } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import Sidebar from './components/Sidebar.jsx';
import NexusProvider from './context/NexusProvider.jsx';
import WelcomeScreen from './components/WelcomeScreen.jsx';
import ToastOverlay from './components/ToastOverlay.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// v4.8.0 — code-split each dashboard module + the rarely-opened modals into
// their own chunks via React.lazy. Pre-split the main bundle was 517.79kB
// because every module shipped at startup even though the user only views
// one at a time. Graph + Overseer are the heaviest (SVG layout, chat history);
// splitting them off saves ~150kB from initial load. Suspense fallback uses
// the same Cartographer "Scanning..." style as in-module loading states so
// the swap is visually consistent.
const Command   = lazy(() => import('./modules/Command.jsx'));
const Pulse     = lazy(() => import('./modules/Pulse.jsx'));
const Fleet     = lazy(() => import('./modules/Fleet.jsx'));
const FuelModule = lazy(() => import('./modules/Fuel.jsx'));
const GraphModule = lazy(() => import('./modules/Graph.jsx'));
const Overseer  = lazy(() => import('./modules/Overseer.jsx'));
const Log       = lazy(() => import('./modules/Log.jsx'));
const Handover  = lazy(() => import('./modules/Handover.jsx'));
const SearchModal = lazy(() => import('./components/SearchModal.jsx'));
const ThoughtStackModal = lazy(() => import('./components/ThoughtStackModal.jsx'));
const ShortcutHelpModal = lazy(() => import('./components/ShortcutHelpModal.jsx'));

const MODULE_KEYS = ['command', 'pulse', 'fleet', 'fuel', 'graph', 'overseer', 'log', 'handover'];
const MODULES = {
  command: { label: 'Command', icon: 'compass', component: Command, shortcut: '1' },
  pulse: { label: 'Dashboard', icon: 'activity', component: Pulse, shortcut: '2' },
  fleet: { label: 'Fleet', icon: 'ship', component: Fleet, shortcut: '3' },
  fuel: { label: 'Fuel', icon: 'fuel', component: FuelModule, shortcut: '4' },
  graph: { label: 'Graph', icon: 'git-branch', component: GraphModule, shortcut: '5' },
  overseer: { label: 'Overseer', icon: 'brain', component: Overseer, shortcut: '6' },
  log: { label: 'Log', icon: 'scroll-text', component: Log, shortcut: '7' },
  handover: { label: 'Handover', icon: 'book-marked', component: Handover, shortcut: '8' },
};

export default function App() {
  const [activeModule, setActiveModule] = useState('command');
  // v4.4.5 #380 — nav options payload for cross-module hints (e.g. Fleet asks Graph
  // to open Visual tab focused on a specific project). Consumed by receiving module
  // on mount; cleared after consumption so it doesn't re-apply on subsequent renders.
  const [navOptions, setNavOptions] = useState({});
  const handleNavigate = (moduleKey, options = {}) => {
    setActiveModule(moduleKey);
    setNavOptions(options);
  };
  const [showWelcome, setShowWelcome] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [thoughtsOpen, setThoughtsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const ws = useWebSocket();

  // Welcome screen dismisses itself via onReady callback after init checks

  // Keyboard shortcuts: Ctrl+1-9,0 switch modules, Ctrl+K search, Ctrl+T thoughts
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.ctrlKey && /^[0-9]$/.test(e.key)) {
        // 1-9 map to indices 0-8; 0 maps to index 9 (the 10th module)
        const idx = e.key === '0' ? 9 : parseInt(e.key) - 1;
        const target = MODULE_KEYS[idx];
        if (target) {
          e.preventDefault();
          setActiveModule(target);
        }
      }
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        setThoughtsOpen((v) => !v);
      }
      if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function handleSearchNavigate(result) {
    // Navigate to the relevant module based on result type
    const typeModuleMap = {
      task: 'command',
      activity: 'log',
      session: 'log',
    };
    const target = typeModuleMap[result.type];
    if (target) setActiveModule(target);
  }

  if (showWelcome) return <WelcomeScreen connected={ws.connected} onReady={() => setShowWelcome(false)} />;

  const ActiveComponent = MODULES[activeModule].component;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        modules={MODULES}
        active={activeModule}
        onSelect={setActiveModule}
        connected={ws.connected}
        onSearchClick={() => setSearchOpen(true)}
      />
      <main className="flex-1 overflow-auto p-4 md:p-6 pt-14 md:pt-6">
        <NexusProvider ws={ws}>
          <ErrorBoundary resetKey={activeModule}>
            {/* v4.4.1 #354 — onNavigate prop gives modules a way to jump to sibling views
                (e.g. Log entries click-through to Command / Graph). Used in Log.jsx.
                v4.4.5 #380 — second arg `options` carries hints for the destination
                module (e.g. { graphView: 'visual', focusProject: 'Nexus' }). */}
            {/* v4.8.0 — Suspense boundary catches first-render of any lazy module.
                Fallback matches the in-module loading states so the cross-fade reads
                as "module thinking" rather than "broken page". */}
            <Suspense fallback={
              <div className="flex items-center gap-3 h-64 justify-center">
                <div className="text-2xl animate-compass text-nexus-amber">◈</div>
                <span className="font-mono text-sm text-nexus-text-dim">Loading {MODULES[activeModule].label}...</span>
              </div>
            }>
              <ActiveComponent ws={ws} onNavigate={handleNavigate} navOptions={navOptions} />
            </Suspense>
          </ErrorBoundary>
        </NexusProvider>
      </main>
      {/* v4.8.0 — modals lazy-loaded too. They mount only when opened, so the
          import doesn't even fire until the user reaches for the modal. */}
      <Suspense fallback={null}>
        {searchOpen && (
          <SearchModal
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            onNavigate={handleSearchNavigate}
          />
        )}
        {thoughtsOpen && (
          <ThoughtStackModal
            open={thoughtsOpen}
            onClose={() => setThoughtsOpen(false)}
          />
        )}
        {helpOpen && (
          <ShortcutHelpModal
            open={helpOpen}
            onClose={() => setHelpOpen(false)}
          />
        )}
      </Suspense>
      <ToastOverlay ws={ws} />
    </div>
  );
}
