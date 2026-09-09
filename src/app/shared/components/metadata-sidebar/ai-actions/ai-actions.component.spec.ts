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
