// Tipos para el vault de KeyPing (sin tildes ni enies)

export type VaultEntry = {
  id: string;
  createdAt: number;
  length: number;
  classMask: number;
  hash: string;       // hash sha256 de la password
  normalized?: string; // patron normalizado (para similitud)
  note?: string;
};

export type VaultData = {
  entries: VaultEntry[];
};
