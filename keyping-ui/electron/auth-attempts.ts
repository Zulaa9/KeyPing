import { promises as fs } from 'fs';
import { dataFile } from './vault/paths';
import { atomicWriteFile } from './vault/fsutil';
import { AttemptGuard as CoreAttemptGuard } from '../core/attempt-policy';

// Retardos progresivos tras desbloqueos fallidos, mantenidos en el proceso principal y
// persistidos en disco (kp-attempts.json). La lógica vive en core/attempt-policy.ts.

const ATTEMPTS_FILE = 'kp-attempts.json';

export { MAX_COOLDOWN_MS, DEFAULT_POLICY, clampPolicy, cooldownFor } from '../core/attempt-policy';
export type { AttemptPolicy } from '../core/attempt-policy';

export class AttemptGuard extends CoreAttemptGuard {
  constructor(now: () => number = Date.now) {
    // El archivo se resuelve en cada acceso: los tests cambian el directorio de datos.
    super({
      read: () => fs.readFile(dataFile(ATTEMPTS_FILE), 'utf8'),
      write: data => atomicWriteFile(dataFile(ATTEMPTS_FILE), data)
    }, now);
  }
}
