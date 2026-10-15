// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const notices = squash(readFileSync(resolve(REPO_ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8'));

// Readings ship pinyin-pro and Lindera in the app, and IPADIC inside the wasm the
// app downloads: each licence asks for its notice to go with every copy.
describe('THIRD_PARTY_NOTICES.md for readings', () => {
  it.each(['lindera-wasm-ipadic-web', 'pinyin-pro'])('carries the licence of %s', (pkg) => {
    const licence = squash(readFileSync(resolve(REPO_ROOT, 'node_modules', pkg, 'LICENSE'), 'utf8'));
    expect(notices).toContain(licence);
  });

  it('carries the IPADIC notice', () => {
    expect(notices).toContain('Copyright 2000, 2001, 2002, 2003 Nara Institute of Science and Technology. All Rights Reserved.');
    expect(notices).toContain('NO WARRANTY');
    expect(notices).toContain('from and not be held liable to the user for any such damages as noted above as far as the program is concerned.');
  });
});
