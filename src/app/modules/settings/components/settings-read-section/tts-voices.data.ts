export interface TtsVoiceOption {
  name: string;
  code: string;
  gender: string;
  provider: 'browser';
}

export interface VoiceGroup {
  provider: string;
  voices: TtsVoiceOption[];
}

export const SAMPLE_TEXTS: Record<string, string> = {
  cs: 'Bylo nebylo, v daleké zemi žil jeden král, který měl tři syny.',
  sk: 'Bolo raz, v ďalekej krajine žil jeden kráľ, ktorý mal troch synov.',
  en: 'Once upon a time, in a faraway land, there lived a king who had three sons.',
  pl: 'Dawno, dawno temu, w odległej krainie, żył sobie król, który miał trzech synów.',
  de: 'Es war einmal, in einem fernen Land, lebte ein König, der drei Söhne hatte.',
  fr: 'Il était une fois, dans un pays lointain, un roi qui avait trois fils.',
  es: 'Érase una vez, en una tierra lejana, vivía un rey que tenía tres hijos.',
  it: 'C\'era una volta, in una terra lontana, un re che aveva tre figli.',
  pt: 'Era uma vez, numa terra distante, vivia um rei que tinha três filhos.',
  sl: 'Nekoč, v daljni deželi, je živel kralj, ki je imel tri sinove.',
  hu: 'Egyszer volt, hol nem volt, egy távoli országban élt egy király, akinek három fia volt.',
  uk: 'Жив колись у далекій країні один король, і було в нього три сини.',
  ru: 'Жил-был в далёкой стране один король, и было у него три сына.',
  sv: 'Det var en gång, i ett fjärran land, en kung som hade tre söner.',
  et: 'Elas kord kauges maal kuningas, kellel oli kolm poega.',
  lt: 'Seniai seniai, tolimame krašte, gyveno karalius, kuris turėjo tris sūnus.',
  lv: 'Reiz tālā zemē dzīvoja karalis, kuram bija trīs dēli.',
  'zh-CN': '从前，在一个遥远的国度，住着一位国王，他有三个儿子。',
};
