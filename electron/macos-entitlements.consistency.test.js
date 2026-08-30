// electron/macos-entitlements.consistency.test.js
//
// Every certificate-signed macOS build is signed with the Hardened Runtime
// (electron-builder's default), and under the Hardened Runtime the microphone
// is denied outright -- no TCC prompt, no error, getUserMedia simply rejects --
// unless the bundle carries com.apple.security.device.audio-input.
// electron-builder's built-in entitlements template does not carry it, so the
// moment #449 moved the release from an ad-hoc signature to a real signing
// identity, v0.39.1 shipped with a microphone that could not be turned on from
// Finder (#458). Nothing in the build noticed: electron-builder logs nothing
// about entitlements, and the CI signature check only looked at the designated
// requirement.
//
// This pins the packaging half: package.json must point electron-builder at our
// own plist for the app AND its helpers (the renderer helper is the process
// that actually opens the device), and that plist must carry the audio-input
// entitlement on top of the three the default template provides, without which
// Electron does not launch at all. The signed artifact itself is checked in
// .github/workflows/build.yml ("Verify the macOS update artifacts").
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(electronDir, '..');
const mac = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).build.mac;

/** Keys set to <true/> in a plist, read as text -- there is no plist parser in the tree. */
function trueKeys(plistPath) {
  const xml = readFileSync(plistPath, 'utf8');
  const keys = new Set([...xml.matchAll(/<key>([^<]+)<\/key>\s*<true\s*\/>/g)].map(([, key]) => key));
  if (keys.size === 0) throw new Error(`no <key>...</key><true/> pairs found in ${plistPath}`);
  return keys;
}

// What app-builder-lib/templates/entitlements.mac.plist provides. Replacing the
// template must not drop these: without them the signed app does not start.
const ELECTRON_BUILDER_DEFAULTS = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
];
const MICROPHONE = 'com.apple.security.device.audio-input';

describe('macOS signing entitlements (#458)', () => {
  it("names the hardened runtime instead of inheriting electron-builder's default", () => {
    // The default is already `true`; saying so keeps the entitlement below
    // visibly tied to the reason it is needed.
    expect(mac.hardenedRuntime).toBe(true);
  });

  it('hands electron-builder its own entitlements for the app and every helper', () => {
    // `entitlements` / `entitlementsInherit` go to @electron/osx-sign as-is and
    // resolve against the cwd -- the repo root, both in CI and under
    // `npm run make:pkg` -- unlike `pkg.scripts`, which is buildResources-relative.
    expect(typeof mac.entitlements).toBe('string');
    expect(existsSync(path.join(repoRoot, mac.entitlements))).toBe(true);
    expect(mac.entitlementsInherit).toBe(mac.entitlements);
  });

  it('grants microphone access on top of what Electron needs to launch', () => {
    const keys = trueKeys(path.join(repoRoot, mac.entitlements));
    expect(keys.has(MICROPHONE)).toBe(true);
    for (const key of ELECTRON_BUILDER_DEFAULTS) {
      expect(keys.has(key), key).toBe(true);
    }
  });
});
