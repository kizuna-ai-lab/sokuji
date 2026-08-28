// electron/update-payload.test.js
//
// macOS used to be notify-only: the builds were ad-hoc signed, and Squirrel.Mac
// verifies each update against the designated requirement captured from the
// running bundle, which an ad-hoc cdhash can never satisfy. Signing with a
// stable (self-signed) certificate makes that check pass, so darwin now takes
// the same native electron-updater path as AppImage.
//
// These are pure decisions deliberately kept out of UpdateManager, which cannot
// be imported under test because it pulls in electron and electron-updater.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { buildUpdatePayload, usesNativeUpdaterFlow } = nodeRequire('./update-payload.js');

const info = { version: '1.2.3', releaseNotes: '<p>notes</p>' };

describe('usesNativeUpdaterFlow', () => {
  it('is true on darwin', () => {
    expect(usesNativeUpdaterFlow({ platform: 'darwin', isAppImage: false })).toBe(true);
  });

  it('is true for Linux AppImage and false for a distro package', () => {
    expect(usesNativeUpdaterFlow({ platform: 'linux', isAppImage: true })).toBe(true);
    expect(usesNativeUpdaterFlow({ platform: 'linux', isAppImage: false })).toBe(false);
  });

  it('is false on win32, which downloads the Squirrel installer itself', () => {
    expect(usesNativeUpdaterFlow({ platform: 'win32', isAppImage: false })).toBe(false);
  });
});

describe('buildUpdatePayload on darwin', () => {
  const mac = (arch = 'arm64') =>
    buildUpdatePayload(info, { platform: 'darwin', arch, isAppImage: false });

  it('advertises auto-update', () => {
    expect(mac().supportsAutoUpdate).toBe(true);
  });

  // UpdateDialog renders a browser-download button whenever downloadUrl is set,
  // which would hide the in-app flow entirely.
  it('sets no downloadUrl, so the dialog shows the in-app flow', () => {
    expect(mac().downloadUrl).toBeUndefined();
  });

  it('offers no AppImage/deb links either', () => {
    expect(mac().appImageUrl).toBeUndefined();
    expect(mac().debUrl).toBeUndefined();
  });

  it('still carries version and release notes', () => {
    expect(mac()).toMatchObject({
      status: 'available',
      version: '1.2.3',
      releaseNotes: '<p>notes</p>',
    });
  });
});

describe('buildUpdatePayload on linux', () => {
  it('keeps the AppImage auto-update path', () => {
    const p = buildUpdatePayload(info, { platform: 'linux', arch: 'x64', isAppImage: true });
    expect(p.supportsAutoUpdate).toBe(true);
    expect(p.appImageUrl).toContain('Sokuji-1.2.3-x86_64.AppImage');
    expect(p.downloadUrl).toBeUndefined();
  });

  it('sends distro-package users to the release page', () => {
    const p = buildUpdatePayload(info, { platform: 'linux', arch: 'arm64', isAppImage: false });
    expect(p.supportsAutoUpdate).toBe(false);
    expect(p.debUrl).toContain('sokuji_1.2.3_arm64.deb');
    expect(p.downloadUrl).toBe(p.releasePageUrl);
  });
});

describe('buildUpdatePayload release notes normalisation', () => {
  it('passes an array through (fullChangelog)', () => {
    const notes = [{ version: '1.2.3', note: '<p>a</p>' }];
    const p = buildUpdatePayload({ version: '1.2.3', releaseNotes: notes },
      { platform: 'win32', arch: 'x64' });
    expect(p.releaseNotes).toBe(notes);
  });

  it('falls back to an empty string when absent', () => {
    const p = buildUpdatePayload({ version: '1.2.3' }, { platform: 'win32', arch: 'x64' });
    expect(p.releaseNotes).toBe('');
  });
});
