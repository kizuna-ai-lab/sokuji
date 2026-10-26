#!/usr/bin/env node
// Checks a build ships Lindera's wasm, and only that: exactly one
// lindera_wasm_bg*.wasm per build, of the installed lindera-wasm's size, and
// neither the IPADIC dictionary archive (the app downloads it on first use of
// Japanese readings: it is data, which browser stores allow fetched) nor a
// script chunk large enough to carry it inlined. A wasm fetched at run time is
// what the stores call remotely hosted code, so the wasm has to be here.
// Usage: node scripts/check-lindera-assets.mjs build extension/dist
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** lindera-wasm 6.2.0's lindera_wasm_bg.wasm. dictionary.test.ts checks it against the installed package. */
export const LINDERA_WASM_BYTES = 1_784_285;
/** lindera-ipadic-6.2.0.zip. dictionary.test.ts checks it against src/lib/reading/ja/dictionary.ts. */
export const DICTIONARY_BYTES = 10_519_550;
/**
 * The dictionary as base64 in a chunk would be 14.0 MB; the largest chunk the
 * builds have today (the Electron main chunk) is 1.6 MB.
 */
const INLINED_JS_BYTES = 8_000_000;

/** Calls `visit(path, size)` for every file under `dir`. */
function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, visit);
    else visit(path, st.size);
  }
}

/** The problems with the builds in `dirs`; none means each ships the wasm and nothing else of Lindera's. */
export function checkLinderaAssets(dirs) {
  const problems = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      problems.push(`${dir} does not exist`);
      continue;
    }
    const wasms = [];
    walk(dir, (path, size) => {
      const name = basename(path);
      if (/^lindera_wasm_bg.*\.wasm$/.test(name)) {
        if (size === LINDERA_WASM_BYTES) wasms.push(path);
        else problems.push(`${path} (${size} bytes) is not the installed Lindera wasm (${LINDERA_WASM_BYTES} bytes)`);
      } else if (/^lindera-ipadic-.*\.zip$/.test(name) || size === DICTIONARY_BYTES) {
        problems.push(`${path} (${size} bytes) is the dictionary, which the app downloads`);
      } else if (/\.m?js$/.test(name) && size > INLINED_JS_BYTES) {
        problems.push(`${path} (${size} bytes) is large enough to carry the dictionary inlined`);
      }
    });
    if (wasms.length === 0) problems.push(`${dir} has no Lindera wasm: the app would fetch it at run time`);
    else if (wasms.length > 1) problems.push(`${dir} has ${wasms.length} Lindera wasms: ${wasms.join(', ')}`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error('usage: node scripts/check-lindera-assets.mjs <build dir>...');
    process.exit(2);
  }
  const problems = checkLinderaAssets(dirs);
  if (problems.length > 0) {
    console.error(`Lindera's assets are wrong in the build:\n${problems.join('\n')}`);
    process.exit(1);
  }
  console.log(`Lindera wasm in, dictionary out of ${dirs.join(', ')}`);
}
