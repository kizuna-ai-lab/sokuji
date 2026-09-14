// Re-score the saved offline outputs in results/quality-final-*.json with the
// current lib/text.mjs, without re-running any model. Timing fields are kept.
// usage: node tools/rescore.mjs
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hypothesisFor, loadCorpus, newCounts, scoreInto, summarize } from '../lib/text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const items = new Map((await loadCorpus(join(root, 'corpus'))).map((i) => [i.id, i]));
const files = (await readdir(join(root, 'results'))).filter((f) => /^quality-final-.*\.json$/.test(f));

for (const f of files) {
  const path = join(root, 'results', f);
  const data = JSON.parse(await readFile(path, 'utf8'));
  for (const m of Object.values(data.models)) {
    const counts = {};
    for (const o of m.outputs) {
      const it = items.get(o.id);
      const key = `${it.lang}/${o.variant}`;
      counts[key] ??= newCounts();
      scoreInto(counts[key], it.ref, hypothesisFor(m.info, o.out).hyp, { scoreCase: o.variant === 'lower' });
    }
    for (const [key, c] of Object.entries(counts)) {
      const { ms, chars, calls } = m.offline[key] ?? {};
      m.offline[key] = { ...summarize(c), ms, chars, calls };
    }
  }
  await writeFile(path, JSON.stringify(data, null, 1));
  console.log(`rescored ${f}`);
}
