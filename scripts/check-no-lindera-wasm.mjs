#!/usr/bin/env node
// Fails when a build carries the Lindera wasm (17,750,350 bytes, IPADIC inside):
// the app downloads it on first use of Japanese readings (vite.lindera-wasm-url.ts).
// Usage: node scripts/check-no-lindera-wasm.mjs build extension/dist
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LINDERA_WASM_BYTES = 17_750_350;
const INLINED_JS_BYTES = 15_000_000; // the wasm as base64 in a chunk would be ~23.7 MB

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: node scripts/check-no-lindera-wasm.mjs <build dir>...');
  process.exit(2);
}
const hits = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    else if (name.includes('lindera_wasm_bg') || st.size === LINDERA_WASM_BYTES || (/\.m?js$/.test(name) && st.size > INLINED_JS_BYTES)) {
      hits.push(`${path} (${st.size} bytes)`);
    }
  }
};
for (const dir of dirs) walk(dir);
if (hits.length > 0) {
  console.error(`The Lindera wasm is in the build:\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`No Lindera wasm in ${dirs.join(', ')}`);
