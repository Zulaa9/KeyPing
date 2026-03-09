import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { HeaderComponent } from './components/header/header';
import { FormsModule } from '@angular/forms';
import { NgClass, NgFor, NgIf, NgStyle, NgSwitch, NgSwitchCase } from '@angular/common';
import { MasterLockService, MasterState } from './core/master-lock.service';
import { TranslatePipe } from './core/translate.pipe';
import { I18nService } from './core/i18n.service';
import { filter, Subscription } from 'rxjs';
import { UpdateBannerComponent } from './components/update-banner/update-banner';
import { AppUpdateService } from './core/app-update.service';
type OnboardingStep = {
  titleKey: string;
  descKey: string;
  route?: string;
  highlightSelector?: string;
  placement?: 'right' | 'bottom' | 'bottom-right' | 'left' | 'center' | 'top-left' | 'top-right';
};
type OnboardingPlacement = 'right' | 'bottom' | 'bottom-right' | 'left' | 'center' | 'top-left' | 'top-right';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FormsModule, NgIf, NgFor, TranslatePipe, NgSwitch, NgSwitchCase, NgStyle, NgClass, UpdateBannerComponent],
  templateUrl: './app.html'
})
export class AppComponent implements OnInit, OnDestroy {
  // Estado de bloqueo maestro y mensajes de UI asociados
  lockState: MasterState = 'locked';
  masterError: { key: string; params?: Record<string, string | number> } | null = null;
  masterCooldownLabel: { key: string; params?: Record<string, string | number> } | null = null;
  private cooldownTimer?: any;
  masterPassword = '';
  masterPasswordConfirm = '';
  showIntro = true;
  private pendingSearchFocus = false;
  private navSub?: Subscription;
  showOnboarding = false;
  onboardingStep = 0;
  private readonly onboardingKey = 'keyping.onboarding.v1';
  private highlightedEl?: Element | null;
  onboardingPos: { top: number; left: number; placement: OnboardingPlacement } = {
    top: 20,
    left: 20,
    placement: 'right'
  };
  lastOnboardingAction: 'next' | 'prev' | 'skip' = 'next';
  private lastOnboardingKeyTs = 0;
  private readonly onboardingKeyThrottle = 450; // milisegundos

  readonly onboardingSteps: OnboardingStep[] = [
    { titleKey: 'onboarding.welcomeTitle', descKey: 'onboarding.welcomeDesc', route: '/dashboard', placement: 'center' },
    {
      titleKey: 'onboarding.dashboardTitle',
      descKey: 'onboarding.dashboardDesc',
      route: '/dashboard',
      highlightSelector: '.sidebar-nav [routerLink="/dashboard"]',
      placement: 'bottom'
    },
    {
      titleKey: 'onboarding.passwordsOverviewTitle',
      descKey: 'onboarding.passwordsOverviewDesc',
      route: '/passwords',
      highlightSelector: '.sidebar-nav [routerLink="/passwords"]',
      placement: 'bottom'
    },
    {
      titleKey: 'onboarding.searchTitle',
      descKey: 'onboarding.searchDesc',
      route: '/passwords',
      highlightSelector: '.passwords-page .search-bar',
      placement: 'right'
    },
    {
      titleKey: 'onboarding.filtersTitle',
      descKey: 'onboarding.filtersDesc',
      route: '/passwords',
      highlightSelector: '.passwords-page .filters-panel',
      placement: 'right'
    },
    {
      titleKey: 'onboarding.addButtonTitle',
      descKey: 'onboarding.addButtonDesc',
      route: '/passwords',
      highlightSelector: '.passwords-page .add-btn',
      placement: 'bottom-right'
    },
    {
      titleKey: 'onboarding.addFormTitle',
      descKey: 'onboarding.addFormDesc',
      route: '/add',
      highlightSelector: '.add-page .card-surface',
      placement: 'right'
    },
    {
      titleKey: 'onboarding.listTitle',
      descKey: 'onboarding.listDesc',
      route: '/passwords',
      highlightSelector: '.passwords-page .list-panel',
      placement: 'right'
    },
    {
      titleKey: 'onboarding.detailTitle',
      descKey: 'onboarding.detailDesc',
      route: '/passwords',
      highlightSelector: '.passwords-page .detail',
      placement: 'left'
    },
    {
      titleKey: 'onboarding.generatorTitle',
      descKey: 'onboarding.generatorDesc',
      route: '/passwords',
      highlightSelector: 'kp-password-generator .nav-item, .sidebar-nav kp-password-generator',
      placement: 'bottom'
    },
    {
      titleKey: 'onboarding.healthTitle',
      descKey: 'onboarding.healthDesc',
      route: '/health',
      highlightSelector: '.sidebar-nav [routerLink="/health"]',
      placement: 'bottom'
    },
    {
      titleKey: 'onboarding.settingsTitle',
      descKey: 'onboarding.settingsDesc',
      route: '/settings',
      highlightSelector: '.sidebar-nav [routerLink="/settings"]',
      placement: 'bottom'
    },
    { titleKey: 'onboarding.shortcutsTitle', descKey: 'onboarding.shortcutsDesc', placement: 'center' },
    {
      titleKey: 'onboarding.revisitTitle',
      descKey: 'onboarding.revisitDesc',
      placement: 'bottom',
      highlightSelector: '.sidebar-nav .tour-nav'
    }
  ];

