import { Injectable, inject, signal, computed } from '@angular/core';
import { AltoService, AltoTextBlock } from './alto.service';
import { AiApiService, TtsProvider } from './ai-api.service';
import { DetailViewService } from '../../modules/detail-view-page/services/detail-view.service';
import { IIIFViewerService } from './iiif-viewer.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { DocumentInfoService } from './document-info.service';
import { Observable, of } from 'rxjs';
import { take, switchMap } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class TtsService {

  private altoService = inject(AltoService);
  private aiApiService = inject(AiApiService);
  private detailViewService = inject(DetailViewService);
  private iiifViewerService = inject(IIIFViewerService);
  private settingsService = inject(SettingsService);
  private documentInfoService = inject(DocumentInfoService);

  private audio = new Audio();
  private prefetchedAudio: string | null = null;
  private prefetchingBlockIndex = -1;
  private destroyed = false;
  private isPlayingBlock = false;

  // --- State signals ---
  private _isReading = signal(false);
  private _isPaused = signal(false);
  private _currentBlockIndex = signal(-1);
  private _currentPagePid = signal<string | null>(null);
  private _blocks = signal<AltoTextBlock[]>([]);
  private _detectedLanguage = signal<string | null>(null);
  private _documentUuid = signal<string | null>(null);

  // Public readonly signals
  readonly isReading = this._isReading.asReadonly();
  readonly isPaused = this._isPaused.asReadonly();
  readonly currentBlockIndex = this._currentBlockIndex.asReadonly();
  readonly currentPagePid = this._currentPagePid.asReadonly();
  readonly blocks = this._blocks.asReadonly();
  readonly detectedLanguage = this._detectedLanguage.asReadonly();

  readonly currentBlock = computed(() => {
    const blocks = this._blocks();
    const index = this._currentBlockIndex();
    return index >= 0 && index < blocks.length ? blocks[index] : null;
  });

  // TTS settings
  private _provider = signal<TtsProvider>('google');
  private _voice = signal<string | null>(null);

  constructor() {
    this.audio.addEventListener('ended', () => {
      if (this.isPlayingBlock) {
        this.isPlayingBlock = false;
        this.onBlockEnded();
      }
    });
    this.audio.addEventListener('error', (e) => {
      console.error('TTS audio error:', e);
      if (this.isPlayingBlock) {
        this.isPlayingBlock = false;
        this.onBlockEnded();
      }
    });
  }

  // --- Public API ---

  startReading(pagePid: string, documentUuid?: string): void {
    this.stop();
    this._currentPagePid.set(pagePid);
    this._documentUuid.set(documentUuid || null);
    this._isReading.set(true);
    this._isPaused.set(false);

    this.loadPageAndRead(pagePid);
  }

  pause(): void {
    if (this._isReading() && !this._isPaused()) {
      this.audio.pause();
      this._isPaused.set(true);
    }
  }

  resume(): void {
    if (this._isReading() && this._isPaused()) {
      this.audio.play();
      this._isPaused.set(false);
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
    this.audio.pause();
    this.cleanupBlobUrl();
    this.prefetchedAudio = null;
    this.prefetchingBlockIndex = -1;

    this._isReading.set(false);
    this._isPaused.set(false);
    this._currentBlockIndex.set(-1);
    this._currentPagePid.set(null);
    this._blocks.set([]);
    this._detectedLanguage.set(null);
    this._documentUuid.set(null);

    this.iiifViewerService.clearTtsHighlight();
  }

  setProvider(provider: TtsProvider): void {
    this._provider.set(provider);
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
            error: () => {
              // Default to Czech if detection fails
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
    const { voice, provider, voiceLangCode } = this.resolveVoiceAndProvider(lang);

    // Plain OCR has no page coordinates, so highlighting is only possible for ALTO.
    if (block.width > 0 && block.height > 0) {
      this.iiifViewerService.showTtsHighlight(block);
    } else {
      this.iiifViewerService.clearTtsHighlight();
    }

    // Check if we have prefetched audio for this block
    if (this.prefetchedAudio && this.prefetchingBlockIndex === index) {
      this.playAudioContent(this.prefetchedAudio);
      this.prefetchedAudio = null;
      this.prefetchingBlockIndex = -1;
      // Prefetch next block
      this.prefetchNextBlock();
      return;
    }

    // Request TTS for current block (translate first if languages differ)
    this.maybeTranslate(block.text, lang, voiceLangCode).pipe(
      switchMap(text => this.aiApiService.textToSpeech(text, voiceLangCode || lang, provider, voice)),
      take(1)
    ).subscribe({
        next: (audioContent) => {
          if (!this._isReading()) return;
          this.playAudioContent(audioContent);
          // Start prefetching next block
          this.prefetchNextBlock();
        },
        error: (err) => {
          console.error('TTS error for block:', err);
          // Skip to next block on error
          this.onBlockEnded();
        }
      });
  }

  private prefetchNextBlock(): void {
    const blocks = this._blocks();
    const nextIndex = this._currentBlockIndex() + 1;

    if (nextIndex >= blocks.length) return; // No more blocks to prefetch

    const nextBlock = blocks[nextIndex];
    const lang = this._detectedLanguage() || 'cs';
    const { voice, provider, voiceLangCode } = this.resolveVoiceAndProvider(lang);

    this.prefetchingBlockIndex = nextIndex;
    this.maybeTranslate(nextBlock.text, lang, voiceLangCode).pipe(
      switchMap(text => this.aiApiService.textToSpeech(text, voiceLangCode || lang, provider, voice)),
      take(1)
    ).subscribe({
        next: (audioContent) => {
          if (this.prefetchingBlockIndex === nextIndex) {
            this.prefetchedAudio = audioContent;
          }
        },
        error: () => {
          // Prefetch failure is not critical
          this.prefetchedAudio = null;
        }
      });
  }

  private playAudioContent(audioContent: string): void {
    this.cleanupBlobUrl();
    this.isPlayingBlock = false;

    // audioContent is base64 encoded
    const binaryString = atob(audioContent);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);

    this.audio.src = url;
    this.isPlayingBlock = true;
    this.audio.play().catch(err => {
      console.error('Failed to play TTS audio:', err);
      // play() rejection — don't advance here, the 'error' event handler will handle it
      // But if there's no error event (e.g. autoplay policy), we need to stop
      if (this.isPlayingBlock) {
        this.isPlayingBlock = false;
        this.onBlockEnded();
      }
    });
  }

  private cleanupBlobUrl(): void {
    if (this.audio.src && this.audio.src.startsWith('blob:')) {
      URL.revokeObjectURL(this.audio.src);
    }
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
      this.prefetchedAudio = null;
      this.prefetchingBlockIndex = -1;

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
   * Resolves the voice + provider to use for TTS based on settings.
   * 1. If user set a voice via _voice signal, use that with current provider
   * 2. If settings have a voice for the detected language, use that entry's voice + provider
   * 3. If settings have a primary voice, use that entry's voice + provider
   * 4. Fall back to undefined (API default)
   *
   * Also returns voiceLangCode — the language the voice entry is configured for.
   * When voiceLangCode differs from the detected document language, the text
   * should be translated before TTS.
   */
  private resolveVoiceAndProvider(lang: string): { voice?: string; provider: TtsProvider; voiceLangCode?: string } {
    // Explicit override takes priority
    const override = this._voice();
    if (override) return { voice: override, provider: this._provider() };

    const settings = this.settingsService.settings;
    const voices = settings?.ttsVoices;
    if (!voices?.length) return { provider: this._provider() };

    // Look for exact language match
    const langEntry = voices.find(v => v.langCode === lang && v.voice);
    if (langEntry) return { voice: langEntry.voice, provider: langEntry.provider || this._provider(), voiceLangCode: langEntry.langCode };

    // Fall back to primary voice
    const primary = voices.find(v => v.isPrimary && v.voice);
    if (primary) return { voice: primary.voice, provider: primary.provider || this._provider(), voiceLangCode: primary.langCode };

    return { provider: this._provider() };
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
