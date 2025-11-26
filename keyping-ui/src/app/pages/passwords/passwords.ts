import { Component, OnInit } from '@angular/core';
import {
  NgFor,
  NgIf,
  NgClass,
  UpperCasePipe,
  NgSwitch,
  NgSwitchCase,
  NgSwitchDefault
} from '@angular/common';

import { FormsModule } from '@angular/forms';
import { ElectronService, PasswordMeta } from '../../core/electron.service';
import { PasswordCountService } from '../../core/password-count.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-passwords',
  standalone: true,
  imports: [
    NgFor,
    NgIf,
    NgClass,
    UpperCasePipe,
    NgSwitch,
    NgSwitchCase,
    NgSwitchDefault,
    FormsModule,
  ],
  templateUrl: './passwords.html',
  styleUrls: ['./passwords.scss']
})
export class PasswordsComponent implements OnInit {
  loading = true;
  entries: PasswordMeta[] = [];

  // Termino de busqueda
  searchTerm = '';

  // copiar
  copyingId: string | null = null;
  copySecondsLeft = 0;
  private copyTimer: any;

  // editar
  editingId: string | null = null;
  newPwd = '';

  // detalle seleccionado
  selected: PasswordMeta | null = null;

  // mapa: id -> contraseña revelada (texto claro SOLO en memoria del renderer)
  revealed: Record<string, string | undefined> = {};

  editingDetail = false;
  editLabel = '';
  editPwd = '';
  editLoginUrl = '';
  editPasswordChangeUrl = '';
  editEmail = '';
  editUsername = '';


  constructor(
    private es: ElectronService,
    private passwordCountSvc: PasswordCountService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadEntries();
  }

  async loadEntries(): Promise<void> {
    this.loading = true;
    try {
      this.entries = await this.es.listPasswords();
      this.passwordCountSvc.setLocalCount(this.entries.length);
    } finally {
      this.loading = false;
    }
  }

  // Lista filtrada en base al searchTerm
  get filteredEntries(): PasswordMeta[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return this.entries;

    return this.entries.filter(e => {
      const fields: (string | undefined)[] = [
        e.label,
        (e as any).username,
        (e as any).email,
        e.loginUrl,
        e.passwordChangeUrl
      ];

      return fields.some(f => f && f.toLowerCase().includes(term));
    });
  }

  maskToChips(mask: number): string[] {
    const chips: string[] = [];
    if (mask & 1) chips.push('a-z');
    if (mask & 2) chips.push('A-Z');
    if (mask & 4) chips.push('0-9');
    if (mask & 8) chips.push('sym');
    return chips;
  }

