/**
 * Picks a representative sample of page indices for a whole-book AI summary,
 * within a page budget dictated by the model's context size.
 *
 * A book rarely fits the AI request's token budget in full, so instead of
 * chunking the whole text (which would need one LLM call per chunk) we sample
 * pages: 30% from the start, 30% from the end and 40% spread evenly through
 * the middle, so the summary sees the setup, the resolution and the main
 * turns in between from a single request.
 */
export function selectBookSummaryPageIndices(totalPages: number, pageBudget: number): number[] {
  if (totalPages <= 0 || pageBudget <= 0) return [];
  if (totalPages <= pageBudget) {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  // The first/last few pages of a scanned book are usually a title page,
  // table of contents or index rather than narrative content - excluding them
  // keeps the start/end samples representative. Capped so it never eats a
  // meaningful share of a short book.
  const edgeSkip = Math.min(5, Math.floor(totalPages * 0.03));
  const contentStart = edgeSkip;
  const contentEnd = totalPages - edgeSkip;
  const contentLength = Math.max(0, contentEnd - contentStart);

  const startCount = Math.min(Math.round(pageBudget * 0.3), contentLength);
  const endCount = Math.min(Math.round(pageBudget * 0.3), contentLength - startCount);
  const middleCount = Math.max(0, Math.min(pageBudget - startCount - endCount, contentLength - startCount - endCount));

  const indices = new Set<number>();
  for (let i = 0; i < startCount; i++) indices.add(contentStart + i);
  for (let i = 0; i < endCount; i++) indices.add(contentEnd - 1 - i);

  const middleRangeStart = contentStart + startCount;
  const middleRangeEnd = contentEnd - endCount;
  const middleRangeLength = middleRangeEnd - middleRangeStart;
  if (middleCount > 0 && middleRangeLength > 0) {
    for (let i = 0; i < middleCount; i++) {
      const position = middleRangeStart + Math.floor((i + 0.5) * middleRangeLength / middleCount);
      indices.add(Math.min(position, middleRangeEnd - 1));
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}
