import { useEffect, useMemo, useState } from 'react';
import UploadTab from './components/UploadTab.jsx';
import ScanTab from './components/ScanTab.jsx';
import HistoryTab from './components/HistoryTab.jsx';

const tabs = [
  { key: 'Upload', icon: 'M12 4v16m8-8H4' },
  { key: 'Receive', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
  { key: 'History', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' }
];

function useClientId() {
  const [clientId, setClientId] = useState(null);

  useEffect(() => {
    let id = localStorage.getItem('quickdropClientId');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('quickdropClientId', id);
    }
    setClientId(id);
  }, []);

  return clientId;
}

function App() {
  const clientId = useClientId();
  const [activeTab, setActiveTab] = useState('Upload');
  const [pendingRoom, setPendingRoom] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room && /^\d{4}$/.test(room)) {
      setPendingRoom(room);
      setActiveTab('Receive');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);
  const tabsContent = useMemo(() => {
    if (!clientId) return null;
    return {
      Upload: <UploadTab clientId={clientId} />,
      Receive: <ScanTab clientId={clientId} pendingRoom={pendingRoom} />,
      History: <HistoryTab clientId={clientId} />
    };
  }, [clientId, pendingRoom]);

  return (
    <div className="min-h-screen bg-background text-onsurface">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="relative mb-6 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-surface/90 via-surface/70 to-surface-low/90 p-5 shadow-glow backdrop-blur-xl">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-accent/5 rounded-full blur-3xl pointer-events-none" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-primary/60">No-login file sharing</p>
              <h1 className="mt-1 text-4xl font-extrabold text-onsurface tracking-tight">
                QuickDrop <span className="text-primary"></span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-onsurface/60 sm:text-base">
                Share files directly browser-to-browser with a 4-digit code. No server storage.
              </p>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl bg-background/50 border border-white/5 p-3 text-sm text-onsurface-variant shadow-sm">
              <div>
                <span className="font-semibold text-onsurface text-xs">Device ID</span>
                <div className="mt-1 font-mono text-[11px] text-primary/80 break-all">{clientId || 'Generating...'}</div>
              </div>
            </div>
          </div>
        </header>

        <nav className="mb-6 grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-surface-low/80 p-1.5 shadow-sm sm:max-w-md">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-300 ${
                activeTab === tab.key
                  ? 'bg-gradient-to-r from-primary to-accent text-background shadow-glow-sm scale-[1.02]'
                  : 'text-onsurface/60 hover:text-onsurface hover:bg-white/5'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
              </svg>
              {tab.key}
            </button>
          ))}
        </nav>

        <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-surface/90 via-surface/70 to-surface-low/90 p-5 shadow-glow sm:p-8">
          {tabsContent && (
            <>
              <div className={activeTab === 'Upload' ? 'block' : 'hidden'}>{tabsContent.Upload}</div>
              <div className={activeTab === 'Receive' ? 'block' : 'hidden'}>{tabsContent.Receive}</div>
              <div className={activeTab === 'History' ? 'block' : 'hidden'}>{tabsContent.History}</div>
            </>
          )}
        </div>

        <footer className="mt-8 text-center text-xs text-onsurface/30">
          QuickDrop &mdash; Files are transferred directly between devices. 
        </footer>
      </div>
    </div>
  );
}

export default App;
