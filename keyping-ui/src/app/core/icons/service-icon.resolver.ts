import { GENERIC_ICON_NAME, GENERIC_SERVICE_ID, SERVICE_ICON_REGISTRY } from './icon-registry';
import type { IconResolvableEntry, ResolvedIconResult, ServiceDefinition } from './service-detection.types';

const WORD_BOUNDARY = /[^\p{L}\p{N}]+/gu;

type Candidate = {
  service: ServiceDefinition;
  score: number;
  source: 'domain' | 'title' | 'username';
};

export function resolveEntryIcon(entry: IconResolvableEntry): ResolvedIconResult {
  if (entry.iconSource === 'manual' && entry.iconName) {
    return {
      serviceId: entry.detectedService || GENERIC_SERVICE_ID,
      iconName: entry.iconName,
      source: 'manual',
      confidence: 100,
      isAutoDetected: false
    };
  }

  const domainCandidate = scoreFromDomain(entry);
  const titleCandidate = scoreFromTitle(entry);
  const usernameCandidate = scoreFromUsername(entry);

  const winner = pickBest([domainCandidate, titleCandidate, usernameCandidate].filter(Boolean) as Candidate[]);
  if (!winner) {
    return {
      serviceId: GENERIC_SERVICE_ID,
      iconName: GENERIC_ICON_NAME,
      source: 'fallback',
      confidence: 0,
      isAutoDetected: true
    };
  }

  return {
    serviceId: winner.service.id,
    iconName: winner.service.iconName,
    source: winner.source,
    confidence: Math.max(1, Math.min(100, winner.score)),
    isAutoDetected: true
  };
}

function scoreFromDomain(entry: IconResolvableEntry): Candidate | null {
  const urls = [entry.loginUrl, entry.passwordChangeUrl].filter(Boolean) as string[];
  if (!urls.length) return null;

  let best: Candidate | null = null;
  for (const raw of urls) {
    const host = parseHost(raw);
    if (!host) continue;
    for (const service of SERVICE_ICON_REGISTRY) {
      for (const domain of service.domains) {
        const d = normalize(domain);
        const exact = host === d;
        const subdomain = host.endsWith(`.${d}`);
        if (!exact && !subdomain) continue;
        const score = (exact ? 96 : 88) + (service.priority || 0) * 0.03;
        const candidate: Candidate = { service, score, source: 'domain' };
        best = better(best, candidate);
      }
    }
  }
  return best;
}

function scoreFromTitle(entry: IconResolvableEntry): Candidate | null {
  const text = normalize(entry.label || '');
  if (!text) return null;

  // Allow exact "X" title to resolve to X/Twitter without enabling broad 1-char matches.
  if (text === 'x') {
    const service = SERVICE_ICON_REGISTRY.find(s => s.id === 'twitterx');
    if (service) {
      return {
        service,
        score: 61 + (service.priority || 0) * 0.02,
        source: 'title'
      };
    }
  }

  let best: Candidate | null = null;
  for (const service of SERVICE_ICON_REGISTRY) {
    const words = tokenize(text);
    const keyScore = scoreKeyword(words, text, service.keywords, 60);
    const aliasScore = scoreKeyword(words, text, service.aliases || [], 54);
    const raw = Math.max(keyScore, aliasScore);
    if (raw <= 0) continue;
    const candidate: Candidate = {
      service,
      score: raw + (service.priority || 0) * 0.02,
      source: 'title'
    };
    best = better(best, candidate);
  }
  return best;
}

function scoreFromUsername(entry: IconResolvableEntry): Candidate | null {
  const email = normalize(entry.email || '');
  const username = normalize(entry.username || '');
  let best: Candidate | null = null;

  const emailDomain = extractEmailDomain(email);
  for (const service of SERVICE_ICON_REGISTRY) {
    if (emailDomain) {
      const emailDomains = new Set([...(service.emailDomains || []), ...service.domains].map(normalize));
      for (const domain of emailDomains) {
        if (emailDomain === domain || emailDomain.endsWith(`.${domain}`)) {
          const candidate: Candidate = {
            service,
            score: 44 + (service.priority || 0) * 0.015,
            source: 'username'
          };
          best = better(best, candidate);
        }
      }
    }

    const words = tokenize(username);
    const userKeyword = scoreKeyword(words, username, service.keywords, 38);
    const userAlias = scoreKeyword(words, username, service.aliases || [], 34);
    const raw = Math.max(userKeyword, userAlias);
    if (raw > 0) {
      const candidate: Candidate = {
        service,
        score: raw + (service.priority || 0) * 0.01,
        source: 'username'
      };
      best = better(best, candidate);
    }
  }

  return best;
}

function scoreKeyword(words: string[], text: string, values: string[], base: number): number {
  let best = 0;
  for (const raw of values) {
    const term = normalize(raw);
    if (!term) continue;
    if (term.length <= 1) continue;
    if (term.includes(' ')) {
      if (text.includes(term)) best = Math.max(best, base);
      continue;
    }
    if (words.includes(term)) {
      best = Math.max(best, base);
    }
  }
  return best;
}

function better(a: Candidate | null, b: Candidate): Candidate {
  if (!a) return b;
  if (b.score !== a.score) return b.score > a.score ? b : a;
  return (b.service.priority || 0) > (a.service.priority || 0) ? b : a;
}

function pickBest(candidates: Candidate[]): Candidate | null {
  if (!candidates.length) return null;
  let best: Candidate | null = null;
  for (const c of candidates) best = better(best, c);
  return best;
}

function parseHost(rawUrl: string): string | null {
  const clean = rawUrl.trim();
  if (!clean) return null;
  try {
    const direct = new URL(clean);
    return normalize(direct.hostname);
  } catch {
    try {
      const patched = new URL(`https://${clean}`);
      return normalize(patched.hostname);
    } catch {
      return null;
    }
  }
}

function extractEmailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at === -1) return null;
  const domain = normalize(email.slice(at + 1));
  return domain || null;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(WORD_BOUNDARY)
    .map(v => v.trim())
    .filter(Boolean);
}
