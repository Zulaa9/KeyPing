// Actualiza src/data/release-fallback.json con la última release publicada.
// Uso: npm run release:snapshot (opcional; el workflow lo hace solo en memoria en cada build).
import { writeFile } from 'node:fs/promises';
import { fetchLatestRelease } from '../src/lib/release-core.mjs';

const data = await fetchLatestRelease({ token: process.env.GITHUB_TOKEN });
const target = new URL('../src/data/release-fallback.json', import.meta.url);
await writeFile(target, JSON.stringify(data, null, 2) + '\n');
console.log(`release-fallback.json -> ${data.version} (${data.publishedAt})`);
