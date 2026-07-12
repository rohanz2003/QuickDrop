import { useCallback, useEffect, useRef, useState } from 'react';
import { addLocalHistoryEvent } from '../utils/historyStorage.js';
import { apiUrl, downloadUrl } from '../utils/api.js';
import { RTC_CONFIG, SIGNALING_WS_URL } from '../utils/signaling.js';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(1)} ${units[power]}`;
}

export default function ScanTab({ clientId, mode, pendingRoom }) {
  const [roomCode, setRoomCode] = useState('');
  const [filePreview, setFilePreview] = useState(null);
  const [error, setError] = useState('');
  const [p2pStatus, setP2pStatus] = useState('');
  const [p2pProgress, setP2pProgress] = useState(0);
  const [p2pResult, setP2pResult] = useState(null);

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
            const blob = new Blob(receiveBufferRef.current);
            const url = URL.createObjectURL(blob);
            const meta = fileMetaRef.current;

            addLocalHistoryEvent(clientId, {
              clientId,
              fileId: 'p2p-' + Date.now(),
              type: 'download',
              fileName: meta?.fileName || 'Unknown',
              fileSize: meta?.fileSize || 0,
              mimeType: meta?.mimeType || 'application/octet-stream',
              timestamp: new Date().toISOString()
            });

            setP2pResult({ blobUrl: url, ...meta });
            setP2pStatus('Download ready!');
            setP2pProgress(100);
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
    if (!p2pResult?.blobUrl) return;
    const link = document.createElement('a');
    link.href = p2pResult.blobUrl;
    link.download = p2pResult.fileName || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadFromUrl = (url) => {
    const match = url.match(/\/d\/(.+)$/);
    if (!match) {
      setError('Invalid download link');
      return;
    }
    const fileId = match[1];
    fetch(apiUrl(`/api/file/${fileId}`))
      .then((res) => res.json())
      .then((data) => {
        if (data.file) {
          setFilePreview(data.file);

          addLocalHistoryEvent(clientId, {
            clientId,
            fileId,
            type: 'download',
            fileName: data.file.originalName,
            fileSize: data.file.sizeBytes,
            mimeType: data.file.mimeType,
            timestamp: new Date().toISOString()
          });

          const link = document.createElement('a');
          link.href = downloadUrl(fileId, clientId);
          link.setAttribute('download', '');
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } else {
          setError(data.error || 'Could not fetch file metadata');
        }
      })
      .catch(() => setError('Unable to load file metadata'));
  };

  const handleUrlPaste = (e) => {
    const url = e.clipboardData?.getData('text') || '';
    if (url.includes('/d/')) {
      e.preventDefault();
      downloadFromUrl(url);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="rounded-[2rem] border border-white/10 bg-surface-low/80 p-6 shadow-sm">
        {mode === 'P2P' ? (
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
                className="w-48 rounded-2xl border border-white/10 bg-background px-6 py-4 text-center text-4xl font-extrabold tracking-[0.3em] text-primary outline-none focus:border-primary/50 focus:shadow-glow-sm transition-all duration-300"
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
        ) : (
          <div className="flex flex-col items-center gap-3 text-center mb-6">
            <p className="text-sm uppercase tracking-[0.35em] text-primary/70">Download from server</p>
            <h2 className="text-3xl font-semibold text-onsurface">Paste a download link</h2>
            <p className="max-w-2xl text-sm leading-6 text-onsurface/70">
              Paste a QuickDrop download URL to preview and download the file.
            </p>
            <input
              type="text"
              placeholder="Paste download URL here..."
              onPaste={handleUrlPaste}
              className="mt-2 w-full max-w-md rounded-2xl border border-white/10 bg-background px-5 py-3 text-sm text-onsurface outline-none focus:border-primary/50 focus:shadow-glow-sm transition-all duration-300"
            />
          </div>
        )}

        <div className="mt-8 rounded-[2rem] border border-white/10 bg-surface-low/90 p-6 shadow-sm">
          <p className="text-sm uppercase tracking-[0.25em] text-primary/70">File preview</p>
          <div className="mt-4 rounded-[1.5rem] border border-white/5 bg-background/80 p-5 min-h-[200px]">
            {filePreview ? (
              <div className="space-y-3 animate-fade-in">
                <p className="text-sm text-onsurface/70">File name</p>
                <p className="text-base font-semibold text-onsurface break-all">{filePreview.originalName}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-sm text-onsurface/70">Size</p>
                    <p className="text-base font-semibold text-onsurface">{formatBytes(filePreview.sizeBytes)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-onsurface/70">Type</p>
                    <p className="text-base font-semibold text-onsurface break-all">{filePreview.mimeType}</p>
                  </div>
                </div>
              </div>
            ) : p2pResult ? (
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
                <button
                  type="button"
                  onClick={downloadP2PFile}
                  className="mt-2 inline-flex w-full items-center justify-center rounded-3xl bg-gradient-to-r from-primary to-accent px-5 py-4 text-sm font-semibold text-background transition-all duration-300 hover:shadow-glow"
                >
                  Download file
                </button>
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
                    <div className="h-2 overflow-hidden rounded-full bg-white/5">
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
              <p className="text-sm text-onsurface/50">
                {mode === 'P2P' ? 'Enter a code above to receive a file.' : 'Paste a download URL to preview a file.'}
              </p>
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
    </div>
  );
}
