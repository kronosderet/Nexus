import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import Sidebar from './components/Sidebar.jsx';
import SearchModal from './components/SearchModal.jsx';
import Command from './modules/Command.jsx';
import Pulse from './modules/Pulse.jsx';
import Fleet from './modules/Fleet.jsx';
import FuelModule from './modules/Fuel.jsx';
import GraphModule from './modules/Graph.jsx';
import Overseer from './modules/Overseer.jsx';
import Log from './modules/Log.jsx';
import TerminalModule from './modules/Terminal.jsx';
import NexusProvider from './context/NexusProvider.jsx';
import WelcomeScreen from './components/WelcomeScreen.jsx';
import ToastOverlay from './components/ToastOverlay.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ThoughtStackModal from './components/ThoughtStackModal.jsx';
import ShortcutHelpModal from './components/ShortcutHelpModal.jsx';

const MODULE_KEYS = ['command', 'pulse', 'fleet', 'fuel', 'graph', 'overseer', 'log', 'terminal'];
const MODULES = {
  command: { label: 'Command', icon: 'compass', component: Command, shortcut: '1' },
  pulse: { label: 'Dashboard', icon: 'activity', component: Pulse, shortcut: '2' },
  fleet: { label: 'Fleet', icon: 'ship', component: Fleet, shortcut: '3' },
  fuel: { label: 'Fuel', icon: 'fuel', component: FuelModule, shortcut: '4' },
  graph: { label: 'Graph', icon: 'git-branch', component: GraphModule, shortcut: '5' },
  overseer: { label: 'Overseer', icon: 'brain', component: Overseer, shortcut: '6' },
  log: { label: 'Log', icon: 'scroll-text', component: Log, shortcut: '7' },
  terminal: { label: 'Terminal', icon: 'terminal', component: TerminalModule, shortcut: '8' },
};

export default function App() {
  const [activeModule, setActiveModule] = useState('command');
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
            <ActiveComponent ws={ws} />
          </ErrorBoundary>
        </NexusProvider>
      </main>
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={handleSearchNavigate}
      />
      <ThoughtStackModal
        open={thoughtsOpen}
        onClose={() => setThoughtsOpen(false)}
      />
      <ShortcutHelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
      <ToastOverlay ws={ws} />
    </div>
  );
}
