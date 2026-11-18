import { installFakeKeyping, uninstallFakeKeyping, testProviders } from '../../../testing/fake-keyping';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DashboardComponent } from './dashboard';

describe('DashboardComponent', () => {
  beforeEach(() => installFakeKeyping());
  afterEach(() => uninstallFakeKeyping());

  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: testProviders
    })
    .compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
