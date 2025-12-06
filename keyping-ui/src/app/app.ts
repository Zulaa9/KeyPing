import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { HeaderComponent } from './components/header/header';
import { FormsModule } from '@angular/forms';
import { NgIf, NgSwitch, NgSwitchCase } from '@angular/common';
import { MasterLockService, MasterState } from './core/master-lock.service';
import { TranslatePipe } from './core/translate.pipe';
import { I18nService } from './core/i18n.service';
import { filter, Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FormsModule, NgIf, TranslatePipe, NgSwitch, NgSwitchCase],
  templateUrl: './app.html'
})
export class AppComponent implements OnInit, OnDestroy {
  lockState: MasterState = 'locked';
  masterError: { key: string; params?: Record<string, string | number> } | null = null;
  masterCooldownLabel: { key: string; params?: Record<string, string | number> } | null = null;
  private cooldownTimer?: any;
  masterPassword = '';
  masterPasswordConfirm = '';
  private pendingSearchFocus = false;
  private navSub?: Subscription;

  constructor(private master: MasterLockService, private i18n: I18nService, private router: Router) {}

  async ngOnInit(): Promise<void> {
    this.lockState = await this.master.init();
    this.master.state$.subscribe(state => (this.lockState = state));
    this.navSub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(event => {
        if (this.pendingSearchFocus && (event as NavigationEnd).urlAfterRedirects.startsWith('/passwords')) {
          this.pendingSearchFocus = false;
          setTimeout(() => this.focusSearchInput());
        }
      });
  }

  ngOnDestroy(): void {
    this.navSub?.unsubscribe();
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

  @HostListener('document:keydown', ['$event'])
  onGlobalShortcuts(ev: KeyboardEvent): void {
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (!ctrl) return;
    const key = ev.key.toLowerCase();
    const isAlt = ev.altKey;

    if (key === 'l' && !isAlt && !ev.shiftKey) {
      ev.preventDefault();
      this.master.lock();
      return;
    }

    if (key === 'n' && !ev.shiftKey && !isAlt) {
      ev.preventDefault();
      this.navigateIfUnlocked('/add');
      return;
    }

    if (key === 'f' && !isAlt && !ev.shiftKey) {
      ev.preventDefault();
      this.handleSearchShortcut();
      return;
    }

    if (key === 'g' && !isAlt && !ev.shiftKey) {
      ev.preventDefault();
      this.openGeneratorShortcut();
      return;
    }
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

  private navigateIfUnlocked(path: string): void {
    if (this.lockState !== 'unlocked') return;
    this.router.navigate([path]);
  }

  private handleSearchShortcut(): void {
    if (this.lockState !== 'unlocked') return;
    if (this.router.url.startsWith('/passwords')) {
      this.focusSearchInput();
    } else {
      this.pendingSearchFocus = true;
      this.router.navigate(['/passwords']);
    }
  }

  private focusSearchInput(retries = 15): void {
    setTimeout(() => {
      const el = document.querySelector('.passwords-page .search-bar input') as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.select?.();
        return;
      }
      if (retries > 0) {
        this.focusSearchInput(retries - 1);
      }
    }, 80);
  }

  private openGeneratorShortcut(): void {
    const event = new CustomEvent('kp-open-generator');
    document.dispatchEvent(event);
  }
}
