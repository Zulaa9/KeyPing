// KeyPing móvil: interfaz propia sobre el núcleo compartido con el escritorio (core/).
import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { installPlatform } from './app/platform/platform';
import { Root } from './app/root';

installPlatform()
  .then(() => bootstrapApplication(Root, { providers: [provideZonelessChangeDetection()] }))
  .catch(err => console.error('[keyping] start failed', err?.message));
