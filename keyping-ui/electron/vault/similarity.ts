// Motor de similitud de patrones para comparar nuevas contraseñas con histórico.

import { loadVault } from './file';
import type { VaultEntry } from './types';

// Mapa leet básico para normalizar variaciones comunes.
const LEET_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '2': 'z',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  '$': 's',
  '!': 'i',
  '+': 't'
};

// Normaliza string para comparación robusta entre variantes visuales.
export function normalizePattern(s: string): string {
  let x = (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/[\s._\-:/\\|'",`~^°(){}\[\]]/g, ''); // separadores comunes

  x = x.replace(/[0-9@$!+]/g, m => LEET_MAP[m] ?? m);
  x = x.replace(/(.)\1{2,}/g, '$1$1'); // colapsa repeticiones largas

  return x;
}

// Distancia de edición de Levenshtein.
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = new Array<number>((m + 1) * (n + 1));
  const idx = (i: number, j: number) => i * (n + 1) + j;

  for (let i = 0; i <= m; i++) dp[idx(i, 0)] = i;
  for (let j = 0; j <= n; j++) dp[idx(0, j)] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[idx(i, j)] = Math.min(
        dp[idx(i - 1, j)] + 1,     // borrado
        dp[idx(i, j - 1)] + 1,     // inserción
        dp[idx(i - 1, j - 1)] + cost // sustitución
      );
    }
  }
  return dp[idx(m, n)];
}

// Similaridad Jaro-Winkler (0..1).
function jaroWinkler(s1: string, s2: string): number {
  const m1 = s1.length;
  const m2 = s2.length;
  if (m1 === 0 && m2 === 0) return 1;
  if (m1 === 0 || m2 === 0) return 0;

  const matchDistance = Math.floor(Math.max(m1, m2) / 2) - 1;
  const s1Matches = new Array<boolean>(m1).fill(false);
  const s2Matches = new Array<boolean>(m2).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < m1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, m2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < m1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  transpositions = transpositions / 2;

  const m = matches;
  const jaro =
    (m / m1 + m / m2 + (m - transpositions) / m) / 3;

  // Refuerzo por prefijo común (Winkler).
  let prefix = 0;
  for (let i = 0; i < Math.min(4, m1, m2); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  const p = 0.1; // factor de escala
  return jaro + prefix * p * (1 - jaro);
}

// Longitud de la subcadena común más larga.
function longestCommonSubstringLen(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  let maxLen = 0;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
        if (dp[i][j] > maxLen) maxLen = dp[i][j];
      }
    }
  }

  return maxLen;
}

// Devuelve score 0..100 entre dos patrones ya normalizados.
function similarityScoreNormalized(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 100;

  const maxLen = Math.max(a.length, b.length);
  const lev = levenshtein(a, b);
  const levRatio = 1 - lev / maxLen;

  const jaro = jaroWinkler(a, b);

  const lcs = longestCommonSubstringLen(a, b);
  const lcsRatio = lcs / maxLen;

  // Combinación ponderada de métricas (ajustable).
  const score =
    0.5 * levRatio +
    0.3 * jaro +
    0.2 * lcsRatio;

  return Math.max(0, Math.min(1, score)) * 100;
}

// API pública: busca en el vault la entrada más similar.
export type SimilarityMatch = {
  entry: VaultEntry;
  score: number; // 0..100
};

export async function findMostSimilarInVault(candidatePwd: string): Promise<SimilarityMatch | null> {
  const candidateNorm = normalizePattern(candidatePwd);
  if (!candidateNorm) return null;

  const vault = await loadVault();
  let best: SimilarityMatch | null = null;

  for (const e of vault.entries) {
    const norm = e.normalized || '';
    if (!norm) continue;

    const score = similarityScoreNormalized(candidateNorm, norm);
    if (!best || score > best.score) {
      best = { entry: e, score };
    }
  }

  // Si el mejor score es bajo, se considera no relevante para alertar.
  if (!best || best.score < 40) return null;
  return best;
}
