/**
 * Repairs transport/encoding damage that is safe to fix without knowing the
 * language of the document. Linguistic OCR substitutions are intentionally left
 * to the local language model: guessing them here would corrupt names, numbers
 * and historical spelling.
 */
export function normalizeOcrText(input: string | null | undefined): string {
  if (!input) return '';

  let text = repairUtf8Mojibake(input.replace(/^\uFEFF/, ''));

  text = text
    .normalize('NFC')
    // Common OCR ligatures are valid Unicode, but neither TTS nor all local
    // models tokenize them as reliably as their ordinary letter equivalents.
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\uFB05|\uFB06/g, 'st')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00AD/g, '')
    // Keep tab/newline, remove binary controls, their visible control-picture
    // variants, bidi marks and zero-width transport debris.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2400-\u2426]/g, '')
    .replace(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '')
    .replace(/\uFFFD/g, '');

  // A legacy proxy can expand an invalid UTF-16 byte into EF BF BD and then
  // decode the shifted pairs into Hangul/private-use characters (e.g. 뿯½).
  // Remove these only inside a token that also contains Latin letters; genuine
  // Korean text, including a wholly Korean document, is therefore preserved.
  text = text.replace(/\S+/gu, token => {
    if (!/\p{Script=Latin}/u.test(token) || !/\p{Script=Hangul}/u.test(token)) return token;
    return token.replace(/[\p{Script=Hangul}\uE000-\uF8FF]+[½¼¾]?/gu, '');
  });

  // Mixed damage may initially contain characters that cannot be represented
  // as legacy bytes. Once those artifacts are gone, a second pass can safely
  // recover mojibake elsewhere in the same line.
  text = repairUtf8Mojibake(text);

  return text
    // Join words split only by a line-end hyphen. A hyphen followed by an upper
    // case letter is retained because it is more likely semantic punctuation.
    .replace(/(\p{L})-[ \t]*\n[ \t]*(?=\p{Ll})/gu, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function repairUtf8Mojibake(input: string): string {
  let text = input;
  for (let attempt = 0; attempt < 2; attempt++) {
    const repaired = decodeUtf8Mojibake(text);
    if (repaired && corruptionScore(repaired) < corruptionScore(text)) {
      text = repaired;
      continue;
    }

    // A line can mix already-correct Czech (not representable in Windows-1252)
    // with a damaged fragment. Repair only characteristic UTF-8 byte groups in
    // that case, leaving surrounding Unicode untouched.
    const fragmentPattern = /(?:[ÃÂÄÅÆÐÑØÞ].|â..|ð...|ï..)+/gu;
    const fragmentRepaired = text.replace(fragmentPattern, fragment => {
      const candidate = decodeUtf8Mojibake(fragment);
      return candidate && corruptionScore(candidate) < corruptionScore(fragment)
        ? candidate
        : fragment;
    });
    if (fragmentRepaired === text) break;
    text = fragmentRepaired;
  }
  return text;
}

/** Windows-1252 characters whose original byte is not equal to the code point. */
const WINDOWS_1252_BYTES = new Map<number, number>([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C],
  [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93],
  [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B],
  [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F],
]);

/** Tries the inverse of the common UTF-8-as-Windows-1252 decoding mistake. */
function decodeUtf8Mojibake(value: string): string | null {
  const bytes: number[] = [];
  for (const character of value) {
    const code = character.codePointAt(0)!;
    const legacyByte = code <= 0xFF ? code : WINDOWS_1252_BYTES.get(code);
    if (legacyByte === undefined) return null;
    bytes.push(legacyByte);
  }

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    return decoded === value ? null : decoded;
  } catch {
    return null;
  }
}

/** Lower is better; only accept a mojibake repair when it is measurably safer. */
function corruptionScore(value: string): number {
  const matches = (pattern: RegExp): number => value.match(pattern)?.length ?? 0;
  return matches(/[\uFFFD\uE000-\uF8FF]/gu) * 12
    + matches(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g) * 8
    + matches(/[ÃÂÄÅÆÐÑØÞâ]/g) * 3
    + matches(/(?:â€|ðŸ|ï»¿|Â\s)/g) * 6;
}
