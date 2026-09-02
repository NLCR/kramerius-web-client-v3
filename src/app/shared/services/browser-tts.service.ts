import { Injectable, signal } from '@angular/core';

export interface BrowserSpeechHandlers {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

const LOCALE_MAP: Record<string, string> = {
  cs: 'cs-CZ', sk: 'sk-SK', pl: 'pl-PL', en: 'en-US', de: 'de-DE',
  fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-PT', ru: 'ru-RU',
  uk: 'uk-UA', hu: 'hu-HU', ro: 'ro-RO', nl: 'nl-NL', sv: 'sv-SE',
  da: 'da-DK', nb: 'nb-NO', fi: 'fi-FI', ja: 'ja-JP', zh: 'zh-CN',
  ko: 'ko-KR', ar: 'ar-SA', hi: 'hi-IN', tr: 'tr-TR', el: 'el-GR',
  bg: 'bg-BG', hr: 'hr-HR', sr: 'sr-RS', sl: 'sl-SI', lt: 'lt-LT',
  lv: 'lv-LV', et: 'et-EE',
};

/**
 * Local text-to-speech backed by the browser/operating system. It deliberately
 * performs no HTTP request, so reading cannot leak OCR text to an external TTS
 * provider and does not depend on Kramerius or Trinera authentication.
 */
@Injectable({ providedIn: 'root' })
export class BrowserTtsService {
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private readonly _voices = signal<SpeechSynthesisVoice[]>([]);

  readonly voices = this._voices.asReadonly();

  constructor() {
    this.refreshVoices();
    const synthesis = this.synthesis;
    if (synthesis) {
      synthesis.addEventListener('voiceschanged', () => this.refreshVoices());
    }
  }

  isSupported(): boolean {
    return this.synthesis !== null && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  speak(
    text: string,
    language: string,
    preferredVoice: string | undefined,
    handlers: BrowserSpeechHandlers = {},
  ): SpeechSynthesisUtterance | null {
    const synthesis = this.synthesis;
    if (!synthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      return null;
    }

    this.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.toLocale(language);
    utterance.voice = this.resolveVoice(language, preferredVoice);
    utterance.onstart = () => {
      if (this.currentUtterance === utterance) handlers.onStart?.();
    };
    utterance.onend = () => {
      if (this.currentUtterance !== utterance) return;
      this.currentUtterance = null;
      handlers.onEnd?.();
    };
    utterance.onerror = event => {
      if (this.currentUtterance !== utterance) return;
      this.currentUtterance = null;
      handlers.onError?.(event.error || 'speech-error');
    };

    this.currentUtterance = utterance;
    try {
      synthesis.speak(utterance);
    } catch {
      this.currentUtterance = null;
      return null;
    }
    return utterance;
  }

  pause(): void {
    this.synthesis?.pause();
  }

  resume(): void {
    this.synthesis?.resume();
  }

  cancel(utterance?: SpeechSynthesisUtterance | null): void {
    if (utterance && this.currentUtterance !== utterance) return;
    if (this.currentUtterance) {
      this.currentUtterance.onstart = null;
      this.currentUtterance.onend = null;
      this.currentUtterance.onerror = null;
      this.currentUtterance = null;
    }
    this.synthesis?.cancel();
  }

  voicesForLanguage(language: string): SpeechSynthesisVoice[] {
    // Reading the signal makes components that call this from templates update
    // when Chrome/Safari publishes their asynchronous voice list.
    const voices = this._voices();
    const locale = this.toLocale(language).toLowerCase();
    const languageCode = locale.split('-')[0];
    const exact = voices.filter(voice => voice.lang.toLowerCase() === locale);
    return exact.length > 0
      ? exact
      : voices.filter(voice => voice.lang.toLowerCase().split('-')[0] === languageCode);
  }

  private resolveVoice(language: string, preferredVoice?: string): SpeechSynthesisVoice | null {
    const voices = this._voices();
    if (preferredVoice) {
      const preferred = preferredVoice.toLowerCase();
      const match = voices.find(voice =>
        voice.name.toLowerCase() === preferred || voice.voiceURI.toLowerCase() === preferred
      );
      if (match) return match;
    }
    return this.voicesForLanguage(language)[0] ?? null;
  }

  private refreshVoices(): void {
    this._voices.set(this.synthesis?.getVoices() ?? []);
  }

  private toLocale(language: string): string {
    if (language.includes('-')) return language;
    return LOCALE_MAP[language.toLowerCase()] || language;
  }

  private get synthesis(): SpeechSynthesis | null {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
      ? window.speechSynthesis
      : null;
  }
}
