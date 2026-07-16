# QuickDrop Architecture

## Overview

QuickDrop is a browser-to-browser P2P file-sharing application using **WebRTC data channels** for direct, serverless transfers. A lightweight signaling server (Node.js/Express) coordinates connection setup; after that, all data flows peer-to-peer.

---

## Architecture Diagram

```
┌─────────────────────┐        WebRTC (SCTP/DTLS/UDP)       ┌──────────────────────┐
│   SENDER (Upload)   │◄───────────────────────────────────►│  RECEIVER (Scan)     │
│  ┌───────────────┐  │      single DataChannel used        │  ┌────────────────┐  │
│  │  UploadTab    │  │      for files + chat + ctrl        │  │   ScanTab      │  │
│  │  + ChatSidebar│  │                                     │  │  + ChatSidebar │  │
│  └───────┬───────┘  │                                     │  └───────┬────────┘  │
│          │           │                                     │          │           │
│  ┌───────▼───────┐  │   ┌─────────────────────────────┐   │  ┌───────▼────────┐  │
│  │   WebRTC Peer │  │   │  Signaling Server           │   │  │  WebRTC Peer   │  │
│  │  (RTCPeerConn)│──┼───┤  (WebSocket + HTTP API)     ├───┼──┤ (RTCPeerConn)  │  │
│  └───────────────┘  │   │  - createOfferRoom()         │   │  └────────────────┘  │
│                     │   │  - relay SDP (offer/answer)  │   │                      │
│                     │   │  - relay ICE candidates      │   │                      │
└─────────────────────┘   └─────────────────────────────┘   └──────────────────────┘
```

**Key principle**: The signaling server only orchestrates the handshake. **File data never touches the server.**

---

## 1. Identity — `useClientId()` (`App.jsx:20`)

- On first visit, a UUID is generated via `crypto.randomUUID()` and persisted in `localStorage` under `quickdropClientId`
- This identifies the device across sessions for history tracking

---

## 2. Connection Flow

### 2a. Sender Initiates (`UploadTab.jsx:65`)

1. User selects files and clicks "Start direct transfer"
2. `startP2P()` calls `createOfferRoom()`:
   - `POST /api/signal/create-offer` → server returns a **4-digit room code**
3. A new `RTCPeerConnection` is created with config from `signaling.js`:
   - 5 Google STUN servers for NAT traversal
   - `iceCandidatePoolSize: 10` — pre-gathers candidates for faster connection
   - `bundlePolicy: 'max-bundle'` — single transport for all data
4. A **data channel** is created: `peer.createDataChannel('file-transfer')`
   - Single bidirectional channel for file chunks + chat + control signals
   - `binaryType = 'arraybuffer'` so incoming data arrives as typed arrays
5. A WebRTC **offer** is created via `peer.createOffer()` and set as local description
6. A **WebSocket** connects to the signaling server and registers:
   ```json
   { "type": "register-offer", "payload": { "roomId", "offer" } }
   ```
7. ICE candidates are collected and relayed through the WebSocket
8. Sender waits for the receiver's **SDP answer** and ICE candidates
9. Once `setRemoteDescription(answer)` completes, the P2P link is live

### 2b. Receiver Connects (`ScanTab.jsx:89`)

1. User enters the 4-digit room code (or uses `?room=XXXX` URL param)
2. A new `RTCPeerConnection` is created with the same RTC config
3. A WebSocket connects and sends:
   ```json
   { "type": "join-offer", "payload": { "roomId" } }
   ```
4. Server replies with the sender's SDP **offer** → set as remote description
5. Receiver creates an **answer** (`peer.createAnswer()`), sets local description, sends back
6. ICE candidates flow bidirectionally until the connection establishes
7. The data channel arrives via `peer.ondatachannel` event

### 2c. ICE & STUN

- Both sides use Google's public STUN servers (`stun:stun.l.google.com:19302`, etc.) to discover their public IP:port
- `iceCandidatePoolSize: 10` pre-fetches candidates before the offer/answer exchange
- If STUN fails (symmetric NAT/firewall), a TURN relay would be needed (not currently configured)
- The ICE process finds the lowest-latency path (typically direct UDP)

---

## 3. File Transfer Protocol

All messages share one data channel. Protocol-level prefixes distinguish message types.

### Phase 1: Batch Metadata (`__BATCH__`)

```
[8 bytes ASCII "__BATCH_"] + [JSON string of file array]
```

```json
[
  { "fileName": "photo.jpg", "fileSize": 2097152, "mimeType": "image/jpeg" },
  { "fileName": "doc.pdf",   "fileSize": 1048576, "mimeType": "application/pdf" }
]
```

- Receiver initializes `receivedSizeRef = 0`, `receiveBufferRef = []`, starts ETA timer
- The total size drives the progress calculation on both sides

### Phase 2: File Chunks (raw binary)

Sender slices each file into `CHUNK_SIZE` (256 KB) Blobs and sends via a backpressure loop:

```
sendNext():
  while (bufferedAmount < 1 MB):           // cap to keep chat latency low
    send file.slice(offset, offset + 256KB)
    offset += 256KB

  if all files done:
    wait for bufferedAmount to drain → send __END__
  else:
    wait for bufferedAmountLowThreshold → refill
```

**Backpressure details:**
- `bufferedAmountLowThreshold = 256 KB` triggers `onbufferedamountlow` event
- The 1 MB buffer cap ensures a chat message only queues behind ~1 MB of data (~1.6 s at 5 Mbps)
- ETA refreshes every chunk: `rate = bytesSent / elapsed → remaining = (total - sent) / rate`

**Receiver side** appends each ArrayBuffer to `receiveBufferRef`:
```js
receiveBufferRef.current.push(data);
receivedSizeRef.current += data.byteLength;
```

### Phase 3: End Signal (`__END__`)

```
[6 bytes ASCII "__END__"]
```

Receiver:
1. Concatenates all ArrayBuffers into one `Uint8Array`
2. Splits by file sizes from the batch metadata
3. Wraps each segment in a `Blob` with the correct MIME type
4. Shows "Download" / "Download All" buttons

---

## 4. Chat Overlay

Chat messages share the same data channel with a `__CHAT__` prefix:

### Sending (`App.jsx:74`)
```js
const sendChat = (text) => {
  const msg = { text, from: 'me', timestamp: Date.now() };
  ch.send(new TextEncoder().encode('__CHAT__' + JSON.stringify(msg)));
  setChatMessages(prev => [...prev, msg]);  // optimistic update
};
```

### Receiving (`UploadTab.jsx:110`, `ScanTab.jsx:177`)
```js
channel.onmessage = (e) => {
  const prefix = new TextDecoder().decode(data.slice(0, 8));
  if (prefix === '__CHAT__') {
    const chatData = JSON.parse(new TextDecoder().decode(data.slice(8)));
    onChannelUpdate?.({ chatMessage: { ...chatData, from: 'peer' } });
  }
};
```

A single `ChatSidebar` component renders in three contexts:
- **Desktop sidebar** — slides in alongside the main content
- **Mobile full-screen** — overlays the entire viewport
- Both use the same `sendChat` / `chatMessages` state from `App.jsx`

### Unread Badge Logic (`App.jsx:66`)

Uses **refs** instead of state to avoid stale closures:
```js
if (update.chatMessage.from !== 'me' && !mobileChatOpenRef.current && !desktopChatOpenRef.current) {
  setUnreadCount(prev => prev + 1);
}
```

---

## 5. Component Tree

```
App
├── Header (sticky)
│   ├── Logo + "QuickDrop" + "P2P file sharing"
│   ├── "Live" badge (mobile, when connected)
│   └── Client ID display (desktop)
├── Body
│   ├── Tab Switcher (desktop)
│   │   ├── Send
│   │   ├── Receive
│   │   ├── History
│   │   └── Chat (when connected, toggles sidebar)
│   ├── Content Area
│   │   ├── UploadTab    (Send tab)
│   │   ├── ScanTab      (Receive tab)
│   │   └── HistoryTab   (History tab)
│   └── ChatSidebar (desktop, sliding)
├── Mobile Nav (fixed bottom)
│   ├── Send
│   ├── Receive
│   ├── History
│   └── Chat (with unread badge)
├── ChatSidebar (mobile, full-screen overlay)
└── Footer (desktop, sticky bottom)
```

---

## 6. Key Configuration (`signaling.js`)

| Setting | Value | Purpose |
|---------|-------|---------|
| STUN servers | 5 Google STUN | Redundant NAT traversal |
| `iceCandidatePoolSize` | 10 | Pre-gather candidates for faster connect |
| `bundlePolicy` | `max-bundle` | Single transport, less overhead |
| `rtcpMuxPolicy` | `require` | RTP/RTCP on same port |
| `CHUNK_SIZE` | 262,144 (256 KB) | File slice size |
| Buffer cap | 1,048,576 (1 MB) | Max queued file data (keeps chat responsive) |
| `bufferedAmountLowThreshold` | 262,144 (256 KB) | Refill trigger |

---

## 7. Signaling Server API

| Endpoint | Direction | Purpose |
|----------|-----------|---------|
| `POST /api/signal/create-offer` | Sender → Server | Create a room, get 4-digit code |
| `WS /ws` | Bidirectional | Relay SDP offers/answers and ICE candidates |

The server is stateless between connections — once the WebRTC handshake completes, the WebSocket can close and transfers continue peer-to-peer.

---

## 8. Message Wire Format

| Prefix | Length | Body | Direction |
|--------|--------|------|-----------|
| `__BATCH_` | 8 bytes | JSON file array | Sender → Receiver |
| `__META__` | 8 bytes | JSON single file metadata | Sender → Receiver |
| `__CHAT__` | 8 bytes | JSON `{text, from, timestamp}` | Bidirectional |
| `__END__` | 6 bytes | (empty) | Sender → Receiver |
| (none) | 0 | Raw file chunk (ArrayBuffer) | Sender → Receiver |
