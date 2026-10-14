import type { RubyPiece } from './types';

// Revised Romanization of Korean (spec 2026-10-15 §2): the sound changes it writes
// (liaison, nasalization, lateralization, palatalization, aspiration), lower case.
// Not handled, stated: n-insertion (학여울), the noun aspiration exception (묵호), names.

const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const VOWELS = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const INITIAL_ROMAN: Record<string, string> = {
  ㄱ: 'g', ㄲ: 'kk', ㄴ: 'n', ㄷ: 'd', ㄸ: 'tt', ㄹ: 'r', ㅁ: 'm', ㅂ: 'b', ㅃ: 'pp', ㅅ: 's',
  ㅆ: 'ss', ㅇ: '', ㅈ: 'j', ㅉ: 'jj', ㅊ: 'ch', ㅋ: 'k', ㅌ: 't', ㅍ: 'p', ㅎ: 'h',
};
const VOWEL_ROMAN: Record<string, string> = {
  ㅏ: 'a', ㅐ: 'ae', ㅑ: 'ya', ㅒ: 'yae', ㅓ: 'eo', ㅔ: 'e', ㅕ: 'yeo', ㅖ: 'ye', ㅗ: 'o', ㅘ: 'wa', ㅙ: 'wae',
  ㅚ: 'oe', ㅛ: 'yo', ㅜ: 'u', ㅝ: 'wo', ㅞ: 'we', ㅟ: 'wi', ㅠ: 'yu', ㅡ: 'eu', ㅢ: 'ui', ㅣ: 'i',
};
/** The sound a coda is read as before a consonant or at the end of a word. */
const CODA_SOUND: Record<string, string> = {
  ㄱ: 'ㄱ', ㄲ: 'ㄱ', ㅋ: 'ㄱ', ㄳ: 'ㄱ', ㄺ: 'ㄱ',
  ㄷ: 'ㄷ', ㅅ: 'ㄷ', ㅆ: 'ㄷ', ㅈ: 'ㄷ', ㅊ: 'ㄷ', ㅌ: 'ㄷ', ㅎ: 'ㄷ',
  ㅂ: 'ㅂ', ㅍ: 'ㅂ', ㅄ: 'ㅂ', ㄿ: 'ㅂ',
  ㄴ: 'ㄴ', ㄵ: 'ㄴ', ㄶ: 'ㄴ',
  ㄹ: 'ㄹ', ㄼ: 'ㄹ', ㄽ: 'ㄹ', ㄾ: 'ㄹ', ㅀ: 'ㄹ',
  ㅁ: 'ㅁ', ㄻ: 'ㅁ', ㅇ: 'ㅇ',
};
const CODA_ROMAN: Record<string, string> = { '': '', ㄱ: 'k', ㄷ: 't', ㅂ: 'p', ㄴ: 'n', ㄹ: 'l', ㅁ: 'm', ㅇ: 'ng' };
/** A cluster before a vowel: the part that stays, the part that moves to the next syllable. */
const SPLIT: Record<string, [string, string]> = {
  ㄳ: ['ㄱ', 'ㅅ'], ㄵ: ['ㄴ', 'ㅈ'], ㄺ: ['ㄹ', 'ㄱ'], ㄻ: ['ㄹ', 'ㅁ'], ㄼ: ['ㄹ', 'ㅂ'],
  ㄽ: ['ㄹ', 'ㅅ'], ㄾ: ['ㄹ', 'ㅌ'], ㄿ: ['ㄹ', 'ㅍ'], ㅄ: ['ㅂ', 'ㅅ'],
};
const NASAL: Record<string, string> = { ㄱ: 'ㅇ', ㄷ: 'ㄴ', ㅂ: 'ㅁ' };
const ASPIRATED: Record<string, string> = { ㄱ: 'ㅋ', ㄷ: 'ㅌ', ㅂ: 'ㅍ', ㅈ: 'ㅊ' };

interface Syllable { initial: string; vowel: string; coda: string }

function decompose(ch: string): Syllable {
  const n = ch.charCodeAt(0) - 0xac00;
  return { initial: INITIALS[Math.floor(n / 588)], vowel: VOWELS[Math.floor((n % 588) / 28)], coda: FINALS[n % 28] };
}

