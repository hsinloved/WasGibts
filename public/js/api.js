// Thin client for the server's AI endpoints.

// The server may ask for a passcode before it uses the AI (APP_PASSCODE). It is
// entered once and kept on this device only.
const PASSCODE_KEY = 'wasgibts-passcode';
export const passcode = {
  get() { try { return localStorage.getItem(PASSCODE_KEY) || ''; } catch { return ''; } },
  set(v) { try { if (v) localStorage.setItem(PASSCODE_KEY, v); else localStorage.removeItem(PASSCODE_KEY); } catch { /* private mode: lasts this page only */ } memory = v || ''; },
};
let memory = '';
const authHeaders = () => { const p = passcode.get() || memory; return p ? { 'X-WasGibts-Passcode': p } : {}; };

async function post(path, body) {
  let res;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Could not reach the server. Are you online?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

export const api = {
  async status() {
    try {
      const s = await (await fetch('/api/status', { headers: authHeaders() })).json();
      // Locked behind a passcode: everything that needs the AI treats it as unavailable.
      return s.locked ? { ...s, available: false } : s;
    } catch { return { available: false }; }
  },
  extract: (source, settings) => post('/api/menu/extract', { source, ...settings }),
  recommend: (payload) => post('/api/recommend', payload),
  parseProfile: (text) => post('/api/profile/parse', { text }),
};

const MAX_PDF = 20 * 1024 * 1024;
const MAX_EDGE = 1600; // px; menu text stays legible and 8 pages fit in one hosted request

/** Read File objects into the { name, mediaType, data } shape the server expects. */
export async function readFiles(fileList) {
  const files = [...fileList];
  return Promise.all(files.map(async (f) => {
    const type = f.type || guessType(f.name);
    if (type === 'application/pdf') {
      if (f.size > MAX_PDF) throw new Error(`${f.name} is larger than 20 MB.`);
      return { name: f.name, mediaType: type, data: await toBase64(f) };
    }
    if (!type.startsWith('image/')) throw new Error(`${f.name} is not a photo or PDF.`);
    return { name: f.name, mediaType: 'image/jpeg', data: await downscale(f) };
  }));
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(blob);
  });
}

async function downscale(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new Error(`Could not open ${file.name} as an image (HEIC photos may need converting).`); }
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
  return toBase64(blob);
}

const guessType = (name) => (/\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg');
