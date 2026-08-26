import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AuthService } from '../../core/auth/auth.service';
import { ConfigService } from '../../core/config/config.service';
import { AiApiService } from './ai-api.service';

describe('AiApiService Qwen integration', () => {
  let service: AiApiService;
  let httpMock: HttpTestingController;
  let token: string | null;
  let aiConfig: any;

  beforeEach(() => {
    token = 'signed-kramerius-token';
    aiConfig = {
      apiBaseUrl: 'https://api.trinera.cloud/api',
      llm: {
        provider: 'qwen',
        baseUrl: 'https://ai.example.org/v1',
        model: 'Qwen/Qwen3-8B',
        auth: 'kramerius'
      }
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AiApiService,
        { provide: AuthService, useValue: { getAccessToken: () => token } },
        { provide: ConfigService, useValue: { get ai() { return aiConfig; } } }
      ]
    });

    service = TestBed.inject(AiApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('uses the configured OpenAI-compatible Qwen endpoint and model', () => {
    let result = '';
    service.askLLM('Text dokumentu', 'Shrň text', undefined, 512)
      .subscribe(value => result = value);

    const request = httpMock.expectOne('https://ai.example.org/v1/chat/completions');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer signed-kramerius-token');
    expect(request.request.body).toEqual(jasmine.objectContaining({
      model: 'Qwen/Qwen3-8B',
      max_tokens: 512,
      stream: false,
      chat_template_kwargs: { enable_thinking: false }
    }));
    request.flush({ choices: [{ message: { content: 'Krátké shrnutí' } }] });

    expect(result).toBe('Krátké shrnutí');
  });

  it('can call a reverse-proxy-protected Qwen endpoint without a browser token', () => {
    token = null;
    aiConfig.llm.auth = 'none';

    service.askLLM('Text', 'Shrň').subscribe();

    const request = httpMock.expectOne('https://ai.example.org/v1/chat/completions');
    expect(request.request.headers.has('Authorization')).toBeFalse();
    request.flush({ choices: [{ message: { content: 'Shrnutí' } }] });
  });

  it('rejects Kramerius-authenticated calls when the user has no token', () => {
    token = null;
    let errorMessage = '';

    service.askLLM('Text', 'Shrň').subscribe({
      error: error => errorMessage = error.message
    });

    expect(errorMessage).toBe('unauthorized');
    httpMock.expectNone('https://ai.example.org/v1/chat/completions');
  });
});
