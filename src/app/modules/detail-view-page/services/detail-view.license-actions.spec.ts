import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DetailViewService } from './detail-view.service';
import { ConfigService } from '../../../core/config';
import { EnvironmentService } from '../../../shared/services/environment.service';
import { CdkSourceService } from '../../../shared/services/cdk-source.service';

/**
 * Covers which licences decide what the reader may do (export / print / copy).
 *
 * The bug this pins down: permissions were read from the *document's*
 * `licenses.facet`, which Solr builds as the union of the whole tree — the
 * object's own licences, its ancestors' AND its descendants' (`contains_licenses`).
 * For a periodical issue of a title carrying `dnnto` that union came back as
 * `["public","dnnto","covid"]`, and because the matrix is most-restrictive-wins the
 * `dnnto` entry denied print/jpeg/pdf/text on an issue whose pages are plainly
 * public — every section of the export tab disappeared and the tab rendered empty.
 *
 * What actually governs the reader is the page on screen, so that is what is
 * consulted, with the document kept as the fallback for views that have no pages
 * (and so that a page indexed without any licence cannot silently unlock a
 * restricted document).
 *
 * DetailViewService pulls in the store, router and viewer services and its
 * constructor registers effects, none of which this path touches — it only reads
 * `_pages`, `_currentPageIndex` and the document signal, so the instance is built
 * without Angular's injector and those are seeded directly (same approach as
 * detail-view.convolute.spec.ts).
 */
describe('DetailViewService.isActionAllowed', () => {
  let config: ConfigService;

  const licensesConfig = [
    {
      id: 'public',
      accessType: 'open',
      isOnline: true,
      label: { cs: 'Volna dila' },
      actions: { text: true, crop: true, jpeg: true, pdf: true, print: true, selection: true },
    },
    {
      id: 'dnnto',
      accessType: 'login',
      isOnline: true,
      label: { cs: 'DNNT online' },
      actions: { text: false, crop: false, jpeg: false, pdf: false, print: false, selection: false, textMode: true },
    },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ConfigService,
        { provide: EnvironmentService, useValue: {} },
        { provide: CdkSourceService, useValue: { getCode: () => null, code$: { subscribe: () => ({ unsubscribe() {} }) } } },
      ],
    });
    config = TestBed.inject(ConfigService);
    (config as any).config$.next({ ...config.getConfig(), licenses: licensesConfig });
  });

  function serviceWith(opts: { pages?: any[]; currentPageIndex?: number; documentLicences?: string[] }): DetailViewService {
    const service = Object.create(DetailViewService.prototype) as DetailViewService;
    (service as any)._pages = signal(opts.pages ?? []);
    (service as any)._currentPageIndex = signal(opts.currentPageIndex ?? 0);
    (service as any).documentSignal = signal(
      opts.documentLicences === undefined ? null : { licences: opts.documentLicences },
    );
    (service as any).configService = config;
    return service;
  }

  it('allows exports on a public page of a document whose facet licences include dnnto', () => {
    // The reported case: page uuid:567846f0… is indexed public, while the issue's
    // `licenses.facet` is ["public","dnnto","covid"] because the periodical title
    // above it is dnnto.
    const service = serviceWith({
      pages: [{ pid: 'p1', model: 'page', licenses_of_ancestors: ['public'] }],
      documentLicences: ['public', 'dnnto', 'covid'],
    });

    expect(service.isActionAllowed('pdf')).toBe(true);
    expect(service.isActionAllowed('print')).toBe(true);
    expect(service.isActionAllowed('jpeg')).toBe(true);
    expect(service.isActionAllowed('text')).toBe(true);
  });

  it('still denies on a restricted page, whatever the parent document says', () => {
    const service = serviceWith({
      pages: [{ pid: 'p1', model: 'page', licenses_of_ancestors: ['dnnto'] }],
      documentLicences: ['public'],
    });

    expect(service.isActionAllowed('pdf')).toBe(false);
    expect(service.isActionAllowed('text')).toBe(false);
  });

  it('reads a licence set directly on the page as well as inherited ones', () => {
    const service = serviceWith({
      pages: [{ pid: 'p1', model: 'page', licenses: ['dnnto'], licenses_of_ancestors: ['public'] }],
      documentLicences: ['public'],
    });

    // Own and inherited both apply to the page, so the restrictive one wins.
    expect(service.isActionAllowed('print')).toBe(false);
  });

  it('follows the page the reader is actually on', () => {
    const service = serviceWith({
      pages: [
        { pid: 'p1', model: 'page', licenses_of_ancestors: ['public'] },
        { pid: 'p2', model: 'page', licenses_of_ancestors: ['dnnto'] },
      ],
      currentPageIndex: 1,
      documentLicences: ['public'],
    });

    expect(service.isActionAllowed('jpeg')).toBe(false);

    (service as any)._currentPageIndex.set(0);
    expect(service.isActionAllowed('jpeg')).toBe(true);
  });

  it('falls back to the document when there is no current page', () => {
    // Sound recordings and PDF documents have no page list; a restricted document
    // must not become permissive just because nothing is indexed under it.
    const service = serviceWith({ pages: [], documentLicences: ['dnnto'] });

    expect(service.isActionAllowed('pdf')).toBe(false);
  });

  it('falls back to the document when the current page carries no licence at all', () => {
    const service = serviceWith({
      pages: [{ pid: 'p1', model: 'page' }],
      documentLicences: ['dnnto'],
    });

    expect(service.isActionAllowed('pdf')).toBe(false);
  });

  it('permits everything when neither page nor document carries a licence', () => {
    const service = serviceWith({ pages: [{ pid: 'p1', model: 'page' }], documentLicences: [] });

    expect(service.isActionAllowed('pdf')).toBe(true);
  });
});
