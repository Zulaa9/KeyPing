// Tipos para el vault de KeyPing

export type VaultEntry = {
  id: string;
  createdAt: number;
  updatedAt?: number;
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
};

export type VaultData = {
  entries: VaultEntry[];
};
