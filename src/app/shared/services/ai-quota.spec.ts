import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { AiApiService, isQuotaExceeded, AI_QUOTA_EXCEEDED } from './ai-api.service';
import { AuthService } from '../../core/auth/auth.service';
import { ConfigService } from '../../core/config/config.service';
import { TtsService } from './tts.service';
import { AltoService } from './alto.service';
import { BrowserTtsService } from './browser-tts.service';
import { DetailViewService } from '../../modules/detail-view-page/services/detail-view.service';
import { IIIFViewerService } from './iiif-viewer.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { ToastService } from './toast.service';
import { DocumentInfoService } from './document-info.service';

describe('AI quota exhaustion', () => {
  const QUOTA_BODY = {
    errorMessage: 'your quota for tokens for this month was exceeded',
    errorCode: 'quota_exceeded',
  };

  describe('Qwen error normalization', () => {
    let service: AiApiService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          AiApiService,
          { provide: AuthService, useValue: {
            getAccessToken: () => null,
            isTokenExpired: () => true,
          } },
          { provide: ConfigService, useValue: {
            api: { aiProxyUrl: 'https://api.trinera.cloud/api' },
            ai: { llm: {
              provider: 'qwen', baseUrl: '/ai/v1', model: 'Qwen/Test', auth: 'none'
            } },
          } },
        ],
      });
      service = TestBed.inject(AiApiService);
      httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpMock.verify());

    it('surfaces quota_exceeded from an error response', () => {
      let caught: Error | null = null;
      service.detectLanguage('nějaký text').subscribe({ error: error => caught = error });

      httpMock.expectOne('/ai/v1/chat/completions')
        .flush(QUOTA_BODY, { status: 429, statusText: 'Too Many Requests' });

      expect(caught!.message).toBe(AI_QUOTA_EXCEEDED);
      expect(isQuotaExceeded(caught)).toBeTrue();
    });

    it('surfaces quota_exceeded even when it arrives with HTTP 200', () => {
      let caught: Error | null = null;
      service.translate('text', 'cs').subscribe({ error: error => caught = error });

      httpMock.expectOne('/ai/v1/chat/completions').flush(QUOTA_BODY);

      expect(caught!.message).toBe(AI_QUOTA_EXCEEDED);
    });

    it('passes a normal Qwen language response through', () => {
      let result = '';
      service.detectLanguage('nějaký text').subscribe(value => result = value);

      httpMock.expectOne('/ai/v1/chat/completions')
        .flush({ choices: [{ message: { content: 'cs' } }] });

      expect(result).toBe('cs');
    });
  });

  it('stops browser reading when Qwen language detection exhausts quota', () => {
    const toast = { show: jasmine.createSpy('show') };
    const browserTts = {
      isSupported: () => true,
      speak: jasmine.createSpy('speak'),
      pause: () => {}, resume: () => {}, cancel: () => {},
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        TtsService,
        { provide: AltoService, useValue: {
          fetchOcrContent: () => of({ text: 'text', altoXml: '<alto/>' }),
          getBlocksForReading: () => [{ text: 'first block' }],
        } },
        { provide: AiApiService, useValue: {
          detectLanguage: () => throwError(() => new Error(AI_QUOTA_EXCEEDED)),
          translate: (text: string) => of(text),
        } },
        { provide: BrowserTtsService, useValue: browserTts },
        { provide: DetailViewService, useValue: { pages: [{ pid: 'page-1' }], goToPage: () => {} } },
        { provide: IIIFViewerService, useValue: { showTtsHighlight: () => {}, clearTtsHighlight: () => {} } },
        { provide: SettingsService, useValue: { settings: null } },
        { provide: ToastService, useValue: toast },
        { provide: DocumentInfoService, useValue: { hasAlto: () => true } },
      ],
    });

    const tts = TestBed.inject(TtsService);
    tts.startReading('page-1');

    expect(tts.isReading()).toBeFalse();
    expect(tts.error()).toBe('ai.quota-exceeded');
    expect(toast.show).toHaveBeenCalledWith('ai.quota-exceeded');
    expect(browserTts.speak).not.toHaveBeenCalled();
  });
});
