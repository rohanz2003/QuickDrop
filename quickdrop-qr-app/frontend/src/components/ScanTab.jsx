import { useCallback, useEffect, useRef, useState } from 'react';
import { addLocalHistoryEvent } from '../utils/historyStorage.js';
import { RTC_CONFIG, SIGNALING_WS_URL } from '../utils/signaling.js';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(1)} ${units[power]}`;
}

export default function ScanTab({ clientId, pendingRoom, onChannelUpdate }) {
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [p2pStatus, setP2pStatus] = useState('');
  const [p2pProgress, setP2pProgress] = useState(0);
  const [p2pResult, setP2pResult] = useState(null);
  const [viewDetails, setViewDetails] = useState(null);

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
  const fileListRef = useRef(null);
  const receiveStartTimeRef = useRef(0);
  const endReceivedRef = useRef(false);
  const blobsRef = useRef([]);

  const tryFinish = () => {
    const fileList = fileListRef.current;
    if (!fileList || !fileList.length) return;

    const totalExpected = fileList.reduce((s, f) => s + f.fileSize, 0);
    const received = receivedSizeRef.current;

    if (received !== totalExpected) {
      setP2pStatus(`Waiting for remaining data (${formatBytes(received)} / ${formatBytes(totalExpected)})...`);
      return;
    }

    const buf = new Uint8Array(received);
    let pos = 0;
    for (const chunk of receiveBufferRef.current) {
      buf.set(new Uint8Array(chunk), pos);
      pos += chunk.byteLength;
    }

    const blobs = [];
    let offset = 0;
    for (const info of fileList) {
      blobs.push(new Blob([buf.slice(offset, offset + info.fileSize)]));
      offset += info.fileSize;
    }
    blobsRef.current = blobs;

    for (const info of fileList) {
      addLocalHistoryEvent(clientId, {
        clientId,
        fileId: 'p2p-' + Date.now(),
        type: 'download',
        fileName: info.fileName,
        fileSize: info.fileSize,
        mimeType: info.mimeType,
        timestamp: new Date().toISOString()
      });
    }

    setP2pResult(fileList);
    setP2pStatus('Download ready!');
    setP2pProgress(100);
  };

  const startP2PDownload = useCallback(async (roomId) => {
    setP2pStatus('Connecting...');
    setP2pProgress(0);

    const peer = new RTCPeerConnection(RTC_CONFIG);
    peerRef.current = peer;

    peer.onicecandidate = (e) => {
      if (e.candidate && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'signal',
          payload: { roomId, candidate: e.candidate.toJSON() }
        }));
      }
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        onChannelUpdate?.({ connected: true });
      }
      if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
        setError('Peer disconnected');
        setP2pStatus('');
        onChannelUpdate?.({ connected: false });
      }
    };

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
        onChannelUpdate?.({ channel, connected: true, role: 'receiver' });
      };

      channel.onmessage = (e) => {
        const data = e.data;

        if (data instanceof ArrayBuffer && data.byteLength >= 8) {
          const prefix = new TextDecoder().decode(data.slice(0, 8));
          if (prefix === '__CHAT__') {
            const chatData = JSON.parse(new TextDecoder().decode(data.slice(8)));
            onChannelUpdate?.({ chatMessage: { ...chatData, from: 'peer' } });
            return;
          }
        }

        if (data instanceof ArrayBuffer && data.byteLength === 6 && new TextDecoder().decode(data) === '__END__') {
          tryFinish();
          return;
        }

        if (data instanceof ArrayBuffer && data.byteLength >= 8) {
          const prefix = new TextDecoder().decode(data.slice(0, 8));
          if (prefix === '__BATCH_') {
            const fileList = JSON.parse(new TextDecoder().decode(data.slice(8)));
            fileListRef.current = fileList;
            fileMetaRef.current = fileList[0] || null;
            receiveBufferRef.current = [];
            receivedSizeRef.current = 0;
            receiveStartTimeRef.current = Date.now();
            setP2pStatus(`Receiving ${fileList.length} file${fileList.length > 1 ? 's' : ''}...`);
            return;
          }
        }

        if (data instanceof ArrayBuffer && data.byteLength >= 8) {
          const prefix = new TextDecoder().decode(data.slice(0, 8));
          if (prefix === '__META__') {
            const meta = JSON.parse(new TextDecoder().decode(data.slice(8)));
            fileListRef.current = [meta];
            fileMetaRef.current = meta;
            receiveBufferRef.current = [];
            receivedSizeRef.current = 0;
            receiveStartTimeRef.current = Date.now();
            return;
          }
        }

        receiveBufferRef.current.push(data);
        receivedSizeRef.current += data.byteLength;
        const list = fileListRef.current;
        if (list && list.length) {
          const total = list.reduce((s, f) => s + f.fileSize, 0);
          const pct = Math.round((receivedSizeRef.current / total) * 100);
          const statusText = pct >= 5
            ? (() => {
                const elapsed = (Date.now() - receiveStartTimeRef.current) / 1000;
                const rate = receivedSizeRef.current / elapsed;
                const remaining = rate > 0 ? Math.round((total - receivedSizeRef.current) / rate) : 0;
                const eta = remaining >= 60 ? `${Math.floor(remaining / 60)}m ${remaining % 60}s` : `${remaining}s`;
                return `Receiving ${pct}% · ${eta} left`;
              })()
            : `Receiving ${pct}%`;
          setP2pProgress(pct);
          setP2pStatus(statusText);
          if (pct >= 100) tryFinish();
        }
      };

      channel.onerror = () => {
        setError('Channel error');
        setP2pStatus('');
      };
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

  const downloadP2PFile = (index) => {
    const blob = blobsRef.current[index];
    const info = p2pResult?.[index];
    if (!blob || !info) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = info.fileName || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const downloadAllP2P = () => {
    for (let i = 0; i < (p2pResult?.length || 0); i++) {
      setTimeout(() => downloadP2PFile(i), i * 500);
    }
  };

  const handleRemoveP2P = () => {
    wsRef.current?.close();
    peerRef.current?.close();
    wsRef.current = null;
    peerRef.current = null;
    channelRef.current = null;
    blobsRef.current = [];
    receiveBufferRef.current = [];
    receivedSizeRef.current = 0;
    fileMetaRef.current = null;
    fileListRef.current = null;
    receiveStartTimeRef.current = 0;
    endReceivedRef.current = false;
    setP2pResult(null);
    setP2pStatus('');
    setP2pProgress(0);
    setRoomCode('');
    setError('');
  };



  return (
    <div className="space-y-3 animate-fade-in sm:space-y-6">
      <div className="rounded-2xl border border-onsurface/10 bg-surface-low/80 p-4 shadow-sm sm:rounded-[2rem] sm:p-6">
        <div className="flex flex-col items-center gap-3 sm:gap-6">
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-[0.35em] text-primary/70 sm:text-sm">Connect to sender</p>
              <h2 className="mt-1 text-lg font-semibold text-onsurface sm:mt-2 sm:text-3xl">Enter the 4-digit code</h2>
              <p className="mt-1 text-xs text-onsurface/70 sm:mt-2 sm:text-sm">
                Ask the sender for their code and enter it below to receive the file directly.
              </p>
            </div>

            <div className="flex flex-col items-center gap-3 sm:gap-4">
              <input
                type="text"
                maxLength={4}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                placeholder="0000"
                className="w-36 rounded-xl border border-onsurface/10 bg-background px-4 py-3 text-center text-2xl font-extrabold tracking-[0.3em] text-primary outline-none focus:border-primary/50 focus:shadow-glow-sm transition-all duration-300 sm:w-48 sm:rounded-2xl sm:px-6 sm:py-4 sm:text-4xl"
                disabled={!!p2pStatus || !!p2pResult}
                inputMode="numeric"
                autoFocus
              />
              <button
                type="button"
                onClick={handleConnect}
                disabled={roomCode.length !== 4 || !!p2pStatus || !!p2pResult}
                className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-primary to-accent px-6 py-2 text-xs font-semibold text-background transition-all duration-300 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50 sm:rounded-3xl sm:px-8 sm:py-3 sm:text-sm"
              >
                Connect
              </button>
              <button
                type="button"
                onClick={handleRemoveP2P}
                disabled={!roomCode && !p2pStatus && !p2pResult}
                className="rounded-lg border border-onsurface/10 bg-onsurface/5 p-1.5 text-onsurface/60 transition-all duration-300 hover:border-primary/30 hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed sm:rounded-xl sm:p-2.5"
                title="Clear"
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

        <div className="mt-4 rounded-2xl border border-onsurface/10 bg-surface-low/90 p-4 shadow-sm sm:mt-8 sm:rounded-[2rem] sm:p-6">
          <p className="text-[10px] uppercase tracking-[0.25em] text-primary/70 sm:text-sm">File preview</p>
          <div className="mt-3 rounded-xl border border-onsurface/5 bg-background/80 p-3 min-h-[100px] sm:mt-4 sm:rounded-[1.5rem] sm:p-5 sm:min-h-[200px]">
            {p2pResult ? (
              <div className="space-y-2 animate-fade-in sm:space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-onsurface/70 sm:text-sm">
                    {p2pResult.length} file{p2pResult.length > 1 ? 's' : ''} received!
                  </p>
                  <p className="text-xs font-semibold text-onsurface sm:text-sm">
                    {formatBytes(p2pResult.reduce((s, f) => s + f.fileSize, 0))}
                  </p>
                </div>
                <div className="max-h-36 space-y-1.5 overflow-y-auto sm:max-h-48 sm:space-y-2">
                  {p2pResult.map((info, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-xl border border-onsurface/5 bg-background/60 px-2 py-1.5 sm:rounded-2xl sm:px-3 sm:py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-onsurface sm:text-sm">{info.fileName}</p>
                        <p className="text-[10px] text-onsurface/50 sm:text-xs">{formatBytes(info.fileSize)}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => downloadP2PFile(i)}
                          className="rounded-lg bg-gradient-to-r from-primary to-accent px-2 py-1.5 text-white shadow-sm transition-all duration-300 hover:shadow-md sm:rounded-xl sm:px-3 sm:py-2"
                          title="Download"
                        >
                          <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewDetails(info)}
                          className="rounded-lg border border-onsurface/10 bg-onsurface/5 px-2 py-1.5 text-onsurface/60 transition-all duration-300 hover:border-primary/30 hover:text-primary hover:bg-primary/10 sm:rounded-xl sm:px-3 sm:py-2"
                          title="Details"
                        >
                          <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  {p2pResult.length > 1 && (
                    <button
                      type="button"
                      onClick={downloadAllP2P}
                      className="rounded-2xl bg-gradient-to-r from-primary to-accent px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all duration-300 hover:shadow-md sm:rounded-3xl sm:px-5 sm:py-2.5 sm:text-sm"
                    >
                      Download All
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleRemoveP2P}
                    className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 transition-all duration-300 hover:bg-red-500/20 sm:rounded-3xl sm:px-5 sm:py-2.5 sm:text-sm"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : p2pStatus ? (
              <div className="space-y-2 animate-fade-in sm:space-y-3">
                <div className="flex items-start justify-between gap-2 sm:gap-3">
                  <div className="flex items-center gap-2 min-w-0 sm:gap-3">
                    <svg className="w-4 h-4 text-primary animate-spin shrink-0 sm:w-5 sm:h-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <p className="text-xs font-medium text-onsurface sm:text-sm">{p2pStatus}</p>
                  </div>
                  {!p2pResult && (
                    <button
                      type="button"
                      onClick={handleRemoveP2P}
                      className="shrink-0 rounded-lg border border-onsurface/10 bg-onsurface/5 p-1 text-onsurface/60 transition-all duration-300 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 sm:rounded-xl sm:p-1.5"
                      title="Cancel"
                    >
                      <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                {p2pProgress > 0 && (
                  <div className="space-y-1">
                    <div className="h-1.5 overflow-hidden rounded-full bg-onsurface/5 sm:h-2">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
                        style={{ width: `${p2pProgress}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-onsurface/60 text-right sm:text-xs">{p2pProgress}%</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-onsurface/50 sm:text-sm">Enter a code above to receive a file.</p>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400 animate-fade-in sm:rounded-3xl sm:px-4 sm:py-3 sm:text-sm">
          <svg className="w-3 h-3 shrink-0 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {viewDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setViewDetails(null)}>
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl ring-1 ring-black/5 animate-slide-up sm:max-w-md sm:rounded-3xl sm:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/70 sm:text-sm">File Details</p>
              <button onClick={() => setViewDetails(null)} className="rounded-lg p-1 text-onsurface-variant hover:bg-onsurface/10 sm:rounded-xl sm:p-1.5">
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mt-4 space-y-3 sm:mt-5 sm:space-y-4">
              <div>
                <p className="text-[10px] text-onsurface-variant uppercase tracking-wider sm:text-xs">Name</p>
                <p className="mt-1 text-xs font-semibold text-onsurface break-all sm:text-sm">{viewDetails.fileName}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <p className="text-[10px] text-onsurface-variant uppercase tracking-wider sm:text-xs">Size</p>
                  <p className="mt-1 text-xs font-semibold text-onsurface sm:text-sm">{formatBytes(viewDetails.fileSize)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-onsurface-variant uppercase tracking-wider sm:text-xs">Type</p>
                  <p className="mt-1 text-xs font-semibold text-onsurface break-all sm:text-sm">{viewDetails.mimeType || 'Unknown'}</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-onsurface-variant uppercase tracking-wider sm:text-xs">Date &amp; Time</p>
                <p className="mt-1 text-xs font-semibold text-onsurface sm:text-sm">{new Date().toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
