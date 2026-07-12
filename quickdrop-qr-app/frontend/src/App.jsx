import { useEffect, useMemo, useRef, useState } from 'react';
import UploadTab from './components/UploadTab.jsx';
import ScanTab from './components/ScanTab.jsx';
import HistoryTab from './components/HistoryTab.jsx';
import ChatSidebar from './components/ChatSidebar.jsx';

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
  const channelRef = useRef(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatConnected, setChatConnected] = useState(false);
  const [chatRole, setChatRole] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room && /^\d{4}$/.test(room)) {
      setPendingRoom(room);
      setActiveTab('Receive');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleChannelUpdate = (update) => {
    if (update.channel) {
      channelRef.current = update.channel;
    }
    if (update.connected !== undefined) {
      setChatConnected(update.connected);
      if (!update.connected) setChatRole(null);
    }
    if (update.role) {
      setChatRole(update.role);
    }
    if (update.chatMessage) {
      setChatMessages((prev) => [...prev, update.chatMessage]);
    }
  };

  const sendChat = (text) => {
    const ch = channelRef.current;
    if (!ch || ch.readyState !== 'open') return;
    const msg = { text, from: 'me', timestamp: Date.now() };
    ch.send(new TextEncoder().encode('__CHAT__' + JSON.stringify(msg)));
    setChatMessages((prev) => [...prev, msg]);
  };

  const tabsContent = useMemo(() => {
    if (!clientId) return null;
    return {
      Send: <UploadTab clientId={clientId} onChannelUpdate={handleChannelUpdate} />,
      Receive: <ScanTab clientId={clientId} pendingRoom={pendingRoom} onChannelUpdate={handleChannelUpdate} />,
      History: <HistoryTab clientId={clientId} />
    };
  }, [clientId, pendingRoom]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-onsurface">
      {/* HEADER */}
      <header className="bg-gradient-to-r from-[#4338ca] via-[#3730a3] to-[#312e81] px-6 py-4 shadow-lg shadow-indigo-500/20">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#4338ca] to-[#6366f1] shadow-md shadow-white/10">
              <span className="text-lg font-extrabold text-white">Q</span>
            </div>
            <div>
              <p className="text-lg font-bold text-white">QuickDrop</p>
              <p className="text-[11px] text-indigo-200/80">P2P file sharing</p>
            </div>
          </div>

          <div className="hidden rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs text-white/70 backdrop-blur sm:block">
            <span className="font-semibold text-white/50">ID: </span>
            <span className="font-mono text-indigo-200">
              {clientId ? clientId.slice(0, 8) + '...' : 'Generating...'}
            </span>
          </div>
        </div>
      </header>

      {/* BODY */}
      <div className="light-panel flex flex-1" style={{ background: '#f8f9fc' }}>
        {/* Chat Sidebar */}
        {chatConnected && (
          <ChatSidebar
            messages={chatMessages}
            connected={chatConnected}
            role={chatRole}
            onSend={sendChat}
          />
        )}

        {/* Main content */}
        <div className="flex flex-1 flex-col px-6 py-8 sm:px-10">
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

          <div className="mt-8 flex-1">
            {tabsContent && (
              <>
                <div className={activeTab === 'Send' ? 'block' : 'hidden'}>{tabsContent.Send}</div>
                <div className={activeTab === 'Receive' ? 'block' : 'hidden'}>{tabsContent.Receive}</div>
                <div className={activeTab === 'History' ? 'block' : 'hidden'}>{tabsContent.History}</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="bg-[#f1f3f7] py-4 text-center text-xs text-[#9ca3af]">
        <div className="mx-auto max-w-5xl">
          QuickDrop &mdash; Files are transferred directly between devices.
        </div>
      </footer>
    </div>
  );
}

export default App;
