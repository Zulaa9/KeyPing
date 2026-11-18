import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, withHashLocation } from '@angular/router';

import { routes } from './app.routes';

// Configuración raíz de Angular: providers globales de routing, HTTP y gestión de errores.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    // Rutas con hash: la app se carga desde file://, donde una recarga o un enlace con ruta
    // real (file:///.../settings) llevaría a una página de error en lugar de a la vista.
    provideRouter(routes, withHashLocation()),
    provideHttpClient()
  ]
};
