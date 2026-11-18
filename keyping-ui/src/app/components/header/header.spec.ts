import { installFakeKeyping, uninstallFakeKeyping, testProviders } from '../../../testing/fake-keyping';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HeaderComponent } from './header';

describe('HeaderComponent', () => {
  beforeEach(() => installFakeKeyping());
  afterEach(() => uninstallFakeKeyping());

  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: testProviders
    })
    .compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
