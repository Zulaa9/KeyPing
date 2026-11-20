// Motor de similitud: la lógica vive en el núcleo compartido (core/similarity.ts).

import { loadVault } from './file';
import { findMostSimilar, normalizePattern, SimilarityMatch } from '../../core/similarity';

export { normalizePattern, findMostSimilar } from '../../core/similarity';
export type { SimilarityMatch } from '../../core/similarity';

export async function findMostSimilarInVault(candidatePwd: string): Promise<SimilarityMatch | null> {
  // Mismo orden que antes: sin patrón no se lee el vault.
  if (!normalizePattern(candidatePwd)) return null;
  const vault = await loadVault();
  return findMostSimilar(candidatePwd, vault.entries);
}
