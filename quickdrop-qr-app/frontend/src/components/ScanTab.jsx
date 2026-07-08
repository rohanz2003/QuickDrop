import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Html5Qrcode } from 'html5-qrcode';
import { addLocalHistoryEvent } from '../utils/historyStorage.js';
import { apiUrl, downloadUrl } from '../utils/api.js';
import { connectSignaling, sendSignaling, RTC_CONFIG, CHUNK_SIZE } from '../utils/signaling.js';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(1)} ${units[power]}`;
}

export default function ScanTab({ clientId, mode, pendingRoom }) {
  const [scanResult, setScanResult] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [error, setError] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [p2pStatus, setP2pStatus] = useState('');
  const [p2pProgress, setP2pProgress] = useState(0);
  const imageInputRef = useRef(null);
  const scannerRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (pendingRoom) {
      setScanResult(`Room: ${pendingRoom}`);
      setP2pStatus('Starting P2P download...');
      startP2PDownload(pendingRoom);
    }
  }, [pendingRoom]);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().then(() => scannerRef.current.clear()).catch(() => {});
      }
      wsRef.current?.close();
      peerRef.current?.close();
    };
  }, []);

  const downloadViaServer = (decodedText) => {
    setError('');
    setP2pStatus('');
    const match = decodedText.match(/\/d\/(.+)$/);
    if (!match) {
      setError('QR did not contain a valid download link.');
      setFilePreview(null);
      setScanResult(null);
      return;
    }

    const fileId = match[1];
    fetch(apiUrl(`/api/file/${fileId}`))
      .then((res) => res.json())
      .then((data) => {
        if (data.file) {
          setFilePreview(data.file);
          setScanResult(decodedText);
        } else {
          setError(data.error || 'Could not fetch file metadata');
        }
      })
      .catch(() => setError('Unable to load file metadata'));
  };

  const startP2PDownload = useCallback((roomId) => {
    setP2pStatus('Connecting to peer...');
    setP2pProgress(0);

    const ws = connectSignaling((msg) => {
      if (msg.type === 'offer' && msg.payload) {
        handleOffer(msg.payload, ws);
      } else if (msg.type === 'signal' && msg.payload) {
        if (msg.payload.candidate && peerRef.current) {
          peerRef.current.addIceCandidate(new RTCIceCandidate(msg.payload.candidate));
        }
      } else if (msg.type === 'error') {
        setError(msg.payload?.message || 'Connection error');
        setP2pStatus('');
      } else if (msg.type === 'peer-disconnected') {
        setError('Uploader disconnected');
        setP2pStatus('');
      }
    });
    wsRef.current = ws;

    ws.onopen = () => {
      sendSignaling(ws, 'join-offer', { roomId });
      setP2pStatus('Joining room...');
    };
  }, []);

  const wsRef = useRef(null);
  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const receiveBufferRef = useRef([]);
  const receivedSizeRef = useRef(0);
  const fileMetaRef = useRef(null);

  const handleOffer = async (payload, ws) => {
    const { offer, metadata } = payload;
    setP2pStatus('Peer found! Establishing connection...');
    fileMetaRef.current = metadata;

    const peer = new RTCPeerConnection(RTC_CONFIG);
    peerRef.current = peer;

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
            const link = document.createElement('a');
            link.href = url;
            link.download = fileMetaRef.current?.fileName || 'download';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            addLocalHistoryEvent(clientId, {
              clientId,
              fileId: 'p2p-' + Date.now(),
              type: 'download',
              fileName: fileMetaRef.current?.fileName || 'Unknown',
              fileSize: fileMetaRef.current?.fileSize || 0,
              mimeType: fileMetaRef.current?.mimeType || 'application/octet-stream',
              timestamp: new Date().toISOString()
            });

            setP2pStatus('Download complete!');
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
      if (e.candidate) {
        sendSignaling(ws, 'signal', { roomId: '', candidate: e.candidate.toJSON() });
      }
    };

    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    sendSignaling(ws, 'signal', { roomId: '', answer });
  };

  const handleFile = (file) => {
    setError('');
    setP2pStatus('');

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = canvasRef.current || document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, canvas.width, canvas.height);
        if (code) {
          processDecodedText(code.data);
        } else {
          setError('No QR code found in this image.');
        }
      };
      if (typeof reader.result === 'string') image.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const processDecodedText = (text) => {
    setScanResult(text);

    const roomMatch = text.match(/[?&]room=([a-zA-Z0-9-]+)/);
    if (roomMatch && mode === 'P2P') {
      setP2pStatus('Starting P2P download...');
      startP2PDownload(roomMatch[1]);
      return;
    }

    downloadViaServer(text);
  };

  const startCamera = async () => {
    if (scannerRef.current) return;
    setError('');
    setCameraError('');

    try {
      const html5Qrcode = new Html5Qrcode('camera-scanner');
      scannerRef.current = html5Qrcode;

      await html5Qrcode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 280 } },
        (decodedText) => {
          processDecodedText(decodedText);
          html5Qrcode.stop().then(() => html5Qrcode.clear()).catch(() => {});
          scannerRef.current = null;
          setCameraActive(false);
        },
        () => {}
      );

      setCameraActive(true);
    } catch (err) {
      setCameraError(err.message || 'Camera initialization failed');
    }
  };

  const stopCamera = async () => {
    if (!scannerRef.current) return;
    await scannerRef.current.stop();
    await scannerRef.current.clear();
    scannerRef.current = null;
    setCameraActive(false);
  };

  const downloadFile = () => {
    if (!scanResult || !filePreview) return;
    const match = scanResult.match(/\/d\/(.+)$/);
    if (!match) return;
    const fileId = match[1];

    addLocalHistoryEvent(clientId, {
      clientId,
      fileId,
      type: 'download',
      fileName: filePreview.originalName,
      fileSize: filePreview.sizeBytes,
      mimeType: filePreview.mimeType,
      timestamp: new Date().toISOString()
    });

    const link = document.createElement('a');
    link.href = downloadUrl(fileId, clientId);
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="rounded-[2rem] border border-white/10 bg-surface-low/80 p-6 shadow-sm">
        <div className="flex flex-col items-center gap-3 text-center mb-6">
          <p className="text-sm uppercase tracking-[0.35em] text-primary/70">Scan QR Code</p>
          <h2 className="text-3xl font-semibold text-onsurface">Point your camera at a QuickDrop QR code.</h2>
          <p className="max-w-2xl text-sm leading-6 text-onsurface/70">
            {mode === 'P2P'
              ? 'Scan a P2P share QR to receive files directly from the sender.'
              : 'Instantly decode a link and preview the file before you download it.'}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
          <div className="rounded-[2rem] border border-white/10 bg-surface/90 p-6 shadow-sm">
            <div className="camera-frame relative overflow-hidden rounded-[2rem] border border-white/5 bg-black/80 p-4">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />
              <div className="corner-tl" />
              <div className="corner-tr" />
              <div className="corner-bl" />
              <div className="corner-br" />
              {!cameraActive && (
                <div className="flex h-[360px] flex-col items-center justify-center gap-4 text-center text-onsurface/70 relative z-20">
                  <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-primary/10 border border-primary/20 text-4xl">
                    <svg className="w-10 h-10 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                  </div>
                  <p className="text-base font-medium text-onsurface">Ready to scan</p>
                  <p className="max-w-md text-sm text-onsurface/60">
                    Use a live camera scan or upload a QR image file to begin.
                  </p>
                </div>
              )}
              <div
                id="camera-scanner"
                className={`absolute inset-0 transition-opacity duration-500 z-10 ${
                  cameraActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
              />
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={cameraActive ? stopCamera : startCamera}
                className="inline-flex min-w-[160px] items-center justify-center rounded-3xl bg-gradient-to-r from-primary to-accent px-6 py-4 text-sm font-semibold text-background transition-all duration-300 hover:shadow-glow"
              >
                {cameraActive ? 'Stop camera' : 'Use camera'}
              </button>
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="inline-flex min-w-[160px] items-center justify-center rounded-3xl border border-white/10 bg-surface px-6 py-4 text-sm font-semibold text-onsurface transition-all duration-300 hover:bg-surface-high hover:shadow-glow-sm"
              >
                Upload QR image
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])}
              />
            </div>

            {cameraError && (
              <div className="mt-4 flex items-center gap-2 rounded-3xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 animate-fade-in">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {cameraError}
              </div>
            )}
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-surface-low/90 p-6 shadow-sm">
            <div className="space-y-5">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-primary/70">Decoded result</p>
                <div className="mt-4 rounded-[1.5rem] border border-white/5 bg-background/80 p-5 min-h-[160px]">
                  {scanResult ? (
                    <div className="space-y-2 animate-fade-in">
                      <p className="text-sm text-onsurface/70">URL</p>
                      <p className="break-all text-sm font-mono text-primary">{scanResult}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-onsurface/50">No QR decoded yet.</p>
                  )}
                </div>
              </div>

              <div>
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
                      <button
                        type="button"
                        onClick={downloadFile}
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
                    <p className="text-sm text-onsurface/50">Scan or upload a QR code to preview a file.</p>
                  )}
                </div>
              </div>
            </div>
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
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
