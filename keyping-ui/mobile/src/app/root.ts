// Raíz: bloqueo/creación de bóveda, pestañas con barra inferior y pantallas apiladas.
import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { I18n } from './i18n';
import { VaultStore } from './vault';
import { Confirm, Icon, Nav, Tab, Toast } from './ui';
import { SetupScreen, UnlockScreen } from './screens/auth';
import { ListScreen } from './screens/list';
import { DetailScreen, NewPasswordScreen } from './screens/detail';
import { EditScreen } from './screens/edit';
import { ExportScreen, GeneratorScreen, ImportScreen, MasterScreen, SettingsScreen } from './screens/tools';

@Component({
  selector: 'kp-root',
  standalone: true,
  imports: [Icon, SetupScreen, UnlockScreen, ListScreen, DetailScreen, NewPasswordScreen, EditScreen, GeneratorScreen,
    SettingsScreen, ExportScreen, ImportScreen, MasterScreen],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  @switch (store.phase()) {
    @case ('loading') { <div class="splash"><img src="logo.png" alt="" width="72" height="72"></div> }
    @case ('setup') { <kp-setup/> }
    @case ('locked') { <kp-unlock/> }
    @case ('unlocked') {
      @if (nav.top(); as s) {
        <div class="screen pushed" [attr.data-screen]="s.name">
          @switch (s.name) {
            @case ('detail') { <kp-detail [id]="$any(s).id"/> }
            @case ('newpwd') { <kp-newpwd [id]="$any(s).id"/> }
            @case ('edit') { <kp-edit [id]="$any(s).id" [initialPassword]="$any(s).password"/> }
            @case ('export') { <kp-export/> }
            @case ('import') { <kp-import/> }
            @case ('master') { <kp-master/> }
          }
        </div>
      } @else {
        <div class="screen tabbed" [attr.data-screen]="nav.tab()">
          @switch (nav.tab()) {
            @case ('list') { <kp-list/> }
            @case ('gen') { <kp-generator/> }
            @case ('settings') { <kp-settings/> }
          }
        </div>
        <nav class="tabbar">
          @for (t of tabs; track t.id) {
            <button [class.on]="nav.tab() === t.id" (click)="nav.go(t.id)" [attr.aria-current]="nav.tab() === t.id ? 'page' : null">
              <kp-icon [name]="t.icon" [size]="24"/><span>{{ i18n.t(t.label) }}</span>
            </button>
          }
        </nav>
      }
    }
  }
  @if (toast.message(); as m) { <div class="toast" role="status">{{ m }}</div> }
  @if (confirm.request(); as r) {
    <div class="sheet-backdrop" (click)="confirm.answer(false)">
      <div class="sheet" role="alertdialog" aria-modal="true" (click)="$event.stopPropagation()">
        <p>{{ r.text }}</p>
        <button class="btn big" [class.danger]="r.danger" [class.primary]="!r.danger" (click)="confirm.answer(true)">{{ r.ok }}</button>
        <button class="btn big" (click)="confirm.answer(false)">{{ i18n.t('common.cancel') }}</button>
      </div>
    </div>
  }`
})
export class Root implements OnInit {
  readonly i18n = inject(I18n);
  readonly store = inject(VaultStore);
  readonly nav = inject(Nav);
  readonly toast = inject(Toast);
  readonly confirm = inject(Confirm);
  readonly tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'list', icon: 'key', label: 'tab.passwords' },
    { id: 'gen', icon: 'dice', label: 'tab.generator' },
    { id: 'settings', icon: 'gear', label: 'tab.settings' }
  ];

  async ngOnInit(): Promise<void> {
    // Al bloquear se vuelve a la lista y se cierran avisos y confirmaciones abiertos.
    this.store.onLock(() => {
      this.nav.reset();
      this.confirm.answer(false);
      this.toast.message.set(null);
    });
    await this.store.init();
  }
}
