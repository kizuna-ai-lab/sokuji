// electron/macos-developer-id.consistency.test.js
//
// From the release after v0.46.4 the macOS app is signed with our Apple
// Developer ID and notarized (docs/build/macos-auto-update.md §7.1c). Every
// piece of that fails quietly: electron-builder carries on unsigned when it
// cannot find an identity, skips notarization when the API key is missing, and
// an afterSign hook runs after notarization, so a re-sign there voids the
// ticket. The signed artifact itself is checked in .github/workflows/build.yml
// ("Verify the macOS update artifacts"); this pins the configuration that feeds
// it, and the one requirement every build must keep satisfying for installed
// v0.46.4 copies -- the bridge release -- to accept it as an update.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const build = pkg.build;
const lock = JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
const workflow = readFileSync(path.join(repoRoot, '.github/workflows/build.yml'), 'utf8');

const TEAM_ID = '48ST7Q3ACJ';
// `codesign -d -r-` on an installed v0.46.4, verbatim. Squirrel.Mac installs an
// update only if it satisfies the running app's designated requirement.
const BRIDGE_REQUIREMENT =
  'identifier "ai.kizunaai.sokuji" and (certificate root = H"92e86a47b9d0179e060c7e7cea61b8f9d4f3c350" ' +
  'or anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ ' +
  'and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ ' +
  `and certificate leaf[subject.OU] = "${TEAM_ID}")`;

/** One step of build.yml, from its `- name:` line to the next one. */
function step(name) {
  const start = workflow.indexOf(`- name: ${name}`);
  expect(start, `expected a step named ${name}`).toBeGreaterThan(-1);
  const next = workflow.indexOf('- name:', start + 1);
  return workflow.slice(start, next === -1 ? undefined : next);
}

describe('macOS Developer ID signing (package.json)', () => {
  it('names the Developer ID identity without the prefix electron-builder rejects', () => {
    // electron-builder throws on a "Developer ID Application:" prefix and adds
    // the certificate type itself. The pkg target looks up
    // "Developer ID Installer: <this name>" from the same value.
    expect(build.mac.identity).toBe(`jiang zhuo (${TEAM_ID})`);
  });

  it('leaves notarization on', () => {
    // Only an explicit `false` turns it off; with the APPLE_API_* variables set,
    // electron-builder notarizes and staples both the app and the pkg.
    expect(build.mac.notarize).not.toBe(false);
  });

  it('runs no afterSign hook, which would re-sign the app after notarization', () => {
    expect(build.afterSign).toBeUndefined();
  });

  it('gives electron-builder a notarize that actually retries stapling', () => {
    // @electron/notarize 2.5.0, which every app-builder-lib 26 pins, hands
    // promise-retry a function that never calls `retry`, so its `retries: 3`
    // never retries: one dropped request to Apple's ticket service failed the
    // whole macOS build (2026-10-27, x64 runner). 3.1.1 has the same bug;
    // 3.1.2 is the first release that passes the retry on.
    const atLeast312 = (version) => {
      const [major, minor, patch] = String(version).replace(/^\^/, '').split('.').map(Number);
      return major === 3 && (minor > 1 || (minor === 1 && patch >= 2));
    };
    const spec = pkg.overrides?.['app-builder-lib']?.['@electron/notarize'];
    expect(atLeast312(spec), `override ${spec}`).toBe(true);
    const resolved =
      lock.packages['node_modules/app-builder-lib/node_modules/@electron/notarize'] ??
      lock.packages['node_modules/@electron/notarize'];
    expect(atLeast312(resolved?.version), `lockfile ${resolved?.version}`).toBe(true);
  });
});

