import { Component, computed, inject, Input, OnDestroy, OnInit, signal } from '@angular/core';
import {
  ExportDocumentSectionItemComponent
} from '../export-document-section-item-component/export-document-section-item-component';
import { ExportService } from '../../../services/export.service';
import { IIIFViewerService } from '../../../services/iiif-viewer.service';
import { Subscription, take } from 'rxjs';
import { DocumentInfoService } from '../../../services/document-info.service';
import { MatDialog } from '@angular/material/dialog';
import { DetailViewService } from '../../../../modules/detail-view-page/services/detail-view.service';
import { PageSelectionDialogComponent, PageSelectionDialogResult } from '../../../dialogs/page-selection-dialog/page-selection-dialog.component';
import { EmailExportDialogComponent, EmailExportType } from '../../../dialogs/email-export-dialog/email-export-dialog.component';
import { LoginPromptDialogComponent } from '../../../dialogs/login-prompt-dialog/login-prompt-dialog.component';
import { AuthService } from '../../../../core/auth/auth.service';
import { Router } from '@angular/router';
import { ToastService } from '../../../services/toast.service';
import { AppConfigService } from '../../../services/app-config.service';
import { ConfigService } from '../../../../core/config';
import { PdfService } from '../../../services/pdf.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { UserService } from '../../../services/user.service';
import { Page } from '../../../models/page.model';
import { LicenseActionsConfig } from '../../../../core/config/config.interfaces';

@Component({
  selector: 'app-export-document-section-component',
  imports: [
    ExportDocumentSectionItemComponent,
  ],
  templateUrl: './export-document-section-component.html',
  styleUrl: './export-document-section-component.scss',
})
export class ExportDocumentSectionComponent implements OnInit, OnDestroy {

  @Input() pagePid: string | null = null;

  exportService = inject(ExportService);
  iiifViewerService = inject(IIIFViewerService);
  documentInfoService = inject(DocumentInfoService);
  dialog = inject(MatDialog);
  detailViewService = inject(DetailViewService);
  appConfig = inject(AppConfigService);
  configService = inject(ConfigService);
  pdfService = inject(PdfService);
  userService = inject(UserService);
  toastService = inject(ToastService);
  authService = inject(AuthService);
  router = inject(Router);

  iiifBookMode = toSignal(this.iiifViewerService.bookMode$, { initialValue: false });
  pdfProperties = toSignal(this.pdfService.properties$, { initialValue: this.pdfService.pdfProperties });

  selectedJpegOption: string | null = null;
  pdfLoading = signal(false);
  expandedSection = signal<string | null>('print');
  private cropSubscription?: Subscription;
  private selectionModeSubscription?: Subscription;
  private activeCropSession = false;

  ngOnInit(): void {
    this.selectionModeSubscription = this.iiifViewerService.isSelectionMode$.subscribe(isSelectionMode => {
      if (!isSelectionMode) {
        this.activeCropSession = false;
      }
    });

    this.cropSubscription = this.iiifViewerService.selectedArea$.subscribe(rect => {
      if (rect && this.activeCropSession && this.pagePid) {
        this.exportService.exportJpegCrop(this.pagePid, rect);
        this.iiifViewerService.setSelectionMode(false);
        this.activeCropSession = false;
        this.selectedJpegOption = 'current-page';

        setTimeout(() => this.iiifViewerService.clearSelectedArea(), 0);
      }
    });
  }

  /**
   * Get filtered pages that have exportable licenses
   */
  private getExportablePages(action: keyof LicenseActionsConfig): Page[] {
    const pages = this.detailViewService.pages;
    if (!pages) return [];
    return pages.filter(page => this.exportService.hasExportableLicense(page, action));
  }

  private getEffectiveDocumentLicenses(): string[] {
    return Array.from(new Set([
      ...(this.detailViewService.document?.licences ?? []),
      ...this.documentInfoService.getRuntimeLicenses(),
    ]));
  }

  private isActionAllowed(action: keyof LicenseActionsConfig): boolean {
    return this.configService.isLicenseActionAllowed(this.getEffectiveDocumentLicenses(), action);
  }

  pdfAllowed = computed(() => this.isActionAllowed('pdf'));
  printAllowed = computed(() => this.isActionAllowed('print'));
  jpegAllowed = computed(() => this.isActionAllowed('jpeg'));
  cropAllowed = computed(() =>
    this.jpegAllowed() && this.isActionAllowed('selection') && this.isActionAllowed('crop'));
  textAllowed = computed(() => this.isActionAllowed('text'));

