import { installFakeKeyping, uninstallFakeKeyping, testProviders } from '../testing/fake-keyping';
import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app';

describe('AppComponent', () => {
  beforeEach(() => installFakeKeyping());
  afterEach(() => uninstallFakeKeyping());

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: testProviders,
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
