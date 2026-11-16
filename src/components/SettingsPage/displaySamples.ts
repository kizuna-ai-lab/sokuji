// src/components/SettingsPage/displaySamples.ts
//
// The display preview's sample conversation in the languages the user translates between (B-22): the same three
// lines in each language — mine, theirs, mine — about a delivery date. A pair language without a sample, or a
// source left to auto-detection, takes the interface language; failing that, English.

/** The three lines: I ask about the delivery, they answer, I ask again. */
export type SampleLines = readonly [mine1: string, theirs: string, mine2: string];

export const SAMPLE_LINES: Readonly<Record<string, SampleLines>> = {
  en: ['Can you deliver by next Wednesday?', 'It depends on the certification test results.', 'When will the results be out?'],
  zh: ['下周三之前能交货吗？', '要看认证测试的结果。', '结果什么时候出来？'],
  'zh-Hant': ['下週三之前能交貨嗎？', '要看認證測試的結果。', '結果什麼時候出來？'],
  ja: ['来週の水曜日までに納品できますか？', '認証試験の結果次第です。', '結果はいつ出ますか？'],
  ko: ['다음 주 수요일까지 납품할 수 있나요?', '인증 시험 결과에 따라 달라요.', '결과는 언제 나오나요?'],
  es: ['¿Pueden entregar antes del próximo miércoles?', 'Depende de los resultados de la prueba de certificación.', '¿Cuándo salen los resultados?'],
  fr: ['Pouvez-vous livrer d’ici mercredi prochain ?', 'Cela dépend des résultats du test de certification.', 'Quand les résultats seront-ils disponibles ?'],
  de: ['Können Sie bis nächsten Mittwoch liefern?', 'Das hängt von den Ergebnissen der Zertifizierungsprüfung ab.', 'Wann kommen die Ergebnisse?'],
  pt: ['Vocês conseguem entregar até a próxima quarta-feira?', 'Depende dos resultados do teste de certificação.', 'Quando saem os resultados?'],
  it: ['Potete consegnare entro mercoledì prossimo?', 'Dipende dai risultati del test di certificazione.', 'Quando escono i risultati?'],
  nl: ['Kunnen jullie vóór volgende woensdag leveren?', 'Dat hangt af van de resultaten van de certificeringstest.', 'Wanneer komen de resultaten?'],
  sv: ['Kan ni leverera före nästa onsdag?', 'Det beror på resultaten från certifieringstestet.', 'När kommer resultaten?'],
  da: ['Kan I levere inden næste onsdag?', 'Det afhænger af resultaterne af certificeringstesten.', 'Hvornår kommer resultaterne?'],
  fi: ['Voitteko toimittaa ensi keskiviikkoon mennessä?', 'Se riippuu sertifiointitestin tuloksista.', 'Milloin tulokset tulevat?'],
  pl: ['Czy możecie dostarczyć do przyszłej środy?', 'To zależy od wyników testu certyfikacyjnego.', 'Kiedy będą wyniki?'],
  ru: ['Сможете поставить до следующей среды?', 'Это зависит от результатов сертификационных испытаний.', 'Когда будут результаты?'],
  uk: ['Чи зможете поставити до наступної середи?', 'Це залежить від результатів сертифікаційних випробувань.', 'Коли будуть результати?'],
  tr: ['Önümüzdeki çarşambaya kadar teslim edebilir misiniz?', 'Sertifikasyon testinin sonuçlarına bağlı.', 'Sonuçlar ne zaman çıkar?'],
  ar: ['هل يمكنكم التسليم قبل الأربعاء القادم؟', 'يعتمد ذلك على نتائج اختبار الاعتماد.', 'متى ستظهر النتائج؟'],
  he: ['תוכלו לספק עד יום רביעי הבא?', 'זה תלוי בתוצאות מבחן ההסמכה.', 'מתי יצאו התוצאות?'],
  fa: ['می‌توانید تا چهارشنبهٔ آینده تحویل بدهید؟', 'بستگی به نتایج آزمون گواهی‌نامه دارد.', 'نتایج کی اعلام می‌شود؟'],
  ur: ['کیا آپ اگلے بدھ تک ڈیلیوری کر سکتے ہیں؟', 'یہ سرٹیفیکیشن ٹیسٹ کے نتائج پر منحصر ہے۔', 'نتائج کب آئیں گے؟'],
  hi: ['क्या आप अगले बुधवार तक डिलीवरी कर सकते हैं?', 'यह सर्टिफ़िकेशन टेस्ट के नतीजों पर निर्भर करता है।', 'नतीजे कब आएँगे?'],
  bn: ['আপনারা কি আগামী বুধবারের মধ্যে ডেলিভারি দিতে পারবেন?', 'এটা সার্টিফিকেশন পরীক্ষার ফলাফলের উপর নির্ভর করে।', 'ফলাফল কবে বের হবে?'],
  ta: ['அடுத்த புதன்கிழமைக்குள் டெலிவரி செய்ய முடியுமா?', 'அது சான்றிதழ் சோதனையின் முடிவுகளைப் பொறுத்தது.', 'முடிவுகள் எப்போது வரும்?'],
  te: ['వచ్చే బుధవారం లోపు డెలివరీ చేయగలరా?', 'అది సర్టిఫికేషన్ పరీక్ష ఫలితాలపై ఆధారపడి ఉంటుంది.', 'ఫలితాలు ఎప్పుడు వస్తాయి?'],
  th: ['ส่งของได้ก่อนวันพุธหน้าไหม', 'ขึ้นอยู่กับผลการทดสอบเพื่อรับรอง', 'ผลจะออกเมื่อไร'],
  vi: ['Bên anh có thể giao hàng trước thứ Tư tuần sau không?', 'Còn tùy vào kết quả kiểm định chứng nhận.', 'Khi nào có kết quả?'],
  id: ['Bisakah Anda mengirim sebelum Rabu depan?', 'Tergantung pada hasil uji sertifikasi.', 'Kapan hasilnya keluar?'],
  ms: ['Bolehkah anda menghantar sebelum Rabu depan?', 'Ia bergantung pada keputusan ujian pensijilan.', 'Bilakah keputusannya akan keluar?'],
  fil: ['Maihahatid ba ninyo bago ang susunod na Miyerkules?', 'Depende iyan sa resulta ng certification test.', 'Kailan lalabas ang resulta?'],
};

