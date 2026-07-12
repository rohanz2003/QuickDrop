import { useEffect, useMemo, useState } from 'react';

const QD_THEMES = ['default', 'ocean', 'lime', 'fuchsia', 'amber'];


import UploadTab from './components/UploadTab.jsx';
import ScanTab from './components/ScanTab.jsx';
import HistoryTab from './components/HistoryTab.jsx';

const tabs = [
  { key: 'Upload', icon: 'M12 4v16m8-8H4' },
  { key: 'Scan', icon: 'M12 4v1m6 11h2m-6 0h-2v4m0-11v3' },
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
  const [mode, setMode] = useState('Server');
  const [pendingRoom, setPendingRoom] = useState(null);

  const themes = [
    { key: 'default', label: 'Blue' },
    { key: 'ocean', label: 'Ocean' },
    { key: 'lime', label: 'Lime' },
    { key: 'fuchsia', label: 'Fuchsia' },
    { key: 'amber', label: 'Amber' }
  ];

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('quickdropTheme');
    if (!saved) return 'default';
    return QD_THEMES.includes(saved) ? saved : 'default';
  });


  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'default') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    localStorage.setItem('quickdropTheme', theme);
  }, [theme]);


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      setPendingRoom(room);
      setActiveTab('Scan');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);
  const modes = [
    { key: 'P2P', label: 'Direct (P2P)' },
    { key: 'Server', label: 'Server' }
  ];

  const tabsContent = useMemo(() => {
    if (!clientId) return null;
    return {
      Upload: <UploadTab clientId={clientId} mode={mode} />,
      Scan: <ScanTab clientId={clientId} mode={mode} pendingRoom={mode === 'P2P' ? pendingRoom : null} />,
      History: <HistoryTab clientId={clientId} />
    };
  }, [clientId, mode, pendingRoom]);

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
                QuickDrop <span className="text-primary">QR</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-onsurface/60 sm:text-base">
                {mode === 'P2P'
                  ? 'Share files directly browser-to-browser with QR codes. No server storage.'
                  : 'Upload any file, generate a QR share link, scan to download instantly.'}
              </p>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl bg-background/50 border border-white/5 p-3 text-sm text-onsurface-variant shadow-sm">
              <div>
                <span className="font-semibold text-onsurface text-xs">Device ID</span>
                <div className="mt-1 font-mono text-[11px] text-primary/80 break-all">{clientId || 'Generating...'}</div>
              </div>

              <div className="space-y-2">
                <span className="font-semibold text-onsurface text-xs">Theme</span>
                <div className="flex flex-wrap gap-1.5">
                  {themes.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTheme(t.key)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-300 ${
                        theme === t.key
                          ? 'bg-gradient-to-r from-primary to-accent text-background shadow-glow-sm'
                          : 'text-onsurface/60 hover:text-onsurface hover:bg-white/5'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="inline-flex gap-1 rounded-xl bg-surface/60 p-1">
                {modes.map((option) => (
                  <button
                    key={option.key}
                    onClick={() => setMode(option.key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-300 ${
                      mode === option.key
                        ? 'bg-gradient-to-r from-primary to-accent text-background shadow-glow-sm'
                        : 'text-onsurface/60 hover:text-onsurface'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
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
              <div
                className={activeTab === 'Upload' ? 'block' : 'hidden'}
              >
                <div className="animate-slide-up motion-reduce:animate-none">{tabsContent.Upload}</div>
              </div>
              <div
                className={activeTab === 'Scan' ? 'block' : 'hidden'}
              >
                <div className="animate-slide-up motion-reduce:animate-none">{tabsContent.Scan}</div>
              </div>
              <div
                className={activeTab === 'History' ? 'block' : 'hidden'}
              >
                <div className="animate-slide-up motion-reduce:animate-none">{tabsContent.History}</div>
              </div>
            </>
          )}
        </div>


        <footer className="mt-8 text-center text-xs text-onsurface/30">
          QuickDrop QR &mdash; Files are transferred {mode === 'P2P' ? 'directly between devices' : 'via server'}. No login required.
        </footer>
      </div>
    </div>
  );
}

export default App;
