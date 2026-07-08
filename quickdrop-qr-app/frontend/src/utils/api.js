const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
const DOWNLOAD_BASE_URL = import.meta.env.VITE_DOWNLOAD_HOST || API_BASE_URL;

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

export function downloadUrl(fileId, clientId) {
  const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
  return `${DOWNLOAD_BASE_URL}/d/${fileId}${query}`;
}

export const API_BASE = API_BASE_URL;
