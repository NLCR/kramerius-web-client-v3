import { Injectable, inject, signal, computed } from '@angular/core';
import { AltoService, AltoTextBlock } from './alto.service';
import { AiApiService, isQuotaExceeded } from './ai-api.service';
import { DetailViewService } from '../../modules/detail-view-page/services/detail-view.service';
import { IIIFViewerService } from './iiif-viewer.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { DocumentInfoService } from './document-info.service';
import { ToastService } from './toast.service';
import { BrowserTtsService } from './browser-tts.service';
import { Observable, of } from 'rxjs';
import { take } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class TtsService {

  private altoService = inject(AltoService);
  private aiApiService = inject(AiApiService);
  private detailViewService = inject(DetailViewService);
  private iiifViewerService = inject(IIIFViewerService);
  private settingsService = inject(SettingsService);
  private documentInfoService = inject(DocumentInfoService);
  private toastService = inject(ToastService);
  private browserTtsService = inject(BrowserTtsService);

  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private isPlayingBlock = false;
  /**
   * Consecutive blocks that failed to produce audio. Advancing on failure is what
   * lets reading skip an unreadable block, but without a ceiling it turns into a
   * runaway "speedrun" through blocks and pages (see issue #161).
   */
  private consecutiveFailures = 0;
  private static readonly MAX_CONSECUTIVE_FAILURES = 3;

  // --- State signals ---
  private _isReading = signal(false);
  private _isPaused = signal(false);
  private _currentBlockIndex = signal(-1);
  private _currentPagePid = signal<string | null>(null);
  private _blocks = signal<AltoTextBlock[]>([]);
  private _detectedLanguage = signal<string | null>(null);
  private _documentUuid = signal<string | null>(null);
  private _playbackBlocked = signal(false);
  private _error = signal<string | null>(null);

  // Public readonly signals
  readonly isReading = this._isReading.asReadonly();
  readonly isPaused = this._isPaused.asReadonly();
  readonly currentBlockIndex = this._currentBlockIndex.asReadonly();
  readonly currentPagePid = this._currentPagePid.asReadonly();
  readonly blocks = this._blocks.asReadonly();
  readonly detectedLanguage = this._detectedLanguage.asReadonly();
  /** Set when the browser refused to play audio, so the UI can prompt for a tap. */
  readonly playbackBlocked = this._playbackBlocked.asReadonly();
  /**
   * Translation key for why reading stopped, or null when it stopped normally.
   * Survives `stop()` so the message stays on screen after playback ends.
   */
  readonly error = this._error.asReadonly();

  readonly currentBlock = computed(() => {
    const blocks = this._blocks();
    const index = this._currentBlockIndex();
    return index >= 0 && index < blocks.length ? blocks[index] : null;
  });

  // Preferred system voice; an unavailable legacy cloud voice falls back to
  // the first browser voice matching the requested language.
  private _voice = signal<string | null>(null);

  // --- Public API ---

  startReading(pagePid: string, documentUuid?: string): void {
    this.stop();
    // Cleared here rather than in stop(), so the reason for an aborted run
    // survives the stop() that aborting itself performs.
    this._error.set(null);
    if (!this.browserTtsService.isSupported()) {
      this._error.set('ai.error-unavailable');
      this.toastService.show('ai.error-unavailable');
      return;
    }
    this._currentPagePid.set(pagePid);
    this._documentUuid.set(documentUuid || null);
    this._isReading.set(true);
    this._isPaused.set(false);

    this.loadPageAndRead(pagePid);
  }

  pause(): void {
    if (this._isReading() && !this._isPaused()) {
      this.browserTtsService.pause();
      this._isPaused.set(true);
    }
  }

  resume(): void {
    if (!this._isReading() || !this._isPaused()) return;

    // Resuming after a blocked autoplay: the element has no usable source yet,
    // so re-request the current block rather than playing silence.
    if (this._playbackBlocked()) {
      this._playbackBlocked.set(false);
      this._isPaused.set(false);
      this.readCurrentBlock();
      return;
    }

    this.browserTtsService.resume();
    this._isPaused.set(false);
  }

  togglePlayPause(): void {
    if (this._isPaused()) {
      this.resume();
    } else {
      this.pause();
    }
  }

  stop(): void {
    this.isPlayingBlock = false;
    this.browserTtsService.cancel(this.currentUtterance);
    this.currentUtterance = null;
    this.consecutiveFailures = 0;
    this._playbackBlocked.set(false);

    this._isReading.set(false);
    this._isPaused.set(false);
    this._currentBlockIndex.set(-1);
    this._currentPagePid.set(null);
    this._blocks.set([]);
    this._detectedLanguage.set(null);
    this._documentUuid.set(null);

    this.iiifViewerService.clearTtsHighlight();
  }

  setVoice(voice: string | null): void {
    this._voice.set(voice);
  }

  /**
   * Check if a specific page is currently being read
   */
  isReadingPage(pagePid: string): boolean {
    return this._isReading() && this._currentPagePid() === pagePid;
  }

  // --- Private methods ---

  private loadPageAndRead(pagePid: string): void {
    this.altoService.fetchOcrContent(pagePid, this.documentInfoService.hasAlto()).pipe(take(1)).subscribe({
      next: ({ text, altoXml }) => {
        const blocks = altoXml
          ? this.altoService.getBlocksForReading(altoXml)
          : this.getBlocksForPlainText(text);

        if (blocks.length === 0) {
          // No text on this page, try next page
          this.advanceToNextPage();
          return;
        }

        this._blocks.set(blocks);
        this._currentBlockIndex.set(0);

        // Detect language from first block if not already detected
        if (!this._detectedLanguage()) {
          this.aiApiService.detectLanguage(blocks[0].text).pipe(take(1)).subscribe({
            next: (lang) => {
              this._detectedLanguage.set(lang);
              this.readCurrentBlock();
            },
            error: (err) => {
              // Quota is terminal: every TTS call that follows would fail the
              // same way, so stop here rather than reading on into them.
              if (isQuotaExceeded(err)) {
                this.abortWithError('ai.quota-exceeded');
                return;
              }
              // Default to Czech if detection fails for any other reason
              this._detectedLanguage.set('cs');
              this.readCurrentBlock();
            }
          });
        } else {
          this.readCurrentBlock();
        }
      },
      error: (err) => {
        console.error('Failed to fetch OCR text for TTS:', err);
        // Try next page on error
        this.advanceToNextPage();
      }
    });
  }

  private readCurrentBlock(): void {
    if (!this._isReading()) return;

    const blocks = this._blocks();
    const index = this._currentBlockIndex();

    if (index < 0 || index >= blocks.length) {
      // All blocks on this page are done, advance to next page
      this.advanceToNextPage();
      return;
    }

    const block = blocks[index];
    const lang = this._detectedLanguage() || 'cs';
    const { voice, voiceLangCode } = this.resolveVoiceAndProvider(lang);

    // Plain OCR has no page coordinates, so highlighting is only possible for ALTO.
    if (block.width > 0 && block.height > 0) {
      this.iiifViewerService.showTtsHighlight(block);
    } else {
      this.iiifViewerService.clearTtsHighlight();
    }

    // Translation/detection uses Qwen; audio is generated locally by the browser.
    this.maybeTranslate(block.text, lang, voiceLangCode).pipe(take(1)).subscribe({
      next: text => {
        if (!this._isReading()) return;
        this.speakText(text, voiceLangCode || lang, voice);
      },
      error: err => {
        console.error('TTS text preparation failed:', err);
        this.onBlockFailed(err);
      }
    });
  }

  private speakText(text: string, language: string, voice?: string): void {
    this.isPlayingBlock = true;
    let utterance: SpeechSynthesisUtterance | null = null;
    utterance = this.browserTtsService.speak(text, language, voice, {
      onStart: () => {
        if (this.currentUtterance !== utterance) return;
        this._playbackBlocked.set(false);
        this.consecutiveFailures = 0;
      },
      onEnd: () => {
        if (!this.isPlayingBlock || this.currentUtterance !== utterance) return;
        this.isPlayingBlock = false;
        this.currentUtterance = null;
        this.consecutiveFailures = 0;
        this.onBlockEnded();
      },
      onError: error => {
        if (!this.isPlayingBlock || this.currentUtterance !== utterance) return;
        this.isPlayingBlock = false;
        this.currentUtterance = null;
        if (error === 'not-allowed') {
          this._playbackBlocked.set(true);
          this._isPaused.set(true);
          return;
        }
        console.error('Browser TTS error:', error);
        this.onBlockFailed();
      }
    });
    this.currentUtterance = utterance;
    if (!utterance) {
      this.isPlayingBlock = false;
      this.onBlockFailed();
    }
  }

  /**
   * Stops reading and records why, for errors that will not recover on retry.
   * Quota exhaustion is the motivating case: every further block would spend
   * another failed call to reach the same answer, so abort the whole run at the
   * first one and tell the user instead of skipping blocks silently.
   */
  private abortWithError(messageKey: string): void {
    this.stop();
    this._error.set(messageKey);
    // Reading is driven from the viewer as often as from the AI panel, and the
    // transport controls vanish with `isReading`. A toast is the one surface the
    // user sees either way, so the run never just stops without explanation.
    this.toastService.show(messageKey);
  }

  /**
   * A block produced no audio. Skipping one bad block is fine, but a run of them
   * means something systemic is wrong, so stop instead of racing to the end.
   *
   * `err` is inspected for terminal conditions (quota) that must abort at once
   * rather than burn through the failure ceiling.
   */
  private onBlockFailed(err?: unknown): void {
    if (!this._isReading()) return;

    if (isQuotaExceeded(err)) {
      this.abortWithError('ai.quota-exceeded');
      return;
    }

    this.consecutiveFailures++;
    if (this.consecutiveFailures >= TtsService.MAX_CONSECUTIVE_FAILURES) {
      console.error(`TTS: stopping after ${this.consecutiveFailures} consecutive failures`);
      this.stop();
      return;
    }

    this.onBlockEnded();
  }

  private onBlockEnded(): void {
    if (!this._isReading()) return;

    const blocks = this._blocks();
    const nextIndex = this._currentBlockIndex() + 1;

    if (nextIndex < blocks.length) {
      // Move to next block on same page
      this._currentBlockIndex.set(nextIndex);
      this.readCurrentBlock();
    } else {
      // All blocks done, advance to next page
      this.advanceToNextPage();
    }
  }

  private advanceToNextPage(): void {
    if (!this._isReading()) return;

    const pages = this.detailViewService.pages;
    const currentPid = this._currentPagePid();
    const currentIndex = pages.findIndex(p => p.pid === currentPid);

    if (currentIndex >= 0 && currentIndex < pages.length - 1) {
      const nextPage = pages[currentIndex + 1];
      this._currentPagePid.set(nextPage.pid);
      this._currentBlockIndex.set(-1);
      this._blocks.set([]);
      // Navigate the viewer to the next page
      this.detailViewService.goToPage(currentIndex + 1);

      // Load OCR for the next page and continue reading
      // Small delay to let the page navigation settle
      setTimeout(() => {
        this.loadPageAndRead(nextPage.pid);
      }, 500);
    } else {
      // No more pages, stop reading
      this.stop();
    }
  }

  /** Splits a plain OCR transcript into reasonably sized TTS requests. */
  private getBlocksForPlainText(text: string): AltoTextBlock[] {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const chunks: string[] = [];
    let currentWords: string[] = [];
    let currentLength = 0;

    const flush = (): void => {
      if (currentWords.length === 0) return;
      chunks.push(currentWords.join(' '));
      currentWords = [];
      currentLength = 0;
    };

    for (const word of words) {
      const nextLength = currentLength + (currentWords.length > 0 ? 1 : 0) + word.length;
      if (currentWords.length > 0 && nextLength > 600) {
        flush();
      }

      currentWords.push(word);
      currentLength += (currentWords.length > 1 ? 1 : 0) + word.length;

      if (currentLength >= 180 && /[.!?;:]$/.test(word)) {
        flush();
      }
    }
    flush();

    return chunks.map(chunk => ({
      text: chunk,
      hMin: 0,
      hMax: 0,
      vMin: 0,
      vMax: 0,
      width: 0,
      height: 0
    }));
  }

  /**
   * Resolves the preferred system voice based on settings.
   * 1. If user set a voice via _voice signal, use it.
   * 2. If settings have a voice for the detected language, use that entry.
   * 3. Otherwise prefer an installed voice for the detected language.
   * 4. If none exists, fall back to the primary configured voice.
   * 5. Finally let the browser choose its default voice.
   *
   * Also returns voiceLangCode — the language the voice entry is configured for.
   * When voiceLangCode differs from the detected document language, the text
   * should be translated before TTS.
   */
  private resolveVoiceAndProvider(lang: string): { voice?: string; voiceLangCode?: string } {
    // Explicit override takes priority
    const override = this._voice();
    if (override) return { voice: override };

    const settings = this.settingsService.settings;
    const voices = settings?.ttsVoices;
    if (!voices?.length) return {};

    // Look for exact language match
    const langEntry = voices.find(v => v.langCode === lang && v.voice);
    if (langEntry) return { voice: langEntry.voice, voiceLangCode: langEntry.langCode };

    // Prefer reading the source as-is with a system voice in its own language.
    // Only translate to the primary configured language when the device has no
    // matching voice at all.
    const systemVoice = this.browserTtsService.voicesForLanguage(lang)[0];
    if (systemVoice) return { voice: systemVoice.name, voiceLangCode: lang };

    // Fall back to primary voice
    const primary = voices.find(v => v.isPrimary && v.voice);
    if (primary) return { voice: primary.voice, voiceLangCode: primary.langCode };

    return {};
  }

  /**
   * Returns an Observable that translates text if the document language
   * differs from the voice entry language, or passes text through as-is.
   */
  private maybeTranslate(text: string, documentLang: string, voiceLangCode?: string): Observable<string> {
    if (!voiceLangCode || documentLang === voiceLangCode) {
      return of(text);
    }
    return this.aiApiService.translate(text, voiceLangCode);
  }
}
