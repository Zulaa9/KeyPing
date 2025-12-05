import { Component, HostListener, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './components/header/header';
import { FormsModule } from '@angular/forms';
import { NgIf, NgSwitch, NgSwitchCase } from '@angular/common';
import { MasterLockService, MasterState } from './core/master-lock.service';
import { TranslatePipe } from './core/translate.pipe';
import { I18nService } from './core/i18n.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FormsModule, NgIf, TranslatePipe, NgSwitch, NgSwitchCase],
  templateUrl: './app.html'
})
export class AppComponent implements OnInit {
  lockState: MasterState = 'locked';
  masterError: { key: string; params?: Record<string, string | number> } | null = null;
  masterCooldownLabel: { key: string; params?: Record<string, string | number> } | null = null;
  private cooldownTimer?: any;
  masterPassword = '';
  masterPasswordConfirm = '';

  constructor(private master: MasterLockService, private i18n: I18nService) {}

  async ngOnInit(): Promise<void> {
    this.lockState = await this.master.init();
    this.master.state$.subscribe(state => (this.lockState = state));
  }

  async onUnlock(): Promise<void> {
    this.masterError = null;
    this.masterCooldownLabel = null;
    clearInterval(this.cooldownTimer);

    const ok = await this.master.unlock(this.masterPassword);
    if (!ok) {
      const wait = this.master.getCooldownSeconds();
      if (wait > 0) {
        this.startCooldownCountdown();
        this.masterError = { key: 'app.lock.tooMany' };
      } else {
        this.masterError = { key: 'app.lock.invalid' };
      }
      return;
    }
    this.masterPassword = '';
    this.masterCooldownLabel = null;
    clearInterval(this.cooldownTimer);
  }

  async onCreateMaster(): Promise<void> {
    this.masterError = null;
    if (this.masterPassword.length < 8) {
      this.masterError = { key: 'app.lock.minLength' };
      return;
    }
    if (this.masterPassword !== this.masterPasswordConfirm) {
      this.masterError = { key: 'app.lock.mismatch' };
      return;
    }
    await this.master.setMaster(this.masterPassword);
    this.masterPassword = '';
    this.masterPasswordConfirm = '';
  }

  @HostListener('document:mousemove')
  @HostListener('document:keydown')
  @HostListener('document:click')
  onUserActivity(): void {
    this.master.touch();
  }

  private startCooldownCountdown(): void {
    const update = () => {
      const seconds = this.master.getCooldownSeconds();
      if (seconds <= 0) {
        this.masterCooldownLabel = null;
        this.masterError = null;
        clearInterval(this.cooldownTimer);
        return;
      }
      this.masterCooldownLabel = { key: 'app.lock.cooldown', params: { seconds } };
    };
    update();
    clearInterval(this.cooldownTimer);
    this.cooldownTimer = setInterval(update, 1000);
  }

  render(msg: { key: string; params?: Record<string, string | number> } | null): string {
    if (!msg) return '';
    return this.i18n.translate(msg.key, msg.params);
  }
}
