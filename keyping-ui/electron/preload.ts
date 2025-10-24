import { contextBridge } from 'electron';

// API vacia por ahora; expondremos metodos seguros mas adelante
contextBridge.exposeInMainWorld('keyping', {});
