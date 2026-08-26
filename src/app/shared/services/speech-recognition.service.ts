import {computed, inject, Injectable, NgZone, signal} from '@angular/core';
import {Observable, Subject} from 'rxjs';
import {AppTranslationService} from '../translation/app-translation.service';
import {ToastService} from './toast.service';

// SpeechRecognitionErrorEvent.error values that are worth telling the user about.
// 'aborted' is excluded: it fires on our own stop()/abort() calls, not a real failure.
const SPEECH_ERROR_MESSAGE_KEYS: Record<string, string> = {
  'not-allowed': 'voice-input-error-not-allowed',
  'service-not-allowed': 'voice-input-error-not-allowed',
  'audio-capture': 'voice-input-error-no-mic',
  'no-speech': 'voice-input-error-no-speech',
  'network': 'voice-input-error-network',
};

const LANG_TO_SPEECH_LOCALE: Record<string, string> = {
  sk: 'sk-SK',
  cs: 'cs-CZ',
  en: 'en-US',
  pl: 'pl-PL',
};

@Injectable({
  providedIn: 'root'
})
export class SpeechRecognitionService {

  private translationService = inject(AppTranslationService);
  private toastService = inject(ToastService);
  private zone = inject(NgZone);
  private recognition: any = null;
  private result$ = new Subject<string>();

  isListening = signal(false);

  private speechLang = computed(() => {
    const code = this.translationService.currentLanguage().code;
    return LANG_TO_SPEECH_LOCALE[code] ?? 'en-US';
  });

  get isSupported(): boolean {
    return !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition;
  }

  start(): Observable<string> {
    if (!this.isSupported) {
      console.warn('Speech Recognition API is not supported in this browser.');
      return this.result$.asObservable();
    }

    if (this.isListening()) {
      this.stop();
      return this.result$.asObservable();
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();
    this.recognition = recognition;

    recognition.lang = this.speechLang();
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    const cleanup = () => {
      this.zone.run(() => {
        recognition.onresult = null;
        recognition.onaudioend = null;
        recognition.onend = null;
        recognition.onerror = null;
        recognition.onspeechend = null;
        if (this.recognition === recognition) {
          this.recognition = null;
        }
        this.isListening.set(false);
      });
    };

    recognition.onresult = (event: any) => {
      const transcript: string = event.results[0][0].transcript;
      this.zone.run(() => this.result$.next(transcript));
      // Explicitly stop after getting result — ensures Safari fires onend and releases mic
      recognition.stop();
    };

    recognition.onspeechend = () => {
      recognition.stop();
    };

    recognition.onend = cleanup;
    recognition.onerror = (event: any) => {
      cleanup();
      // Without this, a denied mic permission or transient failure looks
      // identical to "nothing happened" — the mic just silently stops listening.
      const messageKey = SPEECH_ERROR_MESSAGE_KEYS[event?.error];
      if (messageKey) {
        this.zone.run(() => this.toastService.show(messageKey, null, 5000));
      }
    };

    this.isListening.set(true);
    recognition.start();

    return this.result$.asObservable();
  }

  stop() {
    if (this.recognition) {
      const recognition = this.recognition;
      this.recognition = null;
      recognition.onresult = null;
      recognition.onaudioend = null;
      recognition.onspeechend = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      this.isListening.set(false);
    }
  }

  toggle(): Observable<string> {
    if (this.isListening()) {
      this.stop();
    } else {
      this.start();
    }
    return this.result$.asObservable();
  }
}
