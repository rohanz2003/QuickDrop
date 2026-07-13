import { API_BASE } from './api.js';

export const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

export const CHUNK_SIZE = 262144;

const wsBase = import.meta.env.VITE_SIGNALING_URL;
export const SIGNALING_WS_URL = wsBase || (API_BASE ? API_BASE.replace(/^http/, 'ws') + '/ws' : '/ws');

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