/** The sound changes across one syllable boundary inside a word. */
function join(a: Syllable, b: Syllable): void {
  let coda = a.coda;
  if (!coda) return;
  // Liaison: a coda before a vowel moves over (palatalized before 이).
  if (b.initial === 'ㅇ') {
    if (coda === 'ㅇ') return;
    if (coda === 'ㅎ') { a.coda = ''; return; }
    if (coda === 'ㄶ' || coda === 'ㅀ') { a.coda = ''; b.initial = coda === 'ㄶ' ? 'ㄴ' : 'ㄹ'; return; }
    const [stay, moving] = SPLIT[coda] ?? ['', coda];
    let move = moving;
    if (b.vowel === 'ㅣ' && (move === 'ㄷ' || move === 'ㅌ')) move = move === 'ㄷ' ? 'ㅈ' : 'ㅊ';
    a.coda = stay;
    b.initial = move;
    return;
  }
  // ㅎ in the coda aspirates ㄱ ㄷ ㅈ, vanishes before ㅅ, and reads as ㄴ otherwise.
  if (coda === 'ㅎ' || coda === 'ㄶ' || coda === 'ㅀ') {
    const rest = coda === 'ㅎ' ? '' : coda === 'ㄶ' ? 'ㄴ' : 'ㄹ';
    if (b.initial === 'ㄱ' || b.initial === 'ㄷ' || b.initial === 'ㅈ') { a.coda = rest; b.initial = ASPIRATED[b.initial]; return; }
    if (b.initial === 'ㅅ') { a.coda = rest; return; }
    coda = rest || 'ㄴ';
    a.coda = coda;
  }
  const sound = CODA_SOUND[coda];
  // A stop before ㅎ: aspiration (ㄷ before 히 palatalizes to ㅊ).
  if (b.initial === 'ㅎ' && (sound === 'ㄱ' || sound === 'ㄷ' || sound === 'ㅂ')) {
    const base = coda === 'ㄺ' ? 'ㄱ' : coda === 'ㄼ' ? 'ㅂ' : coda === 'ㅈ' ? 'ㅈ' : sound;
    a.coda = coda === 'ㄺ' || coda === 'ㄼ' ? 'ㄹ' : '';
    b.initial = base === 'ㄷ' && b.vowel === 'ㅣ' ? 'ㅊ' : ASPIRATED[base];
    return;
  }
  if (b.initial === 'ㄹ') {
    if (sound === 'ㄹ') return;                    // ㄹㄹ, written ll
    if (sound === 'ㄴ') { a.coda = 'ㄹ'; return; } // ㄴㄹ → ㄹㄹ
    b.initial = 'ㄴ';                              // ㄹ after ㅁ ㅇ and the stops
  }
  if ((b.initial === 'ㄴ' || b.initial === 'ㅁ') && NASAL[sound]) { a.coda = NASAL[sound]; return; }
  if (b.initial === 'ㄴ' && sound === 'ㄹ') { b.initial = 'ㄹ'; return; } // ㄹㄴ → ㄹㄹ
  if (coda === 'ㄺ' && b.initial === 'ㄱ') { a.coda = 'ㄹ'; }
}

/** One Hangul word in Revised Romanization, lower case. */
export function romanizeHangul(word: string): string {
  const syllables = [...word].map(decompose);
  for (let k = 0; k + 1 < syllables.length; k++) join(syllables[k], syllables[k + 1]);
  let out = '';
  syllables.forEach((s, k) => {
    const before = k > 0 ? CODA_SOUND[syllables[k - 1].coda] : undefined;
    out += s.initial === 'ㄹ' && before === 'ㄹ' ? 'l' : INITIAL_ROMAN[s.initial];
    out += VOWEL_ROMAN[s.vowel];
    out += CODA_ROMAN[s.coda ? CODA_SOUND[s.coda] : ''];
  });
  return out;
}

const HANGUL_RUN = /([가-힣]+)/;

/** One piece per run of Hangul syllables; everything else plain. */
export function annotateKorean(text: string): RubyPiece[] {
  return text
    .split(HANGUL_RUN)
    .filter((part) => part !== '')
    .map((part) => (HANGUL_RUN.test(part) ? { text: part, reading: romanizeHangul(part) } : { text: part }));
}
