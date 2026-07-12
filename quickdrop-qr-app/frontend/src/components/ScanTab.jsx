import { useCallback, useEffect, useRef, useState } from 'react';
import { addLocalHistoryEvent } from '../utils/historyStorage.js';
import { RTC_CONFIG, SIGNALING_WS_URL } from '../utils/signaling.js';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(1)} ${units[power]}`;
}

export default function ScanTab({ clientId, pendingRoom }) {
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [p2pStatus, setP2pStatus] = useState('');
  const [p2pProgress, setP2pProgress] = useState(0);
  const [p2pResult, setP2pResult] = useState(null);
  const [viewDetails, setViewDetails] = useState(null);
  const blobRef = useRef(null);

  useEffect(() => {
    if (pendingRoom) {
      setP2pStatus('Starting P2P download...');
      startP2PDownload(pendingRoom);
    }
  }, [pendingRoom]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      peerRef.current?.close();
    };
  }, []);

  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const wsRef = useRef(null);
  const receiveBufferRef = useRef([]);
  const receivedSizeRef = useRef(0);
  const fileMetaRef = useRef(null);
  const endReceivedRef = useRef(false);

  const tryFinish = () => {
    const meta = fileMetaRef.current;
    const expected = meta?.fileSize || 0;
    const received = receivedSizeRef.current;

    if (!meta || (expected > 0 && received !== expected)) {
      if (meta) setP2pStatus(`Waiting for remaining data (${formatBytes(received)} / ${formatBytes(expected)})...`);
      return;
    }

    const buf = new Uint8Array(received);
    let pos = 0;
    for (const chunk of receiveBufferRef.current) {
      buf.set(new Uint8Array(chunk), pos);
      pos += chunk.byteLength;
    }
    const blob = new Blob([buf]);
    blobRef.current = blob;

    addLocalHistoryEvent(clientId, {
      clientId,
      fileId: 'p2p-' + Date.now(),
      type: 'download',
      fileName: meta?.fileName || 'Unknown',
      fileSize: meta?.fileSize || 0,
      mimeType: meta?.mimeType || 'application/octet-stream',
      timestamp: new Date().toISOString()
    });

    setP2pResult({ ...meta });
    setP2pStatus('Download ready!');
    setP2pProgress(100);
  };

  const startP2PDownload = useCallback(async (roomId) => {
    setP2pStatus('Connecting...');
    setP2pProgress(0);

    const peer = new RTCPeerConnection(RTC_CONFIG);
    peerRef.current = peer;

    const ws = new WebSocket(SIGNALING_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join-offer', payload: { roomId } }));
    };

    ws.onmessage = async (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'offer') {
        const { offer, metadata } = msg.payload;
        fileMetaRef.current = metadata;
        setP2pStatus('Peer found! Establishing connection...');

        try {
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          ws.send(JSON.stringify({
            type: 'signal',
            payload: { roomId, answer: peer.localDescription }
          }));
        } catch (err) {
          setError('Connection setup failed: ' + err.message);
          setP2pStatus('');
        }
      }

      if (msg.type === 'signal') {
        const { candidate } = msg.payload;
        if (candidate) {
          try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch { }
        }
      }

      if (msg.type === 'error') {
        setError(msg.payload.message);
        setP2pStatus('');
      }
    };

    ws.onerror = () => {
      setError('Signaling connection failed');
      setP2pStatus('');
    };

    peer.ondatachannel = (event) => {
      const channel = event.channel;
      channelRef.current = channel;
      channel.binaryType = 'arraybuffer';

      channel.onopen = () => {
        setP2pStatus('Receiving file...');
      };

      channel.onmessage = (e) => {
        const data = e.data;
        if (typeof data === 'string') {
          if (data.startsWith('__META__')) {
            const meta = JSON.parse(data.slice(8));
            fileMetaRef.current = meta;
            receiveBufferRef.current = [];
            receivedSizeRef.current = 0;
            return;
          }
          if (data === '__END__') {
            tryFinish();
            return;
          }
          return;
        }

        receiveBufferRef.current.push(data);
        receivedSizeRef.current += data.byteLength;
        if (fileMetaRef.current?.fileSize) {
          const pct = Math.round((receivedSizeRef.current / fileMetaRef.current.fileSize) * 100);
          setP2pProgress(pct);
          setP2pStatus(`Receiving ${pct}%`);
          if (pct >= 100) tryFinish();
        }
      };

      channel.onerror = () => {
        setError('Channel error');
        setP2pStatus('');
      };
    };

    peer.onicecandidate = (e) => {
      if (e.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'signal',
          payload: { roomId, candidate: e.candidate.toJSON() }
        }));
      }
    };
  }, [clientId]);

  const handleConnect = () => {
    const code = roomCode.trim();
    if (code.length !== 4 || !/^\d{4}$/.test(code)) {
      setError('Please enter a valid 4-digit code');
      return;
    }
    setError('');
    startP2PDownload(code);
  };

  const downloadP2PFile = () => {
    const blob = blobRef.current;
    if (!blob || !p2pResult) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = p2pResult.fileName || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const handleRemoveP2P = () => {
    blobRef.current = null;
    setP2pResult(null);
    setP2pStatus('');
    setP2pProgress(0);
    setRoomCode('');
  };



  return (
    <div className="space-y-6 animate-fade-in">
      <div className="rounded-[2rem] border border-onsurface/10 bg-surface-low/80 p-6 shadow-sm">
        <div className="flex flex-col items-center gap-6">
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.35em] text-primary/70">Connect to sender</p>
              <h2 className="mt-2 text-3xl font-semibold text-onsurface">Enter the 4-digit code</h2>
              <p className="mt-2 text-sm text-onsurface/70">
                Ask the sender for their code and enter it below to receive the file directly.
              </p>
            </div>

            <div className="flex flex-col items-center gap-4">
              <input
                type="text"
                maxLength={4}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                placeholder="0000"
                className="w-48 rounded-2xl border border-onsurface/10 bg-background px-6 py-4 text-center text-4xl font-extrabold tracking-[0.3em] text-primary outline-none focus:border-primary/50 focus:shadow-glow-sm transition-all duration-300"
                disabled={!!p2pStatus || !!p2pResult}
                inputMode="numeric"
                autoFocus
              />
              <button
                type="button"
                onClick={handleConnect}
                disabled={roomCode.length !== 4 || !!p2pStatus || !!p2pResult}
                className="inline-flex items-center justify-center rounded-3xl bg-gradient-to-r from-primary to-accent px-8 py-3 text-sm font-semibold text-background transition-all duration-300 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
              >
                Connect
              </button>
            </div>
          </div>

        <div className="mt-8 rounded-[2rem] border border-onsurface/10 bg-surface-low/90 p-6 shadow-sm">
          <p className="text-sm uppercase tracking-[0.25em] text-primary/70">File preview</p>
          <div className="mt-4 rounded-[1.5rem] border border-onsurface/5 bg-background/80 p-5 min-h-[200px]">
            {p2pResult ? (
              <div className="space-y-3 animate-fade-in">
                <p className="text-sm text-onsurface/70">File received!</p>
                <p className="text-base font-semibold text-onsurface break-all">{p2pResult.fileName || 'Unknown file'}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-sm text-onsurface/70">Size</p>
                    <p className="text-base font-semibold text-onsurface">{formatBytes(p2pResult.fileSize)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-onsurface/70">Type</p>
                    <p className="text-base font-semibold text-onsurface break-all">{p2pResult.mimeType || 'application/octet-stream'}</p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setViewDetails(p2pResult)}
                    className="rounded-xl border border-onsurface/10 bg-onsurface/5 px-3 py-2 text-onsurface/60 transition-all duration-300 hover:border-primary/30 hover:text-primary hover:bg-primary/10"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={downloadP2PFile}
                    className="rounded-xl bg-gradient-to-r from-primary to-accent px-3 py-2 text-white shadow-sm transition-all duration-300 hover:shadow-md"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveP2P}
                    className="rounded-xl border border-onsurface/10 bg-onsurface/5 px-3 py-2 text-onsurface/60 transition-all duration-300 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : p2pStatus ? (
              <div className="space-y-3 animate-fade-in">
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-primary animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <p className="text-sm font-medium text-onsurface">{p2pStatus}</p>
                </div>
                {p2pProgress > 0 && (
                  <div className="space-y-1">
                    <div className="h-2 overflow-hidden rounded-full bg-onsurface/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
                        style={{ width: `${p2pProgress}%` }}
                      />
                    </div>
                    <p className="text-xs text-onsurface/60 text-right">{p2pProgress}%</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-onsurface/50">Enter a code above to receive a file.</p>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-3xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 animate-fade-in">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {viewDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setViewDetails(null)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary/70">File Details</p>
              <button onClick={() => setViewDetails(null)} className="rounded-xl p-1.5 text-onsurface-variant hover:bg-onsurface/10">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <div>
                <p className="text-xs text-onsurface-variant uppercase tracking-wider">Name</p>
                <p className="mt-1 font-semibold text-onsurface break-all">{viewDetails.fileName}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-onsurface-variant uppercase tracking-wider">Size</p>
                  <p className="mt-1 font-semibold text-onsurface">{formatBytes(viewDetails.fileSize)}</p>
                </div>
                <div>
                  <p className="text-xs text-onsurface-variant uppercase tracking-wider">Type</p>
                  <p className="mt-1 font-semibold text-onsurface break-all">{viewDetails.mimeType || 'Unknown'}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-onsurface-variant uppercase tracking-wider">Date &amp; Time</p>
                <p className="mt-1 font-semibold text-onsurface">{new Date().toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
