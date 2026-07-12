import { useRef, useEffect } from 'react';

export default function ChatSidebar({ messages, connected, onSend, role }) {
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      const text = inputRef.current?.value.trim();
      if (text) {
        onSend?.(text);
        inputRef.current.value = '';
      }
    }
  };

  return (
    <div className="flex w-72 flex-col self-stretch border-r border-onsurface/10 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-onsurface/10 px-4 py-3">
        <span className={`h-3 w-3 rounded-full ${connected ? 'bg-green-500 shadow-sm shadow-green-500/50' : 'bg-red-500 shadow-sm shadow-red-500/50'}`} />
        <div>
          <p className="text-sm font-semibold text-[#1a1a2e]">Chat</p>
          <p className="text-[11px] text-[#6b7280]">{connected ? (role === 'sender' ? 'Receiver connected' : 'Sender connected') : 'Disconnected'}</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-xs text-[#9ca3af]">No messages yet.</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.from === 'me' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
              msg.from === 'me'
                ? 'bg-gradient-to-r from-[#4338ca] to-[#6366f1] text-white rounded-br-md'
                : 'bg-[#f3f4f6] text-[#1a1a2e] rounded-bl-md'
            }`}>
              <p className="break-words">{msg.text}</p>
              <p className={`mt-0.5 text-[10px] ${msg.from === 'me' ? 'text-white/60' : 'text-[#9ca3af]'}`}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-onsurface/10 px-4 py-3">
        <div className="flex items-center gap-2 rounded-2xl bg-[#f3f4f6] px-4 py-2">
          <input
            ref={inputRef}
            type="text"
            placeholder={connected ? 'Type a message...' : 'Not connected'}
            disabled={!connected}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-sm text-[#1a1a2e] outline-none placeholder:text-[#9ca3af] disabled:opacity-50"
          />
          <button
            type="button"
            disabled={!connected}
            onClick={() => {
              const text = inputRef.current?.value.trim();
              if (text) {
                onSend?.(text);
                inputRef.current.value = '';
              }
            }}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-r from-[#4338ca] to-[#6366f1] text-white transition-all duration-300 hover:shadow-md disabled:opacity-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
