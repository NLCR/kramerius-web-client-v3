import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AltoService, OcrPageContent } from './alto.service';
import { EnvironmentService } from './environment.service';
import { CdkSourceService } from './cdk-source.service';

describe('AltoService OCR loading', () => {
  let service: AltoService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AltoService,
        CdkSourceService,
        {
          provide: EnvironmentService,
          useValue: { getApiUrl: () => 'https://api.example.org/items' }
        }
      ]
    });

    service = TestBed.inject(AltoService);
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(CdkSourceService).setCode('knav');
  });

  afterEach(() => httpMock.verify());

  function utf8(text: string): ArrayBuffer {
    return new TextEncoder().encode(text).buffer as ArrayBuffer;
  }

  function utf16le(text: string, withBom = true): ArrayBuffer {
    const offset = withBom ? 2 : 0;
    const bytes = new Uint8Array(offset + text.length * 2);
    if (withBom) {
      bytes[0] = 0xff;
      bytes[1] = 0xfe;
    }
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      bytes[offset + index * 2] = code & 0xff;
      bytes[offset + index * 2 + 1] = code >> 8;
    }
    return bytes.buffer;
  }

  it('loads plain OCR directly when ALTO is not available', () => {
    let result: OcrPageContent | undefined;
    service.fetchOcrContent('uuid:page', false).subscribe(value => result = value);

    httpMock.expectOne('https://api.example.org/items/knav/uuid:page/ocr/text')
      .flush(utf8('  Prostý OCR text  '));

    expect(result).toEqual({ text: 'Prostý OCR text', altoXml: null });
    httpMock.expectNone('https://api.example.org/items/knav/uuid:page/ocr/alto');
  });

  it('falls back to plain OCR when an advertised ALTO request fails', () => {
    let result: OcrPageContent | undefined;
    service.fetchOcrContent('uuid:page').subscribe(value => result = value);

    httpMock.expectOne('https://api.example.org/items/knav/uuid:page/ocr/alto')
      .flush('Not found', { status: 404, statusText: 'Not Found' });
    httpMock.expectOne('https://api.example.org/items/knav/uuid:page/ocr/text')
      .flush(utf8('Záložní text'));

    expect(result).toEqual({ text: 'Záložní text', altoXml: null });
  });

  it('keeps ALTO when it is available and contains text', () => {
    const altoXml = '<alto><Layout><Page WIDTH="100" HEIGHT="100"><PrintSpace><TextBlock><TextLine><String CONTENT="Text"/></TextLine></TextBlock></PrintSpace></Page></Layout></alto>';
    let result: OcrPageContent | undefined;
    service.fetchOcrContent('uuid:page').subscribe(value => result = value);

    httpMock.expectOne('https://api.example.org/items/knav/uuid:page/ocr/alto').flush(altoXml);

    expect(result).toEqual({ text: 'Text', altoXml });
    httpMock.expectNone('https://api.example.org/items/knav/uuid:page/ocr/text');
  });

  it('decodes a UTF-16LE OCR stream instead of showing its bytes as control characters', () => {
    const transcript = 'aneb tělesná poroba, jak Palacký dí, věci neznámé, teprv později, když nelidský Němců';
    let result: OcrPageContent | undefined;
    service.fetchOcrContent('uuid:page', false).subscribe(value => result = value);

    httpMock.expectOne('https://api.example.org/items/knav/uuid:page/ocr/text')
      .flush(utf16le(transcript));

    expect(result?.text).toBe(transcript);
  });

  it('detects a UTF-16LE OCR stream without a BOM', () => {
    let result: OcrPageContent | undefined;
    service.fetchOcrContent('uuid:page', false).subscribe(value => result = value);

    httpMock.expectOne('https://api.example.org/items/knav/uuid:page/ocr/text')
      .flush(utf16le('Příliš žluťoučký kůň', false));

    expect(result?.text).toBe('Příliš žluťoučký kůň');
  });

  it('removes stray binary control markers from an otherwise valid transcript', () => {
    let result: OcrPageContent | undefined;
    service.fetchOcrContent('uuid:page', false).subscribe(value => result = value);

    httpMock.expectOne('https://api.example.org/items/knav/uuid:page/ocr/text')
      .flush(utf8('Čistý\u0001 text ␛bez značek�'));

    expect(result?.text).toBe('Čistý text bez značek');
  });
});
