import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Html5Qrcode } from 'html5-qrcode';
import { addLocalHistoryEvent } from '../utils/historyStorage.js';
import { apiUrl, downloadUrl } from '../utils/api.js';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(1)} ${units[power]}`;
}

export default function ScanTab({ clientId }) {
  const [scanResult, setScanResult] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [error, setError] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const imageInputRef = useRef(null);
  const scannerRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().then(() => scannerRef.current.clear()).catch(() => {});
      }
    };
  }, []);

  const loadMetadata = async (decodedText) => {
    setError('');
    const match = decodedText.match(/\/d\/(.+)$/);
    if (!match) {
      setError('QR did not contain a valid download link.');
      setFilePreview(null);
      setScanResult(null);
      return;
    }

    const fileId = match[1];
    try {
      const response = await fetch(apiUrl(`/api/file/${fileId}`));
      const data = await response.json();
      if (data.file) {
        setFilePreview(data.file);
        setScanResult(decodedText);
      } else {
        setError(data.error || 'Could not fetch file metadata');
      }
    } catch {
      setError('Unable to load file metadata');
    }
  };

  const handleFile = (file) => {
    setError('');
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
          loadMetadata(code.data);
        } else {
          setError('No QR code found in this image.');
        }
      };
      if (typeof reader.result === 'string') image.src = reader.result;
    };
    reader.readAsDataURL(file);
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
          loadMetadata(decodedText);
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
    <div className="space-y-8">
      <div className="rounded-[2rem] border border-white/10 bg-surface-low/80 p-8 shadow-glow">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-sm uppercase tracking-[0.35em] text-secondary/70">Scan QR Code</p>
          <h2 className="text-4xl font-semibold text-onsurface">Point your camera at a QuickDrop QR code.</h2>
          <p className="max-w-2xl text-sm leading-6 text-onsurface/70">
            Instantly decode a link and preview the file before you download it. Prefer not to use a camera? Upload a QR image instead.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
          <div className="rounded-[2rem] border border-white/10 bg-surface/90 p-6 shadow-sm">
            <div className="relative overflow-hidden rounded-[2rem] border border-white/5 bg-black/80 p-4">
              <div className="absolute inset-0 bg-gradient-to-br from-secondary/10 via-transparent to-primary/10 pointer-events-none" />
              <div className="flex h-[360px] flex-col items-center justify-center gap-4 text-center text-onsurface/70">
                <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-white/10 text-4xl text-secondary">
                  <span className="material-symbols-outlined">qr_code_scanner</span>
                </div>
                <p className="text-base font-medium text-onsurface">{cameraActive ? 'Scanning with camera…' : 'Ready to scan'}</p>
                <p className="max-w-md text-sm text-onsurface/60">
                  {cameraActive ? 'Hold your device steady and center the QR code inside the frame.' : 'Use a live camera scan or upload a QR image file to begin.'}
                </p>
              </div>
              <div id="camera-scanner" className={`absolute inset-0 transition-opacity ${cameraActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={cameraActive ? stopCamera : startCamera}
                className="inline-flex min-w-[160px] items-center justify-center rounded-3xl bg-primary px-6 py-4 text-sm font-semibold text-background shadow-glow transition hover:bg-accent"
              >
                {cameraActive ? 'Stop camera' : 'Use camera'}
              </button>
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="inline-flex min-w-[160px] items-center justify-center rounded-3xl border border-white/10 bg-surface px-6 py-4 text-sm font-semibold text-onsurface transition hover:bg-surface-high"
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

            {cameraError && <p className="mt-4 rounded-3xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{cameraError}</p>}
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-surface-low/90 p-6 shadow-sm">
            <div className="space-y-5">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-secondary/70">Decoded result</p>
                <div className="mt-4 rounded-[1.5rem] border border-white/5 bg-background/80 p-5 min-h-[180px]">
                  {scanResult ? (
                    <div className="space-y-3">
                      <p className="text-sm text-onsurface/70">URL</p>
                      <p className="break-all text-base font-semibold text-onsurface">{scanResult}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-onsurface/50">No QR decoded yet.</p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-secondary/70">File preview</p>
                <div className="mt-4 rounded-[1.5rem] border border-white/5 bg-background/80 p-5 min-h-[220px]">
                  {filePreview ? (
                    <div className="space-y-3">
                      <p className="text-sm text-onsurface/70">File name</p>
                      <p className="text-base font-semibold text-onsurface">{filePreview.originalName}</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-sm text-onsurface/70">Size</p>
                          <p className="text-base font-semibold text-onsurface">{formatBytes(filePreview.sizeBytes)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-onsurface/70">Type</p>
                          <p className="text-base font-semibold text-onsurface">{filePreview.mimeType}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={downloadFile}
                        className="mt-4 inline-flex w-full items-center justify-center rounded-3xl bg-secondary px-5 py-4 text-sm font-semibold text-background shadow-sm hover:bg-accent"
                      >
                        Download file
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-onsurface/50">No file metadata loaded yet. Scan or upload a QR code to preview a file.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && <p className="rounded-3xl border border-error/40 bg-error/10 p-4 text-sm text-error">{error}</p>}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
