const STORAGE_KEY = 'quickdrop_quickdrop_qr_history';

function readHistoryStore() {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeHistoryStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function loadLocalHistory(clientId) {
  const store = readHistoryStore();
  return store[clientId] || [];
}

export function addLocalHistoryEvent(clientId, event) {
  const store = readHistoryStore();
  const clientEvents = store[clientId] || [];
  const eventId = event.eventId || crypto.randomUUID();
  const timestamp = event.timestamp || new Date().toISOString();
  const newEvent = { ...event, eventId, timestamp };
  store[clientId] = [newEvent, ...clientEvents];
  writeHistoryStore(store);
  return newEvent;
}

export function removeLocalHistoryEvent(clientId, eventId) {
  const store = readHistoryStore();
  const clientEvents = store[clientId] || [];
  store[clientId] = clientEvents.filter((event) => event.eventId !== eventId);
  writeHistoryStore(store);
  return store[clientId];
}

export function mergeHistory(localEvents, serverEvents) {
  const dedupe = new Map();
  localEvents.forEach((event) => {
    const key = `${event.type}|${event.fileId}|${event.timestamp}`;
    dedupe.set(key, { ...event, source: 'local' });
  });

  serverEvents.forEach((event) => {
    const key = `${event.type}|${event.fileId}|${new Date(event.timestamp).toISOString()}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, { ...event, eventId: event.eventId || `server-${event._id || key}`, source: 'server' });
    }
  });

  return Array.from(dedupe.values()).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}
