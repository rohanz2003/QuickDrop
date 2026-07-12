import { useEffect, useMemo, useState } from 'react';
import UploadTab from './components/UploadTab.jsx';
import ScanTab from './components/ScanTab.jsx';
import HistoryTab from './components/HistoryTab.jsx';

const tabs = [
  {
    key: 'Send',
    icon: 'M12 4v16m8-8H4'
  },
  {
    key: 'Receive',
    icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
  },
  {
    key: 'History',
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
  }
];

const features = [
  'No signup needed',
  '4-digit room code',
  'Direct browser-to-browser',
  'Fast P2P transfer',
  'No server storage',
  'Works on LAN'
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
  const [activeTab, setActiveTab] = useState('Send');
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
      Send: <UploadTab clientId={clientId} />,
      Receive: <ScanTab clientId={clientId} pendingRoom={pendingRoom} />,
      History: <HistoryTab clientId={clientId} />
    };
  }, [clientId, pendingRoom]);

  return (
    <div className="flex min-h-screen bg-background text-onsurface">
      {/* LEFT PANEL — dark indigo gradient (connect-it inspired) */}
      <div className="hidden w-[440px] shrink-0 flex-col justify-between bg-gradient-to-br from-[#4338ca] via-[#3730a3] to-[#312e81] p-12 lg:flex">
        <div>
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-[#4338ca] to-[#6366f1] shadow-lg shadow-indigo-500/30">
            <span className="text-2xl font-extrabold text-white">Q</span>
          </div>

          <h1 className="mt-10 text-[40px] font-extrabold leading-tight tracking-tight text-white">
            QuickDrop
          </h1>
          <p className="mt-3 max-w-[380px] text-base leading-relaxed text-white/85">
            Share files directly between devices. No signup, no server storage — just a 4-digit code.
          </p>

          <ul className="mt-10 flex flex-col gap-[18px]">
            {features.map((f) => (
              <li key={f} className="flex items-center gap-3 text-[15px] font-medium text-white/95">
                <svg className="h-5 w-5 shrink-0 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white/80 backdrop-blur">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">Device ID</p>
          <p className="mt-1 font-mono text-[13px] break-all text-indigo-200">
            {clientId || 'Generating...'}
          </p>
        </div>
      </div>

      {/* RIGHT PANEL — light (connect-it style) */}
      <div className="light-panel flex min-h-screen flex-1 flex-col" style={{ background: '#f8f9fc' }}>
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10 sm:px-10">
          {/* Mobile branding (shown on small screens) */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#4338ca] to-[#6366f1] shadow-md shadow-indigo-500/20">
              <span className="text-lg font-extrabold text-white">Q</span>
            </div>
            <div>
              <p className="text-lg font-bold text-[#1a1a2e]">QuickDrop</p>
              <p className="text-xs text-[#6b7280]">P2P file sharing</p>
            </div>
          </div>

          {/* Tab switcher */}
          <div className="inline-flex gap-1.5 self-center rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-black/5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all duration-300 ${
                  activeTab === tab.key
                    ? 'bg-gradient-to-r from-[#4338ca] to-[#6366f1] text-white shadow-md'
                    : 'text-[#6b7280] hover:text-[#1a1a2e]'
                }`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
                </svg>
                {tab.key}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="mt-8 flex-1">
            {tabsContent && (
              <>
                <div className={activeTab === 'Send' ? 'block' : 'hidden'}>{tabsContent.Send}</div>
                <div className={activeTab === 'Receive' ? 'block' : 'hidden'}>{tabsContent.Receive}</div>
                <div className={activeTab === 'History' ? 'block' : 'hidden'}>{tabsContent.History}</div>
              </>
            )}
          </div>

          <footer className="mt-8 text-center text-xs text-[#9ca3af]">
            QuickDrop &mdash; Files are transferred directly between devices.
          </footer>
        </div>
      </div>
    </div>
  );
}

export default App;
