import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { ConfigService } from '../../core/config/config.service';
import { SKIP_AUTH_INTERCEPTOR } from '../../core/services/http-context-tokens';
import { AiApiService } from './ai-api.service';

describe('AiApiService Qwen integration', () => {
  let service: AiApiService;
  let httpMock: HttpTestingController;
  let token: string | null;
  let tokenExpired: boolean;
  let aiConfig: any;

  beforeEach(() => {
    token = 'signed-kramerius-token';
    tokenExpired = false;
    aiConfig = {
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
        {
          provide: AuthService,
          useValue: {
            getAccessToken: () => token,
            isTokenExpired: () => tokenExpired,
          }
        },
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
    expect(request.request.context.get(SKIP_AUTH_INTERCEPTOR)).toBeTrue();
    request.flush({ choices: [{ message: { content: 'Shrnutí' } }] });
  });

  it('rejects Kramerius-authenticated calls when the user has no token', () => {
    token = null;
    let errorMessage = '';

    service.askLLM('Text', 'Shrň').subscribe({
      error: error => errorMessage = error.message
    });

    expect(errorMessage).toBe('ai.error-unauthorized');
    httpMock.expectNone('https://ai.example.org/v1/chat/completions');
  });

  it('uses the configured Qwen endpoint for page translation', () => {
    aiConfig.llm.auth = 'none';
    let result = '';
    service.translate('Text strany', 'en').subscribe(value => result = value);

    const request = httpMock.expectOne('https://ai.example.org/v1/chat/completions');
    expect(request.request.headers.has('Authorization')).toBeFalse();
    expect(request.request.context.get(SKIP_AUTH_INTERCEPTOR)).toBeTrue();
    expect(request.request.body.messages[0].content).toContain('ISO code en');
    expect(request.request.body.messages[1].content).toBe('Text strany');
    request.flush({ choices: [{ message: { content: 'Page text' } }] });

    expect(result).toBe('Page text');
  });

  it('uses Qwen instead of an external API for language detection', () => {
    aiConfig.llm.auth = 'none';
    let result = '';
    service.detectLanguage('Příliš žluťoučký kůň').subscribe(value => result = value);

    const request = httpMock.expectOne('https://ai.example.org/v1/chat/completions');
    expect(request.request.body.messages[0].content).toContain('ISO 639-1');
    request.flush({ choices: [{ message: { content: 'cs' } }] });

    expect(result).toBe('cs');
  });

  it('uses Qwen to correct contextual OCR substitutions without translating the text', () => {
    aiConfig.llm.auth = 'none';
    let result = '';
    service.correctOcrText('smutn duch a zdrav zrak 1945.', 'cs').subscribe(value => result = value);

    const request = httpMock.expectOne('https://ai.example.org/v1/chat/completions');
    const instructions = request.request.body.messages[0].content as string;
    expect(instructions).toContain('OCR character corrector');
    expect(instructions).toContain('ISO code cs');
    expect(instructions).toContain('historical vocabulary and archaic spelling');
    expect(instructions).toContain('Never paraphrase, translate, summarize');
    const payload = JSON.parse(request.request.body.messages[1].content);
    expect(payload.context).toBe('smutn duch a zdrav zrak 1945.');
    expect(payload.tokens).toEqual({
      '0': 'smutn', '1': 'duch', '2': 'a', '3': 'zdrav', '4': 'zrak', '5': '1945.'
    });
    request.flush({ choices: [{ message: { content: '{"0":"smutný","3":"zdravý"}' } }] });

    expect(result).toBe('smutný duch a zdravý zrak 1945.');
  });

  it('rejects unsafe OCR proposals that rewrite words, punctuation or numbers', () => {
    aiConfig.llm.auth = 'none';
    let result = '';
    service.correctOcrText('Lpe mhouranovi 1945.', 'cs').subscribe(value => result = value);

    const request = httpMock.expectOne('https://ai.example.org/v1/chat/completions');
    request.flush({ choices: [{ message: { content: '```json\n{"0":"Lépe!","1":"mluvícímu","2":"1948."}\n```' } }] });

    expect(result).toBe('Lpe mhouranovi 1945.');
  });

  it('corrects a long page sequentially in bounded chunks without losing separators', () => {
    const source = Array.from({ length: 900 }, () => 'smutn').join(' ');
    const correctChunk = spyOn(service, 'correctOcrText')
      .and.callFake((chunk: string) => of(chunk.replace(/smutn/g, 'smutný')));
    let result = '';

    service.correctOcrTranscript(source, 'cs').subscribe(value => result = value);

    expect(correctChunk.calls.count()).toBeGreaterThan(1);
    for (const call of correctChunk.calls.all()) {
      expect((call.args[0] as string).length).toBeLessThanOrEqual(2400);
      expect(call.args[1]).toBe('cs');
    }
    expect(result).toBe(Array.from({ length: 900 }, () => 'smutný').join(' '));
  });

  it('rejects Kramerius-authenticated calls with an expired access token', () => {
    tokenExpired = true;
    let errorMessage = '';

    service.askLLM('Text', 'Shrň').subscribe({
      error: error => errorMessage = error.message
    });

    expect(errorMessage).toBe('ai.error-unauthorized');
    httpMock.expectNone('https://ai.example.org/v1/chat/completions');
  });

  it('returns a useful message key for a misconfigured endpoint', () => {
    let errorMessage = '';
    service.translate('Text', 'en').subscribe({ error: error => errorMessage = error.message });

    httpMock.expectOne('https://ai.example.org/v1/chat/completions')
      .flush('Method Not Allowed', { status: 405, statusText: 'Method Not Allowed' });

    expect(errorMessage).toBe('ai.error-endpoint');
  });

  it('returns a useful message key for an AI timeout', () => {
    let errorMessage = '';
    service.askLLM('Text', 'Shrň').subscribe({ error: error => errorMessage = error.message });

    httpMock.expectOne('https://ai.example.org/v1/chat/completions')
      .flush('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' });

    expect(errorMessage).toBe('ai.error-timeout');
  });
});
