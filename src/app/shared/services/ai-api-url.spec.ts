import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AiApiService } from './ai-api.service';
import { AuthService } from '../../core/auth/auth.service';
import { ConfigService } from '../../core/config/config.service';

/** Regression coverage: every text AI function must use the self-hosted Qwen URL. */
describe('AiApiService Qwen base URL', () => {
  let httpMock: HttpTestingController;

  function setup(ai: any, api: any = {}): AiApiService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AiApiService,
        { provide: AuthService, useValue: {
          getAccessToken: () => 'test-token',
          isTokenExpired: () => false,
        } },
        { provide: ConfigService, useValue: { api, ai } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    return TestBed.inject(AiApiService);
  }

  afterEach(() => httpMock.verify());

  it('sends translation to the configured Qwen endpoint', () => {
    const service = setup({
      llm: { provider: 'qwen', baseUrl: 'https://ai.example.org/v1', model: 'Qwen/Test', auth: 'none' }
    });

    service.translate('ahoj', 'en').subscribe();

    const request = httpMock.expectOne('https://ai.example.org/v1/chat/completions');
    expect(request.request.body.model).toBe('Qwen/Test');
    request.flush({ choices: [{ message: { content: 'hello' } }] });
  });

  it('never falls back to a legacy Trinera proxy for translation', () => {
    const service = setup(
      { llm: { provider: 'qwen', baseUrl: '/ai/v1', model: 'Qwen/Test', auth: 'none' } },
      { aiProxyUrl: 'https://api.trinera.cloud/api' },
    );

    service.translate('ahoj', 'en').subscribe();

    const request = httpMock.expectOne('/ai/v1/chat/completions');
    expect(request.request.url).not.toContain('trinera.cloud');
    request.flush({ choices: [{ message: { content: 'hello' } }] });
  });

  it('re-reads the Qwen config for each request', () => {
    const ai = {
      llm: { provider: 'qwen', baseUrl: 'https://first.example.org/v1', model: 'Qwen/Test', auth: 'none' }
    };
    const service = setup(ai);

    service.detectLanguage('ahoj').subscribe();
    const first = httpMock.expectOne('https://first.example.org/v1/chat/completions');
    expect(first.request.url).toBe('https://first.example.org/v1/chat/completions');
    first.flush({ choices: [{ message: { content: 'cs' } }] });

    ai.llm.baseUrl = 'https://second.example.org/v1';
    service.detectLanguage('hello').subscribe();
    const second = httpMock.expectOne('https://second.example.org/v1/chat/completions');
    expect(second.request.url).toBe('https://second.example.org/v1/chat/completions');
    second.flush({ choices: [{ message: { content: 'en' } }] });
  });
});
