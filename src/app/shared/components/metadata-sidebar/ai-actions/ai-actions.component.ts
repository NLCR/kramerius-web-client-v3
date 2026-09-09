import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { TtsService } from '../../../services/tts.service';
import { AiPanelService } from '../../../services/ai-panel.service';
import { DetailViewService } from '../../../../modules/detail-view-page/services/detail-view.service';
import { UserService } from '../../../services/user.service';
import { SettingsService } from '../../../../modules/settings/settings.service';
import { DocumentInfoService } from '../../../services/document-info.service';
import { ConfigService } from '../../../../core/config/config.service';
import { CdkTooltipDirective } from '../../../directives';

@Component({
  selector: 'app-ai-actions',
  standalone: true,
  imports: [TranslatePipe, CdkTooltipDirective],
  templateUrl: './ai-actions.component.html',
  styleUrl: './ai-actions.component.scss'
})
export class AiActionsComponent {

  ttsService = inject(TtsService);
  aiPanelService = inject(AiPanelService);
  private detailViewService = inject(DetailViewService);
  userService = inject(UserService);
  private router = inject(Router);
  private settingsService = inject(SettingsService);
  documentInfoService = inject(DocumentInfoService);
  private configService = inject(ConfigService);

  get ocrAvailable(): boolean {
    return this.documentInfoService.hasAlto() || this.documentInfoService.hasOcrText();
  }

  get textActionAllowed(): boolean {
    const licenses = this.documentInfoService.getRuntimeLicenses();
    if (!licenses || licenses.length === 0) {
      return true;
    }
    return licenses.some(licenseId => {
      const config = this.configService.getLicenseConfig(licenseId);
      return config?.actions?.text === true;
    });
  }

  get actionsDisabled(): boolean {
    return !this.ocrAvailable || !this.textActionAllowed;
  }

  /** Whole-book summary only makes sense with more than the one page already covered by "Summarize". */
  get hasMultiplePages(): boolean {
    return this.detailViewService.totalPagesOnly > 1;
  }

  /**
   * Explains why the actions are greyed out (GitHub issue #109) — otherwise
   * a logged-in reader has no way to tell "no OCR" apart from "not allowed
   * by this license".
   */
  get actionsDisabledReason(): string | null {
    if (!this.ocrAvailable) return 'ai.disabled-no-ocr-tooltip';
    if (!this.textActionAllowed) return 'ai.disabled-license-tooltip';
    return null;
  }

  openReadingSettings(event: Event): void {
    event.stopPropagation();
    this.settingsService.openSettingsDialog('reading');
  }

  login(): void {
    // Same flow as the header's login button: go through the terms/GDPR
    // consent page first, and carry the full router URL (incl. ?page=) so the
    // reader returns to the exact page they were on, not the document's first
    // page (see GitHub issue #164).
    const returnUrl = this.router.url;
    this.router.navigate(['pages/terms'], { queryParams: { returnUrl } });
  }

  onRead(): void {
    if (!this.userService.isLoggedIn || this.actionsDisabled) return;
    const pid = this.detailViewService.currentPagePid;
    if (!pid) return;

    if (this.ttsService.isReading()) {
      this.ttsService.stop();
    } else {
      this.ttsService.startReading(pid, this.detailViewService.document?.uuid);
    }
  }

  onTranslate(): void {
    if (!this.userService.isLoggedIn || this.actionsDisabled) return;
    const pid = this.detailViewService.currentPagePid;
    if (!pid) return;
    this.aiPanelService.showTranslation(pid);
  }

  onSummarize(): void {
    if (!this.userService.isLoggedIn || this.actionsDisabled) return;
    const pid = this.detailViewService.currentPagePid;
    if (!pid) return;
    this.aiPanelService.showSummary(pid);
  }

  onSummarizeBook(): void {
    if (!this.userService.isLoggedIn || this.actionsDisabled) return;
    const pids = this.detailViewService.pagesOnly.map(p => p.pid);
    if (pids.length === 0) return;
    this.aiPanelService.showBookSummary(pids);
  }

  onCorrectTranscript(): void {
    if (!this.userService.isLoggedIn || this.actionsDisabled) return;
    const pid = this.detailViewService.currentPagePid;
    if (!pid) return;
    this.aiPanelService.showCorrectedTranscript(pid);
  }
}