const TRADITIONAL = new Set(['hant', 'tw', 'hk', 'mo']);

/**
 * The sample a language code stands for, or null: app codes (`zh-TW`), interface codes (`zh_CN`, `pt_BR`) and a
 * bidirectional pair code's first half (`zh+en`) all resolve; `auto` and a language without a sample give null.
 */
export function sampleKey(code: string | null | undefined): string | null {
  if (!code) return null;
  const [primary, ...subtags] = code.split('+')[0].toLowerCase().split(/[-_]/);
  if (primary === 'zh' || primary === 'cmn') return subtags.some((s) => TRADITIONAL.has(s)) ? 'zh-Hant' : 'zh';
  if (primary === 'tl') return 'fil';
  return primary in SAMPLE_LINES ? primary : null;
}

/** The language badge a sample shows: its primary code in capitals. */
export function badgeCode(key: string): string {
  return key.split('-')[0].toUpperCase();
}

export interface PreviewLanguages {
  /** The language I speak in the sample (the pair's source). */
  mine: string;
  /** The language the other side speaks (the pair's target). */
  theirs: string;
}

/**
 * The sample's two languages: the pair's, a side without a sample taking the interface language, then English.
 * When both land on one language, the side that fell back gives way (the other side's, when both did) to English,
 * or to Chinese when the other is English, so the preview always shows a translation between two languages.
 */
export function previewLanguages(pair: { source: string; target: string } | null | undefined, uiLanguage: string | null | undefined): PreviewLanguages {
  const fallback = sampleKey(uiLanguage) ?? 'en';
  const fromMine = sampleKey(pair?.source);
  const fromTheirs = sampleKey(pair?.target);
  let mine = fromMine ?? fallback;
  let theirs = fromTheirs ?? fallback;
  if (mine === theirs) {
    const other = mine === 'en' ? 'zh' : 'en';
    if (!fromTheirs) theirs = other;
    else mine = other;
  }
  return { mine, theirs };
}
