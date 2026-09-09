import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { AltoService } from './alto.service';
import { AiApiService, AiModel, TranslateProvider, isQuotaExceeded } from './ai-api.service';
import { LocalStorageService } from './local-storage.service';
import { DocumentInfoService } from './document-info.service';
import { TranslateService } from '@ngx-translate/core';
import { TRANSLATION_LANGUAGES } from '../translation/translation-languages';
import { Subscription, from, of } from 'rxjs';
import { take, concatMap, map, catchError, takeWhile } from 'rxjs/operators';
import { selectBookSummaryPageIndices } from '../utils/book-summary-sampling';

const AI_PANEL_FONT_SIZE_KEY = 'ai-panel-font-size';
const DEFAULT_FONT_SIZE = 16;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 28;
const SUMMARY_MAX_TOKENS = 600;
const BOOK_SUMMARY_MAX_TOKENS = 1000;

/**
 * The AI proxy's local vLLM instance (Qwen3.5-9B, fp16, Tesla V100S 32GB) has a
 * shared KV-cache pool of ~68,640 tokens across every concurrent request, not
 * reserved per call - so a whole-book summary must only ever claim a small
 * slice of it. A budget derived from that figure via a generic chars-per-token
 * estimate (~16,000 tokens) still got HTTP 413 (payload too large) in
 * production; the request-size limit in front of the model is stricter than
 * the raw token math suggests, likely because Czech OCR text with diacritics
 * encodes to more bytes per character than the estimate assumed. This value
 * was found by testing directly against the production endpoint and keeps a
 * wide margin below the last size that failed.
 */
const BOOK_SUMMARY_TOKEN_BUDGET = 6000;
const BOOK_SUMMARY_INSTRUCTIONS_TOKEN_RESERVE = 400;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const BOOK_SUMMARY_INPUT_CHAR_BUDGET =
  (BOOK_SUMMARY_TOKEN_BUDGET - BOOK_SUMMARY_MAX_TOKENS - BOOK_SUMMARY_INSTRUCTIONS_TOKEN_RESERVE) * CHARS_PER_TOKEN_ESTIMATE;
// Deliberately low so enough candidate pages are sampled to fill the budget
// even on a book with sparse OCR text per page; real pages exceeding it just
// get trimmed or dropped once the running total hits BOOK_SUMMARY_INPUT_CHAR_BUDGET.
const ASSUMED_CHARS_PER_PAGE = 1200;

export type AiPanelContentType = 'translation' | 'summary' | 'text' | 'corrected-text' | 'book-summary' | null;
export type AiPanelMode = 'split' | 'ai-only';

@Injectable({ providedIn: 'root' })
export class AiPanelService {

  private altoService = inject(AltoService);
  private aiApiService = inject(AiApiService);
  private localStorageService = inject(LocalStorageService);
  private documentInfoService = inject(DocumentInfoService);
  private translate = inject(TranslateService);
  private activeSubscription: Subscription | null = null;

  constructor() {
    effect(() => {
      this.localStorageService.set(AI_PANEL_FONT_SIZE_KEY, this.fontSize());
    });
  }

