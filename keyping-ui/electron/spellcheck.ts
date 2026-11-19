// La app no usa corrector ortográfico (spellcheck: false en la ventana), pero en Linux el
// motor de Electron descarga igualmente un diccionario de los servidores de Google
// (redirector.gvt1.com) al crear la sesión, según el idioma del sistema. Para no hacer
// ninguna conexión que no sea la comprobación de actualizaciones, se vacía la lista de
// idiomas y se desactiva el corrector en cuanto se crea cada sesión.

export interface SpellcheckSession {
  setSpellCheckerEnabled(enable: boolean): void;
  setSpellCheckerLanguages(languages: string[]): void;
}

export function disableSpellcheckDownloads(session: SpellcheckSession, platform: NodeJS.Platform = process.platform): void {
  session.setSpellCheckerEnabled(false);
  // En macOS se usa el corrector del sistema y Electron no admite cambiar los idiomas.
  if (platform === 'darwin') return;
  try {
    session.setSpellCheckerLanguages([]);
  } catch (error) {
    console.warn('[main] no se pudieron vaciar los idiomas del corrector', error);
  }
}