  // Computed signal that updates jpegOptions based on license access
  jpegOptions = computed(() => {
    const canAccess = this.documentInfoService.canAccessDocument();

    // Check if we are in book mode (either IIIF or PDF)
    const isIiifBookMode = this.iiifBookMode();
    const isPdfBookMode = this.pdfProperties()?.bookMode;
    const isBookMode = isIiifBookMode || isPdfBookMode;

    if (isBookMode) {
      const pages = this.detailViewService.pages;
      const currentIndex = this.detailViewService.currentPageIndex;

      // Check if left and right pages exist
      const leftPage = pages && pages[currentIndex];
      const rightPage = pages && pages[currentIndex + 1];

      const options = [];

      if (leftPage) {
        const hasLicense = this.exportService.hasExportableLicense(leftPage, 'jpeg');
        options.push({ label: 'current-left-page', value: 'current-left-page', disabled: !canAccess || !hasLicense });
      }

      if (rightPage) {
        const hasLicense = this.exportService.hasExportableLicense(rightPage, 'jpeg');
        options.push({ label: 'current-right-page', value: 'current-right-page', disabled: !canAccess || !hasLicense });
      }

      // For crop, use left page license
      const hasLicense = leftPage
        ? this.exportService.hasExportableLicense(leftPage, 'jpeg') && this.exportService.hasExportableLicense(leftPage, 'crop')
        : false;
      options.push({ label: 'crop-page', value: 'crop-page', disabled: !canAccess || !hasLicense || !this.cropAllowed() });

      return options;
    } else {
      // Find current page by pagePid
      const currentPage = this.detailViewService.pages?.find(p => p.pid === this.pagePid);
      const hasLicense = this.exportService.hasExportableLicense(currentPage, 'jpeg');
      const hasCropLicense = this.exportService.hasExportableLicense(currentPage, 'crop');

      return [
        { label: 'current-page', value: 'current-page', disabled: !canAccess || !hasLicense },
        { label: 'crop-page', value: 'crop-page', disabled: !canAccess || !hasLicense || !hasCropLicense }
      ];
    }
  });

  isLoggedIn = computed(() => !!this.userService.userSession$()?.authenticated);

  // Per-format visibility driven by the instance's export config (config-main.json).
  printEnabled = this.configService.isExportFormatEnabled('print');
  jpegEnabled = this.configService.isExportFormatEnabled('jpeg');
  pdfEnabled = this.configService.isExportFormatEnabled('pdf');
  epubEnabled = this.configService.isExportFormatEnabled('epub');
  txtEnabled = this.configService.isExportFormatEnabled('txt');

  epubOptions = computed(() => {
    const hasPages = this.detailViewService.pages?.length > 0;
    return [
      { label: 'whole-document', value: 'whole-document', disabled: !hasPages },
      // { label: 'select-pages', value: 'select-pages', disabled: !hasPages },
    ];
  });

  textOptions = computed(() => {
    const hasPages = this.detailViewService.pages?.length > 0;
    return [
      { label: 'whole-document', value: 'whole-document', disabled: !hasPages },
      // { label: 'select-pages', value: 'select-pages', disabled: !hasPages },
    ];
  });

  pdfOptions = computed(() => {
    // For PDF documents the file is downloaded directly, so only offer the
    // whole-document option ("Celý dokument").
    if (this.detailViewService.isPdf) {
      return [
        { label: 'whole-document', value: 'whole-document', disabled: !this.pdfAllowed() },
      ];
    }

    const pages = this.detailViewService.pages;
    const exportablePages = this.getExportablePages('pdf');
    const hasExportablePages = exportablePages.length > 0;

    // Disable select pages if no exportable pages
    const disableSelectPages = !hasExportablePages;

    const pagesLoaded = !!pages;

    return [
      { label: 'select-pages', value: 'select-pages', disabled: disableSelectPages },
      { label: 'whole-document', value: 'whole-document', disabled: !pagesLoaded || !this.pdfAllowed() },
    ];
  });

