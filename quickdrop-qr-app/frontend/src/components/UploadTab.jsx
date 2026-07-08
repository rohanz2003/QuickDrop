import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { addLocalHistoryEvent } from '../utils/historyStorage.js';
import { apiUrl } from '../utils/api.js';
import { connectSignaling, sendSignaling, createOfferRoom, RTC_CONFIG, CHUNK_SIZE } from '../utils/signaling.js';

const initialState = {
  file: null,
  qrSvg: null,
  qrData: null,
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

export default function UploadTab({ clientId, mode }) {
  const [state, setState] = useState(initialState);
  const [qrFormat, setQrFormat] = useState('png');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const wsRef = useRef(null);
  const roomIdRef = useRef(null);

  useEffect(() => {
    return () => {
      peerRef.current?.close();
      wsRef.current?.close();
    };
  }, []);

  const fileInfo = useMemo(() => {
    if (!state.file) return null;
    return `${state.file.name} • ${formatBytes(state.file.size)} • ${state.file.type || 'Unknown'}`;
  }, [state.file]);

  const handleFile = useCallback((file) => {
    setState((prev) => ({ ...prev, file, error: null, qrSvg: null, qrData: null }));
  }, []);

  const startP2P = async () => {
    const file = state.file;
    if (!file) return;

    setState((prev) => ({ ...prev, uploading: true, progress: 0, error: null, statusText: 'Creating room...' }));

    try {
      const roomId = await createOfferRoom(clientId, file.name, file.size, file.type);
      roomIdRef.current = roomId;

      const qrUrl = `${window.location.origin}/receive?room=${roomId}`;
      const qrSvg = await QRCode.toString(qrUrl, { type: 'svg', margin: 1, color: { dark: '#00FFFF', light: '#0A192F' } });
      setState((prev) => ({ ...prev, qrSvg, qrData: qrUrl, statusText: 'Waiting for receiver to scan...' }));

      const peer = new RTCPeerConnection(RTC_CONFIG);
      peerRef.current = peer;

      const channel = peer.createDataChannel('file-transfer');
      channelRef.current = channel;

      channel.onopen = () => {
        setState((prev) => ({ ...prev, statusText: 'Connected! Sending file...' }));
        sendFile(file, channel);
      };

      channel.onerror = () => {
        setState((prev) => ({ ...prev, error: 'Connection lost', uploading: false }));
      };

      peer.onicecandidate = (e) => {
        if (e.candidate && wsRef.current) {
          sendSignaling(wsRef.current, 'signal', { roomId, candidate: e.candidate.toJSON() });
        }
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
          setState((prev) => ({ ...prev, error: 'Peer disconnected', uploading: false }));
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const ws = connectSignaling(
        (msg) => {
          if (msg.type === 'signal' && msg.payload) {
            const p = msg.payload;
            if (p.answer) {
              peer.setRemoteDescription(new RTCSessionDescription(p.answer));
            } else if (p.candidate) {
              peer.addIceCandidate(new RTCIceCandidate(p.candidate));
            }
          } else if (msg.type === 'peer-disconnected') {
            setState((prev) => ({ ...prev, error: 'Receiver disconnected', uploading: false }));
          }
        },
        (err) => setState((prev) => ({ ...prev, error: err, uploading: false }))
      );
      wsRef.current = ws;

      ws.onopen = () => {
        sendSignaling(ws, 'register-offer', { roomId, offer: peer.localDescription });
      };
    } catch (err) {
      setState((prev) => ({ ...prev, uploading: false, error: err.message }));
    }
  };

  const sendFile = (file, channel) => {
    const reader = new FileReader();
    let offset = 0;
    const fileSize = file.size;

    reader.onload = () => {
      const chunk = reader.result;
      if (channel.readyState === 'open') {
        channel.send(chunk);
        offset += chunk.byteLength;
        const pct = Math.round((offset / fileSize) * 100);
        setState((prev) => ({ ...prev, progress: pct, statusText: `Sending ${pct}%` }));
      }

      if (offset < fileSize) {
        readSlice(offset);
      } else {
        setState((prev) => ({ ...prev, uploading: false, progress: 100, statusText: 'Complete!' }));
        addLocalHistoryEvent(clientId, {
          clientId,
          fileId: roomIdRef.current,
          type: 'upload',
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          timestamp: new Date().toISOString()
        });
      }
    };

    reader.onerror = () => {
      setState((prev) => ({ ...prev, error: 'Failed to read file', uploading: false }));
    };

    const readSlice = (start) => {
      const slice = file.slice(start, start + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    readSlice(0);
  };

  const uploadServer = async () => {
    if (!state.file) return;
    setState((prev) => ({ ...prev, uploading: true, progress: 0, error: null, statusText: 'Uploading to server...' }));

    const formData = new FormData();
    formData.append('file', state.file);
    formData.append('clientId', clientId);
    formData.append('originalName', state.file.name);
    formData.append('mimeType', state.file.type);
    formData.append('sizeBytes', state.file.size);

    try {
      const xhr = new XMLHttpRequest();
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
    if (mode === 'P2P') {
      startP2P();
    } else {
      uploadServer();
    }
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
      const ctx = canvas.getContext('2d');
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
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div
          className={`relative rounded-[2rem] border bg-surface-low/80 p-6 shadow-sm transition-all duration-300 ${
            dragOver ? 'border-primary shadow-glow-lg scale-[1.01]' : 'border-white/10'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="flex flex-col gap-3">
            <div className="space-y-2">
              <p className="text-sm uppercase tracking-[0.25em] text-primary/70">Upload</p>
              <h2 className="text-2xl font-semibold text-onsurface">
                {mode === 'P2P' ? 'Share file directly (P2P)' : 'Upload file to server'}
              </h2>
              <p className="text-sm text-onsurface/70">
                {mode === 'P2P'
                  ? 'Your file stays on your device. A QR code lets the receiver connect directly to you.'
                  : 'Files are stored for 7 days on the server. No login required.'}
              </p>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => fileInputRef.current.click()}
                className="group relative inline-flex w-full items-center justify-center rounded-3xl bg-gradient-to-r from-primary/20 to-primary/10 px-5 py-6 text-sm font-semibold text-primary border border-primary/30 transition-all duration-300 hover:shadow-glow hover:from-primary/30 hover:to-primary/20"
              >
                <span className="flex items-center gap-3">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  {state.file ? 'Choose different file' : 'Choose file'}
                </span>
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])}
            />

            <div className="rounded-3xl border border-white/5 bg-surface/50 p-4 text-sm text-onsurface-variant">
              <p className="font-semibold text-onsurface flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {mode === 'P2P' ? 'Direct transfer info' : 'Server upload info'}
              </p>
              <p className="mt-1">
                {mode === 'P2P'
                  ? 'The receiver needs to scan the QR while you stay online. File is transferred directly browser-to-browser.'
                  : 'Upload limit is 2GB per file. Files expire automatically after 7 days.'}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-surface-low/80 p-6 shadow-sm">
          <p className="text-sm uppercase tracking-[0.25em] text-primary/70">Preview</p>
          <div className="mt-5 min-h-[180px] rounded-3xl border border-white/5 bg-background/80 p-4">
            {state.file ? (
              <div className="space-y-3 animate-fade-in">
                <p className="text-sm text-onsurface/70">Selected file</p>
                <p className="text-base font-semibold text-onsurface break-all">{fileInfo}</p>
                <div className="flex flex-wrap gap-2 text-xs text-onsurface/70">
                  <span className="rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-primary">
                    {mode === 'P2P' ? 'Direct transfer' : 'Upload limit 2GB'}
                  </span>
                  <span className="rounded-full bg-white/5 px-3 py-1">
                    {mode === 'P2P' ? 'Real-time' : 'Expires in 7 days'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center min-h-[140px]">
                <svg className="w-12 h-12 text-primary/30 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm text-onsurface/50">No file selected yet.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-[2rem] border border-white/10 bg-surface/80 p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-primary/70">Upload action</p>
            <h3 className="mt-2 text-xl font-semibold text-onsurface">
              {mode === 'P2P' ? 'Start direct transfer' : 'Upload and generate QR'}
            </h3>
          </div>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!state.file || state.uploading}
            className="inline-flex items-center justify-center rounded-3xl bg-gradient-to-r from-primary to-accent px-6 py-3 text-sm font-semibold text-background transition-all duration-300 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.uploading ? (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {state.statusText || 'Processing...'}
              </span>
            ) : (
              mode === 'P2P' ? 'Start direct transfer' : 'Start upload'
            )}
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {state.uploading || state.progress > 0 ? (
            <div className="space-y-2">
              <div className="h-3 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
                  style={{ width: `${state.progress}%` }}
                />
              </div>
              <p className="text-xs text-onsurface/60 text-right">{state.statusText}</p>
            </div>
          ) : null}
          {state.error && (
            <div className="flex items-center gap-2 rounded-3xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 animate-fade-in">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {state.error}
            </div>
          )}
        </div>
      </div>

      {state.qrSvg && (
        <section className="rounded-[2rem] border border-white/10 bg-surface-low/80 p-6 shadow-sm animate-bounce-in">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-3xl border border-white/10 bg-background/80 p-6">
              <div className="mx-auto flex h-[260px] w-[260px] items-center justify-center rounded-3xl bg-white p-4 shadow-glow-lg">
                <div
                  className="w-full h-full"
                  dangerouslySetInnerHTML={{ __html: state.qrSvg }}
                />
              </div>
              <p className="mt-3 text-center text-xs text-onsurface/50">
                {mode === 'P2P' ? 'Share this QR with the receiver' : 'Scan to download'}
              </p>
            </div>
            <div className="space-y-4">
              <p className="text-sm uppercase tracking-[0.25em] text-primary/70">
                {mode === 'P2P' ? 'Connection ready' : 'QR ready'}
              </p>
              <p className="text-xl font-semibold text-onsurface">
                {mode === 'P2P' ? 'Waiting for receiver to connect...' : 'Scan this QR to download your file'}
              </p>
              <div className="rounded-3xl border border-white/5 bg-surface/80 p-4 text-sm text-onsurface-variant">
                <p className="font-semibold text-onsurface flex items-center gap-2">
                  <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  Link
                </p>
                <p className="mt-2 break-all text-sm text-onsurface/80 font-mono text-xs">{state.qrData}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={copyLink}
                  className="rounded-3xl bg-gradient-to-r from-primary/20 to-accent/20 border border-primary/30 px-5 py-3 text-sm font-semibold text-primary transition-all duration-300 hover:shadow-glow-sm hover:from-primary/30 hover:to-accent/30"
                >
                  Copy link
                </button>
                <button
                  type="button"
                  onClick={downloadQrImage}
                  className="rounded-3xl border border-white/10 bg-surface px-5 py-3 text-sm font-semibold text-onsurface transition-all duration-300 hover:bg-surface-high hover:shadow-glow-sm"
                >
                  Download QR
                </button>
              </div>
              {mode === 'P2P' && (
                <div className="flex items-center gap-2 rounded-3xl bg-primary/5 border border-primary/20 px-4 py-3 text-sm text-primary animate-pulse-glow">
                  <span className="flex h-2 w-2 rounded-full bg-primary animate-ping" />
                  Waiting for receiver to scan the QR code and connect...
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