  constructor(
    private master: MasterLockService,
    private i18n: I18nService,
    private router: Router,
    private updates: AppUpdateService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.updates.initialize();
    try {
      await this.updates.checkForUpdates(false);
    } catch (err) {
      console.error('[app] startup update check failed', err);
    }
    this.lockState = await this.master.init();
    this.showIntro = this.lockState === 'unset';
    this.master.state$.subscribe(state => {
      this.lockState = state;
      if (state !== 'unset') {
        this.showIntro = false;
      }
      if (state === 'unlocked') {
        this.maybeStartOnboarding();
      } else {
        this.showOnboarding = false;
      }
    });
    if (this.lockState === 'unlocked') {
      this.maybeStartOnboarding();
    }
    this.navSub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(event => {
        // Atajo Ctrl/Cmd+F: si venimos de otra vista, enfocamos cuando ya estamos en /passwords.
        if (this.pendingSearchFocus && (event as NavigationEnd).urlAfterRedirects.startsWith('/passwords')) {
          this.pendingSearchFocus = false;
          setTimeout(() => this.focusSearchInput());
        }
        // Recalcula highlight al navegar durante el onboarding.
        if (this.showOnboarding) {
          this.applyHighlight();
        }
      });
  }

  ngOnDestroy(): void {
    this.navSub?.unsubscribe();
    clearInterval(this.cooldownTimer);
    this.updates.destroy();
  }

