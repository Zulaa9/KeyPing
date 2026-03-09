import { Component, OnDestroy, OnInit } from '@angular/core';
import { NgClass, NgIf, NgStyle } from '@angular/common';
import { Subscription } from 'rxjs';
import { AppUpdateService } from '../../core/app-update.service';
import { UpdateState } from '../../core/update.types';
import { TranslatePipe } from '../../core/translate.pipe';

@Component({
  selector: 'kp-update-banner',
  standalone: true,
  imports: [NgIf, NgClass, NgStyle, TranslatePipe],
  templateUrl: './update-banner.html',
  styleUrls: ['./update-banner.scss']
})
export class UpdateBannerComponent implements OnInit, OnDestroy {
  state: UpdateState = { status: 'idle', currentVersion: '0.0.0' };
  visible = false;
  private dismissedToken?: string;
  private stateSub?: Subscription;

  constructor(public updates: AppUpdateService) {}

  ngOnInit(): void {
    this.stateSub = this.updates.state$.subscribe(state => {
      this.state = state;
      this.visible = this.shouldRender(state);
    });
  }

  ngOnDestroy(): void {
    this.stateSub?.unsubscribe();
  }

  get progressLabel(): string {
    const pct = this.state.progressPercent ?? 0;
    const transferred = this.formatBytes(this.state.transferredBytes || 0);
    const total = this.state.totalBytes ? this.formatBytes(this.state.totalBytes) : '--';
    return `${pct.toFixed(0)}% (${transferred} / ${total})`;
  }

  get progressPercent(): number {
    const pct = this.state.progressPercent ?? 0;
    return Math.max(0, Math.min(100, pct));
  }

  get errorSummary(): string {
    const raw = (this.state.errorMessage || '').toLowerCase();
    if (!raw) {
      return 'updates.error.summary.generic';
    }
    if (raw.includes('conectar') || raw.includes('internet') || raw.includes('network')) {
      return 'updates.error.summary.network';
    }
    if (raw.includes('servidor') || raw.includes('resolver') || raw.includes('server')) {
      return 'updates.error.summary.server';
    }
    if (raw.includes('permis') || raw.includes('forbidden') || raw.includes('unauthorized')) {
      return 'updates.error.summary.permissions';
    }
    return 'updates.error.summary.generic';
  }

  async onCheck(): Promise<void> {
    await this.updates.checkForUpdates(true);
  }

  async onDownload(): Promise<void> {
    await this.updates.downloadUpdate();
  }

  async onInstall(): Promise<void> {
    await this.updates.installUpdateAndRestart();
  }

  async onPostpone(): Promise<void> {
    await this.updates.postponeUpdate();
    this.dismissCurrent();
  }

  onDismiss(): void {
    this.dismissCurrent();
    this.visible = false;
  }

  private shouldRender(state: UpdateState): boolean {
    const isPopupStatus =
      state.status === 'available' ||
      state.status === 'downloading' ||
      state.status === 'downloaded' ||
      state.status === 'error';
    if (!isPopupStatus) return false;
    if (!this.dismissedToken) return true;

    return this.dismissedToken !== this.buildToken(state);
  }

  private dismissCurrent(): void {
    this.dismissedToken = this.buildToken(this.state);
  }

  private buildToken(state: UpdateState): string {
    return [state.status, state.availableVersion || '', state.errorMessage || ''].join('|');
  }

  private formatBytes(bytes: number): string {
    if (!bytes || Number.isNaN(bytes)) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let i = 0;

    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }

    const fixed = i === 0 ? 0 : 1;
    return `${value.toFixed(fixed)} ${units[i]}`;
  }
}
