import type { CapacitorConfig } from '@capacitor/cli';

// KeyPing móvil (Capacitor). La app web es la misma de escritorio compilada con
// `ng build --configuration mobile` (capa de plataforma móvil en src/app/platform).
const config: CapacitorConfig = {
  // Identificador de la app en Google Play: definitivo una vez publicado (ver docs/MOVIL.md).
  appId: 'dev.zula.keyping',
  appName: 'KeyPing',
  webDir: 'dist/keyping-ui-mobile/browser',
  // Sin servidor remoto ni recarga en vivo: todo se sirve desde el APK.
  server: {
    androidScheme: 'https',
    cleartext: false
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false
  },
  ios: {
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: true
  },
  plugins: {
    CapacitorHttp: { enabled: false },
    CapacitorCookies: { enabled: false }
  }
};

export default config;
