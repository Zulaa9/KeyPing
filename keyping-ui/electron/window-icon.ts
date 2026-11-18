import { join } from 'node:path';

type WindowIconContext = {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  resourcesPath: string;
};

/**
 * En Linux un AppImage sin integrar no tiene archivo .desktop en el sistema, así que la ventana
 * debe indicar su propio icono. Windows y macOS lo toman del ejecutable.
 */
export function getLinuxWindowIcon(context: WindowIconContext): string | undefined {
  if (context.platform !== 'linux' || !context.isPackaged) return undefined;
  return join(context.resourcesPath, 'icon.png');
}
