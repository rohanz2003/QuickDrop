import { useEffect, useMemo, useState } from 'react';
import UploadTab from './components/UploadTab.jsx';
import ScanTab from './components/ScanTab.jsx';
import HistoryTab from './components/HistoryTab.jsx';

const tabs = ['Upload', 'Scan', 'History'];

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

  const tabContent = useMemo(() => {
    if (!clientId) return null;
    return {
      Upload: <UploadTab clientId={clientId} />,
      Scan: <ScanTab clientId={clientId} />,
      History: <HistoryTab clientId={clientId} />
    }[activeTab];
  }, [activeTab, clientId]);

  return (
    <div className="min-h-screen bg-background text-onsurface">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 rounded-3xl border border-white/10 bg-surface/80 p-5 shadow-glow backdrop-blur-xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-secondary/80">No-login file sharing</p>
              <h1 className="mt-2 text-3xl font-semibold text-onsurface sm:text-4xl">QuickDrop QR</h1>
              <p className="mt-2 max-w-2xl text-sm text-onsurface/70 sm:text-base">
                Upload any file, generate a QR share link, scan to download instantly. History is stored locally per device.
              </p>
            </div>
            <div className="rounded-3xl bg-surface-low/80 p-4 text-sm text-onsurface-variant shadow-sm">
              <span className="font-semibold text-onsurface">Device ID</span>
              <div className="mt-1 font-mono text-xs text-secondary break-all">{clientId || 'Generating...'}</div>
            </div>
          </div>
        </header>

        <nav className="mb-6 grid grid-cols-3 gap-2 rounded-3xl border border-white/10 bg-surface-low/80 p-2 shadow-sm sm:max-w-lg">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                activeTab === tab
                  ? 'bg-primary text-background shadow-glow'
                  : 'text-onsurface/70 hover:text-onsurface'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>

        <div className="rounded-[2rem] border border-white/10 bg-surface/90 p-5 shadow-glow sm:p-8">
          {tabContent}
        </div>
      </div>
    </div>
  );
}

export default App;
