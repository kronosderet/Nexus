import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import Sidebar from './components/Sidebar.jsx';
import SearchModal from './components/SearchModal.jsx';
import Pulse from './modules/Pulse.jsx';
import MissionBoard from './modules/MissionBoard.jsx';
import ActivityStream from './modules/ActivityStream.jsx';
import Scratchpad from './modules/Scratchpad.jsx';
import Sessions from './modules/Sessions.jsx';
import Overseer from './modules/Overseer.jsx';
import TerminalModule from './modules/Terminal.jsx';
import FuelModule from './modules/Fuel.jsx';
import GraphModule from './modules/Graph.jsx';
import WelcomeScreen from './components/WelcomeScreen.jsx';
import ToastOverlay from './components/ToastOverlay.jsx';

const MODULE_KEYS = ['pulse', 'fuel', 'graph', 'overseer', 'missions', 'activity', 'sessions', 'scratchpad', 'terminal'];
const MODULES = {
  pulse: { label: 'System Pulse', icon: 'activity', component: Pulse, shortcut: '1' },
  fuel: { label: 'Fuel', icon: 'fuel', component: FuelModule, shortcut: '2' },
  graph: { label: 'Graph', icon: 'git-branch', component: GraphModule, shortcut: '3' },
  overseer: { label: 'Overseer', icon: 'brain', component: Overseer, shortcut: '4' },
  missions: { label: 'Missions', icon: 'compass', component: MissionBoard, shortcut: '5' },
  activity: { label: 'Activity', icon: 'scroll-text', component: ActivityStream, shortcut: '6' },
  sessions: { label: 'Sessions', icon: 'book-open', component: Sessions, shortcut: '7' },
  scratchpad: { label: 'Scratchpad', icon: 'pen-tool', component: Scratchpad, shortcut: '8' },
  terminal: { label: 'Terminal', icon: 'terminal', component: TerminalModule, shortcut: '9' },
};

export default function App() {
  const [activeModule, setActiveModule] = useState('pulse');
  const [showWelcome, setShowWelcome] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const ws = useWebSocket();

  // Welcome screen dismisses itself via onReady callback after init checks

  // Keyboard shortcuts: Ctrl+1-5 switch modules, Ctrl+K search
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        setActiveModule(MODULE_KEYS[parseInt(e.key) - 1]);
      }
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function handleSearchNavigate(result) {
    // Navigate to the relevant module based on result type
    const typeModuleMap = {
      task: 'missions',
      activity: 'activity',
      session: 'sessions',
      scratchpad: 'scratchpad',
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
        ws={ws}
      />
      <main className="flex-1 overflow-auto p-6">
        <ActiveComponent ws={ws} />
      </main>
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={handleSearchNavigate}
      />
      <ToastOverlay ws={ws} />
    </div>
  );
}
