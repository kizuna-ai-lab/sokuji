// electron/squirrel-nuspec.consistency.test.js
//
// electron-winstaller's nuspec template packs a Squirrel.exe into every release
// (lib\net45\squirrel.exe). That copy is unsigned and unique to our package, so
// it has no reputation, and Windows Smart App Control blocks it. Squirrel starts
// it during every install and update (ApplyReleasesImpl.executeSelfUpdate,
// `squirrel.exe --updateSelf`) with no error handling, BEFORE it runs our
// --squirrel-install hook. A block therefore aborts the install after the files
// are written: no Start menu or desktop shortcut, which is how a Microsoft Store
// update failed certification (10.3.4, 2026-10-14). The CodeIntegrity log and
// Squirrel-Install.log on a Smart App Control machine show exactly that.
//
// executeSelfUpdate returns early when app-<version>\Squirrel.exe is absent, so
// we pack our own copy of the template without that one line. The root
// Update.exe, which Setup.exe installs and which the app's updates run, is
// Squirrel's stock binary; it only stops refreshing itself from the package.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(electronDir, '..');
const require = createRequire(import.meta.url);
const forgeConfig = require(path.join(repoRoot, 'forge.config.js'));

const squirrelMaker = forgeConfig.makers.find((m) => m.name === '@electron-forge/maker-squirrel');
const upstreamTemplate = path.join(repoRoot, 'node_modules', 'electron-winstaller', 'template.nuspectemplate');
const SQUIRREL_EXE_LINE = /^\s*<file src="Squirrel\.exe" target="lib\\net45\\squirrel\.exe" \/>\r?\n/m;

describe('Squirrel package without squirrel.exe (Smart App Control)', () => {
  it('hands electron-winstaller our own nuspec template', () => {
    const template = squirrelMaker.config.nuspecTemplate;
    expect(typeof template).toBe('string');
    // electron-winstaller reads it as given, so it must not depend on the cwd.
    expect(path.isAbsolute(template)).toBe(true);
    expect(existsSync(template)).toBe(true);
  });

  it('packs no squirrel.exe', () => {
    const ours = readFileSync(squirrelMaker.config.nuspecTemplate, 'utf8');
    expect(ours).not.toMatch(/squirrel\.exe/i);
  });

  it("is electron-winstaller's template minus that one line", () => {
    // Pinned to the installed electron-winstaller: an upgrade that changes its
    // template fails here, so the copy is redone rather than left stale.
    const upstream = readFileSync(upstreamTemplate, 'utf8');
    expect(upstream).toMatch(SQUIRREL_EXE_LINE);
    expect(readFileSync(squirrelMaker.config.nuspecTemplate, 'utf8')).toBe(upstream.replace(SQUIRREL_EXE_LINE, ''));
  });
});
