// Build the parity row set for sat-3l-sm: every row of results/inputs.json, plus rows the corpus
// does not exercise (the corpus tops out at 65 subwords, so it never reaches wtpsplit's windowing):
// long concatenations that need several overlapping 510-subword windows, and tokenizer edge cases
// (non-BMP characters, ZWJ emoji, combining marks, NFKC-expanding characters, half-width kana,
// input newlines, leading/trailing/whitespace-only/empty input, characters XLM-R has no piece for).
// usage: node tools/dump-inputs.mjs && node parity/sat-3l-sm.rows.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = JSON.parse(await readFile(join(root, 'results', 'inputs.json'), 'utf8'));
const rows = inputs.map((r) => ({ id: r.id, lang: r.lang, variant: r.variant, input: r.input }));

const sep = (lang) => (lang === 'ja' || lang === 'zh' ? '' : ' ');
for (const lang of ['ja', 'zh', 'en', 'ko']) {
  const stripped = inputs.filter((r) => r.lang === lang && r.variant === (lang === 'en' ? 'lower' : 'stripped')).map((r) => r.input);
  const commas = inputs.filter((r) => r.lang === lang && r.variant === 'commas').map((r) => r.input);
  const s = sep(lang);
  rows.push({ id: `long1-${lang}`, lang, variant: 'long', input: stripped.join(s) });
  rows.push({ id: `long2-${lang}`, lang, variant: 'long', input: [...stripped, ...commas].join(s) });
  rows.push({ id: `long3-${lang}`, lang, variant: 'long', input: [stripped, commas, stripped].flat().join(s) });
}

const cp = (...codes) => String.fromCodePoint(...codes);
const edge = [
  ['en', '  leading and trailing spaces  '],
  ['en', 'line one\nline two\n\nline three and then some more words here'],
  ['en', `emoji ${cp(0x1f600)} and ${cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)} family ok then we go home`],
  ['ja', `${cp(0xff76, 0xff80, 0xff76, 0xff85, 0xff83, 0xff9e, 0xff7d)}${cp(0x3000)}全角スペース${cp(0xff11, 0xff12, 0xff13)}です`],
  ['en', `caf${cp(0xe9)} na${cp(0xef)}ve cafe${cp(0x301)} combining marks are fine`],
  ['ja', `${cp(0x337f)}の${cp(0x2460)} ${cp(0x2121)} ${cp(0xfb01)} ligatures です`],
  ['en', `${cp(0x01)}control${cp(0x07)} chars here`],
  ['ja', `${cp(0x20bb7)}野家に行きました${cp(0x2a6a5)}という字は珍しい${cp(0x4e02, 0x4e04, 0x4e05)}`],
  ['en', ''],
  ['en', '   '],
  ['ja', `tilde~wave${cp(0xff5e)}です`],
  ['zh', '我们今天去 Tokyo 然后 meet John 吧明天回来'],
  ['ko', '안녕하세요  반갑습니다\t오늘 날씨가 좋네요'],
  ['en', 'dr smith said 3.5 percent is fine you know what i mean'],
];
edge.forEach(([lang, input], i) => rows.push({ id: `edge-${i}`, lang, variant: 'edge', input }));

await writeFile(join(root, 'results', 'parity-sat-3l-sm.rows.json'), JSON.stringify(rows, null, 1));
console.log(`wrote ${rows.length} rows`);
