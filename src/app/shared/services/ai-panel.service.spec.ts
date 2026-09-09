import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { AiPanelService } from './ai-panel.service';
import { AltoService } from './alto.service';
import { AiApiService } from './ai-api.service';
import { LocalStorageService } from './local-storage.service';
import { DocumentInfoService } from './document-info.service';

/**
 * Issue #161: the summary was always produced in the language of the original
 * text, which is useless to a reader who does not know that language, and the
 * old client offered a language choice that this one dropped.
 */
describe('AiPanelService summary language', () => {
  let service: AiPanelService;
  let askLLM: jasmine.Spy;
  let correctOcrTranscript: jasmine.Spy;
  let fetchOcrContent: jasmine.Spy;
  let currentLang: string;

  /** Instructions passed to the model on the most recent summary request. */
  const lastInstructions = () => askLLM.calls.mostRecent().args[1] as string;

  function configure(uiLang: string): AiPanelService {
    currentLang = uiLang;
    askLLM = jasmine.createSpy('askLLM').and.returnValue(of('a summary'));
    correctOcrTranscript = jasmine.createSpy('correctOcrTranscript')
      .and.returnValue(of('some corrected page text'));
    fetchOcrContent = jasmine.createSpy('fetchOcrContent')
      .and.returnValue(of({ text: 'some page text', altoXml: '<alto/>' }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AiPanelService,
        { provide: AltoService, useValue: {
          fetchOcrContent,
          getStyledHtml: () => '',
        } },
        { provide: AiApiService, useValue: {
          askLLM,
          correctOcrTranscript,
          translate: () => of(''),
          getDefaultModel: () => ({ provider: 'openai', name: 'GPT 4o mini', code: 'gpt-4o-mini' }),
        } },
        { provide: LocalStorageService, useValue: { get: () => null, set: () => {} } },
        { provide: DocumentInfoService, useValue: { hasAlto: () => true } },
        { provide: TranslateService, useValue: {
          getCurrentLang: () => currentLang,
          getDefaultLang: () => 'cs',
        } },
      ],
    });
    return TestBed.inject(AiPanelService);
  }

  it('defaults the summary language to the UI language', () => {
    service = configure('en');
    expect(service.summaryLanguage()).toBe('en');
  });

  it('falls back to Czech when the UI language is not a supported target', () => {
    service = configure('xx');
    expect(service.summaryLanguage()).toBe('cs');
  });

  it('asks the model for the summary in the selected language', () => {
    service = configure('en');
    service.showSummary('uuid:page-1');

    expect(lastInstructions()).toContain('English');
    expect(lastInstructions()).toContain('en');
  });

  it('limits concise summaries so the local model cannot generate 2000 tokens', () => {
    service = configure('cs');
    service.showSummary('uuid:page-1');

    expect(askLLM.calls.mostRecent().args[3]).toBe(600);
  });

  it('tells the summarizer to interpret OCR substitutions without inventing content', () => {
    service = configure('cs');
    service.showSummary('uuid:page-1');

    expect(lastInstructions()).toContain('substituted characters');
    expect(lastInstructions()).toContain('silently account for obvious OCR errors');
    expect(lastInstructions()).toContain('do not invent information');
  });

  it('no longer pins the summary to the language of the original', () => {
    service = configure('en');
    service.showSummary('uuid:page-1');

    expect(lastInstructions()).not.toContain('same language as the original');
  });

  it('re-runs the summary when a different language is picked', () => {
    service = configure('cs');
    service.showSummary('uuid:page-1');
    const before = askLLM.calls.count();

    service.resummarize('de');

    expect(service.summaryLanguage()).toBe('de');
    expect(askLLM.calls.count()).toBeGreaterThan(before);
    expect(lastInstructions()).toContain('Deutsch');
  });

  it('ignores a language change when no page is open', () => {
    service = configure('cs');
    const before = askLLM.calls.count();

    service.resummarize('de');

    expect(askLLM.calls.count()).toBe(before);
  });

  it('keeps the chosen summary language after the panel is closed', () => {
    service = configure('cs');
    service.showSummary('uuid:page-1');
    service.resummarize('fr');

    service.close();

    expect(service.summaryLanguage()).toBe('fr');
  });

  it('keeps summary and translation languages independent', () => {
    service = configure('cs');
    service.showSummary('uuid:page-1');

    service.resummarize('de');

    // Picking a summary language must not silently retarget translation.
    expect(service.targetLanguage()).toBe('cs');
    expect(service.summaryLanguage()).toBe('de');
  });

  it('loads the transcript again after the panel is closed and reopened', () => {
    service = configure('cs');

    service.showPageText('uuid:page-1');
    expect(service.content()).toBe('some page text');

    service.close();
    service.showPageText('uuid:page-1');

    expect(service.error()).toBeNull();
    expect(service.content()).toBe('some page text');
    expect(fetchOcrContent).toHaveBeenCalledTimes(2);
  });

  it('shows a conservatively corrected page transcript as a separate panel type', () => {
    service = configure('cs');

    service.showCorrectedTranscript('uuid:page-1');

    expect(fetchOcrContent).toHaveBeenCalledWith('uuid:page-1', true);
    expect(correctOcrTranscript).toHaveBeenCalledWith('some page text');
    expect(service.contentType()).toBe('corrected-text');
    expect(service.content()).toBe('some corrected page text');
    expect(service.error()).toBeNull();
    expect(service.isLoading()).toBeFalse();
  });

  describe('whole-book summary', () => {
    it('summarizes a sample of pages in a single model call', () => {
      service = configure('cs');
      const pids = Array.from({ length: 10 }, (_, i) => `uuid:page-${i}`);

      service.showBookSummary(pids);

      expect(fetchOcrContent).toHaveBeenCalledWith('uuid:page-0', true);
      expect(askLLM).toHaveBeenCalledTimes(1);
      expect(askLLM.calls.mostRecent().args[3]).toBe(1000);
      expect(service.contentType()).toBe('book-summary');
      expect(service.content()).toBe('a summary');
      expect(service.error()).toBeNull();
    });

    it('tells the model the excerpts are a partial, sampled selection', () => {
      service = configure('cs');

      service.showBookSummary(['uuid:page-0', 'uuid:page-1', 'uuid:page-2']);

      expect(lastInstructions()).toContain('excerpts sampled from the beginning, middle and end of a book');
      expect(lastInstructions()).toContain('do not invent information');
    });

    it('re-runs the book summary when a different language is picked', () => {
      service = configure('cs');
      const pids = ['uuid:page-0', 'uuid:page-1', 'uuid:page-2'];
      service.showBookSummary(pids);
      const before = askLLM.calls.count();

      service.resummarizeBook('de');

      expect(service.summaryLanguage()).toBe('de');
      expect(askLLM.calls.count()).toBeGreaterThan(before);
      expect(lastInstructions()).toContain('Deutsch');
    });

    it('ignores a book-summary language change when no book is open', () => {
      service = configure('cs');
      const before = askLLM.calls.count();

      service.resummarizeBook('de');

      expect(askLLM.calls.count()).toBe(before);
    });

    it('reports an error instead of calling the model when no pages are given', () => {
      service = configure('cs');

      service.showBookSummary([]);

      expect(askLLM).not.toHaveBeenCalled();
      expect(service.error()).toBe('ai.text-transcript-unavailable');
    });
  });

});
