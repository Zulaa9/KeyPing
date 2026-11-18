import { execFile } from 'node:child_process';

// Electron no permite escribir texto y formatos propios en una sola operación: cada escritura
// vacía el portapapeles. Por eso en Windows se usa un proceso auxiliar que publica el texto junto
// con los formatos que lo excluyen del historial (Win+V) y del portapapeles en la nube.
export const CLIPBOARD_EXCLUSION_FORMATS = [
  'ExcludeClipboardContentFromMonitorProcessing',
  'CanIncludeInClipboardHistory',
  'CanUploadToCloudClipboard'
] as const;

// El secreto llega por la entrada estándar: nunca aparece en la línea de comandos del proceso.
export const WINDOWS_CLIPBOARD_SCRIPT = `
  $ErrorActionPreference = 'Stop'
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $bytes = [Convert]::FromBase64String([Console]::In.ReadLine())
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    $data = New-Object System.Windows.Forms.DataObject
    $data.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $true, $text)
    foreach ($format in @(${CLIPBOARD_EXCLUSION_FORMATS.map(f => `'${f}'`).join(', ')})) {
      $data.SetData($format, $false, [System.IO.MemoryStream]::new([byte[]](0, 0, 0, 0)))
    }
    [System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 10, 100)
    exit 0
  } catch {
    exit 1
  }
`;

export const WINDOWS_CLIPBOARD_ARGS: readonly string[] = [
  '-NoProfile',
  '-NonInteractive',
  '-STA',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  WINDOWS_CLIPBOARD_SCRIPT
];

export type ClipboardHelperRunner = (args: readonly string[], stdin: string) => Promise<boolean>;

const runPowerShell: ClipboardHelperRunner = (args, stdin) =>
  new Promise(resolve => {
    const child = execFile(
      'powershell.exe',
      [...args],
      { windowsHide: true, timeout: 8000 },
      err => resolve(!err)
    );
    child.stdin?.on('error', () => resolve(false));
    child.stdin?.end(stdin);
  });

/**
 * Copia el texto excluyéndolo del historial de Windows. Devuelve false si no se ha podido, para
 * que quien llama decida cómo continuar.
 */
export async function writeSecretToWindowsClipboard(
  secret: string,
  run: ClipboardHelperRunner = runPowerShell
): Promise<boolean> {
  try {
    return await run(WINDOWS_CLIPBOARD_ARGS, `${Buffer.from(secret, 'utf8').toString('base64')}\n`);
  } catch {
    return false;
  }
}
