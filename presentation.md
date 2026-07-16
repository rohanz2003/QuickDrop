# QuickDrop — P2P File Sharing
## Presentation Slides (12 slides)

---

## Slide 1 — Title Slide

**QuickDrop**

Browser-to-Browser Peer-to-Peer File Sharing

Instant. Encrypted. (P2P main mode)

---


## Slide 2 — The Problem

**Why another file-sharing tool?**

| Service | Requires Login? | File passes through server? | Size Limit? | Expiry? |
|---------|----------------|---------------------------|-------------|---------|
| Email | Yes | Yes | ~25 MB | No |
| WeTransfer | No | Yes | 2 GB (free) | 7 days |
| Google Drive | Yes | Yes | 15 GB (free) | No |
| Dropbox | Yes | Yes | 2 GB (free) | No |

**Common drawbacks:**
- Files stored on third-party servers (privacy concern)
- Upload then download — double the transfer time
- Registration friction
- Arbitrary file size limits

---

## Slide 3 — The Solution: QuickDrop

**Key idea: The file never touches a server.**

```
Sender Browser ──────WebRTC (encrypted)──────► Receiver Browser
       │                                              │
       └── Signaling Server (handshake only) ──────────┘
```

- **P2P architecture** — direct browser-to-browser transfer
- **WebRTC** — encrypted DTLS tunnel, no middleman
- **No account needed** — just a 4-digit code
- **No file size limit** — limited only by browser memory
- **Files never stored** — ephemeral by design

---

## Slide 4 — Tech Stack

```
┌─────────────────────────────────────────────┐
│              Frontend (React + Vite)         │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ UploadTab│ │ ScanTab   │ │ ChatSidebar │ │
│  └────┬─────┘ └────┬─────┘ └──────┬──────┘ │
│       │             │              │          │
│  ┌────▼─────────────▼──────────────▼───────┐ │
│  │ WebRTC (RTCPeerConnection + DataChannel)  │ │
│  │ SCTP stream for file chunks + chat/control│ │
│  └────────────────────────────────────────────┘ │
│  Tailwind CSS · WebSocket · localStorage      │
└─────────────────────────────────────────────┘
```

| Layer | Technology |
|-------|-----------|
| UI Framework | React 18 |
| Build Tool | Vite |
| Styling | Tailwind CSS |
| P2P Transport | WebRTC DataChannel (`file-transfer`) |
| Connection Config | STUN servers + `iceCandidatePoolSize: 10` |
| Signaling (handshake) | WebSocket at **`/ws`** + HTTP endpoint `POST /api/signal/create-offer` |
| Optional Server Mode | `POST /api/upload` (multipart) + download endpoint **`GET /d/:fileId`** |
| Identity / History | `clientId` in `localStorage` + History merge |

---


## Slide 5 — How Connection Works (1/2)

**Step 1: Sender creates a room (handshake setup)**

```
Sender                          Signaling Server
  │                                     │
  │ POST /api/signal/create-offer       │
  │ ─────────────────────────────────►  │
  │                                     │
  │ ◄── { roomId: "4827" }            │
  │                                     │
  │ WebSocket connect                  │
  │ ─────────────────────────────────► │
  │ { type: "register-offer",        │
  │   payload: { roomId, offer } }   │
```

- Sender selects files and clicks **Start direct transfer**
- Server generates a **4-digit room code**
- Sender creates an **RTCPeerConnection** using STUN/TURN config
- Sender creates the **WebRTC data channel**: `peer.createDataChannel('file-transfer')`
- Sender generates SDP **offer** and registers it via WebSocket

---


## Slide 6 — How Connection Works (2/2)

**Step 2: Receiver joins**

```
Receiver                      Signaling Server
  │                                  │
  │ WebSocket connect + join         │
  │ ─────────────────────────────►   │
  │ { type: "join-offer",            │
  │   payload: { roomId: "4827" } }  │
  │                                  │
  │ ◄── { offer, metadata }          │
  │                                  │
  │ createAnswer() ───────────────►  │
  │ { type: "signal",                │
  │   payload: { answer } }          │
```

