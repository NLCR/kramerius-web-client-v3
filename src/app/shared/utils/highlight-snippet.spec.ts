import { trimSnippetToHighlight } from './highlight-snippet';

describe('trimSnippetToHighlight', () => {
  it('returns the snippet unchanged when it already fits', () => {
    const snippet = 'a short snippet with <strong>match</strong> inside';
    expect(trimSnippetToHighlight(snippet, 200)).toBe(snippet);
  });

  it('drops leading text so the first highlight stays inside the budget', () => {
    // 150 chars of lead-in would push the match past a 60-char budget.
    const lead = 'x'.repeat(150);
    const out = trimSnippetToHighlight(`${lead} <strong>match</strong> tail`, 60);

    expect(out).toContain('<strong>match</strong>');
    expect(visibleLength(out)).toBeLessThanOrEqual(60);
  });

  it('prefixes an ellipsis when text was dropped from the start', () => {
    const out = trimSnippetToHighlight(`${'x'.repeat(150)} <strong>match</strong>`, 60);
    expect(out.startsWith('…')).toBe(true);
  });

  it('keeps some context before the highlight rather than starting at the match', () => {
    const out = trimSnippetToHighlight(
      `${'x'.repeat(150)} context words here <strong>match</strong> tail`,
      60,
    );
    expect(out).toContain('here');
  });

  it('trims the tail so the total visible length respects the budget', () => {
    const out = trimSnippetToHighlight(`<strong>match</strong> ${'y'.repeat(400)}`, 60);
    expect(visibleLength(out)).toBeLessThanOrEqual(60);
    expect(out).toContain('<strong>match</strong>');
  });

  it('never splits a highlight tag', () => {
    const out = trimSnippetToHighlight(`${'x'.repeat(150)} <strong>match</strong> ${'y'.repeat(400)}`, 60);
    expect(countOccurrences(out, '<strong>')).toBe(countOccurrences(out, '</strong>'));
    expect(out).toContain('<strong>match</strong>');
  });

  it('keeps a later highlight when the first one is dropped by tail trimming', () => {
    const out = trimSnippetToHighlight(
      `<strong>one</strong> ${'y'.repeat(400)} <strong>two</strong>`,
      60,
    );
    expect(out).toContain('<strong>one</strong>');
  });

  it('trims a plain snippet with no highlight to the budget', () => {
    const out = trimSnippetToHighlight('z'.repeat(400), 60);
    expect(visibleLength(out)).toBeLessThanOrEqual(60);
  });

  it('handles an empty snippet', () => {
    expect(trimSnippetToHighlight('', 60)).toBe('');
  });

  it('handles a highlight longer than the whole budget', () => {
    const long = 'w'.repeat(200);
    const out = trimSnippetToHighlight(`lead <strong>${long}</strong> tail`, 60);
    expect(out).toContain(`<strong>${long}</strong>`);
  });

  it('is stable when called twice', () => {
    const once = trimSnippetToHighlight(`${'x'.repeat(150)} <strong>match</strong> ${'y'.repeat(200)}`, 60);
    expect(trimSnippetToHighlight(once, 60)).toBe(once);
  });

  // The bug this util exists for: a real Solr fragment whose match sits past
  // what the card's 4-line clamp shows (~71 chars in a 131px box), so the term
  // was rendered into the clipped overflow. Verified against live Solr data,
  // where 28% of page snippets hid their match this way.
  it('pulls a late match into a card-sized budget', () => {
    const real =
      ' - bratr (salvatorián) Matocha Josef Karel (1888-1961), biskup (arcibiskup olomoucký) ' +
      'Mimra František Xaver (1886-1952), <strong>kněz</strong>';

    const out = trimSnippetToHighlight(real, 70);

    expect(out).toContain('<strong>kněz</strong>');
    expect(visibleLength(out)).toBeLessThanOrEqual(70);
  });

  it('strips the BOM some OCR snippets start with', () => {
    expect(trimSnippetToHighlight('﻿MARTYROVÉ <strong>kněz</strong>', 200))
      .toBe('MARTYROVÉ <strong>kněz</strong>');
  });
});

function visibleLength(html: string): number {
  return html.replace(/<\/?strong>/g, '').length;
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
