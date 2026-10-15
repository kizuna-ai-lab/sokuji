import { describe, it, expect } from 'vitest';
import { annotateCyrillic, transliterateRussian, transliterateUkrainian } from './cyrillic';

const RUSSIAN: [string, string][] = [
  ['Москва', 'moskva'], ['Ельцин', 'yeltsin'], ['Пётр', 'pyotr'], ['Счастливого', 'schastlivogo'], ['Хорошо', 'khorosho'],
  ['Подъезд', 'podyezd'], ['Объём', 'obyom'], ['Щука', 'shchuka'], ['Юрий', 'yuriy'], ['Чайковский', 'chaykovskiy'],
  ['Мария', 'mariya'], ['Белый', 'belyy'], ['Спасибо', 'spasibo'], ['встречи', 'vstrechi'], ['поезд', 'poyezd'],
];
// Examples from the official table of Ukraine's 2010 system, lower case.
const UKRAINIAN: [string, string][] = [
  ['Алушта', 'alushta'], ['Андрій', 'andrii'], ['Борщагівка', 'borshchahivka'], ['Вінниця', 'vinnytsia'], ['Гадяч', 'hadiach'],
  ['Згорани', 'zghorany'], ['Ґалаґан', 'galagan'], ['Єнакієве', 'yenakiieve'], ['Наєнко', 'naienko'], ['Житомир', 'zhytomyr'],
  ['Йосипівка', 'yosypivka'], ['Стрий', 'stryi'], ['Їжакевич', 'yizhakevych'], ['Кадиївка', 'kadyivka'], ['Юрій', 'yurii'],
  ['Крюківка', 'kriukivka'], ['Яготин', 'yahotyn'], ['Костянтин', 'kostiantyn'], ["Знам'янка", 'znamianka'],
  ['Щербухи', 'shcherbukhy'], ['Олексій', 'oleksii'], ['Рівне', 'rivne'], ['Харків', 'kharkiv'],
];

describe('transliterateRussian (BGN/PCGN, ASCII)', () => {
  it.each(RUSSIAN)('writes %s as %s', (word, latin) => expect(transliterateRussian(word)).toBe(latin));
});

describe('transliterateUkrainian (2010 national system)', () => {
  it.each(UKRAINIAN)('writes %s as %s', (word, latin) => expect(transliterateUkrainian(word)).toBe(latin));
});

describe('annotateCyrillic', () => {
  it('gives each word one reading, an apostrophe inside a word kept with it', () => {
    expect(annotateCyrillic("Знам'янка, до зустрічі!", 'uk')).toEqual([
      { text: "Знам'янка", reading: 'znamianka' }, { text: ', ' }, { text: 'до', reading: 'do' }, { text: ' ' },
      { text: 'зустрічі', reading: 'zustrichi' }, { text: '!' },
    ]);
  });
  it('uses the table of the language asked for', () => {
    expect(annotateCyrillic('Юрий', 'ru')[0].reading).toBe('yuriy');
    expect(annotateCyrillic('Юрій', 'uk')[0].reading).toBe('yurii');
  });
});
