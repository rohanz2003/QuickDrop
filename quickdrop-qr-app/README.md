# QuickDrop QR

A full-stack no-login file-sharing app that uploads files, generates QR download links, and tracks per-device history.

## Project structure

- `backend/` - Express server, MongoDB models, file uploads, QR generation, download routing.
- `frontend/` - React + Vite single-page app with Tailwind CSS.

## Setup

### 1. MongoDB Atlas

1. Create a free MongoDB Atlas cluster.
2. Create a database user with password.
3. Create a database named `quickdrop-qr` or use any name.
4. Whitelist your IP or allow access from anywhere for development.
5. Copy the connection string and set it in `backend/.env`.

Example `.env` values:

```
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/quickdrop-qr?retryWrites=true&w=majority
PORT=4000
APP_DOWNLOAD_HOST=http://localhost:4000
APP_BASE_URL=http://localhost:5173
```

### 2. Install dependencies

From `quickdrop-qr-app/backend`:

```bash
npm install
```

From `quickdrop-qr-app/frontend`:

```bash
npm install
```

### 3. Run the app

Start backend:

```bash
cd quickdrop-qr-app/backend
npm start
```

Start frontend:

```bash
cd quickdrop-qr-app/frontend
npm run dev
```

### 4. Use the app

- Open the frontend at `http://localhost:5173`
- Upload a file and generate a QR code
- Scan a QR image in the Scan tab
- View uploads/downloads in the History tab

## Notes

- Files are stored on disk in `backend/uploads`
- MongoDB uses a TTL index on `expiresAt` to automatically remove expired file records
- Download link endpoint returns `Content-Disposition: attachment` to force downloads
- The client generates a UUID in `localStorage` to track anonymous history per device
