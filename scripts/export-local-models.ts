/**
 * Write the local model catalog the docs site publishes at /docs/local-models.
 *
 * Usage: npx tsx scripts/export-local-models.ts <out.json>
 *
 * Run it from a release tag, so the docs list what that release offers, and copy
 * the file to sokuji-backend's web/src/data/local-models.json.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildLocalModelCatalog } from '../src/lib/local-inference/localModelCatalog';

const out = process.argv[2];
if (!out) {
  console.error('Usage: npx tsx scripts/export-local-models.ts <out.json>');
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const catalog = buildLocalModelCatalog(version);
writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${catalog.models.length} models (v${version}) to ${out}`);
