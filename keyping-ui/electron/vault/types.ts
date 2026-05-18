// Tipos de dominio del vault de KeyPing (proceso principal).

export type VaultEntry = {
  id: string;
  createdAt: number;
  updatedAt?: number;
  twoFactorEnabled?: boolean;
  length: number;
  classMask: number;
  hash: string;
  secret?: string;
  normalized?: string;
  label?: string;
  active?: boolean;
  previousId?: string;
  loginUrl?: string;
  passwordChangeUrl?: string;
  username?: string;
  email?: string;
  folder?: string;
  iconName?: string;
  iconSource?: 'auto' | 'manual';
  detectedService?: string;
};

export type VaultData = {
  entries: VaultEntry[];
  hashVersion?: string; // 'hmac-sha256-v1' when hashes are keyed HMAC; absent = legacy SHA-256
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
