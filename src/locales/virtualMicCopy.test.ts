// The virtual microphone's line under "Translation the other side hears" says the user chooses the
// virtual microphone in their meeting app, translated in all 30 interface languages.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES = join(__dirname);
const codes = readdirSync(LOCALES).filter((name) => statSync(join(LOCALES, name)).isDirectory()).sort();
const tipIn = (code: string): string => JSON.parse(readFileSync(join(LOCALES, code, 'translation.json'), 'utf8')).audioPanel.otherHearsTip;

// Read and checked by hand, one row per language: the virtual microphone, the meeting app, and "choose / select".
const WORDING: Record<string, readonly [virtualMic: string, meetingApp: string, choose: string]> = {
  ar: ['الميكروفون الافتراضي', 'تطبيق اجتماعك', 'اخترْه'],
  bn: ['ভার্চুয়াল মাইক্রোফোন', 'মিটিং অ্যাপে', 'বেছে নিন'],
  de: ['virtuelle Mikrofon', 'Meeting-App', 'Wählen Sie'],
  en: ['virtual microphone', 'meeting app', 'choose it'],
  es: ['micrófono virtual', 'aplicación de la reunión', 'elígelo'],
  fa: ['میکروفون مجازی', 'برنامهٔ جلسهٔ', 'انتخاب کنید'],
  fi: ['Virtuaalimikrofoniin', 'kokoussovelluksessasi', 'valitse'],
  fil: ['virtual na mikropono', 'meeting app', 'piliin'],
  fr: ['micro virtuel', 'application de réunion', 'choisissez'],
  he: ['המיקרופון הווירטואלי', 'אפליקציית הפגישה', 'בחר'],
  hi: ['वर्चुअल माइक्रोफ़ोन', 'मीटिंग ऐप्लिकेशन', 'चुनें'],
  id: ['mikrofon virtual', 'aplikasi rapat', 'pilih'],
  it: ['microfono virtuale', 'app di riunione', 'selezionalo'],
  ja: ['仮想マイク', '会議アプリ', '選んでください'],
  ko: ['가상 마이크', '회의 앱', '선택하세요'],
  ms: ['mikrofon maya', 'aplikasi mesyuarat', 'pilih'],
  nl: ['virtuele microfoon', 'vergader-app', 'kies'],
  pl: ['wirtualnego mikrofonu', 'aplikacji konferencyjnej', 'wybierz'],
  pt_BR: ['microfone virtual', 'aplicativo de reunião', 'escolha-o'],
  pt_PT: ['microfone virtual', 'aplicação de reunião', 'escolha-o'],
  ru: ['виртуальный микрофон', 'приложении для встреч', 'выберите'],
  sv: ['virtuella mikrofonen', 'mötesapplikation', 'välj'],
  ta: ['மெய்நிகர் மைக்ரோஃபோன', 'மாநாட்டு பயன்பாட்டில்', 'தேர்ந்தெடுக்கவும்'],
  te: ['వర్చువల్ మైక్రోఫోన్', 'మీటింగ్ యాప్', 'ఎంచుకోండి'],
  th: ['ไมโครโฟนเสมือน', 'แอปการประชุม', 'เลือกใช้'],
  tr: ['Sanal mikrofon', 'toplantı uygulamanızda', 'seçin'],
  uk: ['віртуальний мікрофон', 'додатку для конференцій', 'виберіть'],
  vi: ['micro ảo', 'ứng dụng họp', 'hãy chọn'],
  zh_CN: ['虚拟麦克风', '会议软件', '选为麦克风'],
  zh_TW: ['虛擬麥克風', '會議應用程式', '選擇它作為麥克風'],
};

describe('the virtual microphone line, in every interface language', () => {
  it('covers the 30 interface languages', () => {
    expect(codes).toHaveLength(30);
    expect(codes).toEqual(Object.keys(WORDING).sort());
  });

  it.each(codes)('%s: says to choose the virtual microphone in the meeting app', (code) => {
    const tip = tipIn(code);
    for (const words of WORDING[code]) expect(tip, code).toContain(words);
  });

  it.each(codes.filter((c) => c !== 'en'))('%s: is translated, not left in English', (code) => {
    expect(tipIn(code)).not.toBe(tipIn('en'));
    // Filipino keeps "meeting app" as a loanword; the English sentence itself must not be there.
    expect(tipIn(code)).not.toMatch(/choose it as the microphone/i);
  });

  it('no longer says the other side picks it in their own app', () => {
    expect(tipIn('en')).not.toMatch(/other side picks|their own app/);
  });
});
