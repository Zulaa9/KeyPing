import { Component, OnInit } from '@angular/core';
import { NgFor, NgIf, NgClass } from '@angular/common';
import { ElectronService, PasswordMeta } from '../../core/electron.service';
import { Router } from '@angular/router';

type StrengthLevel = 'strong' | 'medium' | 'weak';

type HealthIssue = {
  entry: PasswordMeta;
  plain?: string | null;
  reasons: string[];
  severity: number;
  level: StrengthLevel;
};

type DuplicateGroup = {
  value: string;
  entries: PasswordMeta[];
};

@Component({
  selector: 'app-password-health',
  standalone: true,
  imports: [NgFor, NgIf, NgClass],
  templateUrl: './password-health.html',
  styleUrls: ['./password-health.scss']
})
export class PasswordHealthComponent implements OnInit {
  loading = true;

  total = 0;
  strongCount = 0;
  mediumCount = 0;
  weakCount = 0;

  shortCount = 0;
  lowVarietyCount = 0;
  noTwoFactorCount = 0;

  duplicateGroups: DuplicateGroup[] = [];
  duplicateEntries = 0;

  score = 0;
  scoreLabel = 'Moderado';
  readonly scoreRadius = 46;

  issues: HealthIssue[] = [];
  private revealedDupValues = new Set<string>();

  constructor(
    private es: ElectronService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadHealth();
  }

  goToPassword(issue: HealthIssue): void {
    this.router.navigate(['/passwords'], { queryParams: { select: issue.entry.id } });
  }

  isDupRevealed(dup: DuplicateGroup): boolean {
    return this.revealedDupValues.has(dup.value);
  }

  toggleDup(dup: DuplicateGroup, ev?: MouseEvent): void {
    if (ev) ev.stopPropagation();
    const key = dup.value;
    if (this.revealedDupValues.has(key)) {
      this.revealedDupValues.delete(key);
    } else {
      this.revealedDupValues.add(key);
    }
  }

  get strongPct(): number {
    return this.asPct(this.strongCount);
  }

  get mediumPct(): number {
    return this.asPct(this.mediumCount);
  }

  get weakPct(): number {
    return this.asPct(this.weakCount);
  }

  get shortPct(): number {
    return this.asPct(this.shortCount);
  }

  get lowVarietyPct(): number {
    return this.asPct(this.lowVarietyCount);
  }

  get noTwoFactorPct(): number {
    return this.asPct(this.noTwoFactorCount);
  }

  get scoreCircumference(): number {
    return 2 * Math.PI * this.scoreRadius;
  }

  get scoreDashoffset(): number {
    return this.scoreCircumference * (1 - this.score / 100);
  }

  variety(entry: PasswordMeta): number {
    return this.countVariety(entry.classMask || 0);
  }

  async loadHealth(): Promise<void> {
    this.loading = true;
    try {
      const metas = await this.es.listPasswords();
      this.total = metas.length;
      this.resetCounters();

      const entriesWithPlain: Array<{ meta: PasswordMeta; plain?: string | null }> = [];
      for (const meta of metas) {
        let plain: string | null = null;
        try {
          plain = await this.es.getPassword(meta.id);
        } catch (err) {
          console.error('[PasswordHealth] failed to fetch password', err);
        }
        entriesWithPlain.push({ meta, plain });
      }

      this.computeDuplicates(entriesWithPlain);
      this.computeStats(entriesWithPlain);
      this.computeScore();
    } finally {
      this.loading = false;
    }
  }

  getStrength(level: StrengthLevel): string {
    if (level === 'strong') return 'Fuerte';
    if (level === 'medium') return 'Media';
    return 'Débil';
  }

  severityClass(severity: number): string {
    if (severity >= 80) return 'issue-danger';
    if (severity >= 50) return 'issue-warn';
    return 'issue-muted';
  }

