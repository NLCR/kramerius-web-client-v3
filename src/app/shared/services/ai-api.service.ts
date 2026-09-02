import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpContext } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { AuthService } from '../../core/auth/auth.service';
import { ConfigService } from '../../core/config/config.service';
import { AiLlmAuthMode } from '../../core/config/config.interfaces';
import { SKIP_ERROR_INTERCEPTOR } from '../../core/services/http-context-tokens';

export interface AiModel {
  provider: 'openai' | 'anthropic' | 'google' | 'qwen';
  name: string;
  code: string;
}

export type TtsProvider = 'openai' | 'google' | 'elevenlabs';
export type TranslateProvider = 'google' | 'deepl';

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
    return (this.configService.ai.apiBaseUrl || 'https://api.trinera.cloud/api').replace(/\/+$/, '');
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

  // --- TTS ---

  elevenLabsTTS(text: string, voice: string): Observable<string> {
    const body = { model_id: 'eleven_multilingual_v2', text };
    return this.post<{ audioContent: string }>(`/elevenlabs/tts/${voice}`, body).pipe(
      map(r => r.audioContent)
    );
  }

  openAiTTS(text: string, voice: string): Observable<string> {
    const body = { model: 'tts-1', voice, input: text };
    return this.post<{ audioContent: string }>('/openai/tts', body).pipe(
      map(r => r.audioContent)
    );
  }

  googleTTS(text: string, voice: string, language: string): Observable<string> {
    const body = {
      audioConfig: {
        audioEncoding: 'MP3',
        effectsProfileId: ['small-bluetooth-speaker-class-device'],
        pitch: 0,
        speakingRate: 1
      },
      input: { text: text.toLocaleLowerCase() },
      voice: { languageCode: language, name: voice }
    };
    return this.post<{ audioContent: string }>('/google/tts', body).pipe(
      map(r => r.audioContent)
    );
  }

  textToSpeech(text: string, language: string, provider: TtsProvider = 'google', voice?: string): Observable<string> {
    switch (provider) {
      case 'elevenlabs':
        return this.elevenLabsTTS(text, voice || 'EXAVITQu4vr4xnSDxMaL');
      case 'openai':
        return this.openAiTTS(text, voice || 'alloy');
      case 'google':
      default: {
        // Google TTS requires full locale codes (e.g. cs-CZ, en-US, sk-SK, pl-PL)
        const locale = this.toGoogleLocale(language);
        return this.googleTTS(text, voice || `${locale}-Standard-A`, locale);
      }
    }
  }

  // --- Translation ---

  translateWithGoogle(input: string, targetLanguage: string, format: 'text' | 'html' = 'text'): Observable<string> {
    const body = { q: [input], target: targetLanguage, format };
    return this.post<any>('/google/translate', body).pipe(
      map(r => r.data.translations[0].translatedText)
    );
  }

  translateWithDeepL(input: string, targetLanguage: string, tagHandling?: 'html'): Observable<string> {
    const body: any = { text: [input], target_lang: targetLanguage };
    if (tagHandling) body.tag_handling = tagHandling;
    return this.post<any>('/deepl/translate', body).pipe(
      map(r => r.translations[0].text)
    );
  }

  translate(input: string, targetLanguage: string, provider: TranslateProvider = 'google', format: 'text' | 'html' = 'text'): Observable<string> {
    if (provider === 'deepl') {
      return this.translateWithDeepL(input, targetLanguage, format === 'html' ? 'html' : undefined);
    }
    return this.translateWithGoogle(input, targetLanguage, format);
  }

  // --- Language Detection ---

  detectLanguage(input: string): Observable<string> {
    const body = { q: input };
    return this.post<any>('/google/translate/detect', body).pipe(
      map(r => r.data.detections[0][0].language)
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

  // --- Locale Helper ---

  private static readonly LOCALE_MAP: Record<string, string> = {
    cs: 'cs-CZ', sk: 'sk-SK', pl: 'pl-PL', en: 'en-US', de: 'de-DE',
    fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-PT', ru: 'ru-RU',
    uk: 'uk-UA', hu: 'hu-HU', ro: 'ro-RO', nl: 'nl-NL', sv: 'sv-SE',
    da: 'da-DK', nb: 'nb-NO', fi: 'fi-FI', ja: 'ja-JP', zh: 'zh-CN',
    ko: 'ko-KR', ar: 'ar-XA', hi: 'hi-IN', tr: 'tr-TR', el: 'el-GR',
    bg: 'bg-BG', hr: 'hr-HR', sr: 'sr-RS', sl: 'sl-SI', lt: 'lt-LT',
    lv: 'lv-LV', et: 'et-EE',
  };

  private toGoogleLocale(lang: string): string {
    return AiApiService.LOCALE_MAP[lang] || `${lang}-${lang.toUpperCase()}`;
  }

  // --- HTTP Helper ---

  private post<T>(path: string, body: any): Observable<T> {
    return this.postAbsolute<T>(`${this.apiBaseUrl}${path}`, body, 'kramerius');
  }

  private postAbsolute<T>(url: string, body: any, authMode: AiLlmAuthMode): Observable<T> {
    const token = this.authService.getAccessToken();
    if (authMode === 'kramerius' && !token) {
      return throwError(() => new Error('ai.error-unauthorized'));
    }

    let headers = new HttpHeaders()
      .set('X-Tai-Source', location.href)
      .set('X-Tai-Project', 'Kramerius')
      .set('Content-Type', 'application/json');
    // Do not manually forward a token that is already expired. The global
    // interceptor will refresh it after the endpoint's 401 and retry once.
    if (authMode === 'kramerius' && token && !this.authService.isTokenExpired()) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }

    return this.http.post<T>(url, body, {
      headers,
      context: new HttpContext().set(SKIP_ERROR_INTERCEPTOR, true)
    }).pipe(
      catchError(error => {
        return throwError(() => new Error(this.getErrorMessage(error)));
      })
    );
  }

  private getErrorMessage(error: any): string {
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

    if (typeof error?.error?.errorCode === 'string') {
      return error.error.errorCode;
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
