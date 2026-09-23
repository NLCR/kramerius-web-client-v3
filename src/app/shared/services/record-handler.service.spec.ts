import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { RecordHandlerService } from './record-handler.service';
import { LibraryContextService } from './library-context.service';
import { SearchService } from './search.service';
import { AdminModeService } from './admin-mode.service';
import { BreakpointService } from './breakpoint.service';
import { UserService } from './user.service';
import { MatDialog } from '@angular/material/dialog';
import { DocumentTypeEnum } from '../../modules/constants/document-type';
import { ConfigService } from '../../core/config/config.service';

describe('RecordHandlerService.getDocumentUrl fulltext forwarding', () => {
  let service: RecordHandlerService;

  beforeEach(() => {
    // Fake Router that renders the tree as a query-string URL we can assert on.
    const routerStub = {
      createUrlTree: (segments: any[], extras?: { queryParams?: Record<string, string> }) => ({
        toString: () => {
          const path = '/' + segments.join('/');
          const qp = extras?.queryParams
            ? '?' + Object.entries(extras.queryParams)
                .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
                .join('&')
            : '';
          return path + qp;
        },
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        RecordHandlerService,
        { provide: Router, useValue: routerStub },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
        { provide: LibraryContextService, useValue: { prependLibraryPrefix: (s: any[]) => s } },
        { provide: SearchService, useValue: {} },
        { provide: AdminModeService, useValue: {} },
        { provide: BreakpointService, useValue: {} },
        { provide: UserService, useValue: {} },
        { provide: MatDialog, useValue: {} },
      ],
    });
    service = TestBed.inject(RecordHandlerService);
  });

  it('omits ?fulltext for a periodical matched on title/metadata (non-grouped)', () => {
    // The global query is stamped onto every result as `fulltext`, but a plain
    // title match is not a within-pages hit, so it must not restore an
    // in-document search.
    const url = service.getDocumentUrl({
      model: DocumentTypeEnum.periodical,
      pid: 'uuid:root',
      fulltext: 'chochola',
    });
    expect(url).not.toContain('fulltext=');
  });

  it('carries ?fulltext for a grouped page representative (within-pages hit)', () => {
    const url = service.getDocumentUrl({
      model: DocumentTypeEnum.periodical,
      pid: 'uuid:root',
      fulltext: 'chochola',
      grouped: true,
    });
    expect(url).toContain('fulltext=chochola');
  });

  it('carries ?fulltext for an explicit document-level override regardless of grouping', () => {
    const url = service.getDocumentUrl({
      model: DocumentTypeEnum.periodical,
      pid: 'uuid:root',
      fulltextForDocument: 'chochola',
    });
    expect(url).toContain('fulltext=chochola');
  });
});

describe('RecordHandlerService.isRecordLocked open-access handling', () => {
  /**
   * Builds the service with a user holding `userLicenses` (empty = anonymous).
   * `isRecordLocked` must agree with `isRecordPublic`: an openly licensed record
   * is readable by everyone, so it can never be reported as locked.
   */
  function makeService(userLicenses: string[]): RecordHandlerService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        RecordHandlerService,
        { provide: Router, useValue: { createUrlTree: () => ({ toString: () => '' }) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
        { provide: LibraryContextService, useValue: { prependLibraryPrefix: (s: any[]) => s } },
        { provide: SearchService, useValue: {} },
        { provide: AdminModeService, useValue: {} },
        { provide: BreakpointService, useValue: {} },
        {
          provide: UserService,
          useValue: {
            hasAnyLicense: (required: string[]) =>
              !!required?.length && required.some(l => userLicenses.includes(l)),
          },
        },
        { provide: MatDialog, useValue: {} },
      ],
    });
    return TestBed.inject(RecordHandlerService);
  }

  it('reports a public record as unlocked for an anonymous user', () => {
    // The core defect: `public` is open access, but the anonymous user holds no
    // licenses, so a pure `!hasAnyLicense()` check marked every free work locked.
    const service = makeService([]);
    expect(service.isRecordPublic(['public'])).toBe(true);
    expect(service.isRecordLocked(['public'])).toBe(false);
  });

  it('keeps a record unlocked when an open license sits beside a restrictive one', () => {
    // A public work whose child carries `dnntt` stays public — the restrictive
    // license of a descendant must not win over the work's own open license.
    const service = makeService([]);
    expect(service.isRecordLocked(['dnntt', 'public'])).toBe(false);
  });

  it('still reports a purely restricted record as locked for an anonymous user', () => {
    const service = makeService([]);
    expect(service.isRecordLocked(['dnntt'])).toBe(true);
  });

  it('reports a restricted record as unlocked when the user holds the license', () => {
    const service = makeService(['dnntt']);
    expect(service.isRecordLocked(['dnntt'])).toBe(false);
  });

  it('treats a record with no licenses as locked', () => {
    const service = makeService([]);
    expect(service.isRecordLocked([])).toBe(true);
  });
});

/**
 * The citation and share dialogs are reached via `import()` rather than a static
 * import, to keep this service out of an import cycle with the dialog components
 * (see `dialogSizing` in the service). These tests pin the two things that change
 * could plausibly break: the dialog still opens, and the license gate still runs
 * before the module is even fetched.
 */
describe('RecordHandlerService dialog opening', () => {
  function makeService(opts: { allow?: boolean } = {}) {
    const open = jasmine.createSpy('open');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        RecordHandlerService,
        { provide: Router, useValue: { createUrlTree: () => ({ toString: () => '/' }) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
        { provide: LibraryContextService, useValue: { prependLibraryPrefix: (s: any[]) => s } },
        { provide: SearchService, useValue: {} },
        { provide: AdminModeService, useValue: {} },
        { provide: BreakpointService, useValue: { isMobile: () => false, isTablet: () => false } },
        { provide: UserService, useValue: {} },
        { provide: MatDialog, useValue: { open } },
        {
          provide: ConfigService,
          useValue: { isLicenseActionAllowed: () => opts.allow ?? true },
        },
      ],
    });
    return { service: TestBed.inject(RecordHandlerService), open };
  }

  const doc = { licences: ['public'], mainTitle: 'T' } as any;

  // The service opens the dialog in an import() callback. Awaiting the same
  // module here (already cached by then) puts us behind that callback without
  // guessing at a number of microtask ticks.
  const settleImports = async () => {
    await import('../dialogs/citation-dialog/citation-dialog.component');
    await import('../dialogs/share-dialog/share-dialog.component');
    await Promise.resolve();
  };

  it('opens the citation dialog once the lazy module resolves', async () => {
    const { service, open } = makeService();
    service.openCitationDialog(doc);
    await settleImports();
    expect(open).toHaveBeenCalled();
  });

  it('opens the share dialog once the lazy module resolves', async () => {
    const { service, open } = makeService();
    service.openShareDialog(doc);
    await settleImports();
    expect(open).toHaveBeenCalled();
  });

  it('does not even load the dialog when the license forbids the action', async () => {
    const { service, open } = makeService({ allow: false });
    service.openCitationDialog(doc);
    service.openShareDialog(doc);
    await settleImports();
    expect(open).not.toHaveBeenCalled();
  });
});
