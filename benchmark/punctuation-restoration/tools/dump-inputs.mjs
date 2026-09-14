// Write every model input the evaluation will use to results/inputs.json, so the
// Python parity scripts feed the reference pipelines exactly the same strings.
// usage: node tools/dump-inputs.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus, makeInput } from '../lib/text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const items = await loadCorpus(join(root, 'corpus'));
const rows = [];
for (const it of items) {
  const variants = ['stripped', 'commas', ...(it.lang === 'en' ? ['lower'] : [])];
  for (const variant of variants) rows.push({ id: it.id, lang: it.lang, variant, input: makeInput(it.ref, variant), ref: it.ref });
  if (it.raw) rows.push({ id: it.id, lang: it.lang, variant: 'raw', input: it.raw, ref: it.ref });
}
await mkdir(join(root, 'results'), { recursive: true });
await writeFile(join(root, 'results', 'inputs.json'), JSON.stringify(rows, null, 1));
console.log(`wrote ${rows.length} inputs from ${items.length} items`);
