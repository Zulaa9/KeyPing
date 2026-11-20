// Lógica compartida (build de Astro y script de instantánea) para obtener la última release
// de KeyPing desde la API pública de GitHub. Solo se ejecuta en tiempo de build: el navegador
// nunca llama a la API.

export const REPO = 'Zulaa9/KeyPing';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const LATEST_URL = `${RELEASES_URL}/latest`;
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const TIMEOUT_MS = 10_000;

const WIN_RE = /^KeyPing-Setup-(\d+\.\d+\.\d+)\.exe$/;
const LINUX_RE = /^KeyPing-(\d+\.\d+\.\d+)\.AppImage$/;
// Android es opcional: solo las releases que incluyen el APK firmado lo muestran en la web.
const ANDROID_RE = /^KeyPing-(\d+\.\d+\.\d+)\.apk$/;

async function fetchWithTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Interpreta SHA256SUMS.txt ("hash  nombre" por línea) y devuelve { nombre: hash en minúsculas }. */
export function parseSums(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m) out[m[2].trim()] = m[1].toLowerCase();
  }
  return out;
}

/** Convierte la respuesta de la API en los datos que usa la web. Lanza si falta algo esencial. */
export function normalizeRelease(api, sums = {}) {
  if (!api || typeof api.tag_name !== 'string' || !Array.isArray(api.assets)) {
    throw new Error('respuesta de la API sin tag_name o assets');
  }
  const pick = (re) => {
    const a = api.assets.find((x) => re.test(x.name));
    if (!a) return null;
    return {
      name: a.name,
      size: a.size,
      url: a.browser_download_url,
      sha256: sums[a.name] ?? null,
    };
  };
  const windows = pick(WIN_RE);
  const linux = pick(LINUX_RE);
  const android = pick(ANDROID_RE);
  if (!windows || !linux) throw new Error('la release no tiene instalador de Windows y AppImage');
  const sumsAsset = api.assets.find((x) => x.name === 'SHA256SUMS.txt');
  return {
    version: api.tag_name.replace(/^v/, ''),
    tag: api.tag_name,
    publishedAt: api.published_at,
    url: api.html_url,
    sumsUrl: sumsAsset ? sumsAsset.browser_download_url : null,
    windows,
    linux,
    android,
  };
}

/** Descarga la última release y sus sumas. Lanza ante cualquier fallo. */
export async function fetchLatestRelease({ token } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'keyping-site-build' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res = await fetchWithTimeout(API, { headers });
  if (res.status === 401 && headers.Authorization) {
    // Token caducado o inválido: la API pública responde también sin autenticar.
    delete headers.Authorization;
    res = await fetchWithTimeout(API, { headers });
  }
  if (!res.ok) throw new Error(`API de GitHub: HTTP ${res.status}`);
  const api = await res.json();
  let sums = {};
  const sumsAsset = Array.isArray(api.assets) ? api.assets.find((x) => x.name === 'SHA256SUMS.txt') : null;
  if (sumsAsset) {
    try {
      const r = await fetchWithTimeout(sumsAsset.browser_download_url, { headers: { 'User-Agent': 'keyping-site-build' } });
      if (r.ok) sums = parseSums(await r.text());
    } catch {
      /* sin sumas: la web enlaza a SHA256SUMS.txt igualmente */
    }
  }
  return normalizeRelease(api, sums);
}
