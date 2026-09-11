/**
 * Re-centers a Solr highlight snippet around its first `<strong>` match so the
 * match survives a CSS line clamp.
 *
 * Solr's `original` highlighter honors `hl.fragsize` only loosely: fragments
 * come back anywhere from ~130 to ~350 visible characters, and the first match
 * can sit ~90 characters in. The clamped snippet boxes (4 lines on a record-item
 * card, 5 in the reader's result rows) fit far less than that, and a clamp cuts
 * from the end — so the searched term was often rendered into the hidden
 * overflow. Trimming the lead-in here keeps it in the visible window.
 *
 * Only `<strong>`/`</strong>` are treated as markup, matching `hl.simple.pre`
 * and `hl.simple.post` in solr-query-builder.ts; everything else is literal
 * text, so the result stays safe for the same `innerHTML` bindings as before.
 *
 * @param snippet Highlighted snippet as returned by Solr.
 * @param maxVisibleChars Roughly how many characters the clamped box shows.
 * @returns The snippet trimmed to that budget, with the first match inside it.
 */
export function trimSnippetToHighlight(snippet: string, maxVisibleChars: number): string {
  // OCR fields frequently start with a BOM, which renders as a stray glyph.
  const text = snippet.replace(/^﻿/, '');
  if (!text) return '';

  const tokens = tokenize(text);
  const visibleTotal = tokens.reduce((sum, t) => sum + (t.tag ? 0 : t.text.length), 0);
  if (visibleTotal <= maxVisibleChars) return text;

  // Keep a little context ahead of the match instead of starting on it, so the
  // term reads in a sentence rather than looking like a truncated fragment.
  const leadBudget = Math.floor(maxVisibleChars * LEAD_CONTEXT_RATIO);
  const firstMatchAt = visibleOffsetOfFirstMatch(tokens);
  const dropBefore = firstMatchAt === null ? 0 : Math.max(0, firstMatchAt - leadBudget);

  // The ellipses are visible characters too, so they come out of the budget.
  const ellipses = (dropBefore > 0 ? 1 : 0) + 1;
  const budget = Math.max(1, maxVisibleChars - ellipses);
  const { html, trimmedStart, trimmedEnd } = slice(tokens, dropBefore, dropBefore + budget);

  return `${trimmedStart ? ELLIPSIS : ''}${html}${trimmedEnd ? ELLIPSIS : ''}`;
}

const ELLIPSIS = '…';
const LEAD_CONTEXT_RATIO = 0.25;
const OPEN_TAG = '<strong>';
const CLOSE_TAG = '</strong>';

interface Token {
  text: string;
  /** True for a `<strong>`/`</strong>` marker, which occupies no visible width. */
  tag: boolean;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /<\/?strong>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) tokens.push({ text: text.slice(cursor, match.index), tag: false });
    tokens.push({ text: match[0], tag: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) tokens.push({ text: text.slice(cursor), tag: false });

  return tokens;
}

/** Visible-character offset where the first highlighted run starts, or null if unhighlighted. */
function visibleOffsetOfFirstMatch(tokens: Token[]): number | null {
  let visible = 0;
  for (const token of tokens) {
    if (token.tag) {
      if (token.text === OPEN_TAG) return visible;
    } else {
      visible += token.text.length;
    }
  }
  return null;
}

/**
 * Cuts the token stream to the visible range [from, to), snapping the edges to
 * word boundaries and re-balancing any highlight left open by the cut.
 */
function slice(tokens: Token[], from: number, to: number): { html: string; trimmedStart: boolean; trimmedEnd: boolean } {
  const parts: string[] = [];
  let visible = 0;
  let open = false;
  let trimmedEnd = false;

  for (const token of tokens) {
    if (token.tag) {
      // `open` follows the source stream, not the output: a `</strong>` past the
      // range still has to close the run, or the text after it would be treated
      // as highlighted and kept whole.
      open = token.text === OPEN_TAG;
      // A tag only belongs in the output once its own position is inside the range.
      if (visible >= from && visible <= to) parts.push(token.text);
      continue;
    }

    const start = visible;
    visible += token.text.length;
    if (visible <= from) continue;
    // `open` text is part of a highlighted run, which is kept whole even when it
    // alone overruns the budget — dropping it defeats the point of the trim.
    if (start >= to && !open) {
      trimmedEnd = true;
      continue;
    }

    // A highlighted run is never cut: it is short and it is the whole point.
    const chunk = open
      ? token.text
      : token.text.slice(Math.max(0, from - start), Math.max(0, to - start));
    if (chunk.length < token.text.length) trimmedEnd = trimmedEnd || visible > to;
    parts.push(chunk);
  }

  let html = parts.join('');
  const trimmedStart = from > 0;
  // The boundary tidy-up must not reach into markup: a highlighted run holds no
  // whitespace of its own, so an unanchored trim would swallow the whole match.
  if (trimmedStart) html = trimPartialWord(html, 'start');
  if (trimmedEnd) html = trimPartialWord(html, 'end');

  return { html: balanceTags(html.trim()), trimmedStart, trimmedEnd };
}

/**
 * Drops the half-word a cut left at one edge, but only from the plain-text run
 * on that edge — never across a `<strong>` boundary into the match itself.
 */
function trimPartialWord(html: string, edge: 'start' | 'end'): string {
  if (edge === 'start') {
    const upToFirstTag = html.indexOf('<');
    const head = upToFirstTag === -1 ? html : html.slice(0, upToFirstTag);
    return html.replace(head, head.replace(/^\S*\s+/, ''));
  }

  const afterLastTag = html.lastIndexOf('>');
  const tail = afterLastTag === -1 ? html : html.slice(afterLastTag + 1);
  const trimmedTail = tail.replace(/\s+\S*$/, '');
  return afterLastTag === -1 ? trimmedTail : html.slice(0, afterLastTag + 1) + trimmedTail;
}

/** Closes a `<strong>` the cut left open, or drops a `</strong>` whose opener was cut away. */
function balanceTags(html: string): string {
  const opens = countOccurrences(html, OPEN_TAG);
  const closes = countOccurrences(html, CLOSE_TAG);
  if (opens > closes) return `${html}${CLOSE_TAG}`;
  if (closes > opens) return html.replace(CLOSE_TAG, '');
  return html;
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
