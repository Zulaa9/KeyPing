import type { CapacitorConfig } from '@capacitor/cli';

// KeyPing móvil (Capacitor). Interfaz propia para el móvil (proyecto Angular `keyping-mobile`, carpeta
// mobile/) sobre el mismo núcleo que el escritorio (core/): misma bóveda cifrada y mismo formato .kpenc.
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
    webContentsDebuggingEnabled: false,
    // Capacitor no escribe en logcat las llamadas a plugins (llevan contraseñas copiadas).
    loggingBehavior: 'none'
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
