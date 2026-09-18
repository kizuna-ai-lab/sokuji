// Does Intl.Segmenter find sentence boundaries in ASR-style text?
// usage: node segmenter.mjs [--json out.json]
// Run it under Electron's own V8/ICU too:
//   ELECTRON_RUN_AS_NODE=1 <sokuji>/node_modules/electron/dist/electron segmenter.mjs
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { analyze, loadCorpus, makeInput, newCounts, pct, scoreInto, summarize } from './lib/text.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const items = await loadCorpus(join(here, 'corpus'));
// `raw` is the provider's own partially punctuated transcript, where the corpus has one.
const variants = ['gold', 'stripped', 'lower', 'commas', 'raw'];

function segmenterBoundaries(text, lang) {
  const seg = new Intl.Segmenter(lang, { granularity: 'sentence' });
  const boundaries = [];
  let offset = 0;
  for (const s of seg.segment(text)) {
    offset += s.segment.length;
    if (offset < text.length) boundaries.push(analyze(text.slice(0, offset)).skelChars.length);
  }
  return boundaries;
}

const results = {};
const examples = [];
for (const variant of variants) {
  for (const lang of [...new Set(items.map((i) => i.lang))]) {
    if (variant === 'lower' && lang !== 'en') continue;
    const counts = newCounts();
    for (const it of items.filter((i) => i.lang === lang && (variant !== 'raw' || i.raw))) {
      const input = variant === 'gold' ? it.ref : variant === 'raw' ? it.raw : makeInput(it.ref, variant);
      const boundaries = segmenterBoundaries(input, lang);
      scoreInto(counts, it.ref, { skelSource: input, boundaries });
      if (variant !== 'gold' && examples.length < 400) {
        const seg = new Intl.Segmenter(lang, { granularity: 'sentence' });
        examples.push({ id: it.id, variant, input, segments: [...seg.segment(input)].map((s) => s.segment) });
      }
    }
    results[`${lang}/${variant}`] = summarize(counts);
  }
}

console.log(`runtime: ${process.versions.electron ? 'electron ' + process.versions.electron : 'node ' + process.version}  icu ${process.versions.icu}  unicode ${process.versions.unicode}`);
console.log('internal sentence boundaries (end of passage excluded)');
console.log('lang/variant        items   P      R      F1    tp  fp  fn');
for (const [k, s] of Object.entries(results)) {
  const b = s.boundary;
  console.log(`${k.padEnd(18)} ${String(s.items).padStart(5)}  ${pct(b.p)}  ${pct(b.r)}  ${pct(b.f)}  ${String(b.tp).padStart(3)} ${String(b.fp).padStart(3)} ${String(b.fn).padStart(3)}`);
}

const jsonArg = process.argv.indexOf('--json');
if (jsonArg > 0) {
  await writeFile(process.argv[jsonArg + 1], JSON.stringify({ runtime: process.versions, results, examples }, null, 1));
}
