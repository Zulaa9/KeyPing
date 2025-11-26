import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ElectronService } from './electron.service';
import type { PasswordMeta } from './electron.service';

@Injectable({ providedIn: 'root' })
export class PasswordCountService {
  private _count$ = new BehaviorSubject<number | null>(null);
  readonly count$ = this._count$.asObservable();

  constructor(private es: ElectronService) {
    // Carga inicial para que el header tenga un valor aunque aún no hayas
    // abierto la pantalla de contraseñas.
    this.refreshFromDisk();
  }

  /** Vuelve a leer del vault y actualiza el contador */
  async refreshFromDisk(): Promise<void> {
    try {
      const entries: PasswordMeta[] = await this.es.listPasswords();
      this._count$.next(entries.length);
    } catch (err) {
      console.error('[PasswordCountService] refresh error', err);
      this._count$.next(null);
    }
  }

  /** Permite actualizar el contador directamente desde PasswordsComponent */
  setLocalCount(count: number): void {
    this._count$.next(count);
  }
}
