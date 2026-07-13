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
    <div className="space-y-3 animate-fade-in sm:space-y-6">
      <div className="rounded-2xl border border-onsurface/10 bg-surface-low/80 p-4 shadow-sm sm:rounded-[2rem] sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-primary/70 sm:text-sm">History</p>
            <h2 className="text-sm font-semibold text-onsurface sm:text-2xl">Recent upload and download activity</h2>
          </div>
          <div className="inline-flex gap-1 rounded-lg bg-surface/60 p-0.5 sm:rounded-xl sm:p-1">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setFilter(option.value)}
                className={`rounded-lg px-3 py-1 text-[10px] font-semibold transition-all duration-300 sm:px-4 sm:py-2 sm:text-sm ${
                  option.value === filter
                    ? 'bg-gradient-to-r from-primary to-accent text-background shadow-glow-sm'
                    : 'text-onsurface/60 hover:text-onsurface'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 space-y-2 sm:mt-6 sm:space-y-3">
          {filteredEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center sm:py-12">
              <svg className="w-10 h-10 text-primary/20 mb-3 sm:w-16 sm:h-16 sm:mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <p className="text-xs text-onsurface/50 sm:text-sm">No activity yet. Upload or scan a QR to get started.</p>
            </div>
          ) : (
            filteredEvents.map((event, idx) => (
              <div
                key={`${event._id || event.eventId}-${event.timestamp}`}
                className="group rounded-xl border border-onsurface/10 bg-surface/70 p-3 shadow-sm transition-all duration-300 hover:border-primary/20 hover:shadow-glow-sm animate-fade-in sm:rounded-[1.5rem] sm:p-5"
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div className="flex items-start gap-2 sm:gap-3">
                    <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:mt-1 sm:h-10 sm:w-10 sm:rounded-xl ${
                      event.type === 'upload'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-accent/10 text-accent'
                    }`}>
                      <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        {event.type === 'upload' ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        )}
                      </svg>
                    </div>
                    <div>
                      <p className="text-[10px] text-primary/80 uppercase tracking-[0.2em] font-semibold sm:text-xs">
                        {event.type === 'upload' ? 'Upload' : event.type === 'download' ? 'Download' : event.type}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold text-onsurface break-all sm:mt-1 sm:text-base">{event.fileName}</p>
                      <p className="text-[10px] text-onsurface/60 sm:mt-0.5 sm:text-sm">
                        {formatBytes(event.fileSize)} &bull; {new Date(event.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2 sm:shrink-0">
                    <button
                      type="button"
                      onClick={() => window.open(downloadUrl(event.fileId, clientId), '_blank')}
                      className="rounded-lg bg-gradient-to-r from-primary/20 to-accent/20 border border-primary/30 px-2 py-1 text-primary transition-all duration-300 hover:shadow-glow-sm hover:from-primary/30 hover:to-accent/30 sm:rounded-xl sm:px-3 sm:py-2"
                      title="Re-download"
                    >
                      <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(event)}
                      className="rounded-lg border border-onsurface/10 bg-onsurface/5 px-2 py-1 text-onsurface/60 transition-all duration-300 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 sm:rounded-xl sm:px-3 sm:py-2"
                      title="Remove"
                    >
                      <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400 animate-fade-in sm:rounded-3xl sm:px-4 sm:py-3 sm:text-sm">
          <svg className="w-3 h-3 shrink-0 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
