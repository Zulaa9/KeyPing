import { Component, ElementRef, HostListener, OnDestroy, AfterViewInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf, NgStyle } from '@angular/common';
import { TranslatePipe } from '../../core/translate.pipe';
import { generatePassword } from '../../core/password-generator';

@Component({
  selector: 'kp-password-generator',
  standalone: true,
  imports: [FormsModule, NgIf, NgStyle, TranslatePipe],
  templateUrl: './password-generator.html',
  styleUrls: ['./password-generator.scss']
})
export class PasswordGeneratorComponent implements AfterViewInit, OnDestroy {
  // Estado visual y opciones de generación del panel flotante.
  showGenerator = false;
  generatorPinned = false;
  generatedPassword = '';
  genLength = 16;
  useUpper = true;
  useLower = true;
  useNumbers = true;
  useSymbols = true;
  genPosX = 260;
  genPosY = 90;
  copyFeedback = false;

  @ViewChild('generatorWrapper') generatorWrapper?: ElementRef<HTMLDivElement>;
  @ViewChild('generatorPanel') generatorPanel?: ElementRef<HTMLDivElement>;

  private copyTimer?: any;
  private hideTimer?: any;
  private dragging = false;
  private dragStart = { x: 0, y: 0 };
  private dragOrigin = { x: 0, y: 0 };
  private hoveringButton = false;
  private hoveringPanel = false;

  ngAfterViewInit(): void {
    this.resetToAnchor();
    this.refreshGenerated();
  }

  ngOnDestroy(): void {
    clearTimeout(this.hideTimer);
    clearTimeout(this.copyTimer);
  }

  onGeneratorButtonEnter(): void {
    // En modo no fijado, el panel siempre se recoloca junto al botón.
    this.hoveringButton = true;
    if (!this.generatorPinned && !this.dragging) {
      this.resetToAnchor();
    }
    this.showGenerator = true;
  }

  onGeneratorButtonLeave(): void {
    this.hoveringButton = false;
    if (this.dragging) return;
    this.scheduleHide();
  }

  onPanelEnter(): void {
    this.hoveringPanel = true;
    this.showGenerator = true;
    clearTimeout(this.hideTimer);
  }

  onPanelLeave(): void {
    this.hoveringPanel = false;
    if (this.dragging) return;
    this.scheduleHide();
  }

  togglePin(ev: MouseEvent): void {
    ev.stopPropagation();
    this.generatorPinned = !this.generatorPinned;
    if (this.generatorPinned) {
      this.showGenerator = true;
    }
  }

  onLengthChange(): void {
    this.refreshGenerated();
  }

  onOptionChange(): void {
    // Evita dejar todas las categorías desactivadas (contraseña vacía/imposible).
    if (!this.useUpper && !this.useLower && !this.useNumbers && !this.useSymbols) {
      this.useLower = true;
    }
    this.refreshGenerated();
  }

  refreshGenerated(ev?: MouseEvent): void {
    if (ev) ev.stopPropagation();
    this.generatedPassword = this.makePassword();
  }

  copyGenerated(ev?: MouseEvent): void {
    if (ev) ev.stopPropagation();
    if (!this.generatedPassword) {
      this.refreshGenerated();
    }
    const text = this.generatedPassword;
    if (!text) return;
    // Copia por el proceso principal para que el portapapeles se limpie solo a los 20 s,
    // igual que al copiar una contraseña guardada.
    const viaMain = window.keyping?.copyText?.(text);
    if (viaMain) {
      viaMain
        .then(ok => { if (ok) this.setCopyFeedback(); })
        .catch(() => console.error('[renderer] copy generated failed'));
    }
  }

  onDragStart(ev: MouseEvent): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.dragging = true;
    this.dragStart = { x: ev.clientX, y: ev.clientY };
    this.dragOrigin = { x: this.genPosX, y: this.genPosY };
    this.showGenerator = true;
  }

  @HostListener('document:mousemove', ['$event'])
  onDragMove(ev: MouseEvent): void {
    if (!this.dragging) return;
    const dx = ev.clientX - this.dragStart.x;
    const dy = ev.clientY - this.dragStart.y;
    this.genPosX = this.dragOrigin.x + dx;
    this.genPosY = this.dragOrigin.y + dy;
  }

  @HostListener('document:mouseup')
  onDragEnd(): void {
    this.dragging = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (this.generatorPinned) return;
    const target = ev.target as HTMLElement | null;
    const insideWrapper = this.generatorWrapper?.nativeElement.contains(target as any);
    const insidePanel = this.generatorPanel?.nativeElement.contains(target as any);
    if (insideWrapper || insidePanel) return;
    // Clic fuera: cerramos panel y reseteamos posición si no está fijado.
    this.showGenerator = false;
    this.generatorPinned = false;
    this.resetToAnchor();
  }

  @HostListener('document:kp-open-generator')
  onOpenGenerator(): void {
    this.resetToAnchor();
    this.showGenerator = true;
  }

  private resetToAnchor(): void {
    // Coloca el panel relativo al wrapper para mantener alineación visual consistente.
    const host = this.generatorWrapper?.nativeElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    this.genPosX = rect.right + 4;
    this.genPosY = rect.top - 4;
  }

  private setCopyFeedback(): void {
    this.copyFeedback = true;
    clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => {
      this.copyFeedback = false;
    }, 1000);
  }

  private scheduleHide(): void {
    clearTimeout(this.hideTimer);
    if (this.generatorPinned) return;
    this.hideTimer = setTimeout(() => {
      if (this.hoveringButton || this.hoveringPanel) return;
      // Cierra de forma diferida para evitar parpadeos al pasar de botón a panel.
      this.showGenerator = false;
      this.resetToAnchor();
    }, 180);
  }

  private makePassword(): string {
    return generatePassword({
      length: this.genLength,
      upper: this.useUpper,
      lower: this.useLower,
      numbers: this.useNumbers,
      symbols: this.useSymbols
    });
  }
}
