#!/usr/bin/env node
// Bring every non-en src/locales/<lang>/translation.json into lockstep with en:
//   - add keys en has and the catalogue lacks, with en's value (placeholder)
//   - drop keys the catalogue has and en lacks (including any --delete namespace)
// en/translation.json is read-only: its hand-formatted layout (including compact
// single-line objects) must not be disturbed by JSON.stringify reflow. If en still
// carries a --delete namespace, remove it there yourself with a targeted edit first.
// Nested objects are merged key by key; the target's existing order is kept and
// new keys are appended where en places them. Idempotent: a second run is a no-op.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src', 'locales');
const args = process.argv.slice(2);
const deletions = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--delete') deletions.push(args[++i]);

const read = (lang) => JSON.parse(readFileSync(join(ROOT, lang, 'translation.json'), 'utf8'));
const write = (lang, obj) => writeFileSync(join(ROOT, lang, 'translation.json'), JSON.stringify(obj, null, 2) + '\n');

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Returns [merged, filledKeyPaths]. */
function sync(en, target, prefix = '') {
  const out = {};
  const filled = [];
  // Keep target's order for keys en also has; drop keys en lacks.
  for (const k of Object.keys(target)) {
    if (!(k in en)) continue;
    if (isObj(en[k]) && isObj(target[k])) {
      const [m, f] = sync(en[k], target[k], `${prefix}${k}.`);
      out[k] = m; filled.push(...f);
    } else if (isObj(en[k]) !== isObj(target[k])) {
      out[k] = en[k]; filled.push(...leafPaths(en[k], `${prefix}${k}.`));
    } else {
      out[k] = target[k];
    }
  }
  // Append keys en has and target lacks, in en's order.
  for (const k of Object.keys(en)) {
    if (k in out) continue;
    out[k] = en[k];
    filled.push(...(isObj(en[k]) ? leafPaths(en[k], `${prefix}${k}.`) : [`${prefix}${k}`]));
  }
  return [out, filled];
}

function leafPaths(obj, prefix) {
  return Object.entries(obj).flatMap(([k, v]) => (isObj(v) ? leafPaths(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

const en = read('en');
for (const d of deletions) {
  if (d in en) {
    console.warn(`warning: en still has "${d}" — sync-locale-keys.mjs never rewrites en; remove it there by hand`);
  }
}

const langs = readdirSync(ROOT).filter((d) => statSync(join(ROOT, d)).isDirectory() && d !== 'en');
const allFilled = {};
for (const lang of langs) {
  const target = read(lang);
  for (const d of deletions) delete target[d];
  const [merged, filled] = sync(en, target);
  write(lang, merged);
  allFilled[lang] = filled;
  console.log(`${lang}: +${filled.length} filled from en`);
}
const union = new Set(Object.values(allFilled).flat());
console.log(`\nKeys filled with English in at least one catalogue (${union.size}):`);
for (const k of [...union].sort()) console.log(`  ${k}`);
