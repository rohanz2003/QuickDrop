import { useMemo, useRef, useState } from 'react';
import { addLocalHistoryEvent } from '../utils/historyStorage.js';

const initialState = {
  file: null,
  qrSvg: null,
  downloadUrl: null,
  error: null,
  uploading: false,
  progress: 0
};

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(1)} ${units[power]}`;
}

export default function UploadTab({ clientId }) {
  const [state, setState] = useState(initialState);
  const [qrFormat, setQrFormat] = useState('svg');
  const fileInputRef = useRef(null);

  const fileInfo = useMemo(() => {
    if (!state.file) return null;
    return `${state.file.name} • ${formatBytes(state.file.size)} • ${state.file.type || 'Unknown'}`;
  }, [state.file]);

  const handleFile = (file) => {
    setState((prev) => ({ ...prev, file, error: null, qrSvg: null, downloadUrl: null }));
  };

  const uploadFile = async () => {
    if (!state.file) return;
    setState((prev) => ({ ...prev, uploading: true, progress: 0, error: null }));

    const formData = new FormData();
    formData.append('file', state.file);
    formData.append('clientId', clientId);
    formData.append('originalName', state.file.name);
    formData.append('mimeType', state.file.type);
    formData.append('sizeBytes', state.file.size);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'Upload failed');
      }

      const result = await response.json();
      setState((prev) => ({
        ...prev,
        uploading: false,
        progress: 100,
        qrSvg: result.qrSvg,
        downloadUrl: result.downloadUrl
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

  const copyLink = async () => {
    if (!state.downloadUrl) return;
    try {
      await navigator.clipboard.writeText(state.downloadUrl);
      setState((prev) => ({ ...prev, error: null }));
    } catch {
      setState((prev) => ({ ...prev, error: 'Failed to copy link. Please copy manually.' }));
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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-[2rem] border border-white/10 bg-surface-low/80 p-6 shadow-sm">
          <div className="flex flex-col gap-3">
            <div className="space-y-2">
              <p className="text-sm uppercase tracking-[0.25em] text-secondary/70">Upload</p>
              <h2 className="text-2xl font-semibold text-onsurface">Select a file to generate QR code</h2>
              <p className="text-sm text-onsurface/70">
                Files are stored for 7 days and may be downloaded by anyone with the QR link. No login required.
              </p>
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current.click()}
              className="inline-flex items-center justify-center rounded-3xl bg-primary px-5 py-4 text-sm font-semibold text-background shadow-glow transition hover:bg-accent"
            >
              Choose file
            </button>

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])}
            />

            <div className="rounded-3xl border border-white/10 bg-surface/70 p-4 text-sm text-onsurface-variant">
              <p className="font-semibold text-onsurface">Drag & drop support</p>
              <p>Use the button above or drop a file onto the app when supported by your browser.</p>
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-surface-low/80 p-6 shadow-sm">
          <p className="text-sm uppercase tracking-[0.25em] text-secondary/70">Preview</p>
          <div className="mt-5 min-h-[180px] rounded-3xl border border-white/5 bg-background/80 p-4">
            {state.file ? (
              <div className="space-y-3">
                <p className="text-sm text-onsurface/70">Selected file</p>
                <p className="text-base font-semibold text-onsurface">{fileInfo}</p>
                <div className="flex flex-wrap gap-2 text-xs text-onsurface/70">
                  <span className="rounded-full bg-white/5 px-3 py-1">Upload limit 2GB</span>
                  <span className="rounded-full bg-white/5 px-3 py-1">Expires in 7 days</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-onsurface/50">No file selected yet.</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-[2rem] border border-white/10 bg-surface/80 p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-secondary/70">Upload action</p>
            <h3 className="mt-2 text-xl font-semibold text-onsurface">Upload and generate QR</h3>
          </div>
          <button
            type="button"
            onClick={uploadFile}
            disabled={!state.file || state.uploading}
            className="inline-flex items-center justify-center rounded-3xl bg-primary px-6 py-3 text-sm font-semibold text-background transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.uploading ? 'Uploading…' : 'Start upload'}
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div className="h-3 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-gradient-to-r from-secondary to-primary transition-all" style={{ width: `${state.progress}%` }} />
          </div>
          {state.error && <p className="text-sm text-error">{state.error}</p>}
        </div>
      </div>

      {state.qrSvg && (
        <section className="rounded-[2rem] border border-white/10 bg-surface-low/80 p-6 shadow-sm">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-3xl border border-white/10 bg-background/80 p-6">
              <div
                className="mx-auto flex h-[260px] w-[260px] items-center justify-center rounded-3xl bg-white p-4 shadow-glow"
                dangerouslySetInnerHTML={{ __html: state.qrSvg }}
              />
            </div>
            <div className="space-y-4">
              <p className="text-sm uppercase tracking-[0.25em] text-secondary/70">QR ready</p>
              <p className="text-xl font-semibold text-onsurface">Scan this QR to download your file</p>
              <div className="rounded-3xl border border-white/5 bg-surface/80 p-4 text-sm text-onsurface-variant">
                <p className="font-semibold text-onsurface">Link</p>
                <p className="mt-2 break-all text-sm text-onsurface/80">{state.downloadUrl}</p>
              </div>
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="inline-flex items-center gap-2 rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-onsurface transition hover:border-secondary">
                    <input
                      type="radio"
                      name="qrFormat"
                      value="svg"
                      checked={qrFormat === 'svg'}
                      onChange={() => setQrFormat('svg')}
                      className="h-4 w-4 accent-secondary"
                    />
                    SVG
                  </label>
                  <label className="inline-flex items-center gap-2 rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-onsurface transition hover:border-secondary">
                    <input
                      type="radio"
                      name="qrFormat"
                      value="png"
                      checked={qrFormat === 'png'}
                      onChange={() => setQrFormat('png')}
                      className="h-4 w-4 accent-secondary"
                    />
                    PNG
                  </label>
                  <label className="inline-flex items-center gap-2 rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-onsurface transition hover:border-secondary">
                    <input
                      type="radio"
                      name="qrFormat"
                      value="jpeg"
                      checked={qrFormat === 'jpeg'}
                      onChange={() => setQrFormat('jpeg')}
                      className="h-4 w-4 accent-secondary"
                    />
                    JPEG
                  </label>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={copyLink}
                    className="rounded-3xl bg-secondary px-5 py-3 text-sm font-semibold text-background shadow-sm transition hover:bg-accent"
                  >
                    Copy link
                  </button>
                  <button
                    type="button"
                    onClick={downloadQrImage}
                    className="rounded-3xl border border-white/10 bg-surface px-5 py-3 text-sm font-semibold text-onsurface transition hover:bg-surface-high"
                  >
                    Download QR
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
