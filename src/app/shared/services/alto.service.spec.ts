import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpClientTestingModule,
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { AltoService, OcrPageContent } from './alto.service';
import { EnvironmentService } from './environment.service';
import { CdkSourceService } from './cdk-source.service';

describe('AltoService OCR loading', () => {
  let service: AltoService;
  let httpMock: HttpTestingController;
  let baseCode: string;

  beforeEach(() => {
    baseCode = 'cdk';
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AltoService,
        CdkSourceService,
        {
          provide: EnvironmentService,
          useValue: {
            getApiUrl: () => 'https://api.example.org/items',
            getBaseKrameriusId: () => baseCode,
          }
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

  /** Simulates the legacy proxy reading UTF-16 bytes as UTF-8 before returning them. */
  function mangledUtf16le(text: string): ArrayBuffer {
    const original = new Uint8Array(utf16le(text));
    let malformed = '';
    for (const byte of original) {
      malformed += byte < 0x80 ? String.fromCharCode(byte) : '\uFFFD';
    }
    return utf8(malformed);
  }

  it('loads plain OCR directly when ALTO is not available', () => {
    let result: OcrPageContent | undefined;
    service.fetchOcrContent('uuid:page', false).subscribe(value => result = value);

    httpMock.expectOne('https://api.example.org/items/knav/uuid:page/ocr/text')
      .flush(utf8('  Prostý OCR text  '));

    expect(result).toEqual({ text: 'Prostý OCR text', altoXml: null });
    httpMock.expectNone('https://api.example.org/items/knav/uuid:page/ocr/alto');
  });

  it('does not prefix OCR paths with a stale source code on standalone NKP', () => {
    baseCode = 'nkp';
    let result: OcrPageContent | undefined;
    service.fetchOcrContent('uuid:page', false).subscribe(value => result = value);

    httpMock.expectOne('https://api.example.org/items/uuid:page/ocr/text')
      .flush(utf8('OCR z NKP'));

    expect(result?.text).toBe('OCR z NKP');
    httpMock.expectNone('https://api.example.org/items/knav/uuid:page/ocr/text');
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

  it('normalizes encoding debris extracted from ALTO as well as plain OCR', () => {
    const altoXml = '<alto><Layout><Page WIDTH="100" HEIGHT="100"><PrintSpace><TextBlock><TextLine WIDTH="90"><String CONTENT="PalackÃ½"/><String CONTENT="smutn뿯½"/></TextLine></TextBlock></PrintSpace></Page></Layout></alto>';
    let result: OcrPageContent | undefined;
    service.fetchOcrContent('uuid:page').subscribe(value => result = value);

    httpMock.expectOne('https://api.example.org/items/knav/uuid:page/ocr/alto').flush(altoXml);

    expect(result?.text).toBe('Palacký smutn');
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

  it('does not turn replacement bytes in a mangled UTF-16 transcript into Hangul or private-use characters', () => {
    const transcript = [
      'upokojil se, porozuměv, že smutný duch suší',
      'kosti, a že by zdravý svému ještě více ublížil,',
      'neboť se říkává, že již veselá mysl je půl zdravá.',
      'Lépe mhouřanovi, než slepcovi! rozvážil, že má při',
      'všem neštěstí zdravý zrak a počal o všech věcech přemýšleti.'
    ].join('\n');
    let result: OcrPageContent | undefined;
    service.fetchOcrContent('uuid:page', false).subscribe(value => result = value);

    httpMock.expectOne('https://api.example.org/items/knav/uuid:page/ocr/text')
      .flush(mangledUtf16le(transcript));

    expect(result?.text).toContain('upokojil se, porozuměv, že smutn duch suš');
    expect(result?.text).toContain('neboť se řkv');
    expect(result?.text).toContain('rozvžil');
    expect(result?.text).toContain('přemšleti');
    expect(result?.text).not.toMatch(/[\uAC00-\uD7AF\uE000-\uF8FF\uFFFD]/);
    expect(result?.text).not.toContain('뿯½');
  });
});


/**
 * Builds a minimal ALTO document from a list of words laid out on one line.
 * Each word gets a 10px-wide box, spaced 20px apart, so boxes are identifiable
 * by their HPOS (word index * 20).
 */
function altoWith(words: string[]): string {
  const strings = words
    .map((w, i) => `<String CONTENT="${w}" HPOS="${i * 20}" VPOS="100" WIDTH="10" HEIGHT="8"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
    <alto><Layout><Page WIDTH="1000" HEIGHT="500"><PrintSpace>
      <TextBlock><TextLine>${strings}</TextLine></TextBlock>
    </PrintSpace></Page></Layout></alto>`;
}

/** Word index each returned box came from, ascending. */
function matchedIndexes(boxes: { x: number }[]): number[] {
  return boxes.map(b => b.x / 20).sort((a, b) => a - b);
}

describe('AltoService', () => {
  let service: AltoService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AltoService, provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(AltoService);
  });

  describe('getBoxes with a quoted phrase', () => {
    it('matches only adjacent words in the quoted order', () => {
      // "hájek" appears alone at index 0, the phrase occupies indexes 3 and 4.
      const alto = altoWith(['hájek', 'psal', 'že', 'karel', 'hájek', 'přišel']);

      const boxes = service.getBoxes(alto, '"karel hájek"');

      expect(matchedIndexes(boxes)).toEqual([3, 4]);
    });

    it('does not match the phrase words when they are far apart', () => {
      const alto = altoWith(['karel', 'a', 'jeho', 'přítel', 'hájek']);

      const boxes = service.getBoxes(alto, '"karel hájek"');

      expect(boxes).toEqual([]);
    });

    it('matches a phrase in reversed order as no match', () => {
      const alto = altoWith(['hájek', 'karel']);

      const boxes = service.getBoxes(alto, '"karel hájek"');

      expect(boxes).toEqual([]);
    });

    it('matches every occurrence of the phrase on the page', () => {
      const alto = altoWith(['karel', 'hájek', 'x', 'karel', 'hájek']);

      const boxes = service.getBoxes(alto, '"karel hájek"');

      expect(matchedIndexes(boxes)).toEqual([0, 1, 3, 4]);
    });

    it('ignores punctuation attached to phrase words', () => {
      const alto = altoWith(['(karel', 'hájek),']);

      const boxes = service.getBoxes(alto, '"karel hájek"');

      expect(matchedIndexes(boxes)).toEqual([0, 1]);
    });

    it('matches a single-word quoted term', () => {
      const alto = altoWith(['karel', 'hájek']);

      const boxes = service.getBoxes(alto, '"hájek"');

      expect(matchedIndexes(boxes)).toEqual([1]);
    });
  });

  describe('getBoxes without quotes', () => {
    it('still matches each word independently', () => {
      const alto = altoWith(['karel', 'a', 'jeho', 'přítel', 'hájek']);

      const boxes = service.getBoxes(alto, 'karel hájek');

      expect(matchedIndexes(boxes)).toEqual([0, 4]);
    });

    it('matches a bare single word', () => {
      const alto = altoWith(['karel', 'hájek']);

      const boxes = service.getBoxes(alto, 'hájek');

      expect(matchedIndexes(boxes)).toEqual([1]);
    });
  });

  describe('getBoxes mixing a phrase with loose words', () => {
    it('applies phrase adjacency only to the quoted part', () => {
      // Phrase at 0-1; the loose word "praha" matches wherever it appears.
      const alto = altoWith(['karel', 'hájek', 'v', 'praze', 'praha', 'hájek']);

      const boxes = service.getBoxes(alto, '"karel hájek" praha');

      expect(matchedIndexes(boxes)).toEqual([0, 1, 4]);
    });
  });
});