- Receiver enters the 4-digit code (from sender)
- Receiver creates its own `RTCPeerConnection`
- Gets sender’s **offer** + metadata via WebSocket
- Creates an **answer** and sends it back using `type: "signal"`
- ICE candidates flow bidirectionally until the WebRTC data channel opens

---


## Slide 7 — ICE & NAT Traversal

**How peers find each other across networks**

```
Sender (Home WiFi)              Receiver (Office)
  │                                    │
  │  STUN: stun*.google.com:19302      │
  │  ─────────────────────────────►    │
  │  ◄── Public IP:Port               │
  │                                    │
  │  ICE Candidates exchanged          │
  │  ◄══════════════════════════►      │
  │                                    │
  │  Best path selected:              │
  │  Host > STUN > (optional TURN)   │
```

| Config | Value |
|--------|-------|
| STUN servers | 5 Google STUN |
| `iceCandidatePoolSize` | 10 |
| `bundlePolicy` | `max-bundle` |
| `rtcpMuxPolicy` | `require` |

**Result:** Direct P2P is typically possible; TURN can be added via env config if required.

---


## Slide 8 — File Transfer Protocol

**How file data is structured over the WebRTC data channel**

```
Timeline:
┌───────────────────────────────────────────────────────────────┐
│  __BATCH__   │  Chunk 1  │  Chunk 2  │  ...  │  __END__     │
│ (JSON list)  │  (256 KB) │  (256 KB) │       │ (done)        │
└───────────────────────────────────────────────────────────────┘
```

**Message types (implemented prefixes):**

| Prefix | Type | Content | Purpose |
|--------|------|---------|---------|
| `__BATCH_` | ArrayBuffer | JSON file list | File names/sizes/types metadata |
| `__META__` | ArrayBuffer | JSON single file metadata | Used when transferring one file/metadata-only |
| `__CHAT__` | ArrayBuffer | JSON `{ text, from, timestamp }` | Chat messages between peers |
| `__END__` | ArrayBuffer (6 bytes) | (empty) | Signals transfer complete |
| (raw) | ArrayBuffer | binary chunk | File chunk bytes |

**Chunking:** Files are sliced into `CHUNK_SIZE = 262144` (256 KB).

**Backpressure & sending:**
- Sender sends while `channel.bufferedAmount < 1048576` (1 MB)
- Uses `channel.bufferedAmountLowThreshold = 262144` + `onbufferedamountlow` to refill smoothly
- Receiver appends chunks into an in-memory buffer, then reconstructs Blobs after `__END__`

---


## Slide 9 — Backpressure & Performance

**Keeping the pipe full without overwhelming memory**

```
SCTP bufferedAmount
◄──────── 1 MB cap ────────►

When bufferedAmount drops below 256 KB:
  → `onbufferedamountlow` fires
  → send next chunks (smooth upload)
```

**Implemented tuning:**

| Setting | Value |
|---------|-------|
| `CHUNK_SIZE` | 262144 (256 KB) |
| Buffer cap (`bufferedAmount`) | 1048576 (1 MB) |
| Refill threshold (`bufferedAmountLowThreshold`) | 262144 (256 KB) |
| STUN servers | 5 Google STUN |
| ICE candidate pool | 10 |

**ETA display (sender + receiver):**
- Sender estimates rate and remaining time: `rate = totalSent / elapsed`
- Receiver uses `receivedSize / elapsed` to show progress % + ETA

---


## Slide 10 — Chat Feature

**Real-time communication during file transfer**

```
Sender                          Receiver
  │                                │
  │  Type: "Hey, this is the      │
  │  project report you asked for"│
  │                                │
  │  __CHAT__ + JSON ────────────► │
  │                                │
  │  ◄── __CHAT__ + JSON          │
  │                                │
  │  "Got it, thanks!"            │
  │                                │
```

