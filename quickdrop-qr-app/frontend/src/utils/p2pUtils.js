import { ICE_SERVERS } from './p2pConfig.js';

export function createPeerConnection(onDataMessage, onConnectionStateChange) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onconnectionstatechange = () => {
    onConnectionStateChange?.(pc.connectionState);
  };

  pc.oniceconnectionstatechange = () => {
    onConnectionStateChange?.(pc.connectionState);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.debug('Local ICE candidate', event.candidate);
    }
  };

  pc.ondatachannel = (event) => {
    event.channel.onmessage = (messageEvent) => {
      onDataMessage?.(messageEvent.data);
    };
    event.channel.onopen = () => console.debug('Remote data channel opened');
    event.channel.onclose = () => console.debug('Remote data channel closed');
  };

  return pc;
}

export function chunkFile(file, chunkSize = 16 * 1024) {
  const chunks = [];
  let offset = 0;
  while (offset < file.size) {
    chunks.push(file.slice(offset, offset + chunkSize));
    offset += chunkSize;
  }
  return chunks;
}

export function toJsonMessage(type, payload) {
  return JSON.stringify({ type, payload });
}

export function parseJsonMessage(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
