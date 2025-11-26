import { Component, ElementRef, HostListener, OnDestroy, AfterViewInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf, NgStyle } from '@angular/common';

@Component({
  selector: 'kp-password-generator',
  standalone: true,
  imports: [FormsModule, NgIf, NgStyle],
  templateUrl: './password-generator.html',
  styleUrls: ['./password-generator.scss']
})
export class PasswordGeneratorComponent implements AfterViewInit, OnDestroy {
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
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => this.setCopyFeedback())
        .catch(err => console.error('[renderer] copy generated failed', err));
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
    this.showGenerator = false;
    this.generatorPinned = false;
    this.resetToAnchor();
  }

  private resetToAnchor(): void {
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
      this.showGenerator = false;
      this.resetToAnchor();
    }, 180);
  }

  private makePassword(): string {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()-_=+[]{};:,.?';

    const pools: string[] = [];
    if (this.useUpper) pools.push(upper);
    if (this.useLower) pools.push(lower);
    if (this.useNumbers) pools.push(numbers);
    if (this.useSymbols) pools.push(symbols);

    if (pools.length === 0) {
      pools.push(lower);
    }

    const all = pools.join('');
    const chars: string[] = [];

    for (const pool of pools) {
      chars.push(pool[Math.floor(Math.random() * pool.length)]);
    }

    while (chars.length < this.genLength) {
      chars.push(all[Math.floor(Math.random() * all.length)]);
    }

    for (let i = chars.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.slice(0, this.genLength).join('');
  }
}
