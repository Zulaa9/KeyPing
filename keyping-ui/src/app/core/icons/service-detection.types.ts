// Tipos base para resolver iconos/servicios a partir de metadatos de entrada.
export type DetectionSource = 'domain' | 'title' | 'username' | 'fallback' | 'manual';

export type EntryIconSource = 'auto' | 'manual';

export type IconResolvableEntry = {
  // Campos que pueden aportar señal para detectar servicio.
  label?: string;
  loginUrl?: string;
  passwordChangeUrl?: string;
  username?: string;
  email?: string;
  iconName?: string;
  iconSource?: EntryIconSource;
  detectedService?: string;
};

export type ServiceDefinition = {
  // Definición normalizada de un servicio soportado en el catálogo de iconos.
  id: string;
  displayName: string;
  iconName: string;
  domains: string[];
  keywords: string[];
  aliases?: string[];
  emailDomains?: string[];
  priority?: number;
};

export type ResolvedIconResult = {
  // Resultado final de la heurística de detección.
  serviceId: string;
  iconName: string;
  source: DetectionSource;
  confidence: number;
  isAutoDetected: boolean;
};
