import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ConfigService } from '../../../core/config/config.service';
import { SiteBannerComponent } from './site-banner.component';

describe('SiteBannerComponent', () => {
  let fixture: ComponentFixture<SiteBannerComponent>;
  const apiConfigUnavailable = signal(false);

  beforeEach(async () => {
    apiConfigUnavailable.set(false);
    await TestBed.configureTestingModule({
      imports: [SiteBannerComponent, TranslateModule.forRoot()],
      providers: [{ provide: ConfigService, useValue: { apiConfigUnavailable } }],
    }).compileComponents();
    fixture = TestBed.createComponent(SiteBannerComponent);
    fixture.detectChanges();
  });

  const strips = () => fixture.nativeElement.querySelectorAll('.site-banner');

  it('shows nothing while Kramerius config loads fine', () => {
    expect(strips().length).toBe(0);
  });

  it('warns when the config API failed, and can be closed', () => {
    apiConfigUnavailable.set(true);
    fixture.detectChanges();
    expect(strips().length).toBe(1);
    expect(strips()[0].textContent).toContain('site-banner--kramerius-unavailable');

    fixture.nativeElement.querySelector('.site-banner__close').click();
    fixture.detectChanges();
    expect(strips().length).toBe(0);
  });
});
