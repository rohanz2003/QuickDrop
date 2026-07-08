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

dotenv.config();

dns.setServers(['1.1.1.1', '8.8.8.8']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 4000;
const uploadDir = path.join(__dirname, 'uploads');
const appHost = process.env.APP_DOWNLOAD_HOST || `http://localhost:${port}`;

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

setInterval(cleanupExpiredFiles, 60 * 60 * 1000); // hourly cleanup

app.post('/api/upload', upload.single('file'), async (req, res) => {
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
  const file = await FileModel.findOne({ fileId: req.params.fileId }).lean();
  if (!file) return res.status(404).json({ error: 'File not found' });
  res.json({ file });
});

app.get('/api/history/:clientId', async (req, res) => {
  const events = await HistoryEventModel.find({ clientId: req.params.clientId })
    .sort({ timestamp: -1 })
    .lean();
  res.json({ events });
});

app.post('/api/history/delete', async (req, res) => {
  const { clientId, fileId, type, eventId } = req.body;
  if (!clientId || !fileId) return res.status(400).json({ error: 'Missing clientId or fileId' });
  await HistoryEventModel.deleteMany({ clientId, fileId, type });
  res.json({ success: true });
});

app.get('/d/:fileId', async (req, res) => {
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

app.get('/health', (req, res) => res.json({ status: 'ok' }));

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    await cleanupExpiredFiles();
    app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
  })
  .catch((err) => {
    console.error('MongoDB connection error', err);
    process.exit(1);
  });
