import { Component, HostListener, OnInit } from '@angular/core';
import { NgFor, NgIf, NgClass } from '@angular/common';
import { Router } from '@angular/router';
import { ElectronService, PasswordMeta } from '../../core/electron.service';
import { TranslatePipe } from '../../core/translate.pipe';
import { I18nService } from '../../core/i18n.service';

// Clasificación simplificada de fortaleza para métricas y estilo visual.
type StrengthLevel = 'strong' | 'medium' | 'weak';

// Resultado de análisis por entrada que alimenta la tabla de incidencias.
type HealthIssue = {
  entry: PasswordMeta;
  reasons: string[];
  severity: number;
  level: StrengthLevel;
};

// Grupo de entradas que comparten el mismo hash HMAC de contraseña.
// revealedValue se carga bajo demanda al hacer click explícito.
type DuplicateGroup = {
  hash: string;
  entries: PasswordMeta[];
  revealedValue?: string | null;
};

@Component({
  selector: 'app-password-health',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, TranslatePipe],
  templateUrl: './password-health.html',
  styleUrls: ['./password-health.scss']
})
export class PasswordHealthComponent implements OnInit {
  loading = true;

  // Contadores base para gráficos/resúmenes.
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
  scoreLabel = '';
  readonly scoreRadius = 46;

  issues: HealthIssue[] = [];
  showDemo = false;

  constructor(
    private es: ElectronService,
    private router: Router,
    private i18n: I18nService
  ) {}

  // Carga inicial de métricas al entrar en la vista.
  async ngOnInit(): Promise<void> {
    await this.loadHealth();
  }

  // Permite saltar al listado y enfocar la credencial con problema.
  goToPassword(issue: HealthIssue): void {
    this.router.navigate(['/passwords'], { queryParams: { select: issue.entry.id } });
  }

  // Revela si el usuario ha pedido ver el valor del grupo.
  isDupRevealed(dup: DuplicateGroup): boolean {
    return dup.revealedValue !== undefined;
  }

  // Alterna visibilidad del valor de un grupo duplicado.
  // En datos reales: fetch a demanda de una entrada representativa.
  // En demo: el hash es directamente el texto plano del demo.
  async toggleDup(dup: DuplicateGroup, ev?: MouseEvent): Promise<void> {
    if (ev) ev.stopPropagation();
    if (dup.revealedValue !== undefined) {
      dup.revealedValue = undefined;
    } else if (this.showDemo) {
      dup.revealedValue = dup.hash;
    } else {
      const firstId = dup.entries[0]?.id;
      try {
        dup.revealedValue = firstId
          ? (await window.keyping?.getPassword?.(firstId) ?? null)
          : null;
      } catch {
        dup.revealedValue = null;
      }
    }
  }

  // Porcentajes derivados usados por anillos, barras y tarjetas.
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

  // Devuelve cuántas clases de caracteres usa la entrada.
  variety(entry: PasswordMeta): number {
    return this.countVariety(entry.classMask || 0);
  }

  // Orquesta la carga completa: datos, duplicados, estadísticas y score.
  async loadHealth(): Promise<void> {
    this.loading = true;
    try {
      const metas = await this.es.listPasswords();
      const allowDemo = this.isDemoAllowed();
      if (!metas.length && allowDemo) {
        this.useDemoData();
        return;
      }
      this.showDemo = false;
      this.total = metas.length;
      this.resetCounters();

      if (!metas.length) {
        this.score = 0;
        this.scoreLabel = this.t('health.score.noData');
        this.duplicateGroups = [];
        this.duplicateEntries = 0;
        this.issues = [];
        return;
      }

      // Build an id→hash map; no plaintext flows to the renderer.
      const hashRows = await window.keyping?.getPasswordHashes?.() ?? [];
      const hashMap = new Map<string, string>(hashRows.map(r => [r.id, r.hash]));
      const entriesWithHash = metas.map(meta => ({ meta, hash: hashMap.get(meta.id) ?? null }));

      this.computeDuplicates(entriesWithHash);
      this.computeStats(entriesWithHash);
      this.computeScore();
    } finally {
      this.loading = false;
    }
  }

