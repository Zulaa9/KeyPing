import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Ajustes persistidos del módulo vault (p. ej. límite de historial por entrada).
const SETTINGS_FILE = 'keyping-settings.json';
export const DEFAULT_MAX_HISTORY = 20;

type StoredSettings = {
  maxHistoryPerEntry?: number;
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function clampHistory(value: number): number {
  const v = Math.round(value);
  return Math.min(200, Math.max(1, v));
}

export async function loadSettings(): Promise<Required<StoredSettings>> {
  // Lee ajustes con valor por defecto seguro si no existen o están corruptos.
  const file = settingsPath();
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as StoredSettings;
    return {
      maxHistoryPerEntry: clampHistory(parsed.maxHistoryPerEntry ?? DEFAULT_MAX_HISTORY)
    };
  } catch {
    return { maxHistoryPerEntry: DEFAULT_MAX_HISTORY };
  }
}

export async function saveSettings(partial: StoredSettings): Promise<Required<StoredSettings>> {
  // Guarda ajustes normalizados y devuelve el estado final persistido.
  const current = await loadSettings();
  const next: Required<StoredSettings> = {
    maxHistoryPerEntry: clampHistory(partial.maxHistoryPerEntry ?? current.maxHistoryPerEntry)
  };
  const file = settingsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(next), 'utf8');
  return next;
}