  printOptions = computed(() => {
    const pages = this.detailViewService.pages;
    const maxRange = this.appConfig.pdfMaxRange();
    const exportablePages = this.getExportablePages('print');
    const hasExportablePages = exportablePages.length > 0;

    const currentPagePid = this.detailViewService.currentPagePid;
    const currentPage = pages?.find(p => p.pid === currentPagePid);
    const currentPageHasLicense = this.exportService.hasExportableLicense(currentPage, 'print');

    // Disable whole document if:
    // 1. Total pages exceed maxRange OR
    // 2. No exportable pages OR
    // 3. Exportable pages exceed maxRange
    const disableWholeDocument =
      !hasExportablePages ||
      (pages && pages.length > maxRange) ||
      exportablePages.length > maxRange;

    // Disable select pages if no exportable pages
    const disableSelectPages = !hasExportablePages;

    return [
      { label: 'current-page', value: 'current-page', disabled: !currentPageHasLicense },
      { label: 'whole-document', value: 'whole-document', disabled: disableWholeDocument },
      { label: 'select-pages', value: 'select-pages', disabled: disableSelectPages }
    ];
  });

  onJpegOptionChange(value: string) {
    this.selectedJpegOption = value;
    if (value === 'crop-page') {
      this.activeCropSession = true;
      this.iiifViewerService.setSelectionMode(true);
    } else {
      this.activeCropSession = false;
      this.iiifViewerService.setSelectionMode(false);
    }
  }

  onJpegSubmit(value: string) {
    if (!this.jpegAllowed() || (value === 'crop-page' && !this.cropAllowed())) return;
    if (value === 'current-page' && this.pagePid) {
      this.exportService.exportJpeg(this.pagePid);
    } else if (value === 'current-left-page') {
      const pages = this.detailViewService.pages;
      const currentIndex = this.detailViewService.currentPageIndex;
      const leftPage = pages[currentIndex];
      if (leftPage) {
        this.exportService.exportJpeg(leftPage.pid);
      }
    } else if (value === 'current-right-page') {
      const pages = this.detailViewService.pages;
      const currentIndex = this.detailViewService.currentPageIndex;
      const rightPage = pages[currentIndex + 1];
      if (rightPage) {
        this.exportService.exportJpeg(rightPage.pid);
      }
    } else if (value === 'crop-page' && this.pagePid) {
      this.iiifViewerService.selectedArea$.pipe(take(1)).subscribe(rect => {
        if (rect) {
          this.exportService.exportJpegCrop(this.pagePid!, rect);
        } else {
          console.warn('No area selected for crop export');
        }
      });
    } else {
      console.log('JPEG Export:', value);
    }
  }

  onSectionToggle(section: string): void {
    this.expandedSection.update(current => current === section ? null : section);
  }

  onPdfSubmit(value: string) {
    if (!this.pdfAllowed()) return;
    // When the current document is itself a PDF, it is already loaded in the
    // viewer — just download that file directly instead of opening any dialog
    // or triggering a server-side export. No login required in this case.
    if (this.detailViewService.isPdf) {
      this.pdfLoading.set(true);
      // Prefer the article title when an article is being viewed; the service
      // falls back to this only when the PDF has no original filename of its own.
      const article = this.detailViewService.getCurrentArticle() as any;
      const articleTitle = article?.['title.search'] || article?.title;
      const fallbackName = articleTitle || this.detailViewService.title;
      this.pdfService.downloadCurrentPdf(fallbackName)
        .finally(() => this.pdfLoading.set(false));
      return;
    }
    if (!this.isLoggedIn()) {
      this.openLoginPrompt();
      return;
    }
    if (value === 'select-pages') {
      this.openPageSelectionDialog('page-selection-dialog--header-pdf', 'pdf');
        } else if (value === 'whole-document') {
      const pid = this.detailViewService.document?.uuid;
      if (pid) this.openEmailExportDialog(pid, 'pdf');
    }
  }

