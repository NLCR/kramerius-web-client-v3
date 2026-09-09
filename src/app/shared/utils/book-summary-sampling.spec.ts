import { selectBookSummaryPageIndices } from './book-summary-sampling';

describe('selectBookSummaryPageIndices', () => {
  it('returns every page when the book already fits the budget', () => {
    expect(selectBookSummaryPageIndices(20, 30)).toEqual(
      Array.from({ length: 20 }, (_, i) => i)
    );
  });

  it('returns every page when the book exactly matches the budget', () => {
    expect(selectBookSummaryPageIndices(30, 30)).toEqual(
      Array.from({ length: 30 }, (_, i) => i)
    );
  });

  it('returns nothing for an empty or non-positive input', () => {
    expect(selectBookSummaryPageIndices(0, 30)).toEqual([]);
    expect(selectBookSummaryPageIndices(300, 0)).toEqual([]);
  });

  it('samples the start, middle and end of a book larger than the budget', () => {
    const indices = selectBookSummaryPageIndices(300, 60);

    expect(indices.length).toBeLessThanOrEqual(60);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);

    // Skips likely front matter/back matter (title page, index) at the edges.
    expect(Math.min(...indices)).toBeGreaterThan(0);
    expect(Math.max(...indices)).toBeLessThan(299);

    // Covers all three sections, not just one end.
    expect(indices.some(i => i < 100)).toBe(true);
    expect(indices.some(i => i >= 100 && i < 200)).toBe(true);
    expect(indices.some(i => i >= 200)).toBe(true);
  });

  it('never returns duplicate or out-of-range indices for a tight budget on a small book', () => {
    const indices = selectBookSummaryPageIndices(12, 5);

    expect(new Set(indices).size).toBe(indices.length);
    for (const i of indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(12);
    }
  });

  it('degrades gracefully when the whole book barely exceeds the budget', () => {
    const indices = selectBookSummaryPageIndices(31, 30);

    expect(indices.length).toBeGreaterThan(0);
    expect(new Set(indices).size).toBe(indices.length);
    for (const i of indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(31);
    }
  });
});