- Chat rides the **same data channel** as file chunks
- Prefix `__CHAT__` distinguishes chat from file data
- Optimistic UI — sender's message appears instantly
- Unread badge with ref-based state (avoids stale closures)
- Works on desktop (sidebar) and mobile (full-screen overlay)

---

## Slide 11 — Receiver Experience

**After the transfer completes**

```
┌─────────────────────────────────────────────┐
│  Download ready!                           │
│  ┌─────────────────────────────────────────┐ │
│  │  📄 report.pdf               2.1 MB      │ │
│  │  📄 presentation.pptx        5.3 MB      │ │
│  │  📊 data.xlsx                1.8 MB      │ │
│  └─────────────────────────────────────────┘ │
│                                             │
│  [Download All]   [Clear]                 │
└─────────────────────────────────────────────┘
```

- Receiver reconstructs files from incoming ArrayBuffer chunks
- Batch download (**Download All**) or individual download
- File list includes **name, size, and type (from metadata)**
- A **Details** modal shows Name / Size / Type
- Files are **not written to disk** (kept in browser memory until download)
- Upload/Download activity is stored in **local history** and merged with server history when available

---


## Slide 12 — Mobile & Desktop UI

**Responsive design across screen sizes**

| | Mobile | Desktop |
|---|---|---|
| Navigation | Fixed bottom bar (Send, Receive, History, Chat) | Top tab row (Send, Receive, History) + optional Chat tab |
| Chat UI | Full-screen slide-up overlay | Right-side sliding sidebar (w-96) |
| Progress | Gradient progress bar + status text | Same UI patterns (centered max width) |
| File selection | Drag & drop / Choose files | Drag & drop / Choose files |
| Connection UX | 4-digit code input | 4-digit code + room-sharing section |

**Key UI components (implemented):**
- **Sticky header:** QuickDrop branding + **Live** badge when connected + short `clientId`
- **Send tab:** file list preview, start/cancel transfer, room code + QR
- **Receive tab:** code entry + progress + per-file actions + Details modal
- **History tab:** local + server merged activity with re-download and remove actions

---


## Slide 13 — Security & Privacy

**Security model (serverless P2P + optional server mode)**

| Concern | How QuickDrop addresses it |
|---------|---------------------------|
| **File privacy (main mode)** | In P2P transfer, file bytes never go through the server. Transfer is browser-to-browser via WebRTC data channel. |
| **Encryption (main mode)** | WebRTC uses DTLS-SRTP/DTLS under the hood to encrypt data-channel traffic. |
| **Eavesdropping / MITM** | Encrypted handshake (DTLS) protects the transport; only peers with the room code can establish the session. |
| **Server access** | Signaling server only relays WebRTC offer/answer + ICE candidates (no file payload). |
| **Optional server mode** | If you upload to the server (`POST /api/upload`), files are temporarily stored and exposed via `GET /d/:fileId` with an expiry policy. |
| **History** | Local activity is stored in `localStorage` and merged with server history when available. |
| **No accounts** | No passwords or registration required. `clientId` is generated on-device. |

**Room code trust:** The 4-digit room code is a short-lived shared secret for connecting peers.

---


## Slide 14 — Future Improvements

**Roadmap ideas**

- **TURN server support (configurable)** — Improve connectivity in restrictive networks
- **Separate data channels** — Dedicated channel for chat/control to avoid contention
- **True streaming** — Progressive file playback/download instead of full-buffer reassembly
- **Security indicators** — Show connection + encryption health to users
- **File preview** — Inline preview for images/PDFs before download
- **Mobile PWA** — Installable app + background transfer
- **Self-hosted signaling** — Docker-ready deployment and easy env setup
- **Transfer resumption** — Resume interrupted transfers

---



## Slide 15 — Thank You

**QuickDrop**

Live demo / docs (update as needed):
- Repository: https://github.com/rohanz2003/QuickDrop
- Setup: run frontend + backend (signaling) locally

```
Browser-to-Browser · P2P · Encrypted (WebRTC) · No login required
```

Thank you!

