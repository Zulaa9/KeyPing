import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf, NgClass } from '@angular/common';
import { ElectronService, CheckResult } from '../../core/electron.service';
import { PasswordCountService } from '../../core/password-count.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-add-password',
  standalone: true,
  imports: [FormsModule, NgIf, NgClass],
  templateUrl: './add-password.html',
  styleUrls: ['./add-password.scss']
})
export class AddPasswordComponent {
  pwd = '';
  label = ''; // nombre del servicio/app
  loginUrl = '';
  passwordChangeUrl = '';
  email = '';
  username = '';
  twoFactorEnabled = false;
  passwordError = false;
  alert?: { level: CheckResult['level']; title: string; message: string };
  private timer?: any;

  constructor(
    private es: ElectronService,
    private passwordCountSvc: PasswordCountService,
    private router: Router
  ) {}

  color(level: CheckResult['level']): string {
    if (level === 'danger') return '#ff6b6b';
    if (level === 'warn')   return '#ffcc66';
    return '#4cd964';
  }

  async onCheck(): Promise<void> {
    if (!this.pwd) { this.alert = undefined; return; }
    const res = await this.es.checkCandidate(this.pwd);
    const title =
      res.level === 'danger' ? 'Contraseña muy insegura' :
      res.level === 'warn'   ? 'Contraseña débil' :
                               'Contraseña sólida';
    const message = res.reasons.length ? res.reasons.join(', ') : 'Sin problemas detectados.';
    this.alert = { level: res.level, title, message };
  }

  debouncedCheck(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onCheck(), 180);
  }

  onPasswordInput(): void {
    if (this.passwordError && this.pwd.trim()) {
      this.passwordError = false;
    }
    this.debouncedCheck();
  }

  async onSave(): Promise<void> {
      if (!this.pwd) {
        this.passwordError = true;
        return;
      }
      this.passwordError = false;

      await this.es.savePassword(
        this.pwd,
        this.label || undefined,
        this.loginUrl || undefined,
        this.passwordChangeUrl || undefined,
        this.username || undefined,
        this.email || undefined,
        this.twoFactorEnabled
      );

      await this.passwordCountSvc.refreshFromDisk();

      console.log('[renderer] saved password meta');
      this.pwd = '';
      this.label = '';
      this.loginUrl = '';
      this.passwordChangeUrl = '';
      this.username = '';
      this.email = '';
      this.twoFactorEnabled = false;
      this.passwordError = false;
      this.alert = undefined;

      await this.router.navigate(['/passwords']);
    }

    onCancel(): void {
      this.router.navigate(['/passwords']);
    }
}