  onPrintSubmit(value: string) {
    if (!this.printAllowed()) return;
    if (value === 'current-page') {
      const isBookMode = this.iiifBookMode() || !!this.pdfProperties()?.bookMode;
      const pages = this.detailViewService.pages;
      const currentIndex = this.detailViewService.currentPageIndex;

      const pids: string[] = [];
      if (isBookMode) {
        const left = pages?.[currentIndex];
        const right = pages?.[currentIndex + 1];
        if (left) pids.push(left.pid);
        if (right) pids.push(right.pid);
      } else {
        const pid = this.detailViewService.currentPagePid;
        if (pid) pids.push(pid);
      }
      if (!pids.length) return;

      const printPages = pids
        .map(pid => {
          const url = this.iiifViewerService.getDirectImageUrl(pid);
          return `<section class="print-page"><img src="${url}" alt="" /></section>`;
        })
        .join('\n  ');

      const printWindow = window.open('', '_blank');
      if (!printWindow) return;
      printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Tisk</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; min-height: 100%; }
    body { background: #fff; }
    .print-page {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 100vh;
    }
    img {
      display: block;
      max-width: 100%;
      max-height: 100vh;
      width: auto;
      height: auto;
      object-fit: contain;
    }
    @media print {
      @page { size: A4 portrait; margin: 8mm; }
      html, body { width: auto; min-height: 0; }
      .print-page {
        width: 194mm;
        height: 281mm;
        min-height: 0;
        overflow: hidden;
        break-inside: avoid;
        page-break-inside: avoid;
        break-after: page;
        page-break-after: always;
      }
      .print-page:last-child {
        break-after: auto;
        page-break-after: auto;
      }
      img { max-width: 100%; max-height: 100%; }
    }
  </style>
</head>
<body>
  ${printPages}
  <script>
    window.onload = async function() {
      var images = Array.from(document.images);
      await Promise.all(images.map(function(image) {
        return image.decode ? image.decode().catch(function() {}) : Promise.resolve();
      }));
      window.print();
    };
  <\/script>
</body>
</html>`);
      printWindow.document.close();
      return;
    }
    if (!this.isLoggedIn()) {
      this.openLoginPrompt();
      return;
    }
    if (value === 'select-pages') {
      this.openPageSelectionDialog('page-selection-dialog--header-print', 'print');
    } else if (value === 'whole-document') {
      const exportablePages = this.getExportablePages('print');
      const pageUuids = exportablePages.map(page => page.pid);
      if (pageUuids.length > 0) {
        this.exportService.printPdfSelection(pageUuids);
      }
    }
  }

  /**
   * Opens the page selection dialog
   * Only shows pages with exportable licenses
   */
  private openPageSelectionDialog(titleKey: string, exportType: 'pdf' | 'print'): void {
    // Get only pages with exportable licenses
    const exportablePages = this.getExportablePages(exportType);

    if (!exportablePages || exportablePages.length === 0) {
      console.warn('No pages with exportable licenses available for selection');
      return;
    }

    const dialogRef = this.dialog.open(PageSelectionDialogComponent, {
      data: {
        pages: exportablePages,
        title: titleKey,
        maxSelectionCount: this.appConfig.pdfMaxRange()
      },
      width: '90vw',
      maxWidth: '1200px',
      maxHeight: '90vh'
    });

    dialogRef.afterClosed().subscribe((result: PageSelectionDialogResult) => {
      if (result && result.selectedPagePids && result.selectedPagePids.length > 0) {
        if (exportType === 'pdf') {
          this.pdfLoading.set(true);
          this.exportService.exportPdfSelection(result.selectedPagePids, this.detailViewService.title).subscribe({
            next: () => this.pdfLoading.set(false),
            error: () => this.pdfLoading.set(false),
          });
        } else if (exportType === 'print') {
          this.exportService.printPdfSelection(result.selectedPagePids);
        }
      }
    });
  }

  private openEmailExportDialog(pid: string, exportType: EmailExportType): void {
    const dialogRef = this.dialog.open(EmailExportDialogComponent, {
      data: { pid, exportType },
      width: '560px',
      maxWidth: '90vw',
    });

    dialogRef.afterClosed().subscribe((result: string) => {
      if (result === 'submitted') {
        this.toastService.show('email-export-dialog--success');
      } else if (result === 'error') {
        this.toastService.show('export-error');
      }
    });
  }

  onEpubSubmit(value: string): void {
    if (!this.textAllowed()) return;
    if (!this.isLoggedIn()) {
      this.openLoginPrompt();
      return;
    }
    if (value === 'whole-document') {
      const pid = this.detailViewService.document?.uuid;
      if (pid) this.openEmailExportDialog(pid, 'epub');
    }
  }

  onTextSubmit(value: string): void {
    if (!this.textAllowed()) return;
    if (!this.isLoggedIn()) {
      this.openLoginPrompt();
      return;
    }
    if (value === 'whole-document') {
      const pid = this.detailViewService.document?.uuid;
      if (pid) this.openEmailExportDialog(pid, 'txt');
    }
  }

  private openLoginPrompt(): void {
    const dialogRef = this.dialog.open(LoginPromptDialogComponent, {
      data: {
        titleKey: 'login-required-export-title',
        messageKey: 'login-prompt-message-export',
      },
      width: '560px',
      maxWidth: '90vw',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === 'login') {
        this.authService.login(this.router.url);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.cropSubscription) {
      this.cropSubscription.unsubscribe();
    }
    if (this.selectionModeSubscription) {
      this.selectionModeSubscription.unsubscribe();
    }
    this.iiifViewerService.setSelectionMode(false);
  }

}
