import { ChangeDetectorRef, OnDestroy, Pipe, PipeTransform } from '@angular/core';
import { Subscription } from 'rxjs';
import { I18nService } from './i18n.service';

@Pipe({
  name: 't',
  standalone: true,
  pure: false
})
export class TranslatePipe implements PipeTransform, OnDestroy {
  // Pipe impuro para reaccionar al cambio de idioma sin recargar vistas manualmente.
  private sub: Subscription;
  private lastKey?: string;
  private lastParams?: Record<string, string | number>;
  private currentValue = '';

  constructor(private i18n: I18nService, private cdr: ChangeDetectorRef) {
    // Al cambiar idioma, recalcula la última clave utilizada y marca CD.
    this.sub = this.i18n.language$.subscribe(() => {
      if (!this.lastKey) return;
      this.currentValue = this.i18n.translate(this.lastKey, this.lastParams);
      this.cdr.markForCheck();
    });
  }

  transform(key: string, params?: Record<string, string | number>): string {
    if (!key) return '';
    this.lastKey = key;
    this.lastParams = params;
    this.currentValue = this.i18n.translate(key, params);
    return this.currentValue;
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
