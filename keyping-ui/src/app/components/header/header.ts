import { Component, Input, OnDestroy, OnInit, Output, EventEmitter } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { NgIf } from '@angular/common';
import { PasswordGeneratorComponent } from '../password-generator/password-generator';
import { PasswordCountService } from '../../core/password-count.service';
import { MasterLockService } from '../../core/master-lock.service';
import { TranslatePipe } from '../../core/translate.pipe';

@Component({
  selector: 'kp-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, NgIf, PasswordGeneratorComponent, TranslatePipe],
  templateUrl: './header.html',
  styleUrls: ['./header.scss']
})
export class HeaderComponent implements OnInit, OnDestroy {
  // Ruta centralizada del logo para no duplicar literales en plantilla.
  readonly logoPath = 'assets/logo.png';

  passwordCount: number | null = null;
  @Input() locked = false;
  @Output() restartTour = new EventEmitter<void>();

  private countSub?: Subscription;

  constructor(
    private passwordCountSvc: PasswordCountService,
    private master: MasterLockService
  ) {}

  ngOnInit(): void {
    // Refleja en sidebar el contador reactivo de entradas del vault.
    this.countSub = this.passwordCountSvc.count$.subscribe(count => {
      this.passwordCount = count;
    });
  }

  ngOnDestroy(): void {
    this.countSub?.unsubscribe();
  }

  onNavClick(ev: MouseEvent): void {
    // Bloquea navegación cuando la app está cerrada por lock maestro.
    if (this.locked) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  onLock(): void {
    this.master.lock();
  }
}