  startMasterSetup(): void {
    this.showIntro = false;
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
    this.ensureOnboardingConsistency();
    this.master.touch();
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalShortcuts(ev: KeyboardEvent): void {
    this.ensureOnboardingConsistency();
    if (this.isOnboardingActive()) {
      this.handleOnboardingKey(ev);
      return;
    }
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
    // Mantiene visible el contador de espera tras varios intentos fallidos de desbloqueo.
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

  get currentOnboardingStep(): OnboardingStep | null {
    return this.onboardingSteps[this.onboardingStep] || null;
  }

  nextOnboarding(): void {
    this.lastOnboardingAction = 'next';
    if (this.onboardingStep >= this.onboardingSteps.length - 1) {
      this.finishOnboarding();
      return;
    }
    const prev = this.currentOnboardingStep;
    this.onboardingStep++;
    this.handleStepTransitions(prev, this.currentOnboardingStep);
    this.navigateToStepRoute();
    this.applyHighlight();
  }

  prevOnboarding(): void {
    this.lastOnboardingAction = 'prev';
    if (this.onboardingStep <= 0) return;
    const prev = this.currentOnboardingStep;
    this.onboardingStep--;
    this.handleStepTransitions(prev, this.currentOnboardingStep);
    this.navigateToStepRoute();
    this.applyHighlight();
  }

  skipOnboarding(): void {
    this.lastOnboardingAction = 'skip';
    this.finishOnboarding();
  }

  private maybeStartOnboarding(): void {
    if (localStorage.getItem(this.onboardingKey) === 'done') return;
    this.onboardingStep = 0;
    this.showOnboarding = true;
    this.handleStepTransitions(null, this.currentOnboardingStep);
    this.navigateToStepRoute();
    this.applyHighlight();
  }

  private finishOnboarding(): void {
    this.clearHighlight();
    this.dispatchFiltersToggle(false);
    this.showOnboarding = false;
    localStorage.setItem('keyping.demo.disabled', '1');
    document.dispatchEvent(new CustomEvent('kp-demo-disable'));
    localStorage.setItem(this.onboardingKey, 'done');
    this.clearFocus();
    this.resetNavStyles();
    this.router.navigate(['/dashboard']).catch(() => {});
  }

  restartOnboarding(): void {
    localStorage.removeItem(this.onboardingKey);
    localStorage.removeItem('keyping.demo.disabled');
    document.dispatchEvent(new CustomEvent('kp-demo-enable'));
    this.showOnboarding = false;
    this.onboardingStep = 0;
    // Diferimos el inicio un ciclo de eventos para que el click que reinicia el tour
    // no dispare validaciones antes de montar el overlay.
    setTimeout(() => this.maybeStartOnboarding(), 0);
  }

  private navigateToStepRoute(): void {
    const step = this.currentOnboardingStep;
    if (!step?.route) return;
    if (this.router.url.startsWith(step.route)) return;
    this.router.navigate([step.route]).then(() => this.applyHighlight());
  }

  private applyHighlight(retries = 15): void {
    this.clearHighlight();
    const selector = this.currentOnboardingStep?.highlightSelector;
    const placement = this.currentOnboardingStep?.placement || 'right';
    setTimeout(() => {
      if (!selector) {
        if (placement === 'center') {
          this.positionOnboardingCard(undefined, placement);
        }
        return;
      }
      let el = document.querySelector(selector);
      if (!el && selector.includes('add-btn')) {
        el = document.querySelector('.add-btn');
      }
      if (el) {
        el.classList.add('onboarding-highlighted');
        this.highlightedEl = el;
        this.positionOnboardingCard(el.getBoundingClientRect(), placement);
      } else if (retries > 0) {
        this.applyHighlight(retries - 1);
      }
    }, 80);
  }

  private clearHighlight(): void {
    if (this.highlightedEl) {
      this.highlightedEl.classList.remove('onboarding-highlighted');
      this.highlightedEl = null;
    }
  }

  private positionOnboardingCard(rect?: DOMRect, placement: OnboardingPlacement = 'right'): void {
    const margin = 12;
    const cardWidth = 360;
    const cardHeight = 220;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (!rect || placement === 'center') {
      const left = window.scrollX + (viewportWidth - cardWidth) / 2;
      const top = window.scrollY + (viewportHeight - cardHeight) / 2;
      this.onboardingPos = { top: Math.max(margin, top), left: Math.max(margin, left), placement: 'center' };
      return;
    }

    const space = {
      right: viewportWidth - rect.right - margin - cardWidth,
      left: rect.left - margin - cardWidth,
      bottom: viewportHeight - rect.bottom - margin - cardHeight,
      top: rect.top - margin - cardHeight
    };

    const pickPlacement = (desiredPlacement: OnboardingPlacement): OnboardingPlacement => {
      // Si abajo no hay espacio suficiente, intentamos arriba.
      if (
        (desiredPlacement === 'bottom' || desiredPlacement === 'bottom-right') &&
        space.bottom < cardHeight * 0.6 &&
        space.top > space.bottom
      ) {
        return desiredPlacement === 'bottom-right' ? 'top-right' : 'top-left';
      }
      // Si la posición deseada cabe, la mantenemos.
      const fitsDesired =
        (desiredPlacement === 'right' && space.right >= 0) ||
        (desiredPlacement === 'left' && space.left >= 0) ||
        (desiredPlacement === 'bottom' && space.bottom >= 0) ||
        (desiredPlacement === 'bottom-right' && space.bottom >= 0 && space.right >= -cardWidth * 0.25) ||
        (desiredPlacement === 'top-left' && space.top >= 0 && space.left >= -cardWidth * 0.25) ||
        (desiredPlacement === 'top-right' && space.top >= 0 && space.right >= -cardWidth * 0.25);
      if (fitsDesired) return desiredPlacement;

      // Si no cabe, elegimos la zona con más espacio disponible.
      const candidates: Array<{ p: OnboardingPlacement; v: number }> = [
        { p: 'right', v: space.right },
        { p: 'left', v: space.left },
        { p: 'bottom', v: space.bottom },
        { p: 'top-left', v: space.top },
        { p: 'top-right', v: space.top }
      ];
      candidates.sort((a, b) => b.v - a.v);
      const best = candidates[0];
      if (best.v >= -cardHeight * 0.25) {
        return best.p;
      }
      return 'center';
    };

    let desired: OnboardingPlacement = pickPlacement(placement);
    let left = rect.right + margin + window.scrollX;
    let top = rect.top + window.scrollY;

    if (desired === 'bottom' || desired === 'bottom-right') {
      if (desired === 'bottom-right') {
        left = rect.right - cardWidth + window.scrollX;
      } else {
        left = rect.left + window.scrollX;
      }
      top = rect.bottom + margin + window.scrollY;
    } else if (desired === 'top-left') {
      left = rect.left + window.scrollX;
      top = rect.top - cardHeight - margin + window.scrollY;
    } else if (desired === 'top-right') {
      left = rect.right - cardWidth + window.scrollX;
      top = rect.top - cardHeight - margin + window.scrollY;
    } else if (desired === 'left') {
      left = rect.left - cardWidth - margin + window.scrollX;
      top = rect.top + window.scrollY;
    } else if (desired === 'right') {
      left = rect.right + margin + window.scrollX;
      top = rect.top + window.scrollY;
    }

    // Ajuste final para no salir de la ventana visible.
    if (left + cardWidth > viewportWidth + window.scrollX) {
      left = Math.max(window.scrollX + margin, viewportWidth + window.scrollX - cardWidth - margin);
    }
    if (left < window.scrollX + margin) {
      left = window.scrollX + margin;
    }
    if (top + cardHeight > window.scrollY + viewportHeight) {
      top = Math.max(window.scrollY + margin, window.scrollY + viewportHeight - cardHeight - margin);
    }
    if (top < window.scrollY + margin) {
      top = window.scrollY + margin;
    }

    this.onboardingPos = { top, left, placement: desired };
  }

  private handleStepTransitions(prev: OnboardingStep | null, next: OnboardingStep | null): void {
    if (prev?.titleKey === 'onboarding.filtersTitle') {
      this.dispatchFiltersToggle(false);
    }
    if (next?.titleKey === 'onboarding.filtersTitle') {
      this.dispatchFiltersToggle(true);
    }
    if (next?.titleKey === 'onboarding.detailTitle') {
      document.dispatchEvent(new CustomEvent('kp-select-first-password'));
    }
  }

  private dispatchFiltersToggle(open: boolean): void {
    const event = new CustomEvent('kp-toggle-filters', { detail: { open } });
    document.dispatchEvent(event);
  }

  private clearFocus(): void {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private resetNavStyles(): void {
    document.querySelectorAll('.sidebar-nav .nav-item, .sidebar-nav kp-password-generator').forEach(el => {
      const node = el as HTMLElement;
      node.blur?.();
      node.classList.remove('onboarding-highlighted', 'btn-active', 'active', 'focus');
    });
    document.querySelectorAll('.onboarding-highlighted').forEach(el => el.classList.remove('onboarding-highlighted'));
    // Fuerza un reflow mínimo para limpiar restos de estilos de foco/active.
    void document.body.offsetHeight;
  }

  private handleOnboardingKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.skipOnboarding();
      return;
    }

    const now = Date.now();
    if (now - this.lastOnboardingKeyTs < this.onboardingKeyThrottle) {
      ev.preventDefault();
      return;
    }
    this.lastOnboardingKeyTs = now;

    const key = ev.key;
    if (key === 'ArrowRight') {
      ev.preventDefault();
      this.nextOnboarding();
      this.focusOnboardingControl('next');
      return;
    }
    if (key === 'ArrowLeft') {
      ev.preventDefault();
      this.prevOnboarding();
      this.focusOnboardingControl('prev');
      return;
    }
    if (key === 'Enter') {
      ev.preventDefault();
      if (this.lastOnboardingAction === 'prev') {
        this.prevOnboarding();
        this.focusOnboardingControl('prev');
      } else if (this.lastOnboardingAction === 'skip') {
        this.skipOnboarding();
        this.focusOnboardingControl('skip');
      } else {
        this.nextOnboarding();
        this.focusOnboardingControl('next');
      }
    }
  }

  private focusOnboardingControl(which: 'next' | 'prev' | 'skip'): void {
    const selector =
      which === 'prev'
        ? '.onboarding-actions .prev-btn'
        : which === 'skip'
          ? '.onboarding-actions .skip-btn'
          : '.onboarding-actions .next-btn';
    setTimeout(() => {
      const btn = document.querySelector(selector) as HTMLButtonElement | null;
      btn?.focus();
    }, 0);
  }

  private isOnboardingOverlayMounted(): boolean {
    return !!document.querySelector('.onboarding-overlay');
  }

  private isOnboardingActive(): boolean {
    return this.showOnboarding && !!this.currentOnboardingStep && this.isOnboardingOverlayMounted();
  }

  private ensureOnboardingConsistency(): void {
    if (!this.showOnboarding) return;
    if (this.currentOnboardingStep && this.isOnboardingOverlayMounted()) return;
    this.clearHighlight();
    this.dispatchFiltersToggle(false);
    this.showOnboarding = false;
  }
}
