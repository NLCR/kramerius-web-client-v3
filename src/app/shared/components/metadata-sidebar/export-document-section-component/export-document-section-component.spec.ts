import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { ExportDocumentSectionComponent } from './export-document-section-component';
import { ExportService } from '../../../services/export.service';
import { IIIFViewerService } from '../../../services/iiif-viewer.service';
import { DocumentInfoService } from '../../../services/document-info.service';
import { MatDialog } from '@angular/material/dialog';
import { DetailViewService } from '../../../../modules/detail-view-page/services/detail-view.service';
import { AppConfigService } from '../../../services/app-config.service';
import { ConfigService } from '../../../../core/config';
import { PdfService } from '../../../services/pdf.service';
import { CdkSourceService } from '../../../services/cdk-source.service';
import { UserService } from '../../../services/user.service';
import { ToastService } from '../../../services/toast.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { Router } from '@angular/router';

/**
 * Covers which whole-document PDF option the export tab offers.
 *
 * There are two different PDF exports behind one section: the synchronous
 * `/pdf/selection` download (works at every library, capped by `pdfMaxRange`) and
 * the worker-backed job delivered by e-mail (KNAV/NKP only). They used to be shown
 * side by side as "Celý dokument (legacy)" and "Celý dokument", and the whole
 * section was hidden wherever the worker was missing — which removed the one PDF
 * export that would actually have worked there.
 *
 * They are now mutually exclusive and both labelled "Celý dokument": the value
 * (`whole-document-legacy` vs `whole-document`) is what still distinguishes the two
 * code paths, never the label.
 */
describe('ExportDocumentSectionComponent PDF options', () => {
  let sourceCode: BehaviorSubject<string | null>;
  let hasWorker: boolean;
  let pages: any[];
  let isPdf: boolean;

  function createComponent(): ExportDocumentSectionComponent {
    sourceCode = new BehaviorSubject<string | null>(null);

    TestBed.configureTestingModule({
      imports: [ExportDocumentSectionComponent],
      providers: [
        { provide: ExportService, useValue: { hasExportableLicense: (page: any) => !!page?.exportable } },
        {
          provide: IIIFViewerService,
          useValue: {
            bookMode$: of(false),
            isSelectionMode$: of(false),
            selectedArea$: of(null),
            setSelectionMode: () => {},
            clearSelectedArea: () => {},
          },
        },
        { provide: DocumentInfoService, useValue: { canAccessDocument: () => true, getRuntimeLicenses: () => [] } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(null) }) } },
        {
          provide: DetailViewService,
          useValue: {
            get pages() { return pages; },
            get isPdf() { return isPdf; },
            currentPageIndex: 0,
            title: 'Doc',
            document: { uuid: 'uuid:doc' },
            isActionAllowed: () => true,
          },
        },
        { provide: AppConfigService, useValue: { pdfMaxRange: () => 120 } },
        {
          provide: ConfigService,
          useValue: {
            isExportFormatEnabled: () => true,
            hasPublicWorkerExports: () => hasWorker,
          },
        },
        { provide: PdfService, useValue: { properties$: of(null), pdfProperties: null, downloadCurrentPdf: () => Promise.resolve() } },
        { provide: CdkSourceService, useValue: { code$: sourceCode, getCode: () => sourceCode.value } },
        { provide: UserService, useValue: { userSession$: signal({ authenticated: true }) } },
        { provide: ToastService, useValue: { show: () => {} } },
        { provide: AuthService, useValue: { login: () => {} } },
        { provide: Router, useValue: { url: '/view/uuid:doc' } },
      ],
    });

    return TestBed.createComponent(ExportDocumentSectionComponent).componentInstance;
  }

  /**
   * The single whole-document entry, wherever it sits: the section lists
   * "Vybrané strany" first, so its position is not part of the contract.
   */
  function wholeDocumentOption(component: ExportDocumentSectionComponent) {
    const matches = component.pdfOptions().filter(o => o.value.startsWith('whole-document'));
    expect(matches.length).toBe(1);
    return matches[0];
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    hasWorker = false;
    isPdf = false;
    pages = [{ pid: 'p1', exportable: true }, { pid: 'p2', exportable: true }];
  });

  it('offers the legacy download as "whole-document" where there is no public worker', () => {
    const component = createComponent();

    expect(component.pdfOptions().map(o => o.value)).toEqual(['select-pages', 'whole-document-legacy']);
    expect(wholeDocumentOption(component).label).toBe('whole-document');
  });

  it('offers the worker export as "whole-document" where the worker exists', () => {
    hasWorker = true;
    const component = createComponent();

    expect(component.pdfOptions().map(o => o.value)).toEqual(['select-pages', 'whole-document']);
  });

  it('never offers both whole-document flavours at once', () => {
    for (const worker of [true, false]) {
      TestBed.resetTestingModule();
      hasWorker = worker;
      const values = createComponent().pdfOptions().map(o => o.value);
      expect(values.filter(v => v.startsWith('whole-document')).length).toBe(1);
    }
  });

  it('never labels an option "legacy"', () => {
    for (const worker of [true, false]) {
      TestBed.resetTestingModule();
      hasWorker = worker;
      const labels = createComponent().pdfOptions().map(o => o.label);
      expect(labels.some(l => l.includes('legacy'))).toBe(false);
    }
  });

  it('keeps the PDF section available at a library without the worker', () => {
    // The regression: the worker gate used to hide the entire section, taking the
    // working synchronous download with it.
    const component = createComponent();
    expect(component.pdfEnabled()).toBe(true);
  });

  it('re-evaluates the options when the CDK source changes', () => {
    const component = createComponent();
    expect(wholeDocumentOption(component).value).toBe('whole-document-legacy');

    hasWorker = true;
    sourceCode.next('knav');
    expect(wholeDocumentOption(component).value).toBe('whole-document');
  });

  it('caps the legacy option by pdfMaxRange, as before', () => {
    pages = Array.from({ length: 200 }, (_, i) => ({ pid: `p${i}`, exportable: true }));
    const component = createComponent();

    expect(wholeDocumentOption(component).value).toBe('whole-document-legacy');
    expect(wholeDocumentOption(component).disabled).toBe(true);
  });

  it('still collapses to a single direct download for a PDF document', () => {
    isPdf = true;
    const component = createComponent();

    expect(component.pdfOptions()).toEqual([{ label: 'whole-document', value: 'whole-document', disabled: false }]);
  });
});
