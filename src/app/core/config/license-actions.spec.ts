import { TestBed } from '@angular/core/testing';
import { ConfigService } from './config.service';
import { EnvironmentService } from '../../shared/services/environment.service';
import { CdkSourceService } from '../../shared/services/cdk-source.service';

/**
 * Guards the license permission matrix (`actions` in config-licenses.json).
 *
 * This matrix was configured from the start but never read by any code, so every
 * restricted action — OCR text display, area crop, JPEG/PDF/print export — was
 * offered on DNNTO documents after login. The API serves the ALTO text and the
 * IIIF crop regardless of license, so these checks are the actual enforcement,
 * which is why the semantics below are worth pinning down.
 */
describe('ConfigService.isLicenseActionAllowed', () => {
  let service: ConfigService;
  let sourceCode: string | null;

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
    // Variant overriding a single flag: proves `actions` are layered, not replaced.
    {
      id: 'dnnto__mzk',
      base: 'dnnto',
      label: { cs: 'DNNT online MZK' },
      actions: { print: true },
    },
  ];

  beforeEach(() => {
    sourceCode = null;
    TestBed.configureTestingModule({
      providers: [
        ConfigService,
        { provide: EnvironmentService, useValue: {} },
        { provide: CdkSourceService, useValue: { getCode: () => sourceCode, code$: { subscribe: () => ({ unsubscribe() {} }) } } },
      ],
    });
    service = TestBed.inject(ConfigService);
    (service as any).config$.next({ ...service.getConfig(), licenses: licensesConfig });
  });

  it('denies an action the document\'s license forbids', () => {
    expect(service.isLicenseActionAllowed(['dnnto'], 'text')).toBe(false);
    expect(service.isLicenseActionAllowed(['dnnto'], 'crop')).toBe(false);
    expect(service.isLicenseActionAllowed(['dnnto'], 'jpeg')).toBe(false);
  });

  it('allows an action the document\'s license permits', () => {
    expect(service.isLicenseActionAllowed(['dnnto'], 'textMode')).toBe(true);
    expect(service.isLicenseActionAllowed(['public'], 'text')).toBe(true);
  });

  // The core reason this is not a simple `.some()`: a DNNTO scan that also
  // carries an open license must not have the open half unlock its text layer.
  it('lets the most restrictive license win when several apply', () => {
    expect(service.isLicenseActionAllowed(['public', 'dnnto'], 'text')).toBe(false);
    expect(service.isLicenseActionAllowed(['dnnto', 'public'], 'text')).toBe(false);
  });

  it('permits everything for a document with no licenses', () => {
    // Restrictions only ever come from a license that is actually present;
    // a plain public scan carries no license array at all.
    expect(service.isLicenseActionAllowed([], 'text')).toBe(true);
    expect(service.isLicenseActionAllowed(null, 'text')).toBe(true);
    expect(service.isLicenseActionAllowed(undefined, 'crop')).toBe(true);
  });

  it('ignores an unrecognised license id rather than denying on it', () => {
    // An id with no matrix to consult can neither allow nor deny.
    expect(service.isLicenseActionAllowed(['no-such-license'], 'text')).toBe(true);
  });

  it('still denies when an unknown id sits alongside a restrictive one', () => {
    expect(service.isLicenseActionAllowed(['no-such-license', 'dnnto'], 'text')).toBe(false);
  });

  it('applies a source-scoped variant\'s actions override', () => {
    // Base dnnto forbids print; the mzk variant re-allows it. Without a source
    // selected the base applies.
    expect(service.isLicenseActionAllowed(['dnnto'], 'print')).toBe(false);

    sourceCode = 'mzk';
    expect(service.isLicenseActionAllowed(['dnnto'], 'print')).toBe(true);
  });

  it('keeps the base license\'s other restrictions under a variant', () => {
    sourceCode = 'mzk';
    // The variant overrides only `print`; text stays forbidden because actions
    // are layered on top of the base rather than replacing it.
    expect(service.isLicenseActionAllowed(['dnnto'], 'text')).toBe(false);
  });
});