describe('the macOS signing pipeline (build.yml)', () => {
  it('signs only when the Developer ID certificate is configured', () => {
    expect(workflow).toContain("HAS_MAC_CERT: ${{ secrets.MACOS_DEVID_APP_P12 != '' }}");
    expect(workflow).not.toContain('MACOS_CSC_LINK');
    expect(workflow).not.toContain('- name: Trust the self-signed signing certificate (macOS)');
  });

  it('hands the signing secrets only to Mac builds of main and release tags', () => {
    // A pull request's build runs the branch's own code, so it must not hold the
    // Developer ID certificates or the notary key (#662 review). They are
    // secrets of the `macos-signing` environment, whose deployment policy admits
    // only `main` and `v*` tags; every other build of the Mac app is unsigned.
    expect(workflow).toContain(
      "environment: ${{ startsWith(matrix.os, 'macos') && github.event_name == 'push' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')) && 'macos-signing' || '' }}"
    );
  });

  it('keeps the signed Mac build of main for checking on a Mac before a tag', () => {
    const upload = step('Upload the signed macOS app for review (main)');
    expect(upload).toMatch(/if: runner\.os == 'macOS' && github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && env\.HAS_MAC_CERT == 'true'/);
    expect(upload).toContain('out/make-mac/*.zip');
    expect(upload).toContain('out/make-mac/*.pkg');
    expect(workflow).not.toContain('- name: Upload the signed macOS app for review (pull requests)');
  });

  it('proves both Developer ID identities are valid before building', () => {
    const check = step('Check the Developer ID signing identities (macOS)');
    expect(check).toContain(`Developer ID Application: jiang zhuo (${TEAM_ID})`);
    expect(check).toContain(`Developer ID Installer: jiang zhuo (${TEAM_ID})`);
    // The .p12 files carry only the leaf; the G2 intermediate is pinned by hash.
    expect(check).toContain('F16CD3C54C7F83CEA4BF1A3E6A0819C8AAA8E4A1528FD144715F350643D2DF3A');
  });

  it('hands electron-builder both certificates and the notary key only when signing', () => {
    const make = step('Build macOS artifacts (electron-builder)');
    const start = make.indexOf(`if [ "$HAS_MAC_CERT" = 'true' ]; then`);
    expect(start).toBeGreaterThan(-1);
    const guarded = make.slice(start, make.indexOf('\n          fi\n', start));
    for (const name of [
      'CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_INSTALLER_LINK', 'CSC_INSTALLER_KEY_PASSWORD',
      'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER',
    ]) {
      expect(guarded, name).toMatch(new RegExp(`^\\s*export\\b.*\\b${name}=`, 'm'));
    }
    // electron-builder refuses a partial APPLE_API_* set, and the pkg target asks
    // for notarization even when it is unsigned, so none of them may be set for
    // the whole step -- that would break every build without the certificate.
    const env = make.slice(make.indexOf('\n        env:\n'));
    expect(env).not.toMatch(/^\s+(CSC_LINK|CSC_INSTALLER_LINK|APPLE_API_KEY|APPLE_API_KEY_ID|APPLE_API_ISSUER):/m);
  });

  it('bounds the build, since notarytool waits on Apple with no timeout of its own', () => {
    // Without it a stalled notary queue holds the runner for the job default, six hours.
    expect(step('Build macOS artifacts (electron-builder)')).toMatch(/^\s+timeout-minutes: \d+$/m);
  });

  it('fails a build that installed v0.46.4 would refuse as an update', () => {
    const verify = step('Verify the macOS update artifacts (signature + notarization + zip + manifest)');
    expect(verify).toContain(`BRIDGE_REQUIREMENT='${BRIDGE_REQUIREMENT}'`);
    // The long option: `-R="=..."` hands codesign "==..." and is a syntax error.
    expect(verify).toContain('--test-requirement="=$BRIDGE_REQUIREMENT"');
  });

  it('fails a build whose app or pkg is not notarized and stapled', () => {
    const verify = step('Verify the macOS update artifacts (signature + notarization + zip + manifest)');
    for (const target of ['"$APP"', '"$UNZIPPED/Sokuji.app"', '"$PKG"']) {
      expect(verify, target).toContain(`stapled ${target}`);
    }
    expect(verify).toContain(`Developer ID Installer: jiang zhuo (${TEAM_ID})`);
  });

  it('retries stapler validate, whose online ticket lookup can drop on a runner', () => {
    // `stapler validate` also asks Apple's CloudKit service for the ticket; on
    // 2026-10-27 that lookup lost its connection on one runner (exit 68) for an
    // app that was notarized and stapled.
    const verify = step('Verify the macOS update artifacts (signature + notarization + zip + manifest)');
    const helper = verify.slice(verify.indexOf('stapled() {'), verify.indexOf('\n          }\n', verify.indexOf('stapled() {')));
    expect(helper).toContain('xcrun stapler validate "$1"');
    expect(helper).toMatch(/for ATTEMPT in 1 2 3; do/);
    expect(verify).not.toMatch(/^\s+xcrun stapler validate "\$(APP|PKG|UNZIPPED)/m);
  });
});
