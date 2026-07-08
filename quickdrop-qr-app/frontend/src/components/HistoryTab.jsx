import { useEffect, useMemo, useState } from 'react';
import { loadLocalHistory, mergeHistory, removeLocalHistoryEvent } from '../utils/historyStorage.js';
import { apiUrl, downloadUrl } from '../utils/api.js';

const filterOptions = [
  { label: 'All', value: 'all' },
  { label: 'Upload', value: 'upload' },
  { label: 'Download', value: 'download' }
];

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(1)} ${units[power]}`;
}

export default function HistoryTab({ clientId }) {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    const loadHistory = async () => {
      const localEvents = loadLocalHistory(clientId);
      try {
        const response = await fetch(apiUrl(`/api/history/${clientId}`));
        const data = await response.json();
        const merged = mergeHistory(localEvents, data.events || []);
        setEvents(merged);
      } catch (err) {
        setEvents(localEvents);
        setError('Could not load server history, showing local activity.');
      }
    };
    loadHistory();
  }, [clientId]);

  const filteredEvents = useMemo(() => {
    if (filter === 'all') return events;
    return events.filter((event) => event.type === filter);
  }, [events, filter]);

  const handleDelete = async (event) => {
    setEvents((prev) => prev.filter((item) => item.eventId !== event.eventId));
    removeLocalHistoryEvent(clientId, event.eventId);

    await fetch(apiUrl('/api/history/delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, fileId: event.fileId, type: event.type })
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-white/10 bg-surface-low/80 p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-secondary/70">History</p>
            <h2 className="text-2xl font-semibold text-onsurface">Recent upload and download activity</h2>
          </div>
          <div className="inline-flex gap-2 rounded-full bg-surface/60 p-2">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setFilter(option.value)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  option.value === filter
                    ? 'bg-secondary text-background shadow-glow'
                    : 'text-onsurface/60 hover:text-onsurface'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {filteredEvents.length === 0 ? (
            <p className="text-sm text-onsurface/50">No activity yet. Upload or scan a QR to get started.</p>
          ) : (
            filteredEvents.map((event) => (
              <div key={`${event._id}-${event.timestamp}`} className="rounded-[2rem] border border-white/10 bg-surface/70 p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-secondary/80 uppercase tracking-[0.2em]">
                      {event.type === 'upload' ? 'Upload' : event.type === 'download' ? 'Download' : event.type}
                    </p>
                    <p className="mt-2 text-base font-semibold text-onsurface">{event.fileName}</p>
                    <p className="mt-1 text-sm text-onsurface/70">
                      {formatBytes(event.fileSize)} • {new Date(event.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => window.open(downloadUrl(event.fileId, clientId), '_blank')}
                      className="rounded-3xl bg-primary px-4 py-2 text-sm font-semibold text-background transition hover:bg-accent"
                    >
                      Re-download
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(event)}
                      className="rounded-3xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-onsurface/70 transition hover:text-onsurface"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {error && <p className="rounded-3xl border border-error/40 bg-error/10 p-4 text-sm text-error">{error}</p>}
    </div>
  );
}
