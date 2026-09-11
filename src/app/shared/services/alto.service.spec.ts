import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AltoService } from './alto.service';

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
