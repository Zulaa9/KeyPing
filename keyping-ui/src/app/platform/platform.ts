// Capa de plataforma. En el escritorio, window.keyping lo expone el preload de Electron y aquí no
// se instala nada. Las builds móviles sustituyen este archivo (angular.json, fileReplacements):
//   - platform.mobile.ts: Capacitor (Android; iOS preparado) con el núcleo compartido core/.
//   - platform.mobile-sim.ts: la misma capa en un navegador, para pruebas con Playwright.
export const PLATFORM_TARGET: 'desktop' | 'mobile' | 'mobile-sim' = 'desktop';

export async function installPlatform(): Promise<void> {}
