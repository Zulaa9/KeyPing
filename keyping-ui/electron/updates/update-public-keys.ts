import type { TrustedKeys } from './update-signature';

// Claves públicas Ed25519 (SPKI DER en base64) que pueden firmar actualizaciones.
// Se rellena con `node scripts/update-signing.mjs keygen` en el equipo del responsable de
// publicar: la clave privada NUNCA entra en el repositorio. Se admiten varias para poder
// rotarla (publicar una versión con la nueva y la antigua y, después, retirar la antigua).
// Si está vacía, la app rechaza cualquier actualización y el empaquetado falla.
export const UPDATE_PUBLIC_KEYS: TrustedKeys = {
  // KEYS-START
    '80165f8111cacb42': 'MCowBQYDK2VwAyEAqOkG3m9DSci7uMhvnxRM7BcE1nbs2wb1u1puwex9T98=',
  // KEYS-END
};
