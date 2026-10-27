// electron/store-installer.consistency.test.js
//
// The Microsoft Store's installer is made in build.yml, signed by SignPath's
// `default` configuration and read by distribution-channel.js. Nothing runs
// that pipeline before a tag, so the names that tie it together are pinned
// here (spec 2026-10-17 §6).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MARKER_FILE, STORE_MARKER } from './distribution-channel.js';

const root = join(__dirname, '..');
const workflow = readFileSync(join(root, '.github/workflows/build.yml'), 'utf8');
const signpath = readFileSync(join(root, '.signpath/artifact-configurations/default.xml'), 'utf8');

/** One step of build.yml, from its `- name:` line to the next one. */
function step(name) {
  const start = workflow.indexOf(`- name: ${name}`);
  expect(start, `expected a step named ${name}`).toBeGreaterThan(-1);
  const next = workflow.indexOf('- name:', start + 1);
  return workflow.slice(start, next === -1 ? undefined : next);
}

/** SignPath's path wildcard: `*` is any run of characters within the zip's root. */
const escape = (s) => s.replace(/[.+?^$()|[\]\\{}]/g, '\\$&');
const glob = (pattern) => new RegExp('^' + pattern.split('*').map(escape).join('[^/]*') + '$');

describe('the Microsoft Store installer pipeline', () => {
  const make = step('Make the Microsoft Store installer (Windows)');

  it('writes the marker distribution-channel.js reads into the packaged app, then makes from that package', () => {
    expect(make).toContain(`'${JSON.stringify(STORE_MARKER)}'`);
    expect(make).toContain(`/resources/${MARKER_FILE}"`);
    expect(make.indexOf(MARKER_FILE)).toBeLessThan(make.indexOf('electron-forge make'));
    expect(make).toContain('--from-package');
    expect(make).not.toMatch(/^\s+if: .*refs\/tags/m);
  });

  it('proves only the Store package carries the marker before either installer ships', () => {
    const check = make.indexOf('Only the Store package may carry resources/distribution.json');
    expect(check).toBeGreaterThan(make.indexOf('--from-package'));
    expect(check).toBeLessThan(make.indexOf('mkdir -p out/installers'));
    expect(make).toContain('"out/make/squirrel.windows/x64" "out/make-web/squirrel.windows/x64"');
  });

  it('puts both installers side by side under the names the rest of the pipeline expects', () => {
    expect(make).toContain('"out/make-web/squirrel.windows/x64/Sokuji-${VERSION} Setup.exe" out/installers/');
    expect(make).toContain('"out/installers/Sokuji-${VERSION}-store-installer.exe"');
  });

  it('signs both installers in one request, each matched by exactly one pattern', () => {
    const patterns = [...signpath.matchAll(/<pe-file path="([^"]+)">/g)].map((m) => glob(m[1]));
    expect(patterns).toHaveLength(2);
    for (const name of ['Sokuji-1.2.3 Setup.exe', 'Sokuji-1.2.3-store-installer.exe']) {
      expect(patterns.filter((p) => p.test(name)), name).toHaveLength(1);
    }
  });

  it('uploads both installers for signing, and the website make\'s nupkg and RELEASES for the release', () => {
    expect(step('Upload unsigned Windows installers for signing')).toContain('path: out/installers/*.exe');
    // Update.exe reads RELEASES from the release and verifies the nupkg against
    // it (electron/squirrel-update.js); both must come from the website make.
    const nupkg = step('Upload Windows nupkg and RELEASES for release');
    expect(nupkg).toContain('out/make-web/squirrel.windows/x64/*.nupkg');
    expect(nupkg).toContain('out/make-web/squirrel.windows/x64/RELEASES');
    expect(step('Collect release assets')).toContain('find windows-nupkg -name "RELEASES"');
  });

  it('releases the Store installer and feeds the updater the website installer only', () => {
    expect(step('Collect release assets')).toContain("-name '*-store-installer.exe'");
    const latest = step('Generate latest.yml for auto-updater');
    expect(latest).toContain('-name "*.Setup.exe"');
    expect(latest).toMatch(/-ne 1 \]; then[\s\S]*exit 1/);
  });
});
