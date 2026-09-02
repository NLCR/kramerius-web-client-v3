import { Injectable, inject, signal, computed } from '@angular/core';
import { AltoService, AltoTextBlock } from './alto.service';
import { AiApiService, isQuotaExceeded } from './ai-api.service';
import { DetailViewService } from '../../modules/detail-view-page/services/detail-view.service';
import { IIIFViewerService } from './iiif-viewer.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { DocumentInfoService } from './document-info.service';
import { ToastService } from './toast.service';
import { Observable, of, Subscription, throwError } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class TtsService {

  private altoService = inject(AltoService);
  private aiApiService = inject(AiApiService);
  private detailViewService = inject(DetailViewService);
  private iiifViewerService = inject(IIIFViewerService);
  private settingsService = inject(SettingsService);
  private documentInfoService = inject(DocumentInfoService);
  private toastService = inject(ToastService);

  private readonly audio: HTMLAudioElement | null = typeof Audio === 'undefined' ? null : new Audio();
  private activePageRequest: Subscription | null = null;
  private activeTtsRequest: Subscription | null = null;
  private currentAudioUrl: string | null = null;
  private audioReady = false;
  private audioUnlocked = false;
  private isPlayingBlock = false;
  /**
   * Consecutive blocks that failed to produce audio. Advancing on failure is what
   * lets reading skip an unreadable block, but without a ceiling it turns into a
   * runaway "speedrun" through blocks and pages (see issue #161).
   */
  private consecutiveFailures = 0;
  private static readonly MAX_CONSECUTIVE_FAILURES = 3;
  private static readonly PIPER_LANGUAGES = new Set(['cs', 'sk', 'pl', 'de', 'en']);

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

  // Preferred voice and language from the existing reading settings. Piper
  // accepts its own voice ids and otherwise chooses a server voice by language.
  private _voice = signal<string | null>(null);

  constructor() {
    this.audio?.addEventListener('ended', () => {
      if (!this.isPlayingBlock) return;
      this.isPlayingBlock = false;
      this.audioReady = false;
      this.cleanupBlobUrl();
      this.consecutiveFailures = 0;
      this.onBlockEnded();
    });
    this.audio?.addEventListener('error', event => {
      if (!this.isPlayingBlock) return;
      console.error('TTS audio error:', event);
      this.isPlayingBlock = false;
      this.audioReady = false;
      this.cleanupBlobUrl();
      this.onBlockFailed();
    });
  }

  // --- Public API ---

  startReading(pagePid: string, documentUuid?: string): void {
    this.stop();
    // Cleared here rather than in stop(), so the reason for an aborted run
    // survives the stop() that aborting itself performs.
    this._error.set(null);
    if (!this.audio) {
      this._error.set('ai.error-unavailable');
      this.toastService.show('ai.error-unavailable');
      return;
    }
    // This method is called from the user's click. Prime the reusable audio
    // element now so mobile browsers allow playback after the HTTP request ends.
    this.unlockAudio();
    this._currentPagePid.set(pagePid);
    this._documentUuid.set(documentUuid || null);
    this._isReading.set(true);
    this._isPaused.set(false);

    this.loadPageAndRead(pagePid);
  }

  pause(): void {
    if (this._isReading() && !this._isPaused()) {
      this.audio?.pause();
      this._isPaused.set(true);
    }
  }

  resume(): void {
    if (!this._isReading() || !this._isPaused()) return;

    this._isPaused.set(false);
    if (this.audioReady) {
      this.playLoadedAudio();
    }
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
    this.activePageRequest?.unsubscribe();
    this.activePageRequest = null;
    this.activeTtsRequest?.unsubscribe();
    this.activeTtsRequest = null;
    this.audio?.pause();
    this.audioReady = false;
    this.cleanupBlobUrl();
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

  private unlockAudio(): void {
    if (!this.audio || this.audioUnlocked) return;

    const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    this.audio.src = silentWav;
    this.audio.play().then(() => {
      this.audioUnlocked = true;
      if (!this.audioReady && this.audio?.src === silentWav) {
        this.audio.pause();
        this.audio.currentTime = 0;
      }
    }).catch(() => {
      // playLoadedAudio() will expose a blocked autoplay through the UI.
    });
  }

  private loadPageAndRead(pagePid: string): void {
    this.activePageRequest?.unsubscribe();
    this.activePageRequest = this.altoService.fetchOcrContent(pagePid, this.documentInfoService.hasAlto()).pipe(
      take(1),
      switchMap(({ text, altoXml }) => {
        const sourceBlocks = altoXml
          ? this.altoService.getBlocksForReading(altoXml)
          : this.getBlocksForPlainText(text);

        if (sourceBlocks.length === 0) {
          return of({ blocks: [] as AltoTextBlock[], language: this._detectedLanguage() || 'cs' });
        }

        // Give Qwen the complete text that will be spoken, including the
        // neighbouring blocks. Correcting each TTS fragment independently loses
        // precisely the sentence context needed to resolve ambiguous OCR glyphs.
        const transcript = sourceBlocks.map(block => block.text).join('\n');
        const knownLanguage = this._detectedLanguage();

        return this.aiApiService.correctOcrTranscript(transcript, knownLanguage || undefined).pipe(
          catchError(error => {
            if (isQuotaExceeded(error)) return throwError(() => error);
            console.warn('Page OCR correction failed; reading cleaned source text:', error);
            return of(transcript);
          }),
          switchMap(correctedTranscript => {
            const language$ = knownLanguage
              ? of(knownLanguage)
              : this.aiApiService.detectLanguage(correctedTranscript).pipe(
                  catchError(error => {
                    if (isQuotaExceeded(error)) return throwError(() => error);
                    return of('cs');
                  })
                );

            return language$.pipe(
              map(language => ({
                blocks: this.splitOversizedBlocks(
                  this.applyCorrectedTranscript(sourceBlocks, correctedTranscript)
                ),
                language,
              }))
            );
          })
        );
      })
    ).subscribe({
      next: ({ blocks, language }) => {
        this.activePageRequest = null;
        if (!this._isReading() || this._currentPagePid() !== pagePid) return;

        if (blocks.length === 0) {
          // No text on this page, try next page.
          this.advanceToNextPage();
          return;
        }

        this._detectedLanguage.set(language);
        this._blocks.set(blocks);
        this._currentBlockIndex.set(0);
        this.readCurrentBlock();
      },
      error: (err) => {
        this.activePageRequest = null;
        if (!this._isReading() || this._currentPagePid() !== pagePid) return;
        if (isQuotaExceeded(err)) {
          this.abortWithError('ai.quota-exceeded');
          return;
        }
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

    // The entire page has already been repaired by Qwen. Translate only when
    // Piper has no voice for the document language, then synthesize the block.
    this.activeTtsRequest?.unsubscribe();
    this.activeTtsRequest = this.maybeTranslate(block.text, lang, voiceLangCode).pipe(
      switchMap(text => this.aiApiService.textToSpeech(text, voiceLangCode || lang, voice)),
      take(1),
    ).subscribe({
      next: audio => {
        this.activeTtsRequest = null;
        if (!this._isReading()) return;
        this.playAudioContent(audio);
      },
      error: err => {
        this.activeTtsRequest = null;
        console.error('Piper TTS error for block:', err);
        this.onBlockFailed(err);
      },
    });
  }

  private playAudioContent(audioContent: Blob): void {
    if (!this.audio) {
      this.onBlockFailed(new Error('ai.error-unavailable'));
      return;
    }

    this.audio.pause();
    this.cleanupBlobUrl();
    this.currentAudioUrl = URL.createObjectURL(audioContent);
    this.audio.src = this.currentAudioUrl;
    this.audioReady = true;

    if (!this._isPaused()) {
      this.playLoadedAudio();
    }
  }

  private playLoadedAudio(): void {
    if (!this.audio || !this.audioReady) return;

    this.isPlayingBlock = true;
    this.audio.play().then(() => {
      if (!this.isPlayingBlock) return;
      this.audioUnlocked = true;
      this._playbackBlocked.set(false);
      this._isPaused.set(false);
      this.consecutiveFailures = 0;
    }).catch(error => {
      if (!this.isPlayingBlock) return;
      this.isPlayingBlock = false;
      if (this.isAutoplayBlocked(error)) {
        this._playbackBlocked.set(true);
        this._isPaused.set(true);
        return;
      }
      console.error('Failed to play Piper TTS audio:', error);
      this.audioReady = false;
      this.cleanupBlobUrl();
      this.onBlockFailed(error);
    });
  }

  private cleanupBlobUrl(): void {
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }
  }

  private isAutoplayBlocked(error: unknown): boolean {
    return (error as { name?: string } | null)?.name === 'NotAllowedError';
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
      const message = (err as { message?: string } | null)?.message;
      this.abortWithError(message?.startsWith('ai.') ? message : 'ai.error-unavailable');
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

  /** Keeps every request below the server-side TTS input limit. */
  private splitOversizedBlocks(blocks: AltoTextBlock[]): AltoTextBlock[] {
    const maxLength = 1000;
    const result: AltoTextBlock[] = [];

    for (const block of blocks) {
      if (block.text.length <= maxLength) {
        result.push(block);
        continue;
      }

      const words = block.text.trim().split(/\s+/).filter(Boolean);
      let chunk = '';
      const flush = (): void => {
        if (!chunk) return;
        result.push({ ...block, text: chunk });
        chunk = '';
      };

      for (const word of words) {
        if (word.length > maxLength) {
          flush();
          for (let offset = 0; offset < word.length; offset += maxLength) {
            result.push({ ...block, text: word.slice(offset, offset + maxLength) });
          }
          continue;
        }

        const candidate = chunk ? `${chunk} ${word}` : word;
        if (candidate.length > maxLength) flush();
        chunk = chunk ? `${chunk} ${word}` : word;
      }
      flush();
    }

    return result;
  }

  /**
   * Reattaches the corrected page transcript to its original ALTO blocks. The
   * conservative Qwen correction preserves all whitespace, so the newlines we
   * insert between blocks remain stable and the coordinates can still be used
   * for the reading highlight. If a future model violates that contract, keep
   * the original blocks instead of attaching text to the wrong page region.
   */
  private applyCorrectedTranscript(blocks: AltoTextBlock[], transcript: string): AltoTextBlock[] {
    const correctedBlocks = transcript.split('\n');
    if (correctedBlocks.length !== blocks.length) {
      console.warn('Corrected OCR changed block boundaries; keeping the source block layout.');
      return blocks;
    }

    return blocks.map((block, index) => ({ ...block, text: correctedBlocks[index] }));
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

  /** Chooses a Piper language, translating only when no server voice exists. */
  private resolveVoiceAndProvider(lang: string): { voice?: string; voiceLangCode?: string } {
    const override = this._voice();
    const settings = this.settingsService.settings;
    const voices = settings?.ttsVoices;
    const langEntry = voices?.find(v => v.langCode === lang);

    if (TtsService.PIPER_LANGUAGES.has(lang)) {
      return { voice: override || langEntry?.voice || undefined, voiceLangCode: lang };
    }

    const primary = voices?.find(v => v.isPrimary && TtsService.PIPER_LANGUAGES.has(v.langCode));
    if (primary) {
      return { voice: override || primary.voice || undefined, voiceLangCode: primary.langCode };
    }

    return { voice: override || undefined, voiceLangCode: 'cs' };
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
