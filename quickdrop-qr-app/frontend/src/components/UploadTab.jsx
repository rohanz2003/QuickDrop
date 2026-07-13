import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { addLocalHistoryEvent } from '../utils/historyStorage.js';
import { apiUrl } from '../utils/api.js';
import { createOfferRoom, RTC_CONFIG, CHUNK_SIZE, SIGNALING_WS_URL } from '../utils/signaling.js';

const initialState = {
  files: [],
  qrSvg: null,
  qrData: null,
  roomCode: null,
  error: null,
  uploading: false,
  progress: 0,
  statusText: ''
};

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(1)} ${units[power]}`;
}

export default function UploadTab({ clientId, onChannelUpdate }) {
  const [state, setState] = useState(initialState);
  const [qrFormat, setQrFormat] = useState('png');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const roomIdRef = useRef(null);
  const xhrRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      peerRef.current?.close();
    };
  }, []);

  const filesInfo = useMemo(() => {
    if (!state.files.length) return null;
    const total = state.files.reduce((sum, f) => sum + f.size, 0);
    return `${state.files.length} file${state.files.length > 1 ? 's' : ''} • ${formatBytes(total)}`;
  }, [state.files]);

  const handleFiles = useCallback((newFiles) => {
    setState((prev) => ({
      ...prev,
      files: [...prev.files, ...Array.from(newFiles)],
      error: null, qrSvg: null, qrData: null, roomCode: null
    }));
  }, []);

  const removeFile = useCallback((index) => {
    setState((prev) => ({
      ...prev,
      files: prev.files.filter((_, i) => i !== index),
      error: null, qrSvg: null, qrData: null, roomCode: null
    }));
  }, []);

  const startP2P = async () => {
    const files = state.files;
    if (!files.length) return;

    setState((prev) => ({ ...prev, uploading: true, progress: 0, error: null, statusText: 'Creating room...' }));

    try {
      const first = files[0];
      const roomId = await createOfferRoom(clientId, files.length > 1 ? `${files.length} files` : first.name, files.reduce((s, f) => s + f.size, 0), first.type);
      roomIdRef.current = roomId;

      setState((prev) => ({ ...prev, roomCode: roomId, statusText: 'Waiting for receiver to connect...' }));

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
          setState((prev) => ({ ...prev, error: 'Peer disconnected', uploading: false }));
          onChannelUpdate?.({ connected: false });
        }
      };

      const channel = peer.createDataChannel('file-transfer');
      channelRef.current = channel;

      channel.onopen = () => {
        setState((prev) => ({ ...prev, statusText: 'Connected! Sending file...' }));
        onChannelUpdate?.({ channel, connected: true, role: 'sender' });
        sendFiles(state.files, channel);
      };

      channel.onmessage = (e) => {
        const data = e.data;
        if (data instanceof ArrayBuffer && data.byteLength >= 8) {
          const prefix = new TextDecoder().decode(data.slice(0, 8));
          if (prefix === '__CHAT__') {
            const chatData = JSON.parse(new TextDecoder().decode(data.slice(8)));
            onChannelUpdate?.({ chatMessage: { ...chatData, from: 'peer' } });
          }
        }
      };

      channel.onerror = () => {
        setState((prev) => ({ ...prev, error: 'Connection lost', uploading: false }));
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const ws = new WebSocket(SIGNALING_WS_URL);
      wsRef.current = ws;
      const pendingCandidates = [];

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'register-offer',
          payload: { roomId, offer: peer.localDescription }
        }));
      };

      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'signal') {
          const payload = msg.payload;
          if (payload.answer && !peer.remoteDescription) {
            peer.setRemoteDescription(new RTCSessionDescription(payload.answer))
              .then(() => {
                while (pendingCandidates.length) {
                  peer.addIceCandidate(new RTCIceCandidate(pendingCandidates.shift()));
                }
              })
              .catch(() => {
                setState((prev) => ({ ...prev, error: 'Connection failed', uploading: false }));
              });
          }
          if (payload.candidate) {
            if (peer.remoteDescription) {
              peer.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } else {
              pendingCandidates.push(payload.candidate);
            }
          }
        }

        if (msg.type === 'error') {
          setState((prev) => ({ ...prev, error: msg.payload.message, uploading: false }));
        }
      };

      ws.onerror = () => {
        setState((prev) => ({ ...prev, error: 'Signaling connection failed', uploading: false }));
      };

    } catch (err) {
      setState((prev) => ({ ...prev, uploading: false, error: err.message }));
    }
  };

  const sendFiles = (files, channel) => {
    const batchMeta = files.map(f => ({
      fileName: f.name,
      fileSize: f.size,
      mimeType: f.type || 'application/octet-stream'
    }));
    channel.send(new TextEncoder().encode('__BATCH_' + JSON.stringify(batchMeta)));

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    let fileIdx = 0;
    let offset = 0;

    const onDone = () => {
      setState((prev) => ({ ...prev, uploading: false, progress: 100, statusText: 'Complete!' }));
      const first = files[0];
      addLocalHistoryEvent(clientId, {
        clientId,
        fileId: roomIdRef.current,
        type: 'upload',
        fileName: files.length > 1 ? `${files.length} files` : first.name,
        fileSize: totalSize,
        mimeType: first.type,
        timestamp: new Date().toISOString()
      });
    };

    const sendEnd = () => {
      channel.onbufferedamountlow = null;
      channel.send(new TextEncoder().encode('__END__'));
      onDone();
    };

    const sendNext = () => {
      if (channel.readyState !== 'open') return;

      while (fileIdx < files.length && channel.bufferedAmount < 15728640) {
        const file = files[fileIdx];
        const end = Math.min(offset + CHUNK_SIZE, file.size);
        channel.send(file.slice(offset, end));
        offset = end;

        if (offset >= file.size) {
          fileIdx++;
          offset = 0;
        }

        let totalSent = 0;
        for (let i = 0; i < fileIdx; i++) totalSent += files[i].size;
        totalSent += offset;
        const pct = Math.round((totalSent / totalSize) * 100);
        setState((prev) => ({ ...prev, progress: pct, statusText: `Sending ${pct}%` }));
      }

      if (fileIdx >= files.length) {
        if (channel.bufferedAmount === 0) {
          sendEnd();
        } else {
          channel.onbufferedamountlow = sendEnd;
        }
        return;
      }

      channel.onbufferedamountlow = sendNext;
    };

    channel.bufferedAmountLowThreshold = 5242880;
    sendNext();
  };

  const uploadServer = async () => {
    if (!state.files.length) return;
    setState((prev) => ({ ...prev, uploading: true, progress: 0, error: null, statusText: 'Uploading to server...' }));

    const file = state.files[0];
    const formData = new FormData();
    formData.append('file', file);
    formData.append('clientId', clientId);
    formData.append('originalName', file.name);
    formData.append('mimeType', file.type);
    formData.append('sizeBytes', file.size);

    try {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setState((prev) => ({ ...prev, progress: pct, statusText: `Uploading ${pct}%` }));
        }
      };

      const result = await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error('Upload failed'));
          }
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.open('POST', apiUrl('/api/upload'));
        xhr.send(formData);
      });

      setState((prev) => ({
        ...prev,
        uploading: false,
        progress: 100,
        statusText: 'Complete!',
        qrSvg: result.qrSvg,
        qrData: result.downloadUrl
      }));

      addLocalHistoryEvent(clientId, {
        clientId,
        fileId: result.file.fileId,
        type: 'upload',
        fileName: result.file.originalName,
        fileSize: result.file.sizeBytes,
        mimeType: result.file.mimeType,
        timestamp: result.file.uploadedAt
      });
    } catch (error) {
      setState((prev) => ({ ...prev, uploading: false, error: error.message || 'Upload failed' }));
    }
  };

  const handleUpload = () => {
    startP2P();
  };

  const copyLink = async () => {
    if (!state.qrData) return;
    try {
      await navigator.clipboard.writeText(state.qrData);
    } catch {
      setState((prev) => ({ ...prev, error: 'Failed to copy link.' }));
    }
  };

  const downloadQrImage = async () => {
    if (!state.qrSvg) return;
    const format = qrFormat;
    const fileName = `quickdrop-qr.${format === 'jpeg' ? 'jpg' : format}`;

    if (format === 'svg') {
      const svgBlob = new Blob([state.qrSvg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return;
    }

    const svgData = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(state.qrSvg)}`;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(image, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) {
            setState((prev) => ({ ...prev, error: 'Unable to create image file.' }));
            return;
          }
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }, `image/${format}`);
      }
    };
    image.onerror = () => {
      setState((prev) => ({ ...prev, error: 'Failed to convert QR image.' }));
    };
    image.src = svgData;
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const cancelTransfer = () => {
    wsRef.current?.close();
    xhrRef.current?.abort();
    channelRef.current?.close();
    peerRef.current?.close();
    xhrRef.current = null;
    wsRef.current = null;
    channelRef.current = null;
    peerRef.current = null;
    roomIdRef.current = null;
    setState(initialState);
  };

  const refreshCode = () => {
    wsRef.current?.close();
    xhrRef.current?.abort();
    channelRef.current?.close();
    peerRef.current?.close();
    xhrRef.current = null;
    wsRef.current = null;
    channelRef.current = null;
    peerRef.current = null;
    roomIdRef.current = null;
    setState((prev) => ({
      ...prev,
      roomCode: null,
      qrSvg: null,
      qrData: null,
      uploading: false,
      progress: 0,
      error: null,
      statusText: ''
    }));
  };

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  return (
    <div className="space-y-3 animate-fade-in sm:space-y-6">
      <div className="grid gap-3 sm:gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div
          className={`relative rounded-2xl border bg-surface-low/80 p-4 shadow-sm transition-all duration-300 sm:rounded-[2rem] sm:p-6 ${
            dragOver ? 'border-primary shadow-glow-lg scale-[1.01]' : 'border-onsurface/10'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="flex flex-col gap-2 sm:gap-3">
            <div className="space-y-1 sm:space-y-2">
              <p className="text-[10px] uppercase tracking-[0.25em] text-primary/70 sm:text-sm">Upload</p>
              <h2 className="text-base font-semibold text-onsurface sm:text-2xl">
                Share file directly (P2P)
              </h2>
              <p className="text-xs text-onsurface/70 sm:text-sm">
                Your file stays on your device. Share the 4-digit code with the receiver to transfer directly.
              </p>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => fileInputRef.current.click()}
                className="group relative inline-flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-primary/20 to-primary/10 px-4 py-4 text-xs font-semibold text-primary border border-primary/30 transition-all duration-300 hover:shadow-glow hover:from-primary/30 hover:to-primary/20 sm:rounded-3xl sm:px-5 sm:py-6 sm:text-sm"
              >
                <span className="flex items-center gap-2 sm:gap-3">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  {state.files.length ? 'Add more files' : 'Choose files'}
                </span>
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => event.target.files?.length && handleFiles(event.target.files)}
            />

            <div className="rounded-2xl border border-onsurface/5 bg-surface/50 p-3 text-xs text-onsurface-variant sm:rounded-3xl sm:p-4 sm:text-sm">
              <p className="font-semibold text-onsurface flex items-center gap-2">
                <svg className="w-3 h-3 text-primary sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Direct transfer info
              </p>
              <p className="mt-1">
                The receiver needs to enter your 4-digit code while you stay online. File is transferred directly browser-to-browser.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-onsurface/10 bg-surface-low/80 p-4 shadow-sm sm:rounded-[2rem] sm:p-6">
          <p className="text-[10px] uppercase tracking-[0.25em] text-primary/70 sm:text-sm">Preview</p>
          <div className="mt-3 min-h-[100px] rounded-2xl border border-onsurface/5 bg-background/80 p-3 sm:mt-5 sm:min-h-[180px] sm:rounded-3xl sm:p-4">
            {state.files.length ? (
              <div className="space-y-2 animate-fade-in sm:space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-onsurface/70 sm:text-sm">
                    {state.files.length} file{state.files.length > 1 ? 's' : ''} selected
                  </p>
                  <p className="text-xs font-semibold text-onsurface sm:text-sm">{filesInfo}</p>
                </div>
                <div className="max-h-36 space-y-1.5 overflow-y-auto sm:max-h-48 sm:space-y-2">
                  {state.files.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-xl border border-onsurface/5 bg-background/60 px-2 py-1.5 sm:rounded-2xl sm:px-3 sm:py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-onsurface sm:text-sm">{f.name}</p>
                        <p className="text-[10px] text-onsurface/50 sm:text-xs">{formatBytes(f.size)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        disabled={state.uploading}
                        className="shrink-0 rounded-lg border border-onsurface/10 bg-onsurface/5 p-1 text-onsurface/60 transition-all duration-300 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 disabled:hidden sm:rounded-xl sm:p-1.5"
                      >
                        <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px] text-onsurface/70 sm:gap-2 sm:text-xs">
                  <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-primary sm:px-3 sm:py-1">
                    Direct transfer
                  </span>
                  <span className="rounded-full bg-onsurface/5 px-2 py-0.5 sm:px-3 sm:py-1">
                    Real-time
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center min-h-[80px] sm:min-h-[140px]">
                <svg className="w-8 h-8 text-primary/30 mb-2 sm:w-12 sm:h-12 sm:mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-xs text-onsurface/50 sm:text-sm">No file selected yet.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-onsurface/10 bg-surface/80 p-4 shadow-sm sm:rounded-[2rem] sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-primary/70 sm:text-sm">Upload action</p>
            <h3 className="mt-1 text-sm font-semibold text-onsurface sm:mt-2 sm:text-xl">
              Start direct transfer
            </h3>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleUpload}
              disabled={!state.files.length || state.uploading}
              className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-primary to-accent px-4 py-2 text-xs font-semibold text-background transition-all duration-300 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50 sm:rounded-3xl sm:px-6 sm:py-3 sm:text-sm"
            >
              {state.uploading ? (
                <span className="flex items-center gap-2">
                  <svg className="w-3 h-3 animate-spin sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {state.statusText || 'Processing...'}
                </span>
              ) : (
                'Start direct transfer'
              )}
            </button>
            {state.uploading && (
              <button
                type="button"
                onClick={cancelTransfer}
                className="inline-flex items-center justify-center rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 transition-all duration-300 hover:bg-red-500/20 hover:shadow-glow-sm sm:rounded-3xl sm:px-4 sm:py-3 sm:text-sm"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 space-y-2 sm:mt-5 sm:space-y-3">
          {state.uploading || state.progress > 0 ? (
            <div className="space-y-1 sm:space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-onsurface/5 sm:h-3">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
                  style={{ width: `${state.progress}%` }}
                />
              </div>
              <p className="text-[10px] text-onsurface/60 text-right sm:text-xs">{state.statusText}</p>
            </div>
          ) : null}
          {state.error && (
            <div className="flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400 animate-fade-in sm:rounded-3xl sm:px-4 sm:py-3 sm:text-sm">
              <svg className="w-3 h-3 shrink-0 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {state.error}
            </div>
          )}
        </div>
      </div>

      {state.roomCode && (
        <section className="rounded-2xl border border-onsurface/10 bg-surface-low/80 p-4 shadow-sm animate-bounce-in sm:rounded-[2rem] sm:p-6">
          <div className="flex flex-col items-center gap-3 sm:gap-6">
            <p className="text-[10px] uppercase tracking-[0.25em] text-primary/70 sm:text-sm">Share this code with receiver</p>
            <div className="relative">
              <div className="flex h-20 w-44 items-center justify-center rounded-2xl bg-background border border-primary/30 shadow-glow-lg sm:h-32 sm:w-64 sm:rounded-3xl">
                <span className="text-4xl font-extrabold tracking-[0.2em] text-primary sm:text-6xl">{state.roomCode}</span>
              </div>
              <button
                type="button"
                onClick={refreshCode}
                className="absolute -top-1.5 -right-1.5 rounded-full border border-onsurface/10 bg-surface-low p-1 text-onsurface/60 shadow-sm transition-all duration-300 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 sm:-top-2 sm:-right-2 sm:p-1.5"
                title="Generate new code"
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
            <p className="text-sm font-semibold text-onsurface sm:text-xl">Waiting for receiver to connect...</p>
            <div className="flex items-center gap-2 rounded-2xl bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-primary animate-pulse-glow sm:rounded-3xl sm:px-4 sm:py-3 sm:text-sm">
              <span className="flex h-1.5 w-1.5 rounded-full bg-primary animate-ping sm:h-2 sm:w-2" />
              Tell the receiver to enter this 4-digit code in the Receive tab
            </div>
          </div>
        </section>
      )}

      {state.qrSvg && (
        <section className="rounded-2xl border border-onsurface/10 bg-surface-low/80 p-4 shadow-sm animate-bounce-in sm:rounded-[2rem] sm:p-6">
          <div className="grid gap-4 sm:gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-onsurface/10 bg-background/80 p-4 sm:rounded-3xl sm:p-6">
              <div className="mx-auto flex h-[160px] w-[160px] items-center justify-center rounded-2xl bg-white p-3 shadow-glow-lg sm:h-[260px] sm:w-[260px] sm:rounded-3xl sm:p-4">
                <div
                  className="w-full h-full"
                  dangerouslySetInnerHTML={{ __html: state.qrSvg }}
                />
              </div>
              <p className="mt-2 text-center text-[10px] text-onsurface/50 sm:mt-3 sm:text-xs">Scan to download</p>
            </div>
            <div className="space-y-3 sm:space-y-4">
              <p className="text-[10px] uppercase tracking-[0.25em] text-primary/70 sm:text-sm">QR ready</p>
              <p className="text-sm font-semibold text-onsurface sm:text-xl">Scan this QR to download your file</p>
              <div className="rounded-2xl border border-onsurface/5 bg-surface/80 p-3 text-xs text-onsurface-variant sm:rounded-3xl sm:p-4 sm:text-sm">
                <p className="font-semibold text-onsurface flex items-center gap-2">
                  <svg className="w-3 h-3 text-primary sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  Link
                </p>
                <p className="mt-1 break-all text-xs text-onsurface/80 font-mono sm:mt-2 sm:text-sm">{state.qrData}</p>
              </div>
              <div className="flex flex-wrap gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={copyLink}
                  className="rounded-2xl bg-gradient-to-r from-primary/20 to-accent/20 border border-primary/30 px-4 py-2 text-xs font-semibold text-primary transition-all duration-300 hover:shadow-glow-sm hover:from-primary/30 hover:to-accent/30 sm:rounded-3xl sm:px-5 sm:py-3 sm:text-sm"
                >
                  Copy link
                </button>
                <button
                  type="button"
                  onClick={downloadQrImage}
                  className="rounded-2xl border border-onsurface/10 bg-surface px-4 py-2 text-xs font-semibold text-onsurface transition-all duration-300 hover:bg-surface-high hover:shadow-glow-sm sm:rounded-3xl sm:px-5 sm:py-3 sm:text-sm"
                >
                  Download QR
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
