import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import dns from 'dns';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';

dotenv.config();

dns.setServers(['1.1.1.1', '8.8.8.8']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 4000;
const uploadDir = path.join(__dirname, 'uploads');
const appHost = process.env.APP_DOWNLOAD_HOST || `http://localhost:${port}`;
const signalingPath = '/ws';
const rooms = new Map();

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(cors({ origin: process.env.APP_BASE_URL || 'http://localhost:5173' }));
app.use(express.json());
app.use('/uploads', express.static(uploadDir));

const fileSchema = new mongoose.Schema({
  fileId: { type: String, required: true, unique: true, index: true },
  originalName: String,
  mimeType: String,
  sizeBytes: Number,
  storagePath: String,
  clientId: String,
  uploadedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, index: { expires: 0 } },
  downloadCount: { type: Number, default: 0 }
});

const historyEventSchema = new mongoose.Schema({
  clientId: { type: String, required: true, index: true },
  fileId: String,
  type: { type: String, enum: ['upload', 'download'] },
  fileName: String,
  fileSize: Number,
  mimeType: String,
  timestamp: { type: Date, default: Date.now }
});

const FileModel = mongoose.model('File', fileSchema);
const HistoryEventModel = mongoose.model('HistoryEvent', historyEventSchema);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const fileId = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${fileId}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024 // 2GB limit per file or chunk
  }
});

function getFinalPath(fileId, ext) {
  return path.join(uploadDir, `${fileId}${ext}`);
}

async function assembleChunks(fileId, ext, totalChunks, originalName, mimeType, sizeBytes, clientId) {
  const finalPath = getFinalPath(fileId, ext);
  const writeStream = fs.createWriteStream(finalPath);

  for (let i = 0; i < totalChunks; i += 1) {
    const partPath = path.join(uploadDir, `${fileId}.part.${i}`);
    if (!fs.existsSync(partPath)) {
      writeStream.close();
      throw new Error(`Missing chunk ${i}`);
    }
    const chunkData = fs.readFileSync(partPath);
    writeStream.write(chunkData);
    fs.unlinkSync(partPath);
  }

  writeStream.end();
  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const fileDoc = await FileModel.create({
    fileId,
    originalName,
    mimeType,
    sizeBytes,
    storagePath: finalPath,
    clientId,
    expiresAt
  });

  await HistoryEventModel.create({
    clientId,
    fileId,
    type: 'upload',
    fileName: originalName,
    fileSize: sizeBytes,
    mimeType
  });

  const downloadUrl = `${appHost}/d/${fileId}`;
  const qrSvg = await QRCode.toString(downloadUrl, { type: 'svg', margin: 1 });
  return { fileDoc, downloadUrl, qrSvg };
}

async function cleanupExpiredFiles() {
  try {
    const expired = await FileModel.find({ expiresAt: { $lt: new Date() } }).lean();
    for (const file of expired) {
      if (file.storagePath && fs.existsSync(file.storagePath)) {
        fs.unlinkSync(file.storagePath);
      }
      await FileModel.deleteOne({ _id: file._id });
    }
  } catch (error) {
    console.error('Cleanup failed', error);
  }
}

setInterval(() => { if (dbConnected) cleanupExpiredFiles(); }, 60 * 60 * 1000);

function cleanupRooms() {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (room.updatedAt + 10 * 60 * 1000 < now || room.offerer?.readyState === 'closed') {
      rooms.delete(roomId);
    }
  }
}

setInterval(cleanupRooms, 5 * 60 * 1000);

function sendWS(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcastToRoom(roomId, message, sender) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const ws of [room.offerer, room.answerer]) {
    if (ws && ws !== sender && ws.readyState === ws.OPEN) {
      sendWS(ws, message);
    }
  }
}

