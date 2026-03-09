import { Component, OnInit } from '@angular/core';
import { NgIf, NgFor } from '@angular/common';
import { TranslatePipe } from '../../core/translate.pipe';
import { ElectronService, PasswordMeta } from '../../core/electron.service';
import { I18nService } from '../../core/i18n.service';
import pkg from '../../../../package.json';

type ActivityItem = { label: string; status: string; time: string };

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [TranslatePipe, NgIf, NgFor],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss']
})
export class DashboardComponent implements OnInit {
  // KPIs agregados del vault para el panel principal.
  loading = true;
  total = 0;
  strong = 0;
  medium = 0;
  weak = 0;
  with2fa = 0;
  folders = 0;
  duplicateCount = 0;
  no2faCount = 0;
  shortCount = 0;
  lowVarietyCount = 0;
  score = 0;
  scoreLabel = '';
  activity: ActivityItem[] = [];
  version = pkg.version ?? '—';

  constructor(private es: ElectronService, private i18nSvc: I18nService) {}

  async ngOnInit(): Promise<void> {
    await this.loadStats();
  }

  async loadStats(): Promise<void> {
    this.loading = true;
    try {
      const metas = await this.es.listPasswords();
      this.total = metas.length;
      this.strong = 0;
      this.medium = 0;
      this.weak = 0;
      this.with2fa = 0;
      this.no2faCount = 0;
      this.folders = 0;
      this.duplicateCount = 0;
      this.shortCount = 0;
      this.lowVarietyCount = 0;
      this.score = 0;
      this.scoreLabel = '';

      const folderSet = new Set<string>();
      const entriesWithPlain: Array<{ meta: PasswordMeta; plain?: string | null }> = [];

      // Recorremos entradas una sola vez para calcular todas las métricas.
      for (const meta of metas) {
        const variety = this.countVariety(meta.classMask || 0);
        const level = this.classify(meta.length || 0, variety);
        if (level === 'strong') this.strong++;
        else if (level === 'medium') this.medium++;
        else this.weak++;
        if (meta.twoFactorEnabled) this.with2fa++;
        else this.no2faCount++;

        if (meta.folder) folderSet.add(meta.folder);

        const len = meta.length || 0;
        if (len < 10) this.shortCount++;
        if (variety < 3) this.lowVarietyCount++;

        // Solo para detectar duplicados por secreto real (no por metadata).
        let plain: string | null = null;
        try {
          plain = await this.es.getPassword(meta.id);
        } catch {
          plain = null;
        }
        entriesWithPlain.push({ meta, plain });
      }

      this.folders = folderSet.size;
      this.duplicateCount = this.countDuplicates(entriesWithPlain);
      this.computeScore();
      this.computeActivity(metas);
    } finally {
      this.loading = false;
    }
  }

  get scoreBadge(): 'good' | 'warn' | 'bad' {
    if (this.score >= 85) return 'good';
    if (this.score >= 60) return 'warn';
    return 'bad';
  }

  private classify(len: number, variety: number): 'strong' | 'medium' | 'weak' {
    if (len >= 16 && variety >= 3) return 'strong';
    if (len >= 12 && variety >= 2) return 'medium';
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

  private countDuplicates(entries: Array<{ meta: PasswordMeta; plain?: string | null }>): number {
    const map = new Map<string, number>();
    for (const { plain } of entries) {
      if (!plain) continue;
      map.set(plain, (map.get(plain) || 0) + 1);
    }
    let dup = 0;
    for (const v of map.values()) {
      if (v > 1) dup += v;
    }
    return dup;
  }

  private computeScore(): void {
    if (!this.total) {
      this.score = 0;
      this.scoreLabel = 'dashboard.score.none';
      return;
    }
    // Scoring heurístico (no criptográfico) para orientar al usuario.
    const weakPct = Math.round((this.weak / this.total) * 100);
    const shortPct = Math.round((this.shortCount / this.total) * 100);
    const varietyPct = Math.round((this.lowVarietyCount / this.total) * 100);
    const no2faPct = Math.round((this.no2faCount / this.total) * 100);
    const dupPenalty = this.duplicateCount
      ? Math.min(25, 10 + (this.duplicateCount / this.total) * 30)
      : 0;

    const raw =
      100 -
      weakPct * 0.5 -
      shortPct * 0.8 -
      varietyPct * 0.4 -
      no2faPct * 0.2 -
      dupPenalty;

    this.score = Math.max(0, Math.min(100, Math.round(raw)));
    if (this.score >= 85) this.scoreLabel = 'dashboard.score.good';
    else if (this.score >= 70) this.scoreLabel = 'dashboard.score.ok';
    else if (this.score >= 50) this.scoreLabel = 'dashboard.score.low';
    else this.scoreLabel = 'dashboard.score.low';
  }

  private computeActivity(metas: PasswordMeta[]): void {
    // Línea temporal simple de los últimos cambios para contexto rápido.
    const sorted = [...metas].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    this.activity = sorted.slice(0, 5).map(m => {
      const label = m.label || m.username || m.email || 'ID ' + m.id;
      const isUpdate = !!m.updatedAt && m.updatedAt !== m.createdAt;
      const ts = new Date((m.updatedAt || m.createdAt) ?? Date.now());
      const time = ts.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
      return {
        label,
        status: isUpdate
          ? this.i18nSvc.translate('dashboard.activity.updated')
          : this.i18nSvc.translate('dashboard.activity.added'),
        time
      };
    });
    if (!this.activity.length) {
      this.activity = [
        { label: this.i18nSvc.translate('dashboard.activity.empty'), status: '', time: '' }
      ];
    }
  }
}
