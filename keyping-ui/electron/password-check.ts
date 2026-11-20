// Analizador de patrones de contraseñas (proceso principal).
// La lógica vive en el núcleo compartido (core/password-check.ts); aquí se conecta con la bóveda.
import { checkPassword, CheckReason } from '../core/password-check';
import { findMostSimilarInVault } from './vault/similarity';

export type { CheckReason, CheckReasonCode } from '../core/password-check';

export async function checkPasswordBetter(pwdInput: string): Promise<{ level: 'ok' | 'warn' | 'danger'; reasons: string[]; codes: CheckReason[] }> {
  return checkPassword(pwdInput, findMostSimilarInVault);
}