  // Traduce la fortaleza técnica a etiqueta legible para el usuario.
  getStrength(level: StrengthLevel): string {
    if (level === 'strong') return this.t('health.level.strong');
    if (level === 'medium') return this.t('health.level.medium');
    return this.t('health.level.weak');
  }

  // Determina la clase visual por severidad para resaltar riesgos.
  severityClass(severity: number): string {
    if (severity >= 80) return 'issue-danger';
    if (severity >= 50) return 'issue-warn';
    return 'issue-muted';
  }

  @HostListener('document:kp-demo-disable')
  onDemoDisable(): void {
    // Si ya estamos en datos reales no hacemos nada.
    if (!this.showDemo) return;
    this.showDemo = false;
    this.total = 0;
    this.resetCounters();
    this.score = 0;
    this.scoreLabel = this.t('health.score.noData');
    this.issues = [];
    this.duplicateGroups = [];
    this.duplicateEntries = 0;
  }

  @HostListener('document:kp-demo-enable')
  onDemoEnable(): void {
    // Solo activa demo cuando no hay datos reales cargados.
    if (this.total > 0) return;
    this.useDemoData();
  }

  // Calcula contadores agregados e incidencias ordenadas por severidad.
  private computeStats(entries: Array<{ meta: PasswordMeta; hash?: string | null }>): void {
    const issues: HealthIssue[] = [];

    for (const { meta, hash } of entries) {
      const variety = this.countVariety(meta.classMask || 0);
      const len = meta.length || 0;
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
        reasons.push(this.t('health.reason.short'));
      }
      if (variety < 3) {
        severity += 25;
        reasons.push(this.t('health.reason.lowVariety'));
      }
      if (!meta.twoFactorEnabled) {
        severity += 10;
        reasons.push(this.t('health.reason.no2fa'));
      }
      if (level === 'weak') {
        severity += 20;
        reasons.push(this.t('health.reason.weak'));
      }

      const dupGroup = this.findDuplicateGroup(hash);
      if (dupGroup) {
        // Reutilización de contraseña: penalización fuerte por riesgo transversal.
        severity += 60;
        reasons.push(this.t('health.reason.duplicate', { count: dupGroup.entries.length }));
      }

      if (reasons.length > 0) {
        issues.push({ entry: meta, reasons, severity, level });
      }
    }

