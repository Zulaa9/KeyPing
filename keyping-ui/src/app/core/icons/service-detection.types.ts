export type DetectionSource = 'domain' | 'title' | 'username' | 'fallback' | 'manual';

export type EntryIconSource = 'auto' | 'manual';

export type IconResolvableEntry = {
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
  serviceId: string;
  iconName: string;
  source: DetectionSource;
  confidence: number;
  isAutoDetected: boolean;
};

