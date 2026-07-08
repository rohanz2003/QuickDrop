const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = import.meta.env.VITE_WS_URL || `${WS_PROTOCOL}//${window.location.host}/ws`;
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export function connectSignaling(onMessage, onError) {
  const ws = new WebSocket(WS_URL);

  const timeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      ws.close();
      onError?.('Signaling server unreachable — deploy the backend to a platform that supports WebSocket (Render, Railway) or switch to Server mode.');
    }
  }, 5000);

  ws.onopen = () => {
    clearTimeout(timeout);
    console.log('[Signaling] Connected');
  };

  ws.onclose = () => {
    clearTimeout(timeout);
    console.log('[Signaling] Disconnected');
  };

  ws.onerror = () => {
    clearTimeout(timeout);
    onError?.('WebSocket connection failed. Vercel does not support WebSocket — use Server mode or deploy the backend separately.');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (e) {
      console.error('[Signaling] Parse error', e);
    }
  };

  return ws;
}

export function sendSignaling(ws, type, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

export async function createOfferRoom(clientId, fileName, fileSize, mimeType) {
  const res = await fetch(`${API_BASE}/api/signal/create-offer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, fileName, fileSize, mimeType })
  });
  if (!res.ok) throw new Error(`Signaling server error: ${res.status}`);
  const data = await res.json();
  return data.roomId;
}

export const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

export const CHUNK_SIZE = 16384;
