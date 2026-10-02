// electron/sandbox-recovery.wiring.test.js
//
// main.js cannot be booted in vitest; where it calls the install-folder grant is
// asserted on its source text, like closeHandshake.wiring.test.js does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const main = readFileSync(join(__dirname, 'main.js'), 'utf8');

/** Index of `needle` in `text`; fails (rather than returning -1) when it is gone. */
function at(text, needle) {
  const i = text.indexOf(needle);
  expect(i, `expected to find ${needle}`).toBeGreaterThan(-1);
  return i;
}

describe('install-folder sandbox grant wiring', () => {
  it('grants on win32 before anything else in main.js can run', () => {
    // Electron 43.7.6 / 44.5.0+ abort in PreCreateThreads when the sandbox
    // cannot read the install folder; main.js's top level runs before that.
    expect(main).toMatch(
      /if \(process\.platform === 'win32'\) \{\s*require\('\.\/sandbox-recovery'\)\.grantInstallDirSandboxRead\(process\.execPath\);\s*\}/,
    );
  });

  it('grants before the Squirrel hooks exit, so install and update runs grant too', () => {
    expect(at(main, 'grantInstallDirSandboxRead(process.execPath)')).toBeLessThan(at(main, 'handleSquirrelEvent()'));
  });
});
