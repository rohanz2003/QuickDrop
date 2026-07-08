const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

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

export async function storeOffer(roomId, offer) {
  const res = await fetch(`${API_BASE}/api/signal/offer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, offer })
  });
  if (!res.ok) throw new Error('Failed to store offer');
}

export async function fetchOffer(roomId) {
  const res = await fetch(`${API_BASE}/api/signal/join-offer/${roomId}`);
  if (!res.ok) throw new Error('Offer not found');
  return res.json();
}

export async function storeAnswer(roomId, answer) {
  const res = await fetch(`${API_BASE}/api/signal/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, answer })
  });
  if (!res.ok) throw new Error('Failed to store answer');
}

export async function fetchAnswer(roomId) {
  const res = await fetch(`${API_BASE}/api/signal/answer/${roomId}`);
  if (!res.ok) return null;
  return res.json();
}

export async function sendIceCandidate(roomId, candidate, target) {
  await fetch(`${API_BASE}/api/signal/ice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, candidate, target })
  });
}

export async function pollMessages(roomId, role) {
  try {
    const res = await fetch(`${API_BASE}/api/signal/poll/${roomId}?role=${role}`);
    if (!res.ok) return { messages: [] };
    return res.json();
  } catch {
    return { messages: [] };
  }
}

export function startPolling(roomId, role, callbacks) {
  let active = true;
  let lastAnswer = null;
  let lastOffer = null;

  const poll = async () => {
    if (!active) return;
    try {
      const data = await pollMessages(roomId, role);
      if (data.messages) {
        for (const msg of data.messages) {
          callbacks.onMessage?.(msg);
        }
      }
      if (role === 'offerer' && data.answer && data.answer !== lastAnswer) {
        lastAnswer = data.answer;
        callbacks.onAnswer?.(data.answer);
      }
      if (role === 'answerer' && data.offer && data.offer !== lastOffer) {
        lastOffer = data.offer;
        callbacks.onOffer?.(data.offer);
      }
    } catch {
      // ignore polling errors
    }
    if (active) setTimeout(poll, 200);
  };

  poll();

  return () => { active = false; };
}

function getTurnServers() {
  const turnUrl = import.meta.env.VITE_TURN_URL;
  if (turnUrl) {
    return [{
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USERNAME || '',
      credential: import.meta.env.VITE_TURN_CREDENTIAL || ''
    }];
  }
  return [];
}

export const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    ...getTurnServers()
  ],
  iceCandidatePoolSize: 10
};

export const CHUNK_SIZE = 16384;
