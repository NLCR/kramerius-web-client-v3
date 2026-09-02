import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpContext } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { AuthService } from '../../core/auth/auth.service';
import { ConfigService } from '../../core/config/config.service';
import { AiLlmAuthMode } from '../../core/config/config.interfaces';
import { SKIP_AUTH_INTERCEPTOR, SKIP_ERROR_INTERCEPTOR } from '../../core/services/http-context-tokens';

export interface AiModel {
  provider: 'openai' | 'anthropic' | 'google' | 'qwen';
  name: string;
  code: string;
}

export type TranslateProvider = 'google' | 'deepl';

/**
 * Error code the AI proxy returns once the monthly token budget is spent
 * Unlike a one-off failure this will not recover on the next request, so callers
 * must abort the whole operation rather than retry the next block. Thrown as the
 * message of the Error so every existing `err.message` consumer can match on it.
 */
export const AI_QUOTA_EXCEEDED = 'quota_exceeded';

/**
 * True when a thrown AI error is the quota-exhausted case.
 * Accepts unknown so callers can pass an untyped RxJS error straight in.
 */
export function isQuotaExceeded(err: unknown): boolean {
  return (err as { message?: string } | null)?.message === AI_QUOTA_EXCEEDED;
}

/**
 * The AI proxy is config-driven only: no `api.aiProxyUrl` means no proxy URL, the
 * same rule the header applies to `app.logo`. Requests then resolve against the
 * app's own origin and fail loudly rather than silently reaching a third-party
 * default the deployment never opted into.
 */
const DEFAULT_AI_URL = '';

export const AI_MODELS: AiModel[] = [
  { provider: 'openai', name: 'GPT 4o', code: 'gpt-4o' },
  { provider: 'openai', name: 'GPT 4o mini', code: 'gpt-4o-mini' },
  { provider: 'anthropic', name: 'Claude 3.5 Haiku', code: 'claude-3-5-haiku-20241022' },
  { provider: 'anthropic', name: 'Claude 3.5 Sonnet', code: 'claude-3-5-sonnet-20241022' },
  { provider: 'google', name: 'Gemini 2.0 Flash', code: 'gemini-2.0-flash-exp' },
  { provider: 'google', name: 'Gemini 1.5 Pro', code: 'gemini-1.5-pro' },
];

@Injectable({ providedIn: 'root' })
export class AiApiService {

  private readonly temperature = 0;

  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private configService = inject(ConfigService);

  private get apiBaseUrl(): string {
    return (
      this.configService.ai?.apiBaseUrl ||
      this.configService.api?.aiProxyUrl ||
      DEFAULT_AI_URL
    ).replace(/\/+$/, '');
  }

  getDefaultModel(): AiModel {
    const config = this.configService.ai.llm;
    if (config?.provider === 'qwen') {
      const code = config.model || 'Qwen/Qwen3.5-9B';
      return { provider: 'qwen', name: code, code };
    }

    const configuredCode = config?.model;
    return AI_MODELS.find(model => model.code === configuredCode) ?? AI_MODELS[1];
  }

  // --- Translation ---

  translate(input: string, targetLanguage: string, _provider: TranslateProvider = 'google', format: 'text' | 'html' = 'text'): Observable<string> {
    return this.translateWithQwen(input, targetLanguage, format);
  }

  // --- Language Detection ---

  detectLanguage(input: string): Observable<string> {
    const instructions = [
      'Identify the language of the supplied text.',
      'Return only its lowercase ISO 639-1 two-letter code, for example cs, en, de or pl.',
      'Do not add punctuation, Markdown or an explanation.'
    ].join(' ');
    return this.askConfiguredQwen(input.slice(0, 3000), instructions, 16).pipe(
      map(result => {
        const code = result.trim().toLowerCase().match(/\b[a-z]{2}\b/)?.[0];
        if (!code) throw new Error('invalid_language_response');
        return code;
      })
    );
  }

  // --- LLM ---

  askLLM(input: string, instructions: string, model?: AiModel, maxTokens: number = 1000): Observable<string> {
    const llmConfig = this.configService.ai.llm;
    if (llmConfig?.provider === 'qwen') {
      const configuredModel = llmConfig.model || 'Qwen/Qwen3.5-9B';
      const modelCode = model?.provider === 'qwen' ? model.code : configuredModel;
      return this.askQwen(input, instructions, modelCode, maxTokens);
    }

    const m = model || this.getDefaultModel();
    switch (m.provider) {
      case 'openai':
        return this.askGPT(input, instructions, m.code, maxTokens);
      case 'anthropic':
        return this.askClaude(input, instructions, m.code, maxTokens);
      case 'google':
        return this.askGemini(input, instructions, m.code, maxTokens);
      case 'qwen':
        return this.askQwen(input, instructions, m.code, maxTokens);
      default:
        return this.askGPT(input, instructions, m.code, maxTokens);
    }
  }

