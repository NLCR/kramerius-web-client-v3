import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ConfigService } from '../../core/config';
import { DirectPdfAvailability, DirectPdfService } from './direct-pdf.service';

describe('DirectPdfService', () => {
  let service: DirectPdfService;
  let httpMock: HttpTestingController;
  let pdfServer: string | undefined;

  beforeEach(() => {
    pdfServer = 'https://pdf.example.org/pdf';
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        DirectPdfService,
        {
          provide: ConfigService,
          useValue: { getConfig: () => ({ api: { pdfServer } }) },
        },
      ],
    });
    service = TestBed.inject(DirectPdfService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('returns the download URL and API-provided MB size for an existing PDF', () => {
    let result: DirectPdfAvailability | null = null;
    service.checkAvailability('uuid:abc-123').subscribe(value => result = value);

    const request = httpMock.expectOne('https://pdf.example.org/pdf/?uuid=uuid%3Aabc-123');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.has('Authorization')).toBeFalse();
    request.flush({ pdf: 'true', size: '13.4' });

    const availability = result as unknown as DirectPdfAvailability;
    expect(availability).toEqual({
      sizeMb: '13.4',
      downloadUrl: 'https://pdf.example.org/pdf/?uuid=uuid%3Aabc-123&pdf=true',
    });
  });

  it('does not offer a download unless the API explicitly returns pdf true', () => {
    let result: DirectPdfAvailability | null | undefined;
    service.checkAvailability('uuid:missing').subscribe(value => result = value);

    httpMock.expectOne('https://pdf.example.org/pdf/?uuid=uuid%3Amissing')
      .flush({ pdf: 'false', size: '0' });

    expect(result).toBeNull();
  });

  it('stays disabled and sends no request when pdfServer is not configured', () => {
    pdfServer = undefined;
    let result: DirectPdfAvailability | null | undefined;
    service.checkAvailability('uuid:abc').subscribe(value => result = value);

    expect(result).toBeNull();
    httpMock.expectNone(() => true);
  });
});
