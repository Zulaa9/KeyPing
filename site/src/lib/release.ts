import fallback from '../data/release-fallback.json';
import { fetchLatestRelease, LATEST_URL, RELEASES_URL } from './release-core.mjs';

export type Asset = { name: string; size: number; url: string; sha256: string | null };
export type Release = {
  version: string;
  tag: string;
  publishedAt: string;
  url: string;
  sumsUrl: string | null;
  windows: Asset;
  linux: Asset;
  /** 'api' = datos de la API en este build; 'fallback' = última release conocida guardada en el repo. */
  source: 'api' | 'fallback';
};

export { LATEST_URL, RELEASES_URL };

let cached: Promise<Release> | null = null;

async function load(): Promise<Release> {
  if (process.env.KEYPING_RELEASE_OFFLINE === '1') {
    console.info('[release] KEYPING_RELEASE_OFFLINE=1: se usa la release de respaldo', fallback.version);
    return { ...(fallback as Omit<Release, 'source'>), source: 'fallback' };
  }
  try {
    const data = await fetchLatestRelease({ token: process.env.GITHUB_TOKEN });
    console.info('[release] última release desde la API:', data.version);
    return { ...data, source: 'api' };
  } catch (err) {
    console.info(`[release] no se pudo consultar la API (${(err as Error).message}); se usa la release de respaldo ${fallback.version}`);
    return { ...(fallback as Omit<Release, 'source'>), source: 'fallback' };
  }
}

/** Una sola consulta por build, compartida por todas las páginas. */
export function getRelease(): Promise<Release> {
  cached ??= load();
  return cached;
}
