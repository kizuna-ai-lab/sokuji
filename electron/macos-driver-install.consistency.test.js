// electron/macos-driver-install.consistency.test.js
//
// The macOS virtual microphone is SokujiVirtualAudio.driver, a HAL plug-in that
// pkg-scripts/postinstall copies out of the app into /Library/Audio/Plug-Ins/HAL
// and loads by restarting coreaudiod.
//
// PackageKit runs that script twice per install: electron-builder lists it both
// as the package's postinstall and as the Sokuji.app component's (the pkg's
// PackageInfo has two <postinstall> entries). The second run used to delete the
// driver the first had just installed, a moment after the first had restarted
// CoreAudio, and restart it again. Measured on macOS 26.6.1 with the v0.42.2 pkg:
// the surviving coreaudiod scanned the HAL directory while the driver was
// missing, so no device appeared until something restarted CoreAudio again.
//
// These run the real script twice in a scratch directory, with its absolute
// paths moved there and chown/killall/launchctl/stat replaced by recorders.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postinstallPath = path.join(repoRoot, 'pkg-scripts', 'postinstall');
const postinstall = readFileSync(postinstallPath, 'utf8');

let root;
let halDir;
let dest;
let bundledBinary;

function writeBundledDriver(content) {
  const macos = path.join(root, 'Applications/Sokuji.app/Contents/Resources/resources/drivers/SokujiVirtualAudio.driver/Contents/MacOS');
  mkdirSync(macos, { recursive: true });
  bundledBinary = path.join(macos, 'SokujiVirtualAudio');
  writeFileSync(bundledBinary, content);
}

function runPostinstall() {
  execFileSync('sh', [path.join(root, 'postinstall')], {
    env: { ...process.env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}` },
  });
}

const restarts = () => {
  const log = path.join(root, 'calls.log');
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith('killall coreaudiod')).length : 0;
};
const installedBinary = () => readFileSync(path.join(dest, 'Contents/MacOS/SokujiVirtualAudio'), 'utf8');

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'sokuji-postinstall-'));
  halDir = path.join(root, 'Library/Audio/Plug-Ins/HAL');
  dest = path.join(halDir, 'SokujiVirtualAudio.driver');
  mkdirSync(halDir, { recursive: true });
  writeBundledDriver('driver v1');
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  for (const cmd of ['chown', 'killall', 'launchctl', 'stat']) {
    writeFileSync(path.join(bin, cmd), `#!/bin/sh\necho "${cmd} $*" >> "${root}/calls.log"\n`, { mode: 0o755 });
  }
  const sandboxed = postinstall
    .replaceAll('/Applications/', `${root}/Applications/`)
    .replaceAll('/Library/Audio/Plug-Ins/HAL', halDir);
  writeFileSync(path.join(root, 'postinstall'), sandboxed, { mode: 0o755 });
});

describe('pkg postinstall survives PackageKit running it twice', () => {
  it('installs the driver and restarts CoreAudio once across both runs', () => {
    runPostinstall();
    runPostinstall();
    expect(installedBinary()).toBe('driver v1');
    expect(restarts()).toBe(1);
  });

  // A fresh copy gets a fresh modification time; an inode check cannot tell
  // (the filesystem may hand the new directory the old one's number), and a
  // marker file would itself make the copies differ.
  it('leaves the driver the first run installed in place on the second run', () => {
    runPostinstall();
    const before = statSync(dest, { bigint: true }).mtimeNs;
    execFileSync('sleep', ['0.05']);
    runPostinstall();
    expect(statSync(dest, { bigint: true }).mtimeNs).toBe(before);
  });

  it('leaves nothing but the driver in the HAL directory', () => {
    runPostinstall();
    runPostinstall();
    expect(readdirSync(halDir)).toEqual(['SokujiVirtualAudio.driver']);
  });

  it('replaces a driver that differs from the bundled one, and restarts CoreAudio for it', () => {
    runPostinstall();
    writeBundledDriver('driver v2');
    runPostinstall();
    expect(installedBinary()).toBe('driver v2');
    expect(restarts()).toBe(2);
  });

  // A full disk, say, fails the copy halfway. The working driver must survive
  // that: it is removed only once a complete, correctly owned copy is staged.
  it.each(['cp', 'chown'])('keeps the installed driver when staging the new one fails (%s)', (cmd) => {
    runPostinstall();
    writeBundledDriver('driver v2');
    writeFileSync(
      path.join(root, 'bin', cmd),
      `#!/bin/sh\necho "${cmd} $*" >> "${root}/calls.log"\nfor last; do :; done\nmkdir -p "$last"\nexit 1\n`,
      { mode: 0o755 },
    );
    expect(() => runPostinstall()).toThrow();
    expect(installedBinary()).toBe('driver v1');
    expect(readdirSync(halDir)).toEqual(['SokujiVirtualAudio.driver']);
    expect(restarts()).toBe(1);
  });

  // The old driver is moved aside, not deleted, until the new one is in place,
  // so a move that fails puts it back instead of leaving no driver at all.
  it('puts the installed driver back when moving the new one into place fails', () => {
    runPostinstall();
    writeBundledDriver('driver v2');
    writeFileSync(
      path.join(root, 'bin', 'mv'),
      `#!/bin/sh\necho "mv $*" >> "${root}/calls.log"\ncase "$1" in *.installing) exit 1 ;; esac\nexec /bin/mv "$@"\n`,
      { mode: 0o755 },
    );
    expect(() => runPostinstall()).toThrow();
    expect(installedBinary()).toBe('driver v1');
    expect(readdirSync(halDir)).toEqual(['SokujiVirtualAudio.driver']);
    expect(restarts()).toBe(1);
  });

  // A copy straight into the final path leaves a half-written driver there for
  // a CoreAudio scan to find; the copy is staged under a name HAL ignores.
  it('never copies straight into the installed driver path', () => {
    expect(postinstall).not.toContain('cp -R "$DRIVER_SOURCE" "$DRIVER_DEST"');
  });

  it('is valid sh', () => {
    execFileSync('sh', ['-n', postinstallPath]);
  });
});
