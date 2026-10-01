import { describe, expect, it } from 'vitest';
import { orderLanguages, pinnedLanguages } from './order';

const opts = (...codes: string[]) => codes.map((value) => ({ value }));
const values = (list: { value: string }[]) => list.map((o) => o.value);
const EN = { ui: 'en', browser: ['en-US'] };

describe('orderLanguages', () => {
  it('puts auto first, common languages next in priority order, the rest by English name', () => {
    const out = values(orderLanguages(opts('af', 'ja', 'auto', 'zu', 'en', 'zh-Hans', 'sq'), EN));
    expect(out[0]).toBe('auto');
    expect(out.slice(1, 4)).toEqual(['en', 'zh-Hans', 'ja']);
    // af and zu are in LANGUAGE_PRIORITY (after ja); sq is not, so it comes last.
    expect(out.indexOf('af')).toBeLessThan(out.indexOf('zu'));
    expect(out[out.length - 1]).toBe('sq');
  });

  it('ranks a list holding only zh-Hans and zh-Hant as common, both adjacent', () => {
    const out = values(orderLanguages(opts('sq', 'zh-Hant', 'en', 'zh-Hans'), EN));
    expect(out).toEqual(['en', 'zh-Hans', 'zh-Hant', 'sq']);
  });

  it('orders peers by the UI language first: Traditional first in a zh_TW UI, Simplified first in zh_CN', () => {
    expect(values(orderLanguages(opts('zh-Hans', 'zh-Hant'), { ui: 'zh_TW', browser: [] }))).toEqual(['zh-Hant', 'zh-Hans']);
    expect(values(orderLanguages(opts('zh-Hant', 'zh-Hans'), { ui: 'zh_CN', browser: [] }))).toEqual(['zh-Hans', 'zh-Hant']);
    expect(values(orderLanguages(opts('zh-CN', 'zh-TW'), { ui: 'zh-Hant', browser: [] }))).toEqual(['zh-TW', 'zh-CN']);
  });

  it('lets the browser languages break a tie the UI language leaves', () => {
    expect(values(orderLanguages(opts('zh-Hans', 'zh-Hant'), { ui: 'en', browser: ['en-US', 'zh-TW'] }))).toEqual(['zh-Hant', 'zh-Hans']);
    expect(values(orderLanguages(opts('pt-BR', 'pt-PT'), { ui: 'en', browser: ['pt-PT'] }))).toEqual(['pt-PT', 'pt-BR']);
  });

  it('falls back to English name when nothing about the user matches', () => {
    expect(values(orderLanguages(opts('pt-PT', 'pt-BR'), EN))).toEqual(['pt-BR', 'pt-PT']);
  });

  it('keeps a pair code as its own entry and every option exactly once', () => {
    const input = opts('zh+en', 'zh', 'en', 'ja');
    const out = values(orderLanguages(input, EN));
    expect([...out].sort()).toEqual(values(input).sort());
    expect(out).toContain('zh+en');
  });
});

describe('pinnedLanguages', () => {
  const list = opts('auto', 'en', 'ja', 'zh-Hans', 'zh-Hant', 'es');

  it('pins the pair, then the code closest to the UI language, offered and de-duplicated', () => {
    expect(values(pinnedLanguages(list, { source: 'ja', target: 'zh-Hant' }, { ui: 'zh_CN', browser: [] }))).toEqual(['ja', 'zh-Hant', 'zh-Hans']);
    expect(values(pinnedLanguages(list, { source: 'ja', target: 'zh-Hant' }, { ui: 'zh_TW', browser: [] }))).toEqual(['ja', 'zh-Hant']);
  });

  it('never pins auto, nor a code the list does not offer', () => {
    expect(values(pinnedLanguages(list, { source: 'auto', target: 'fr' }, EN))).toEqual(['en']);
  });
});