    this.issues = issues.sort((a, b) => b.severity - a.severity);
  }

  // Construye grupos de duplicados por hash HMAC.
  private computeDuplicates(entries: Array<{ meta: PasswordMeta; hash?: string | null }>): void {
    const map = new Map<string, PasswordMeta[]>();

    for (const { meta, hash } of entries) {
      if (!hash) continue;
      if (!map.has(hash)) map.set(hash, []);
      map.get(hash)!.push(meta);
    }

    const groups: DuplicateGroup[] = [];
    let duplicateEntries = 0;

    for (const [hash, metas] of map.entries()) {
      if (metas.length > 1) {
        groups.push({ hash, entries: metas });
        duplicateEntries += metas.length;
      }
    }

    this.duplicateGroups = groups;
    this.duplicateEntries = duplicateEntries;
  }

  // Score ponderado 0-100: combina debilidades estructurales y reutilización.
  private computeScore(): void {
    if (this.total === 0) {
      this.score = 0;
      this.scoreLabel = this.t('health.score.noData');
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

    if (this.score >= 85) this.scoreLabel = this.t('health.score.excellent');
    else if (this.score >= 70) this.scoreLabel = this.t('health.score.good');
    else if (this.score >= 50) this.scoreLabel = this.t('health.score.moderate');
    else this.scoreLabel = this.t('health.score.risky');
  }

  // Regla simple de fortaleza basada en longitud y variedad.
  private classifyStrength(length: number, variety: number): StrengthLevel {
    if (length >= 16 && variety >= 3) return 'strong';
    if (length >= 12 && variety >= 2) return 'medium';
    return 'weak';
  }

  // Decodifica la máscara de clases de caracteres (1/2/4/8) a recuento.
  private countVariety(mask: number): number {
    let count = 0;
    if (mask & 1) count++;
    if (mask & 2) count++;
    if (mask & 4) count++;
    if (mask & 8) count++;
    return count;
  }

  // Convierte cualquier contador absoluto a porcentaje del total.
  private asPct(value: number): number {
    if (!this.total) return 0;
    return Math.round((value / this.total) * 100);
  }

  // Reinicia todos los agregados para recargas limpias sin arrastres de estado.
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

  // Busca el grupo de duplicado asociado a un hash HMAC de contraseña.
  private findDuplicateGroup(hash?: string | null): DuplicateGroup | undefined {
    if (!hash) return undefined;
    return this.duplicateGroups.find(g => g.hash === hash);
  }

  // Acceso centralizado a i18n para evitar repetir el servicio en cada método.
  private t(key: string, params?: Record<string, string | number>): string {
    return this.i18n.translate(key, params);
  }

  // Datos de demostración para que la vista sea explicativa cuando la bóveda está vacía.
  private useDemoData(): void {
    this.showDemo = true;
    const now = Date.now();
    const demo: Array<{ meta: PasswordMeta; plain: string }> = [
      {
        meta: {
          id: 'demo-strong-1',
          label: 'Banco Online',
          username: 'cliente@bank.com',
          length: 20,
          classMask: 1 | 2 | 4 | 8,
          twoFactorEnabled: true,
          createdAt: now - 1000 * 60 * 60 * 24 * 60
        },
        plain: 'TorreAzul!2024$Bank'
      },
      {
        meta: {
          id: 'demo-strong-2',
          label: 'GitHub',
          email: 'dev@ejemplo.io',
          length: 18,
          classMask: 1 | 2 | 4 | 8,
          twoFactorEnabled: true,
          createdAt: now - 1000 * 60 * 60 * 24 * 14
        },
        plain: 'Gh!Safeguard#9821'
      },
      {
        meta: {
          id: 'demo-medium-1',
          label: 'Netflix',
          email: 'user@ejemplo.com',
          length: 13,
          classMask: 1 | 2 | 4 | 8,
          twoFactorEnabled: false,
          createdAt: now - 1000 * 60 * 60 * 24 * 30
        },
        plain: 'SeriesNight123!'
      },
      {
        meta: {
          id: 'demo-weak-1',
          label: 'Wifi casa',
          length: 8,
          classMask: 1 | 2 | 4,
          twoFactorEnabled: false,
          createdAt: now - 1000 * 60 * 60 * 24 * 5
        },
        plain: 'Clave123'
      },
      {
        meta: {
          id: 'demo-dup-1',
          label: 'Foro Tech',
          username: 'usuario77',
          length: 12,
          classMask: 1 | 2 | 4 | 8,
          twoFactorEnabled: false,
          createdAt: now - 1000 * 60 * 60 * 24 * 10
        },
        plain: 'ReusedPass9!'
      },
      {
        meta: {
          id: 'demo-dup-2',
          label: 'Correo personal',
          email: 'mail@ejemplo.com',
          length: 12,
          classMask: 1 | 2 | 4 | 8,
          twoFactorEnabled: false,
          createdAt: now - 1000 * 60 * 60 * 24 * 3
        },
        plain: 'ReusedPass9!'
      }
    ];

    this.total = demo.length;
    this.resetCounters();

    // Demo: use plaintext as pseudo-hash (demo values are not real secrets).
    const entriesWithHash = demo.map(d => ({ meta: { ...d.meta, length: d.plain.length }, hash: d.plain }));

    this.computeDuplicates(entriesWithHash);
    this.computeStats(entriesWithHash);
    this.computeScore();
  }

  // Permite desactivar demo por configuración local durante QA o tests manuales.
  private isDemoAllowed(): boolean {
    return localStorage.getItem('keyping.demo.disabled') !== '1';
  }
}