  private computeStats(entries: Array<{ meta: PasswordMeta; plain?: string | null }>): void {
    const issues: HealthIssue[] = [];

    for (const { meta, plain } of entries) {
      const variety = this.countVariety(meta.classMask || 0);
      const len = meta.length || (plain ? plain.length : 0) || 0;
      const level = this.classifyStrength(len, variety);

      if (level === 'strong') this.strongCount++;
      else if (level === 'medium') this.mediumCount++;
      else this.weakCount++;

      if (len < 10) this.shortCount++;
      if (variety < 3) this.lowVarietyCount++;
      if (!meta.twoFactorEnabled) this.noTwoFactorCount++;

      const reasons: string[] = [];
      let severity = 0;

      if (len < 10) {
        severity += 40;
        reasons.push('Demasiado corta (<10)');
      }
      if (variety < 3) {
        severity += 25;
        reasons.push('Baja variedad de caracteres');
      }
      if (!meta.twoFactorEnabled) {
        severity += 10;
        reasons.push('2FA deshabilitado');
      }
      if (level === 'weak') {
        severity += 20;
        reasons.push('Contraseña débil');
      }

      const dupGroup = this.findDuplicateGroup(plain);
      if (dupGroup) {
        severity += 60;
        reasons.push(`Duplicada (${dupGroup.entries.length} coincidencias)`);
      }

      if (reasons.length > 0) {
        issues.push({
          entry: meta,
          plain,
          reasons,
          severity,
          level
        });
      }
    }

    this.issues = issues.sort((a, b) => b.severity - a.severity);
  }

  private computeDuplicates(entries: Array<{ meta: PasswordMeta; plain?: string | null }>): void {
    const map = new Map<string, PasswordMeta[]>();

    for (const { meta, plain } of entries) {
      if (!plain) continue;
      if (!map.has(plain)) {
        map.set(plain, []);
      }
      map.get(plain)!.push(meta);
    }

    const groups: DuplicateGroup[] = [];
    let duplicateEntries = 0;

    for (const [value, metas] of map.entries()) {
      if (metas.length > 1) {
        groups.push({ value, entries: metas });
        duplicateEntries += metas.length;
      }
    }

    this.duplicateGroups = groups;
    this.duplicateEntries = duplicateEntries;
  }

  private computeScore(): void {
    if (this.total === 0) {
      this.score = 0;
      this.scoreLabel = 'Sin datos';
      return;
    }

    const weakPenalty = this.weakPct * 0.5;
    const shortPenalty = this.shortPct * 0.8;
    const varietyPenalty = this.lowVarietyPct * 0.4;
    const twoFaPenalty = this.noTwoFactorPct * 0.2;
    const duplicatePenalty = this.duplicateGroups.length > 0
      ? Math.min(25, 10 + (this.duplicateEntries / this.total) * 30)
      : 0;

    const raw = 100 - weakPenalty - shortPenalty - varietyPenalty - twoFaPenalty - duplicatePenalty;
    this.score = Math.round(Math.max(0, Math.min(100, raw)));

    if (this.score >= 85) this.scoreLabel = 'Excelente';
    else if (this.score >= 70) this.scoreLabel = 'Muy bien';
    else if (this.score >= 50) this.scoreLabel = 'Moderado';
    else this.scoreLabel = 'Riesgoso';
  }

  private classifyStrength(length: number, variety: number): StrengthLevel {
    if (length >= 16 && variety >= 3) return 'strong';
    if (length >= 12 && variety >= 2) return 'medium';
    return 'weak';
  }

  private countVariety(mask: number): number {
    let count = 0;
    if (mask & 1) count++;
    if (mask & 2) count++;
    if (mask & 4) count++;
    if (mask & 8) count++;
    return count;
  }

  private asPct(value: number): number {
    if (!this.total) return 0;
    return Math.round((value / this.total) * 100);
  }

  private resetCounters(): void {
    this.strongCount = 0;
    this.mediumCount = 0;
    this.weakCount = 0;
    this.shortCount = 0;
    this.lowVarietyCount = 0;
    this.noTwoFactorCount = 0;
    this.duplicateGroups = [];
    this.duplicateEntries = 0;
    this.issues = [];
  }

  private findDuplicateGroup(plain?: string | null): DuplicateGroup | undefined {
    if (!plain) return undefined;
    return this.duplicateGroups.find(g => g.value === plain);
  }
}
