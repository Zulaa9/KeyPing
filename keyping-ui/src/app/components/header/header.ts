import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { NgIf } from '@angular/common';
import { PasswordGeneratorComponent } from '../password-generator/password-generator';
import { PasswordCountService } from '../../core/password-count.service';

@Component({
  selector: 'kp-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, NgIf, PasswordGeneratorComponent],
  templateUrl: './header.html',
  styleUrls: ['./header.scss']
})
export class HeaderComponent implements OnInit, OnDestroy {
  readonly logoPath = 'assets/logo.png';

  passwordCount: number | null = null;

  private navSub?: Subscription;
  private countSub?: Subscription;

  constructor(
    private router: Router,
    private passwordCountSvc: PasswordCountService
  ) {}

  ngOnInit(): void {
    this.countSub = this.passwordCountSvc.count$.subscribe(count => {
      this.passwordCount = count;
    });

    this.navSub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => {
        // Hook to refresh things on navigation if needed later
      });
  }

  ngOnDestroy(): void {
    this.navSub?.unsubscribe();
    this.countSub?.unsubscribe();
  }
}
