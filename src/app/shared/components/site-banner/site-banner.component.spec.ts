import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ConfigService } from '../../../core/config/config.service';
import { NoticeConfig } from '../../../core/config/config.interfaces';
import { AppTranslationService } from '../../translation/app-translation.service';
import { SiteBannerComponent } from './site-banner.component';

describe('SiteBannerComponent', () => {
  let fixture: ComponentFixture<SiteBannerComponent>;
  const apiConfigUnavailable = signal(false);
  let notice: NoticeConfig | null = null;

  const configStub = {
    apiConfigUnavailable,
    get notice() { return notice; },
    resolveLabel: (value: any, lang: string) => typeof value === 'string' ? value : value?.[lang] ?? '',
  };

  async function create(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [SiteBannerComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ConfigService, useValue: configStub },
        { provide: AppTranslationService, useValue: { currentLanguage: signal({ code: 'cs' }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SiteBannerComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    apiConfigUnavailable.set(false);
    notice = null;
    localStorage.removeItem('site-notice-dismissed');
  });

  const strips = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('.site-banner'));
  const close = (strip: HTMLElement) => (strip.querySelector('.site-banner__close') as HTMLButtonElement).click();

  it('shows nothing while Kramerius config loads fine and no notice is set', async () => {
    await create();
    expect(strips().length).toBe(0);
  });

  it('warns when the config API failed, and can be closed', async () => {
    await create();
    apiConfigUnavailable.set(true);
    fixture.detectChanges();
    expect(strips().length).toBe(1);
    expect(strips()[0].textContent).toContain('site-banner--kramerius-unavailable');

    close(strips()[0]);
    fixture.detectChanges();
    expect(strips().length).toBe(0);
  });

  it('shows the configured notice in the current language', async () => {
    notice = { text: { cs: 'Plánovaná odstávka', en: 'Planned outage' }, level: 'warning' };
    await create();
    expect(strips().length).toBe(1);
    expect(strips()[0].textContent).toContain('Plánovaná odstávka');
    expect(strips()[0].classList).toContain('site-banner--warning');
  });

  it('remembers a closed notice until its text changes', async () => {
    notice = { text: 'Odstávka v sobotu' };
    await create();
    close(strips()[0]);
    fixture.detectChanges();
    expect(strips().length).toBe(0);

    TestBed.resetTestingModule();
    await create();
    expect(strips().length).toBe(0);

    TestBed.resetTestingModule();
    notice = { text: 'Odstávka v neděli' };
    await create();
    expect(strips().length).toBe(1);
  });

  it('has no close button when the notice is not dismissible', async () => {
    notice = { text: 'Důležité', dismissible: false };
    await create();
    expect(strips()[0].querySelector('.site-banner__close')).toBeNull();
  });
});
