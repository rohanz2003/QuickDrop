const turnUrl = import.meta.env.VITE_TURN_URL;
const turnUsername = import.meta.env.VITE_TURN_USERNAME;
const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302'] },
  ...(turnUrl
    ? [
        {
          urls: turnUrl.split(',').map((url) => url.trim()),
          username: turnUsername,
          credential: turnCredential
        }
      ]
    : [])
];

export const SIGNALING_WS_URL =
  import.meta.env.VITE_SIGNALING_URL || `ws://${window.location.hostname}:4000/ws`;