  // --- State ---
  readonly panelVisible = signal(false);
  readonly panelMode = signal<AiPanelMode>('ai-only');
  readonly contentType = signal<AiPanelContentType>(null);
  readonly content = signal<string>('');
  readonly styledHtml = signal<string>('');
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);

  // UI state
  readonly showOriginal = signal(true);
  readonly fontSize = signal(this.loadFontSize());
  readonly currentPagePid = signal<string | null>(null);
  /** Page pids the current whole-book summary was built from, kept for resummarizeBook(). */
  readonly currentBookPagePids = signal<string[] | null>(null);

  // Settings
  readonly selectedModel = signal<AiModel>(this.aiApiService.getDefaultModel());
  readonly translateProvider = signal<TranslateProvider>('google');
  readonly targetLanguage = signal<string>('cs');
  /**
   * Language the summary is produced in. Defaults to the UI language, since a
   * summary in a language the reader does not know is of no use (issue #161).
   */
  readonly summaryLanguage = signal<string>(this.defaultSummaryLanguage());

  // Computed: panel mode driven by showOriginal toggle
  readonly effectivePanelMode = computed<AiPanelMode>(() =>
    this.showOriginal() ? 'split' : 'ai-only'
  );

  // --- Actions ---

  showTranslation(pagePid: string, targetLang?: string): void {
    const lang = targetLang || this.targetLanguage();
    const isReload = this.panelVisible() && this.contentType() === 'translation';
    this.cancelPending();
    this.panelVisible.set(true);
    if (!isReload) {
      this.panelMode.set(this.showOriginal() ? 'split' : 'ai-only');
    }
    this.contentType.set('translation');
    this.content.set('');
    this.isLoading.set(true);
    this.error.set(null);
    this.currentPagePid.set(pagePid);

    this.activeSubscription = this.altoService.fetchOcrContent(pagePid, this.documentInfoService.hasAlto()).pipe(take(1)).subscribe({
      next: ({ text, altoXml }) => {
        if (!text) {
          this.isLoading.set(false);
          this.error.set('ai.text-transcript-unavailable');
          return;
        }

        // Translate styled HTML to preserve formatting
        const html = altoXml ? this.altoService.getStyledHtml(altoXml) : '';
        const inputToTranslate = html || text;
        const format = html ? 'html' as const : 'text' as const;

        this.activeSubscription = this.aiApiService.translate(inputToTranslate, lang, this.translateProvider(), format).pipe(take(1)).subscribe({
          next: (translated) => {
            if (format === 'html') {
              this.styledHtml.set(translated);
              this.content.set('');
            } else {
              this.styledHtml.set('');
              this.content.set(translated);
            }
            this.isLoading.set(false);
          },
          error: (err) => {
            this.isLoading.set(false);
            this.error.set(this.describeError(err, 'Translation failed'));
          }
        });
      },
      error: () => {
        this.isLoading.set(false);
        this.error.set('ai.text-transcript-unavailable');
      }
    });
  }

  showSummary(pagePid: string): void {
    const isReload = this.panelVisible() && this.contentType() === 'summary';
    this.cancelPending();
    this.panelVisible.set(true);
    if (!isReload) {
      this.panelMode.set(this.showOriginal() ? 'split' : 'ai-only');
    }
    this.contentType.set('summary');
    this.content.set('');
    this.isLoading.set(true);
    this.error.set(null);
    this.currentPagePid.set(pagePid);

    this.activeSubscription = this.altoService.fetchOcrContent(pagePid, this.documentInfoService.hasAlto()).pipe(take(1)).subscribe({
      next: ({ text }) => {
        if (!text) {
          this.isLoading.set(false);
          this.error.set('ai.text-transcript-unavailable');
          return;
        }

        const instructions = this.buildSummaryInstructions(this.summaryLanguage());
        this.activeSubscription = this.aiApiService.askLLM(text, instructions, this.selectedModel(), SUMMARY_MAX_TOKENS).pipe(take(1)).subscribe({
          next: (summary) => {
            this.styledHtml.set('');
            this.content.set(summary);
            this.isLoading.set(false);
          },
          error: (err) => {
            this.isLoading.set(false);
            this.error.set(this.describeError(err, 'Summary failed'));
          }
        });
      },
      error: () => {
        this.isLoading.set(false);
        this.error.set('ai.text-transcript-unavailable');
      }
    });
  }

  /**
   * Summarizes a whole book from a sample of its pages rather than every page's
   * OCR text, which would not fit a single request's token budget. See
   * `selectBookSummaryPageIndices` for the sampling strategy.
   */
  showBookSummary(pagePids: string[]): void {
    const isReload = this.panelVisible() && this.contentType() === 'book-summary';
    this.cancelPending();
    this.panelVisible.set(true);
    if (!isReload) {
      this.panelMode.set(this.showOriginal() ? 'split' : 'ai-only');
    }
    this.contentType.set('book-summary');
    this.content.set('');
    this.styledHtml.set('');
    this.isLoading.set(true);
    this.error.set(null);
    this.currentPagePid.set(null);
    this.currentBookPagePids.set(pagePids);

    if (pagePids.length === 0) {
      this.isLoading.set(false);
      this.error.set('ai.text-transcript-unavailable');
      return;
    }

    const pageBudget = Math.max(1, Math.round(BOOK_SUMMARY_INPUT_CHAR_BUDGET / ASSUMED_CHARS_PER_PAGE));
    const samplePids = selectBookSummaryPageIndices(pagePids.length, pageBudget).map(i => pagePids[i]);

    // Collected sequentially (not fetched at once) so a page missing OCR can be
    // skipped without failing the whole request, and fetching stops as soon as
    // the char budget is filled instead of always requesting every sampled page.
    let usedChars = 0;
    const excerpts: string[] = [];

    this.activeSubscription = from(samplePids).pipe(
      concatMap(pid => this.altoService.fetchOcrContent(pid, true).pipe(
        map(({ text }) => text || ''),
        catchError(() => of(''))
      )),
      map(text => {
        const remaining = BOOK_SUMMARY_INPUT_CHAR_BUDGET - usedChars;
        const trimmed = remaining > 0 ? text.trim().slice(0, remaining) : '';
        if (trimmed) {
          excerpts.push(trimmed);
          usedChars += trimmed.length;
        }
        return usedChars < BOOK_SUMMARY_INPUT_CHAR_BUDGET;
      }),
      takeWhile(canContinue => canContinue, true)
    ).subscribe({
      error: () => {
        this.isLoading.set(false);
        this.error.set('ai.text-transcript-unavailable');
      },
      complete: () => {
        const input = excerpts.join('\n\n');
        if (!input) {
          this.isLoading.set(false);
          this.error.set('ai.text-transcript-unavailable');
          return;
        }

        const instructions = this.buildBookSummaryInstructions(this.summaryLanguage());
        this.activeSubscription = this.aiApiService.askLLM(input, instructions, this.selectedModel(), BOOK_SUMMARY_MAX_TOKENS).pipe(take(1)).subscribe({
          next: (summary) => {
            this.styledHtml.set('');
            this.content.set(summary);
            this.isLoading.set(false);
          },
          error: (err) => {
            this.isLoading.set(false);
            this.error.set(this.describeError(err, 'Book summary failed'));
          }
        });
      }
    });
  }

  showCorrectedTranscript(pagePid: string): void {
    const isReload = this.panelVisible() && this.contentType() === 'corrected-text';
    this.cancelPending();
    this.panelVisible.set(true);
    if (!isReload) {
      this.panelMode.set(this.showOriginal() ? 'split' : 'ai-only');
    }
    this.contentType.set('corrected-text');
    this.content.set('');
    this.styledHtml.set('');
    this.isLoading.set(true);
    this.error.set(null);
    this.currentPagePid.set(pagePid);

    this.activeSubscription = this.altoService.fetchOcrContent(pagePid, this.documentInfoService.hasAlto()).pipe(take(1)).subscribe({
      next: ({ text }) => {
        if (!text) {
          this.isLoading.set(false);
          this.error.set('ai.text-transcript-unavailable');
          return;
        }

        this.activeSubscription = this.aiApiService.correctOcrTranscript(text).pipe(take(1)).subscribe({
          next: corrected => {
            this.content.set(corrected);
            this.isLoading.set(false);
          },
          error: err => {
            this.isLoading.set(false);
            this.error.set(this.describeError(err, 'OCR correction failed'));
          }
        });
      },
      error: () => {
        this.isLoading.set(false);
        this.error.set('ai.text-transcript-unavailable');
      }
    });
  }

  showText(text: string, pagePid?: string): void {
    this.cancelPending();
    this.panelVisible.set(true);
    this.showOriginal.set(true);
    this.panelMode.set('split');
    this.contentType.set('text');
    this.styledHtml.set('');
    this.content.set(text);
    this.isLoading.set(false);
    this.error.set(null);
    if (pagePid) this.currentPagePid.set(pagePid);
  }

  showPageText(pagePid: string): void {
    this.cancelPending();
    this.panelVisible.set(true);
    this.showOriginal.set(true);
    this.panelMode.set('split');
    this.contentType.set('text');
    this.content.set('');
    this.styledHtml.set('');
    this.isLoading.set(true);
    this.error.set(null);
    this.currentPagePid.set(pagePid);

    this.activeSubscription = this.altoService.fetchOcrContent(pagePid, this.documentInfoService.hasAlto()).pipe(take(1)).subscribe({
      next: ({ text, altoXml }) => {
        this.isLoading.set(false);
        if (!text) {
          this.error.set('ai.text-transcript-unavailable');
          return;
        }
        const html = altoXml ? this.altoService.getStyledHtml(altoXml) : '';
        if (html) {
          this.styledHtml.set(html);
        } else {
          this.content.set(text);
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.error.set('ai.text-transcript-unavailable');
      }
    });
  }

  resummarize(language: string): void {
    const pid = this.currentPagePid();
    if (!pid) return;
    this.summaryLanguage.set(language);
    this.showSummary(pid);
  }

  resummarizeBook(language: string): void {
    const pids = this.currentBookPagePids();
    if (!pids || pids.length === 0) return;
    this.summaryLanguage.set(language);
    this.showBookSummary(pids);
  }

  /**
   * Names the target language for the model. The language is identified by both
   * its endonym and its code, so the model has an unambiguous target without a
   * separate English-name table to keep in sync. Falls back to the original
   * language, which is the previous behaviour.
   */
  /**
   * Human-readable text for a failed AI call.
   *
   * Quota exhaustion gets a localized explanation — it is an expected, recurring
   * state the user can act on (wait for the monthly reset), not a glitch. Other
   * failures keep the previous behaviour of showing the raw error message.
   */
  private describeError(err: unknown, fallback: string): string {
    if (isQuotaExceeded(err)) {
      return this.translate.instant('ai.quota-exceeded');
    }
    return (err as { message?: string } | null)?.message || fallback;
  }

  private buildSummaryInstructions(languageCode: string): string {
    const language = TRANSLATION_LANGUAGES.find(l => l.code === languageCode);
    const target = language
      ? `Write the summary in ${language.name} (language code: ${language.code}), regardless of the language of the source text.`
      : 'Keep the summary in the same language as the original text.';
    return [
      'You are a helpful assistant. Summarize the following text concisely.',
      'The source is an OCR transcription and may contain substituted characters, broken words, missing accents or encoding artifacts.',
      'Infer the intended reading from context and silently account for obvious OCR errors, but do not invent information or modernize historical wording.',
      target
    ].join(' ');
  }

  /** Like buildSummaryInstructions, but for a set of sampled excerpts rather than one page. */
  private buildBookSummaryInstructions(languageCode: string): string {
    const language = TRANSLATION_LANGUAGES.find(l => l.code === languageCode);
    const target = language
      ? `Write the summary in ${language.name} (language code: ${language.code}), regardless of the language of the source text.`
      : 'Keep the summary in the same language as the original text.';
    return [
      'You are a helpful assistant. The following text is a set of excerpts sampled from the beginning, middle and end of a book, not its full text - there are gaps between the excerpts.',
      'Based only on these excerpts, write a coherent overall summary of the whole book: its main topic or storyline, how it develops, and how it concludes.',
      'Write it as a normal summary of the book. Do not mention that the excerpts are partial or point out the gaps between them.',
      'The source is an OCR transcription and may contain substituted characters, broken words, missing accents or encoding artifacts.',
      'Infer the intended reading from context and silently account for obvious OCR errors, but do not invent information or modernize historical wording.',
      target
    ].join(' ');
  }

  /** The UI language when it is one we can ask for, otherwise Czech. */
  private defaultSummaryLanguage(): string {
    const uiLang = this.translate.getCurrentLang() || this.translate.getDefaultLang() || '';
    return TRANSLATION_LANGUAGES.some(l => l.code === uiLang) ? uiLang : 'cs';
  }

  retranslate(targetLang: string): void {
    const pid = this.currentPagePid();
    if (!pid) return;
    this.targetLanguage.set(targetLang);
    this.showTranslation(pid, targetLang);
  }

  close(): void {
    this.cancelPending();
    this.panelVisible.set(false);
    this.panelMode.set('ai-only');
    this.showOriginal.set(true);
    this.contentType.set(null);
    this.content.set('');
    this.styledHtml.set('');
    this.isLoading.set(false);
    this.error.set(null);
    this.currentPagePid.set(null);
    this.currentBookPagePids.set(null);
  }

  toggleOriginal(): void {
    const show = !this.showOriginal();
    this.showOriginal.set(show);
    this.panelMode.set(show ? 'split' : 'ai-only');
  }

  increaseFontSize(): void {
    const current = this.fontSize();
    if (current < MAX_FONT_SIZE) this.fontSize.set(current + 2);
  }

  decreaseFontSize(): void {
    const current = this.fontSize();
    if (current > MIN_FONT_SIZE) this.fontSize.set(current - 2);
  }

  private loadFontSize(): number {
    const saved = this.localStorageService.get<number>(AI_PANEL_FONT_SIZE_KEY);
    if (typeof saved === 'number' && saved >= MIN_FONT_SIZE && saved <= MAX_FONT_SIZE) {
      return saved;
    }
    return DEFAULT_FONT_SIZE;
  }

  private cancelPending(): void {
    if (this.activeSubscription) {
      this.activeSubscription.unsubscribe();
      this.activeSubscription = null;
    }
  }
}
