import * as path from 'path';
import { app } from 'electron';

// Resolución centralizada del directorio de datos (userData).
// Los tests de Node fijan un directorio temporal con setDataDirForTests para no
// depender de Electron ni tocar nunca la bóveda real del equipo.
let overrideDir: string | null = null;

export function setDataDirForTests(dir: string | null): void {
  overrideDir = dir;
}

export function dataDir(): string {
  return overrideDir ?? app.getPath('userData');
}

export function dataFile(name: string): string {
  return path.join(dataDir(), name);
}