function requireDB(req, res) {
  if (!dbConnected) {
    return res.status(503).json({ error: 'Database unavailable — use P2P mode' });
  }
  return null;
}

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (requireDB(req, res)) return;
  try {
    const clientId = req.body.clientId || 'anonymous';
    if (!req.file) return res.status(400).json({ error: 'File required' });

    const isChunked = req.body.totalChunks !== undefined && req.body.chunkIndex !== undefined;
    const fileId = req.body.fileId || uuidv4();
    const originalName = req.body.originalName || req.file.originalname;
    const mimeType = req.body.mimeType || req.file.mimetype;
    const sizeBytes = Number(req.body.sizeBytes) || req.file.size;
    const ext = path.extname(originalName) || path.extname(req.file.originalname) || '';

    if (isChunked) {
      const chunkIndex = Number(req.body.chunkIndex);
      const totalChunks = Number(req.body.totalChunks);
      const partPath = path.join(uploadDir, `${fileId}.part.${chunkIndex}`);
      fs.renameSync(req.file.path, partPath);

      if (chunkIndex + 1 < totalChunks) {
        return res.json({ status: 'chunk-received', fileId, chunkIndex, totalChunks });
      }

      const result = await assembleChunks(fileId, ext, totalChunks, originalName, mimeType, sizeBytes, clientId);
      return res.json({ ...result, status: 'complete' });
    }

    const finalPath = getFinalPath(fileId, ext);
    fs.renameSync(req.file.path, finalPath);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const fileDoc = await FileModel.create({
      fileId,
      originalName,
      mimeType,
      sizeBytes,
      storagePath: finalPath,
      clientId,
      expiresAt
    });

    await HistoryEventModel.create({
      clientId,
      fileId,
      type: 'upload',
      fileName: originalName,
      fileSize: sizeBytes,
      mimeType
    });

    const downloadUrl = `${appHost}/d/${fileId}`;
    const qrSvg = await QRCode.toString(downloadUrl, { type: 'svg', margin: 1 });

    res.json({ file: fileDoc, qrSvg, downloadUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/api/file/:fileId', async (req, res) => {
  if (requireDB(req, res)) return;
  const file = await FileModel.findOne({ fileId: req.params.fileId }).lean();
  if (!file) return res.status(404).json({ error: 'File not found' });
  res.json({ file });
});

app.get('/api/history/:clientId', async (req, res) => {
  if (requireDB(req, res)) return;
  const events = await HistoryEventModel.find({ clientId: req.params.clientId })
    .sort({ timestamp: -1 })
    .lean();
  res.json({ events });
});

app.post('/api/history/delete', async (req, res) => {
  if (requireDB(req, res)) return;
  const { clientId, fileId, type, eventId } = req.body;
  if (!clientId || !fileId) return res.status(400).json({ error: 'Missing clientId or fileId' });
  await HistoryEventModel.deleteMany({ clientId, fileId, type });
  res.json({ success: true });
});

app.get('/d/:fileId', async (req, res) => {
  if (requireDB(req, res)) return;
  const clientId = req.query.clientId || 'anonymous';
  const file = await FileModel.findOne({ fileId: req.params.fileId });
  if (!file) return res.status(404).send('File not found');
  if (file.expiresAt && file.expiresAt < new Date()) {
    if (file.storagePath && fs.existsSync(file.storagePath)) {
      fs.unlinkSync(file.storagePath);
    }
    return res.status(410).send('This download link has expired.');
  }

  file.downloadCount += 1;
  await file.save();

  await HistoryEventModel.create({
    clientId,
    fileId: file.fileId,
    type: 'download',
    fileName: file.originalName,
    fileSize: file.sizeBytes,
    mimeType: file.mimeType
  });

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.originalName.replace(/"/g, '')}"`);
  const readStream = fs.createReadStream(file.storagePath);
  readStream.on('error', () => res.status(500).send('Could not read file'));
  readStream.pipe(res);
});

function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

app.post('/api/signal/create-offer', async (req, res) => {
  const { clientId, fileName, fileSize, mimeType } = req.body;
  const roomId = generateRoomCode();
  rooms.set(roomId, {
    offerer: null,
    answerer: null,
    offer: null,
    answer: null,
    metadata: { clientId, fileName, fileSize, mimeType },
    updatedAt: Date.now(),
    offererQueue: [],
    answererQueue: []
  });
  res.json({ roomId });
});

app.get('/api/signal/join-offer/:id', async (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room || !room.offer) {
    return res.status(404).json({ error: 'Offer not found' });
  }
  room.updatedAt = Date.now();
  res.json({ offer: room.offer, metadata: room.metadata });
});

app.post('/api/signal/offer', (req, res) => {
  const { roomId, offer } = req.body;
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  room.offer = offer;
  room.updatedAt = Date.now();
  res.json({ success: true });
});

app.post('/api/signal/answer', (req, res) => {
  const { roomId, answer } = req.body;
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  room.answer = answer;
  room.updatedAt = Date.now();
  res.json({ success: true });
});

app.get('/api/signal/answer/:id', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room || !room.answer) return res.status(404).json({ error: 'Answer not found' });
  room.updatedAt = Date.now();
  res.json({ answer: room.answer });
});

app.post('/api/signal/ice', (req, res) => {
  const { roomId, candidate, target } = req.body;
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (target === 'offerer') {
    room.offererQueue.push({ candidate });
  } else {
    room.answererQueue.push({ candidate });
  }
  room.updatedAt = Date.now();
  res.json({ success: true });
});

app.get('/api/signal/poll/:id', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const role = req.query.role || 'answerer';
  const queue = role === 'offerer' ? room.offererQueue : room.answererQueue;
  const messages = queue.splice(0, queue.length);
  room.updatedAt = Date.now();
  res.json({ messages, answer: room.answer || null, offer: room.offer || null });
});

app.post('/api/signal/cleanup', (req, res) => {
  cleanupRooms();
  res.json({ success: true });
});

let dbConnected = false;

function startServer() {
  const server = app.listen(port, () => console.log(`Server running on http://localhost:${port}${dbConnected ? '' : ' (MongoDB unavailable — P2P mode only)'}`));
  const wss = new WebSocketServer({ server, path: signalingPath });

  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      let data;
      try {
        data = JSON.parse(message.toString());
      } catch {
        return;
      }

      const { type, payload } = data;
      if (!type) return;

      if (type === 'register-offer') {
        const { roomId } = payload;
        const room = rooms.get(roomId);
        if (!room) {
          sendWS(ws, { type: 'error', payload: { message: 'Offer room not found' } });
          return;
        }
        room.offerer = ws;
        room.offer = payload.offer;
        room.updatedAt = Date.now();
        sendWS(ws, { type: 'offer-registered', payload: { roomId } });
        return;
      }

      if (type === 'join-offer') {
        const { roomId } = payload;
        const room = rooms.get(roomId);
        if (!room) {
          sendWS(ws, { type: 'error', payload: { message: 'Offer room not found' } });
          return;
        }
        room.answerer = ws;
        room.updatedAt = Date.now();
        sendWS(ws, { type: 'offer', payload: { offer: room.offer, metadata: room.metadata } });
        return;
      }

      if (type === 'signal') {
        const { roomId } = payload;
        broadcastToRoom(roomId, { type: 'signal', payload }, ws);
        return;
      }

      if (type === 'leave') {
        const { roomId } = payload;
        const room = rooms.get(roomId);
        if (!room) return;
        if (room.offerer === ws) room.offerer = null;
        if (room.answerer === ws) room.answerer = null;
        room.updatedAt = Date.now();
        return;
      }
    });

    ws.on('close', () => {
      for (const [roomId, room] of rooms.entries()) {
        if (room.offerer === ws) room.offerer = null;
        if (room.answerer === ws) room.answerer = null;
        if (!room.offerer && !room.answerer) rooms.delete(roomId);
      }
    });
  });
}

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    dbConnected = true;
    console.log('MongoDB connected');
    await cleanupExpiredFiles();
    startServer();
  })
  .catch((err) => {
    console.error('MongoDB connection failed — starting in P2P-only mode:', err.message);
    startServer();
  });
