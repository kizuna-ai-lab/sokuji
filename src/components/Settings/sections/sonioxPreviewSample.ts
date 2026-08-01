/**
 * Sample sentences spoken when auditioning a Soniox voice.
 *
 * These are TTS *input*, not UI copy: the key is the TTS target language, not
 * the user's UI locale, so they deliberately live here as literals instead of
 * going through i18n. Soniox's REST payload requires `language` alongside
 * `text`, and a mismatched pair makes the model read the sentence with the
 * wrong phonology — hence `previewSampleFor` returns the pair, never a bare
 * string, so no caller can construct the mismatch.
 *
 * Seeded with the 28 Soniox codes the app's 30 UI locales map onto
 * (`fil→tl`, `pt_BR`/`pt_PT→pt`, `zh_CN`/`zh_TW→zh`) — i.e. the languages
 * the product actually serves. The remaining Soniox target languages fall
 * back to English; timbre still reads correctly because cloned voices are
 * officially any-voice-any-language.
 *
 * Sentences are neutral (they never say "cloned") so the table can be reused
 * if built-in voice preview lands later, and short (~2-3 s) to keep each
 * audition cheap and fast.
 */

export interface PreviewSample {
  language: string;
  text: string;
}

export const PREVIEW_SAMPLES: Record<string, string> = {
  ar: 'مرحبًا. هذه عينة قصيرة لصوت هذا المتحدث.',
  bn: 'নমস্কার। এটি এই কণ্ঠস্বরের একটি সংক্ষিপ্ত নমুনা।',
  de: 'Hallo. Dies ist eine kurze Hörprobe dieser Stimme.',
  en: 'Hello. This is a short preview of how this voice sounds.',
  es: 'Hola. Esta es una breve muestra de cómo suena esta voz.',
  fa: 'سلام. این یک نمونه کوتاه از صدای این گوینده است.',
  fi: 'Hei. Tämä on lyhyt näyte siitä, miltä tämä ääni kuulostaa.',
  fr: 'Bonjour. Voici un bref aperçu du son de cette voix.',
  he: 'שלום. זו דוגמה קצרה לאיך הקול הזה נשמע.',
  hi: 'नमस्ते। यह इस आवाज़ का एक छोटा सा नमूना है।',
  id: 'Halo. Ini adalah contoh singkat suara ini.',
  it: 'Ciao. Questa è una breve anteprima di come suona questa voce.',
  ja: 'こんにちは。これはこの声の短い試聴です。',
  ko: '안녕하세요. 이 목소리의 짧은 미리 듣기입니다.',
  ms: 'Helo. Ini ialah contoh pendek bunyi suara ini.',
  nl: 'Hallo. Dit is een korte voorproef van hoe deze stem klinkt.',
  pl: 'Cześć. To krótka próbka tego, jak brzmi ten głos.',
  pt: 'Olá. Esta é uma breve amostra de como esta voz soa.',
  ru: 'Здравствуйте. Это короткий пример того, как звучит этот голос.',
  sv: 'Hej. Det här är ett kort smakprov på hur den här rösten låter.',
  ta: 'வணக்கம். இது இந்தக் குரலின் ஒரு சிறு மாதிரி.',
  te: 'నమస్కారం. ఇది ఈ స్వరం యొక్క ఒక చిన్న నమూనా.',
  th: 'สวัสดี นี่คือตัวอย่างสั้น ๆ ของเสียงนี้',
  tl: 'Kumusta. Ito ay isang maikling halimbawa ng tunog ng boses na ito.',
  tr: 'Merhaba. Bu, bu sesin nasıl duyulduğuna dair kısa bir örnektir.',
  uk: 'Вітаю. Це короткий приклад того, як звучить цей голос.',
  vi: 'Xin chào. Đây là đoạn nghe thử ngắn của giọng nói này.',
  zh: '你好，这是这个声音的简短试听。',
};

const FALLBACK_LANGUAGE = 'en';

/** The (text, language) pair to synthesize when auditioning a voice. */
export function previewSampleFor(language: string): PreviewSample {
  // `PREVIEW_SAMPLES` is a plain object literal, so a bracket lookup with an
  // untrusted key (e.g. `previewSampleFor('constructor')`) would otherwise
  // resolve to an inherited Object.prototype member instead of `undefined` —
  // and `JSON.stringify` silently drops that function value from the TTS
  // request body, producing a confusing server 400 instead of the intended
  // English fallback. hasOwnProperty guards against exactly that.
  const hasSample = Object.prototype.hasOwnProperty.call(PREVIEW_SAMPLES, language);
  const text = hasSample ? PREVIEW_SAMPLES[language] : undefined;
  return text
    ? { language, text }
    : { language: FALLBACK_LANGUAGE, text: PREVIEW_SAMPLES[FALLBACK_LANGUAGE] };
}
