import { useEffect, useMemo, useRef, useState } from 'react';
import UploadTab from './components/UploadTab.jsx';
import ScanTab from './components/ScanTab.jsx';
import HistoryTab from './components/HistoryTab.jsx';
import ChatSidebar from './components/ChatSidebar.jsx';

const tabs = [
  { key: 'Send', icon: 'M12 4v16m8-8H4' },
  { key: 'Receive', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
  { key: 'History', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' }
];

const navIcons = {
  Send: 'M12 4v16m8-8H4',
  Receive: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  History: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  Chat: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z'
};

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
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

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
    if (update.channel) channelRef.current = update.channel;
    if (update.connected !== undefined) {
      setChatConnected(update.connected);
      if (!update.connected) setChatRole(null);
    }
    if (update.role) setChatRole(update.role);
    if (update.chatMessage) {
      setChatMessages((prev) => [...prev, update.chatMessage]);
      if (update.chatMessage.from !== 'me' && !mobileChatOpen) {
        setUnreadCount((prev) => prev + 1);
      }
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

  const handleNavClick = (key) => {
    if (key === 'Chat') {
      setMobileChatOpen(true);
      setUnreadCount(0);
    } else {
      setActiveTab(key);
    }
  };

  const markChatRead = () => setUnreadCount(0);

  return (
    <div className="flex min-h-screen flex-col bg-background text-onsurface sm:h-screen">
      {/* HEADER */}
      <header className="bg-gradient-to-r from-[#4338ca] via-[#3730a3] to-[#312e81] px-3 py-2 shadow-lg shadow-indigo-500/20 sm:sticky sm:top-0 sm:z-30 sm:px-6 sm:py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-1.5 sm:gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#4338ca] to-[#6366f1] shadow-md shadow-white/10 sm:h-10 sm:w-10 sm:rounded-xl">
              <span className="text-sm font-extrabold text-white sm:text-lg">Q</span>
            </div>
            <div>
              <p className="text-sm font-bold text-white sm:text-lg">QuickDrop</p>
              <p className="text-[9px] text-indigo-200/80 sm:text-[11px]">P2P file sharing</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {chatConnected && (
              <span className="flex items-center gap-1.5 rounded-full border border-green-400/30 bg-green-500/15 px-2.5 py-1 text-[10px] font-semibold text-green-300 sm:hidden">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 shadow-sm shadow-green-400/60 animate-pulse" />
                Live
              </span>
            )}
            <div className="hidden rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs text-white/70 backdrop-blur sm:block">
              <span className="font-semibold text-white/50">ID: </span>
              <span className="font-mono text-indigo-200">
                {clientId ? clientId.slice(0, 8) + '...' : 'Generating...'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* BODY */}
      <div className="light-panel flex flex-1 overflow-hidden" style={{ background: '#f8f9fc' }}>
        {/* Desktop Chat Sidebar (hidden on mobile) */}
        {chatConnected && (
          <div className="hidden sm:flex">
            <ChatSidebar
              messages={chatMessages}
              connected={chatConnected}
              role={chatRole}
              onSend={sendChat}
              unreadCount={unreadCount}
              onMarkRead={markChatRead}
            />
          </div>
        )}

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-y-auto px-3 py-3 pb-20 min-h-0 sm:px-10 sm:py-6 sm:pb-8">
          {/* Desktop tab switcher (hidden on mobile) */}
          <div className="hidden self-center sm:inline-flex sm:gap-1.5 sm:rounded-2xl sm:bg-white sm:p-1.5 sm:shadow-sm sm:ring-1 sm:ring-black/5">
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

          <div className="mt-3 flex-1 overflow-y-auto min-h-0 sm:mt-8">
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

      {/* Mobile Bottom Nav (hidden on desktop) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-onsurface/10 bg-white/95 px-1 pb-[env(safe-area-inset-bottom,0px)] pt-1 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur-lg sm:hidden">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] font-semibold transition-all duration-200 ${
              activeTab === tab.key
                ? 'text-[#4338ca]'
                : 'text-[#9ca3af] hover:text-[#6b7280]'
            }`}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={activeTab === tab.key ? 2.5 : 1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
            </svg>
            <span>{tab.key}</span>
          </button>
        ))}
        {chatConnected && (
          <button
            onClick={() => handleNavClick('Chat')}
            className={`relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] font-semibold transition-all duration-200 ${
              mobileChatOpen
                ? 'text-[#4338ca]'
                : 'text-[#9ca3af] hover:text-[#6b7280]'
            }`}
          >
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white shadow-sm shadow-red-500/50">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={mobileChatOpen ? 2.5 : 1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d={navIcons.Chat} />
            </svg>
            <span>Chat</span>
          </button>
        )}
      </nav>

      {/* Mobile Full-Screen Chat Overlay */}
      {mobileChatOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white animate-slide-up sm:hidden">
          <ChatSidebar
            messages={chatMessages}
            connected={chatConnected}
            role={chatRole}
            onSend={sendChat}
            fullScreen
            onClose={() => setMobileChatOpen(false)}
            unreadCount={unreadCount}
            onMarkRead={markChatRead}
          />
        </div>
      )}

      {/* Desktop FOOTER (hidden on mobile) */}
      <footer className="hidden border-t border-onsurface/10 bg-[#f1f3f7] py-4 text-center text-xs text-[#9ca3af] sm:sticky sm:bottom-0 sm:block">
        <div className="mx-auto max-w-5xl">
          QuickDrop &mdash; Files are transferred directly between devices.
        </div>
      </footer>
    </div>
  );
}

export default App;
