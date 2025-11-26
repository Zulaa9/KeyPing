import { Component } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { NgIf } from '@angular/common';
import { ElectronService } from '../../core/electron.service';
import { PasswordCountService } from '../../core/password-count.service';

@Component({
  selector: 'kp-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, NgIf],
  templateUrl: './header.html',
  styleUrls: ['./header.scss']
})
export class HeaderComponent {
  readonly logoPath = 'assets/logo.png'

  passwordCount: number | null = null;

  private navSub?: Subscription;
  private countSub?: Subscription;

  constructor(
    private es: ElectronService,
    private router: Router,
    private passwordCountSvc: PasswordCountService
  ) {}

  ngOnInit(): void {
    // Escucha cambios del contador (cargar, añadir, borrar…)
    this.countSub = this.passwordCountSvc.count$.subscribe(count => {
      this.passwordCount = count;
    });

    // Esto ya no es estrictamente necesario para el contador,
    // pero si quieres seguir refrescando cosas en cambios de ruta, déjalo.
    this.navSub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => {
        // Si quieres forzar recarga desde disco en cada cambio de ruta:
        // this.passwordCountSvc.refreshFromDisk();
      });
  }

  ngOnDestroy(): void {
    this.navSub?.unsubscribe();
    this.countSub?.unsubscribe();
  }
}
