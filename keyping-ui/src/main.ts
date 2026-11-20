import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app';
import { installPlatform } from './app/platform/platform';

// En el escritorio installPlatform no hace nada (window.keyping lo pone el preload de Electron);
// en las builds móviles crea window.keyping con el núcleo compartido antes de arrancar Angular.
installPlatform()
  .then(() => bootstrapApplication(AppComponent, appConfig))
  .catch(err => console.error(err));
