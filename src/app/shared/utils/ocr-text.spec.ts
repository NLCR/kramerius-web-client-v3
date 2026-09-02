import { normalizeOcrText } from './ocr-text';

describe('normalizeOcrText', () => {
  it('repairs UTF-8 text decoded as Windows-1252', () => {
    expect(normalizeOcrText('PalackÃ½ dÃ­, tÄ›lesnÃ¡ poroba â€“ vÄ›ci neznÃ¡mÃ©'))
      .toBe('Palacký dí, tělesná poroba – věci neznámé');
  });

  it('removes shifted UTF-16 debris from mixed Latin words without a word list', () => {
    const damaged = 'PalackÃ½: 뿯붿upokojil se, smutn뿯½ duch suš뿯½ kosti a zdrav뿯½ zrak';
    const normalized = normalizeOcrText(damaged);

    expect(normalized).toBe('Palacký: upokojil se, smutn duch suš kosti a zdrav zrak');
    expect(normalized).not.toMatch(/[\uAC00-\uD7AF\uE000-\uF8FF\uFFFD]/);
  });

  it('removes controls, expands ligatures and joins line-end hyphenation', () => {
    expect(normalizeOcrText('ne\u0000-\u2401\nznámé ﬁlozoﬁcké  dílo'))
      .toBe('neznámé filozofické dílo');
  });

  it('preserves genuine non-Latin text and meaningful fractions', () => {
    expect(normalizeOcrText('한국어 문서 ½ stránky')).toBe('한국어 문서 ½ stránky');
  });

  it('handles empty input', () => {
    expect(normalizeOcrText('')).toBe('');
    expect(normalizeOcrText(null)).toBe('');
  });
});
