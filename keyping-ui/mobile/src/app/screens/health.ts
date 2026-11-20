// Pestaña Salud: mismos criterios que la página de salud del escritorio (fuerza por longitud y variedad,
// duplicadas por hash HMAC, sin 2FA). Los problemas se ordenan por gravedad y llevan al detalle.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { I18n } from '../i18n';
import { Entry, VaultStore, displayName } from '../vault';
import { Icon, Nav, avatarOf } from '../ui';

type Level = 'strong' | 'medium' | 'weak';
type Issue = { entry: Entry; reasons: string[]; severity: number; level: Level };

function variety(mask: number): number {
  return [1, 2, 4, 8].filter(b => mask & b).length;
}

function strength(e: Entry): Level {
  const len = e.length || 0;
  const v = variety(e.classMask || 0);
  if (len >= 16 && v >= 3) return 'strong';
  if (len >= 12 && v >= 2) return 'medium';
  return 'weak';
}

@Component({
  selector: 'kp-health',
  standalone: true,
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <header class="appbar large"><div class="appbar-row"><h1>{{ i18n.t('health.title') }}</h1></div></header>
  <main class="page">
    @if (!store.entries().length) {
      <p class="muted">{{ i18n.t('health.empty') }}</p>
    } @else {
      <section class="score-card" [attr.data-band]="band()">
        <div class="score-ring" [style.--p]="score()"><span>{{ score() }}</span></div>
        <div>
          <strong>{{ i18n.t('health.band.' + band()) }}</strong>
          <p class="muted small">{{ i18n.t('health.scoreHint') }}</p>
        </div>
      </section>
      <div class="stats">
        <div class="stat"><b>{{ counts().strong }}</b><span>{{ i18n.t('health.strong') }}</span></div>
        <div class="stat"><b>{{ counts().weak }}</b><span>{{ i18n.t('health.weak') }}</span></div>
        <div class="stat"><b>{{ dupEntries() }}</b><span>{{ i18n.t('health.reused') }}</span></div>
        <div class="stat"><b>{{ counts().no2fa }}</b><span>{{ i18n.t('health.no2fa') }}</span></div>
      </div>

      <h2 class="section">{{ i18n.t('health.issues', { n: issues().length }) }}</h2>
      @if (!issues().length) {
        <p class="msg ok">{{ i18n.t('health.allGood') }}</p>
      } @else {
        <ul class="rows flush">
          @for (it of issues(); track it.entry.id) {
            <li>
              <button class="row" (click)="nav.push({ name: 'detail', id: it.entry.id })">
                <span class="avatar" [style.--h]="avatar(it.entry).hue">{{ avatar(it.entry).letter }}</span>
                <span class="row-text">
                  <span class="row-title">{{ name(it.entry) }}</span>
                  <span class="row-sub issue" [attr.data-level]="it.level">{{ it.reasons.join(' · ') }}</span>
                </span>
                <kp-icon name="chevron" [size]="20"/>
              </button>
            </li>
          }
        </ul>
      }
    }
  </main>`
})
export class HealthScreen {
  readonly i18n = inject(I18n);
  readonly nav = inject(Nav);
  readonly store = inject(VaultStore);
  private readonly hashes = signal<Map<string, string>>(new Map());

  constructor() {
    // Los hashes (HMAC) se recalculan cuando cambia la lista; nunca salen las contraseñas.
    effect(() => {
      this.store.entries();
      void this.store.svc.getPasswordHashes().then(list => this.hashes.set(new Map(list.map(h => [h.id, h.hash]))));
    });
  }

  private readonly dupGroups = computed(() => {
    const by = new Map<string, string[]>();
    for (const [id, h] of this.hashes()) if (h) by.set(h, [...(by.get(h) || []), id]);
    const dupOf = new Map<string, number>();
    for (const ids of by.values()) if (ids.length > 1) for (const id of ids) dupOf.set(id, ids.length);
    return dupOf;
  });

  readonly dupEntries = computed(() => this.dupGroups().size);

  readonly counts = computed(() => {
    const c = { strong: 0, medium: 0, weak: 0, short: 0, low: 0, no2fa: 0 };
    for (const e of this.store.entries()) {
      c[strength(e)]++;
      if ((e.length || 0) < 10) c.short++;
      if (variety(e.classMask || 0) < 3) c.low++;
      if (!e.twoFactorEnabled) c.no2fa++;
    }
    return c;
  });

  readonly score = computed(() => {
    const total = this.store.entries().length;
    if (!total) return 0;
    const c = this.counts();
    const pct = (n: number) => Math.round((n / total) * 100);
    const dups = this.dupEntries();
    const dupPenalty = dups > 0 ? Math.min(25, 10 + (dups / total) * 30) : 0;
    const raw = 100 - pct(c.weak) * 0.5 - pct(c.short) * 0.8 - pct(c.low) * 0.4 - pct(c.no2fa) * 0.2 - dupPenalty;
    return Math.round(Math.max(0, Math.min(100, raw)));
  });

  readonly band = computed(() => {
    const s = this.score();
    return s >= 85 ? 'excellent' : s >= 70 ? 'good' : s >= 50 ? 'moderate' : 'risky';
  });

  readonly issues = computed<Issue[]>(() => {
    const out: Issue[] = [];
    for (const e of this.store.entries()) {
      const level = strength(e);
      const reasons: string[] = [];
      let severity = 0;
      const dup = this.dupGroups().get(e.id);
      if (dup) { severity += 60; reasons.push(this.i18n.t('health.r.reused', { n: dup })); }
      if ((e.length || 0) < 10) { severity += 40; reasons.push(this.i18n.t('health.r.short')); }
      if (variety(e.classMask || 0) < 3) { severity += 25; reasons.push(this.i18n.t('health.r.variety')); }
      if (level === 'weak') { severity += 20; reasons.push(this.i18n.t('health.r.weak')); }
      if (!e.twoFactorEnabled) { severity += 10; reasons.push(this.i18n.t('health.r.no2fa')); }
      // Solo «sin 2FA» no es un problema de la contraseña: no se lista para no llenar la pantalla.
      if (severity > 10) out.push({ entry: e, reasons, severity, level });
    }
    return out.sort((a, b) => b.severity - a.severity);
  });

  name(e: Entry): string {
    return displayName(e) || this.i18n.t('list.noName');
  }

  avatar(e: Entry) {
    return avatarOf(this.name(e));
  }
}
