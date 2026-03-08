// Tipos para el vault de KeyPing

export type VaultEntry = {
  id: string;
  createdAt: number;
  updatedAt?: number;
  twoFactorEnabled?: boolean;
  length: number;
  classMask: number;
  hash: string;        // hash sha256 de la password
  secret?: string; 
  normalized?: string; // patron normalizado (para similitud)
  label?: string;      // nombre de la web/app/servicio
  password?: string;   // secreto en claro dentro del vault cifrado
  active?: boolean;    // true = vigente, false = historica / eliminada
  previousId?: string; // id de la entrada anterior (edicion)
  loginUrl?: string;   // URL de login
  passwordChangeUrl?: string;  // URL directa para cambio de contraseña
  username?: string;
  email?: string;
  folder?: string;
  iconName?: string;
  iconSource?: 'auto' | 'manual';
  detectedService?: string;
};

export type VaultData = {
  entries: VaultEntry[];
};

export type VaultIntegrityIssueCode =
  | 'missing-file'
  | 'read-error'
  | 'invalid-header'
  | 'decrypt-failed'
  | 'invalid-json'
  | 'invalid-structure'
  | 'implausible-timestamps';

export type VaultIntegrityIssue = {
  code: VaultIntegrityIssueCode;
  count?: number;
  detail?: string;
};

export type VaultIntegrityStatus = 'ok' | 'warn' | 'error';

export type VaultIntegrityReport = {
  status: VaultIntegrityStatus;
  fileExists: boolean;
  issues: VaultIntegrityIssue[];
  entries?: number;
  checkedAt: number;
};
