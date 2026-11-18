// Analizador de patrones de contraseñas (proceso principal).
import { RAW_COMMON_WORDS } from './common-words';
import { findMostSimilarInVault } from './vault/similarity';

/* ----------------------------------------------------------------
   Detector multilingüe de patrones (versión inicial)
   - normaliza mayúsculas/minúsculas, diacríticos y leet
   - detecta palabras comunes (EN/ES/FR/DE/PT/IT)
   - detecta secuencias numéricas y recorridos de teclado
   - detecta repeticiones y sufijos incrementales
   - valida longitud y variedad de caracteres
------------------------------------------------------------------ */

type Level = 'ok' | 'warn' | 'danger';

const KEYBOARD_RUNS = [
  'qwerty','asdf','zxcv','qwert','wasd',
  'azerty','qsdf','wxcv','azer'
];

const NUM_SEQUENCES = ['0123','1234','2345','3456','4567','5678','6789','7890'];
const YEAR_SUFFIX = /(19|20)\d{2}$/;

const LEET_MAP: Record<string,string> = {
  '0':'o','1':'i','2':'z','3':'e','4':'a','5':'s','6':'g','7':'t','8':'b','9':'g',
  '@':'a','$':'s','!':'i','¡':'i','¿':'','?':'','+':'t'
};

function normalizeBasic(s: string): string {
  let x = (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[\s._\-:/\\|'",`~^°(){}\[\]]/g,'');
  x = x.replace(/[0123456789@$!¡\+\?]/g, m => LEET_MAP[m] ?? m);
  x = x.replace(/(.)\1{2,}/g, '$1$1');
  return x;
}

const COMMON_WORDS: Set<string> = (() => {
  const set = new Set<string>();
  for (const w of RAW_COMMON_WORDS) {
    const n = normalizeBasic(w);
    if (n && n.length >= 3) {
      set.add(n);
    }
  }
    return set;
})();


function classMask(s: string): number {
  let m = 0;
  if (/[a-z]/.test(s)) m |= 1;
  if (/[A-Z]/.test(s)) m |= 2;
  if (/\d/.test(s))   m |= 4;
  if (/[^A-Za-z0-9]/.test(s)) m |= 8;
  return m;
}

function hasCommonWord(nrm: string): string | null {
  if (COMMON_WORDS.has(nrm)) return nrm;

  for (const w of COMMON_WORDS) {
    if (!w) continue;
    if (w.length >= 4 && nrm.includes(w)) {
      return w;
    }
  }
  return null;
}

function hasSequence(nrm: string): string | null {
  if (NUM_SEQUENCES.some(seq => nrm.includes(seq))) return 'numeric sequence';
  if (KEYBOARD_RUNS.some(run => nrm.includes(run))) return 'keyboard run';
  if (/([a-z])\1{2,}/.test(nrm) || /(\d)\1{2,}/.test(nrm)) return 'repeated chars';
  return null;
}

function looksIncremental(orig: string): boolean {
  if (YEAR_SUFFIX.test(orig)) return true;

  const m = orig.match(/^(.*?)([!.?_\-])?(\d{1,4})$/);
  if (!m) return false;

  const prefix = m[1] || '';
  if (prefix.length <= 12) return true;

  return false;
}

export type CheckReasonCode =
  | 'commonWord' | 'numericSequence' | 'keyboardRun' | 'repeatedChars' | 'incremental'
  | 'short' | 'lowVariety' | 'trivialBase' | 'similarHigh' | 'similarMedium';

export type CheckReason = { code: CheckReasonCode; params?: Record<string, string | number> };

export async function checkPasswordBetter(pwdInput: string): Promise<{ level: Level; reasons: string[]; codes: CheckReason[] }> {
  const reasons: string[] = [];
  const codes: CheckReason[] = [];
  // Limita el coste del análisis (similitud O(n·m)) ante entradas enormes.
  const pwd = typeof pwdInput === 'string' ? pwdInput.slice(0, 256) : '';
  let level: Level = 'ok';
  const nrm = normalizeBasic(pwd);
  const orig = pwd || '';

  if (!orig) return { level, reasons, codes };

  const hit = hasCommonWord(nrm);
  if (hit) { level = 'danger'; reasons.push(`common word: "${hit}"`); codes.push({ code: 'commonWord', params: { word: hit } }); }

  const seq = hasSequence(nrm);
  if (seq) {
    level = level === 'danger' ? 'danger' : 'warn';
    reasons.push(seq);
    codes.push({ code: seq === 'numeric sequence' ? 'numericSequence' : seq === 'keyboard run' ? 'keyboardRun' : 'repeatedChars' });
  }

  if (looksIncremental(orig)) {
    level = level === 'danger' ? 'danger' : 'warn';
    reasons.push('incremental suffix (e.g., !1, 2024)');
    codes.push({ code: 'incremental' });
  }

  const len = orig.length;
  const cm = classMask(orig);
  const classCount = ((cm & 1)?1:0)+((cm & 2)?1:0)+((cm & 4)?1:0)+((cm & 8)?1:0);

  if (len < 10) {
    level = level === 'danger' ? 'danger' : 'warn';
    reasons.push('short length (<10)');
    codes.push({ code: 'short', params: { min: 10 } });
  }
  if (classCount < 3) {
    level = level === 'danger' ? 'danger' : 'warn';
    reasons.push('low character variety');
    codes.push({ code: 'lowVariety' });
  }

  if (/^(password|pass|contrasena|senha|passwort|motdepasse|admin)[^a-z]*\d{0,4}$/i.test(orig)) {
    level = 'danger';
    reasons.push('trivial base with small variation');
    codes.push({ code: 'trivialBase' });
  }

  try {
    const best = await findMostSimilarInVault(orig);
    if (best) {
      const score = Math.round(best.score);
      const noteSnippet = best.entry.label ? ` (${best.entry.label})` : '';

      if (score >= 80) {
        level = 'danger';
        reasons.push(`similar to previous password${noteSnippet} (~${score}% match)`);
        codes.push({ code: 'similarHigh', params: { label: best.entry.label || '', score } });
      } else if (score >= 60) {
        if (level === 'ok') level = 'warn';
        reasons.push(`somewhat similar to previous password${noteSnippet} (~${score}% match)`);
        codes.push({ code: 'similarMedium', params: { label: best.entry.label || '', score } });
      }
    }
  } catch {
    // Sin acceso al vault (bloqueado o ilegible): se omite la comparación de similitud.
  }

  return { level, reasons, codes };
}

