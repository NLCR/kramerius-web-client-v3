import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AiActionsComponent } from './ai-actions.component';
import { TtsService } from '../../../services/tts.service';
import { AiPanelService } from '../../../services/ai-panel.service';
import { DetailViewService } from '../../../../modules/detail-view-page/services/detail-view.service';
import { UserService } from '../../../services/user.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { SettingsService } from '../../../../modules/settings/settings.service';
import { DocumentInfoService } from '../../../services/document-info.service';
import { ConfigService } from '../../../../core/config/config.service';

describe('AiActionsComponent corrected transcript', () => {
  it('offers the corrected page transcript and opens it for the current page', () => {
    const showCorrectedTranscript = jasmine.createSpy('showCorrectedTranscript');
    TestBed.configureTestingModule({
      imports: [AiActionsComponent, TranslateModule.forRoot()],
      providers: [
        { provide: TtsService, useValue: { isReading: () => false } },
        { provide: AiPanelService, useValue: {
          contentType: () => null,
          showCorrectedTranscript,
        } },
        { provide: DetailViewService, useValue: { currentPagePid: 'uuid:page-1', totalPagesOnly: 1 } },
        { provide: UserService, useValue: { isLoggedIn: true } },
        { provide: AuthService, useValue: {} },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: SettingsService, useValue: { openSettingsDialog: () => {} } },
        { provide: DocumentInfoService, useValue: {
          hasAlto: () => true,
          hasOcrText: () => true,
          getRuntimeLicenses: () => [],
        } },
        { provide: ConfigService, useValue: { getLicenseConfig: () => null } },
      ]
    });

    const fixture = TestBed.createComponent(AiActionsComponent);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('.ai-actions__item') as NodeListOf<HTMLButtonElement>;

    // A single-page document has no separate "whole book" action.
    expect(buttons.length).toBe(4);
    expect(buttons[3].textContent).toContain('ai.correct-transcript');
    buttons[3].click();
    expect(showCorrectedTranscript).toHaveBeenCalledOnceWith('uuid:page-1');
  });
});

describe('AiActionsComponent whole-book summary', () => {
  it('offers a whole-book summary only for a multi-page document, over all its pages', () => {
    const showBookSummary = jasmine.createSpy('showBookSummary');
    TestBed.configureTestingModule({
      imports: [AiActionsComponent, TranslateModule.forRoot()],
      providers: [
        { provide: TtsService, useValue: { isReading: () => false } },
        { provide: AiPanelService, useValue: {
          contentType: () => null,
          showBookSummary,
        } },
        { provide: DetailViewService, useValue: {
          currentPagePid: 'uuid:page-1',
          totalPagesOnly: 2,
          pagesOnly: [{ pid: 'uuid:page-1' }, { pid: 'uuid:page-2' }],
        } },
        { provide: UserService, useValue: { isLoggedIn: true } },
        { provide: AuthService, useValue: {} },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: SettingsService, useValue: { openSettingsDialog: () => {} } },
        { provide: DocumentInfoService, useValue: {
          hasAlto: () => true,
          hasOcrText: () => true,
          getRuntimeLicenses: () => [],
        } },
        { provide: ConfigService, useValue: { getLicenseConfig: () => null } },
      ]
    });

    const fixture = TestBed.createComponent(AiActionsComponent);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('.ai-actions__item') as NodeListOf<HTMLButtonElement>;

    expect(buttons.length).toBe(5);
    expect(buttons[3].textContent).toContain('ai.summarize-book');
    buttons[3].click();
    expect(showBookSummary).toHaveBeenCalledOnceWith(['uuid:page-1', 'uuid:page-2']);
  });
});

/**
 * Read-aloud, translation and summarisation need the page's words, not their
 * coordinates, and `AltoService` falls back to `/ocr/text` when a page has no
 * ALTO. Gating them on ALTO alone therefore disabled them on pages whose text
 * was available all along — the NKP copy of a CDK document being a real case.
 */
describe('AiActionsComponent OCR availability', () => {
  function setup(ocr: { alto: boolean; text: boolean }, textAllowed = true) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: TtsService, useValue: {} },
        { provide: AiPanelService, useValue: {} },
        { provide: DetailViewService, useValue: {} },
        { provide: UserService, useValue: { isLoggedIn: true } },
        { provide: AuthService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: Router, useValue: { url: '/view/x' } },
        {
          provide: DocumentInfoService,
          useValue: { hasAlto: () => ocr.alto, hasOcrText: () => ocr.text, getRuntimeLicenses: () => [] },
        },
        {
          provide: ConfigService,
          useValue: { getLicenseConfig: () => ({ actions: { text: textAllowed } }) },
        },
      ],
    });
    return TestBed.runInInjectionContext(() => new AiActionsComponent());
  }

  it('enables the actions when the page has ALTO', () => {
    expect(setup({ alto: true, text: true }).actionsDisabled).toBe(false);
  });

  it('enables the actions on a page with OCR text but no ALTO', () => {
    expect(setup({ alto: false, text: true }).actionsDisabled).toBe(false);
  });

  it('disables the actions when the page has no OCR at all', () => {
    expect(setup({ alto: false, text: false }).actionsDisabled).toBe(true);
  });

  it('still defers to the licence when text is forbidden', () => {
    const c = setup({ alto: true, text: true }, false);
    // getRuntimeLicenses() returns [] above, so give it one to evaluate.
    (c as any).documentInfoService.getRuntimeLicenses = () => ['dnnto'];
    expect(c.actionsDisabled).toBe(true);
  });
});
