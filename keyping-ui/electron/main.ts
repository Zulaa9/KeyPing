import { app, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import * as url from 'url';

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Seguridad basica
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, targetUrl) => {
    if (!targetUrl.startsWith('file://')) {
      e.preventDefault();
      shell.openExternal(targetUrl);
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const prodUrl = url.format({
    pathname: path.join(__dirname, '../dist/keyping-ui/browser/index.html'),
    protocol: 'file:',
    slashes: true
  });

  win.loadURL(devUrl ?? prodUrl);
  win.once('ready-to-show', () => win?.show());
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