  fmtDate(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  // mascara proporcional a la longitud
  maskPassword(len: number): string {
    return '•'.repeat(len || 8);
  }

  getSecondaryLine(entry: PasswordMeta): string | null {
    if (entry.username && entry.username.trim()) {
      return entry.username;
    }
    if (entry.email && entry.email.trim()) {
      return entry.email;
    }
    return null;
  }

  // ---- COPIAR ----
  async onCopy(entry: PasswordMeta): Promise<void> {
    try {
      await this.es.copyPassword(entry.id);
      this.copyingId = entry.id;
      this.copySecondsLeft = 20;
      clearInterval(this.copyTimer);
      this.copyTimer = setInterval(() => {
        this.copySecondsLeft--;
        if (this.copySecondsLeft <= 0) {
          clearInterval(this.copyTimer);
          this.copyingId = null;
        }
      }, 1000);
    } catch (err) {
      console.error('[renderer] copy error', err);
    }
  }

  // ---- ELIMINAR ----
  async onDelete(entry: PasswordMeta): Promise<void> {
    const ok = confirm(
      'Delete this password from the active list? Historical pattern stays for similarity checks.'
    );
    if (!ok) return;

    await this.es.deletePassword(entry.id);
    await this.loadEntries();
    
    // EN CASO DE QUE NO SE ACTUALIZE CORRECTAMENTE EL CONTADOR AL ELIMINAR:
    //this.passwordCountSvc.setLocalCount(this.entries.length);

    if (this.selected?.id === entry.id) {
      this.selected = null;
    }

    delete this.revealed[entry.id];
  }

  // ---- EDITAR ----
  startEdit(entry: PasswordMeta): void {
    this.editingId = entry.id;
    this.newPwd = '';
  }

  cancelEdit(): void {
    this.editingId = null;
    this.newPwd = '';
  }

  async confirmEdit(entry: PasswordMeta): Promise<void> {
    if (!this.newPwd) return;

    const wasRevealed = !!this.revealed[entry.id];
    const wasSelected = this.selected?.id === entry.id;

    // 1) Actualizar password en el main (puede devolver mismo id o uno nuevo)
    const updated = await this.es.updatePassword(entry.id, this.newPwd);

    // 2) Limpiar estado de edicion inline
    this.editingId = null;
    this.newPwd = '';

    // 3) Limpiar el estado de "revelado" asociado al id antiguo
    delete this.revealed[entry.id];

    // 4) Recargar lista
    await this.loadEntries();

    // 5) Si el panel de detalle estaba abierto para esta entrada,
    //    volvemos a seleccionar la entrada actualizada
    if (wasSelected) {
      const newId = (updated as any)?.id ?? entry.id;
      const refreshed = this.entries.find(e => e.id === newId) || null;
      this.selected = refreshed;

      // 6) Si ANTES estaba mostrada, volvemos a mostrar la nueva contraseña
      if (wasRevealed && this.selected) {
        try {
          const plain = await this.es.getPassword(this.selected.id);
          if (plain) {
            this.revealed[this.selected.id] = plain;
          }
        } catch (err) {
          console.error('[renderer] reload revealed password failed', err);
        }
      }
    }
  }

  // ---- DETALLE ----
  onSelect(entry: PasswordMeta): void {
    this.selected = entry;
    this.editingDetail = false;
  }

  startDetailEdit(): void {
    if (!this.selected) return;
    this.editingDetail = true;

    this.editLabel = this.selected.label || '';
    this.editPwd = '';
    this.editLoginUrl = this.selected.loginUrl || '';
    this.editPasswordChangeUrl = this.selected.passwordChangeUrl || '';
    this.editUsername = this.selected.username || '';
    this.editEmail = this.selected.email || '';

    // Si ya estaba revelada, usamos ese valor como base
    // (asi al entrar en editar, la ves directamente si ya la habias mostrado)
    this.editPwd = this.revealed[this.selected.id] || '';
  }
  
  async saveDetailEdit(): Promise<void> {
    if (!this.selected) return;

    const oldId = this.selected.id;
    let currentId = oldId;

    // 1) Si se ha escrito una nueva contraseña → updatePassword
    if (this.editPwd) {
      const updated = await this.es.updatePassword(oldId, this.editPwd);
      const newId = updated.id;

      // si la contraseña estaba revelada, movemos el estado al nuevo id
      if (this.revealed[oldId]) {
        this.revealed[newId] = this.editPwd;
        delete this.revealed[oldId];
      }

      currentId = newId;
    }

    // 2) Actualizar metadata (nombre / URLs) sobre el id actual (nuevo si ha cambiado)
    await this.es.updateMeta(
      currentId,
      this.editLabel || '',
      this.editLoginUrl || '',
      this.editPasswordChangeUrl || '',
      this.editUsername || '',
      this.editEmail || ''
    );

    // 3) Cerrar modo edicion pero mantener el panel abierto en la entrada actualizada
    this.editingDetail = false;
    this.editPwd = '';

    await this.loadEntries();
    this.selected = this.entries.find(e => e.id === currentId) || null;
  }

  cancelDetailEdit(): void {
    this.editingDetail = false;
    this.editPwd = '';
  }

  closeDetail(): void {
    this.selected = null;
  }

  // ---- MOSTRAR / OCULTAR CONTRASEÑA ----
  async toggleShow(entry: PasswordMeta): Promise<void> {
    const id = entry.id;

    // si ya está visible, la ocultamos
    if (this.revealed[id]) {
      this.revealed[id] = undefined;
      return;
    }

    try {
      // IMPORTANTE: esto tiene que pedir la contraseña desencriptada al main
      const pwd = await this.es.getPassword(id);
      if (pwd) {
        this.revealed[id] = pwd;

        // Si estamos editando este mismo registro y el input esta vacio,
        // rellenamos el campo de edicion con la contraseña real
        if (this.editingDetail && this.selected?.id === id && !this.editPwd) {
          this.editPwd = pwd;
        }
      } else {
        console.warn('[renderer] plaintext not available for id', id);
      }
    } catch (err) {
      console.error('[renderer] getPassword error', err);
    }
  }

  // ---- ABRIR URL EN NAVEGADOR ----
  async openUrl(url: string, ev?: MouseEvent): Promise<void> {
    if (ev) ev.stopPropagation();
    if (!url) return;

    try {
      await this.es.openExternal(url);
    } catch (err) {
      console.error('[renderer] open url failed', err);
    }
  }
  
  goToAddPassword(): void {
    this.router.navigate(['/add']);
  }
}

