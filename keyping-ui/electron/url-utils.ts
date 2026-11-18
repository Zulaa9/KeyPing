// Validación y normalización de los enlaces de cada entrada (loginUrl / passwordChangeUrl).
// Módulo puro (sin Electron) para poder probarlo con node --test.
// IMPORTANTE: src/app/core/url-utils.ts y electron/url-utils.ts deben ser idénticos (lo comprueba un test).

export type UrlCheck =
  | { ok: true; value: string; href: string; host: string }
  | { ok: false; reason: 'empty' | 'scheme' | 'invalid' | 'credentials' | 'too-long' };

export const MAX_URL_LENGTH = 2048;

const HAS_AUTHORITY_SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const HAS_SCHEME = /^([a-z][a-z0-9+.-]*):(.*)$/i;

/**
 * Normaliza un enlace introducido por la persona usuaria o importado:
 * - recorta espacios y añade https:// si no hay esquema ("github.com/settings" -> "https://github.com/settings");
 * - solo admite http y https; rechaza javascript:, file:, data:, rutas locales o UNC de Windows y
 *   credenciales incrustadas (https://usuario:clave@host);
 * - devuelve `value` (lo que se guarda, legible) y `href` (lo que se abre, con el dominio en punycode).
 */
export function checkEntryUrl(raw: unknown): UrlCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  let value = raw.trim();
  if (!value) return { ok: false, reason: 'empty' };
  if (value.length > MAX_URL_LENGTH) return { ok: false, reason: 'too-long' };

  // Rutas UNC (\\servidor\recurso) y rutas locales de Windows o Unix.
  if (value.startsWith('\\') || value.startsWith('/') && !value.startsWith('//')) {
    return { ok: false, reason: 'scheme' };
  }
  if (/^[a-z]:[\\/]/i.test(value)) return { ok: false, reason: 'scheme' };

  if (value.startsWith('//')) {
    value = 'https:' + value;
  } else if (!HAS_AUTHORITY_SCHEME.test(value)) {
    const m = value.match(HAS_SCHEME);
    // "ejemplo.com:8443/ruta" o "localhost:3000" no son esquemas: es host:puerto.
    if (m && !/^\d+(\/|$|\?|#)/.test(m[2])) {
      return { ok: false, reason: 'scheme' };
    }
    value = 'https://' + value;
  }

  const scheme = (value.match(HAS_AUTHORITY_SCHEME)?.[1] || '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return { ok: false, reason: 'scheme' };

  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (!u.hostname || /\s/.test(value)) return { ok: false, reason: 'invalid' };
  if (u.username || u.password) return { ok: false, reason: 'credentials' };

  // Esquema y dominio en minúsculas para que la búsqueda y la detección de servicio sean estables.
  const rest = value.slice(value.indexOf('//') + 2);
  const cut = rest.search(/[/?#]/);
  const authority = cut === -1 ? rest : rest.slice(0, cut);
  const tail = cut === -1 ? '' : rest.slice(cut);
  const normalized = `${scheme}://${authority.toLowerCase()}${tail}`;

  return { ok: true, value: normalized, href: u.href, host: u.hostname };
}

/** Devuelve la URL segura para abrir en el navegador del sistema, o null si no es válida. */
export function safeExternalHref(raw: unknown): string | null {
  const res = checkEntryUrl(raw);
  return res.ok ? res.href : null;
}

/** Para guardar/importar: valor normalizado, undefined si está vacío; lanza si no es válido. */
export function normalizeStoredUrl(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string' && !raw.trim()) return '';
  const res = checkEntryUrl(raw);
  if (!res.ok) throw new Error(`invalid-url:${res.reason}`);
  return res.value;
}

/** Para importar: como normalizeStoredUrl pero descarta (undefined) en lugar de lanzar. */
export function tryNormalizeStoredUrl(raw: unknown): string | undefined {
  try {
    return normalizeStoredUrl(raw);
  } catch {
    return undefined;
  }
}