  private askGPT(input: string, instructions: string, model: string, maxTokens: number): Observable<string> {
    const body = {
      model,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: input }
      ],
      temperature: this.temperature,
      max_tokens: maxTokens
    };
    return this.post<any>('/openai/chat/completions', body).pipe(
      map(r => r.choices[0].message.content)
    );
  }

  private askClaude(input: string, instructions: string, model: string, maxTokens: number): Observable<string> {
    const body = {
      model,
      messages: [
        { role: 'user', content: `${instructions}\n\n${input}` }
      ],
      temperature: this.temperature,
      max_tokens: maxTokens
    };
    return this.post<any>('/anthropic/messages', body).pipe(
      map(r => r.content[0].text)
    );
  }

  private askGemini(input: string, instructions: string, model: string, maxTokens: number): Observable<string> {
    const body = {
      contents: [
        { role: 'user', parts: [{ text: `${instructions}\n\n${input}` }] }
      ],
      generationConfig: { temperature: this.temperature, maxOutputTokens: maxTokens }
    };
    return this.post<any>(`/google/gemini/${model}`, body).pipe(
      map(r => r.candidates[0].content.parts[0].text)
    );
  }

  private askQwen(input: string, instructions: string, model: string, maxTokens: number): Observable<string> {
    const config = this.configService.ai.llm;
    const baseUrl = (config?.baseUrl || 'http://localhost:8010/v1').replace(/\/+$/, '');
    const url = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl}/chat/completions`;
    const body = {
      model,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: input }
      ],
      temperature: this.temperature,
      max_tokens: maxTokens,
      stream: false,
      chat_template_kwargs: { enable_thinking: false }
    };

    return this.postAbsolute<any>(url, body, config?.auth ?? 'kramerius').pipe(
      map(response => {
        const content = response?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          throw new Error('invalid_ai_response');
        }
        return content;
      })
    );
  }

  private askConfiguredQwen(input: string, instructions: string, maxTokens: number): Observable<string> {
    const model = this.configService.ai.llm?.model || 'Qwen/Qwen3.5-9B';
    return this.askQwen(input, instructions, model, maxTokens);
  }

  private translateWithQwen(input: string, targetLanguage: string, format: 'text' | 'html'): Observable<string> {
    const formatRule = format === 'html'
      ? 'Preserve all HTML elements, attributes and document structure; translate only human-readable text nodes.'
      : 'Preserve paragraph breaks and punctuation.';
    const instructions = [
      `Translate the supplied content into the language with ISO code ${targetLanguage}.`,
      formatRule,
      'Return only the translated content, without commentary, labels or Markdown code fences.'
    ].join(' ');

    return this.askConfiguredQwen(input, instructions, 2048).pipe(
      map(result => this.removeOuterCodeFence(result))
    );
  }

  private removeOuterCodeFence(value: string): string {
    const trimmed = value.trim();
    const fenced = trimmed.match(/^```(?:html|text)?\s*\n?([\s\S]*?)\n?```$/i);
    return (fenced?.[1] ?? trimmed).trim();
  }

  // --- HTTP Helper ---

  private post<T>(path: string, body: any): Observable<T> {
    return this.postAbsolute<T>(`${this.apiBaseUrl}${path}`, body, 'kramerius');
  }

  private postAbsolute<T>(url: string, body: any, authMode: AiLlmAuthMode): Observable<T> {
    const token = this.authService.getAccessToken();
    if (authMode === 'kramerius' && (!token || this.authService.isTokenExpired())) {
      // Do not start a potentially long request without a usable JWT. In
      // particular, never rely on the global interceptor to call the Kramerius
      // code-exchange endpoint as if it supported refresh tokens.
      return throwError(() => new Error('ai.error-unauthorized'));
    }

    let headers = new HttpHeaders()
      .set('X-Tai-Source', location.href)
      .set('X-Tai-Project', 'Kramerius')
      .set('Content-Type', 'application/json');
    if (authMode === 'kramerius' && token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }

    const context = new HttpContext().set(SKIP_ERROR_INTERCEPTOR, true);
    if (authMode === 'none') {
      context.set(SKIP_AUTH_INTERCEPTOR, true);
    }

    return this.http.post<T>(url, body, {
      headers,
      context,
    }).pipe(
      // The proxy reports quota exhaustion as an `errorCode` body. Some endpoints
      // send it with an error status, others with 200 — in the 200 case it would
      // otherwise flow into the per-endpoint `map()`, which expects a success
      // shape and would throw an opaque TypeError, losing the real reason. Turn
      // it into a proper error here so both paths surface the same code.
      map(response => {
        const code = (response as { errorCode?: string } | null)?.errorCode;
        if (code) {
          throw new Error(code);
        }
        return response;
      }),
      catchError(error => {
        return throwError(() => new Error(this.getErrorMessage(error)));
      })
    );
  }

  private getErrorMessage(error: any): string {
    // A structured proxy code is more specific than the HTTP status. In
    // particular quota exhaustion arrives as HTTP 429 but must remain
    // `quota_exceeded` so callers can stop retries and explain the limit.
    if (typeof error?.error?.errorCode === 'string') {
      return error.error.errorCode;
    }

    switch (error?.status) {
      case 0: return 'ai.error-network';
      case 401:
      case 403: return 'ai.error-unauthorized';
      case 405: return 'ai.error-endpoint';
      case 408:
      case 504: return 'ai.error-timeout';
      case 413: return 'ai.error-input-too-long';
      case 429: return 'ai.error-rate-limit';
      case 500:
      case 502:
      case 503: return 'ai.error-unavailable';
    }

    if (typeof error?.error?.detail === 'string') {
      return error.error.detail;
    }
    if (typeof error?.error?.error?.message === 'string') {
      return error.error.error.message;
    }
    if (error instanceof Error && !('status' in error) && error.message) {
      return error.message;
    }
    return 'ai.error-unknown';
  }
}
