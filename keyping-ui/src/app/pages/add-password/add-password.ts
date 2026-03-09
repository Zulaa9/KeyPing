import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf, NgClass } from '@angular/common';
import { Router } from '@angular/router';
import { ElectronService, CheckResult } from '../../core/electron.service';
import { PasswordCountService } from '../../core/password-count.service';
import { TranslatePipe } from '../../core/translate.pipe';
import { I18nService } from '../../core/i18n.service';
import { resolveEntryIcon } from '../../core/icons/service-icon.resolver';

// Mensaje de alerta mostrado tras evaluar la fortaleza de la contraseña candidata.
type AlertMsg = { level: CheckResult['level']; title: string; message: string };

@Component({
  selector: 'app-add-password',
  standalone: true,
  imports: [FormsModule, NgIf, NgClass, TranslatePipe],
  templateUrl: './add-password.html',
  styleUrls: ['./add-password.scss']
})
export class AddPasswordComponent {
  // Campos del formulario de alta de credencial.
  pwd = '';
  label = ''; // nombre del servicio/app
  loginUrl = '';
  passwordChangeUrl = '';
  email = '';
  username = '';
  folder = '';
  twoFactorEnabled = false;
  passwordError = false;
  alert?: AlertMsg;
  private timer?: any;

  constructor(
    private es: ElectronService,
    private passwordCountSvc: PasswordCountService,
    private router: Router,
    private i18n: I18nService
  ) {}

  // Mapea el nivel de seguridad a un color semáforo usado en la UI.
  color(level: CheckResult['level']): string {
    if (level === 'danger') return '#ff6b6b';
    if (level === 'warn') return '#ffcc66';
    return '#4cd964';
  }

  // Ejecuta el análisis de contraseña y prepara el mensaje localizado.
  async onCheck(): Promise<void> {
    if (!this.pwd) {
      this.alert = undefined;
      return;
    }
    const res = await this.es.checkCandidate(this.pwd);
    const title =
      res.level === 'danger'
        ? this.t('add.alert.danger')
        : res.level === 'warn'
          ? this.t('add.alert.warn')
          : this.t('add.alert.ok');
    const message = res.reasons.length ? res.reasons.join(', ') : this.t('common.noIssues');
    this.alert = { level: res.level, title, message };
  }

  // Evita disparar una comprobación en cada pulsación para reducir ruido y carga.
  debouncedCheck(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onCheck(), 180);
  }

  // Limpia el estado de error cuando el usuario empieza a corregir la contraseña.
  onPasswordInput(): void {
    if (this.passwordError && this.pwd.trim()) {
      this.passwordError = false;
    }
    this.debouncedCheck();
  }

  // Guarda la entrada resolviendo icono/servicio y refresca los contadores globales.
  async onSave(): Promise<void> {
    if (!this.pwd) {
      this.passwordError = true;
      return;
    }
    this.passwordError = false;

    const resolvedIcon = resolveEntryIcon({
      label: this.label,
      loginUrl: this.loginUrl,
      passwordChangeUrl: this.passwordChangeUrl,
      username: this.username,
      email: this.email
    });

    await this.es.savePassword(
      this.pwd,
      this.label || undefined,
      this.loginUrl || undefined,
      this.passwordChangeUrl || undefined,
      this.username || undefined,
      this.email || undefined,
      this.folder || undefined,
      this.twoFactorEnabled,
      resolvedIcon.iconName,
      'auto',
      resolvedIcon.serviceId
    );

    // Recalcula el total mostrado en el dashboard y cabecera tras el alta.
    await this.passwordCountSvc.refreshFromDisk();

    // Restablece completamente el formulario para evitar residuos en memoria/UI.
    this.pwd = '';
    this.label = '';
    this.loginUrl = '';
    this.passwordChangeUrl = '';
    this.username = '';
    this.email = '';
    this.folder = '';
    this.twoFactorEnabled = false;
    this.passwordError = false;
    this.alert = undefined;

    await this.router.navigate(['/passwords']);
  }

  // Cancela la creación y vuelve al listado sin persistir cambios.
  onCancel(): void {
    this.router.navigate(['/passwords']);
  }

  // Atajo para centralizar traducciones y simplificar plantillas/métodos.
  private t(key: string, params?: Record<string, string | number>): string {
    return this.i18n.translate(key, params);
  }
}
