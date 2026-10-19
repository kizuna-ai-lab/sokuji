// electron/distribution-channel.test.js
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDistributionChannel, MARKER_FILE, STORE_MARKER } from './distribution-channel.js';

const dirs = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sokuji-dist-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const STORE = JSON.stringify(STORE_MARKER);

/** A packaged app's resources folder and a userData folder, each with an optional marker. */
function layout({ packaged, recorded } = {}) {
  const resourcesPath = tmp();
  const userDataPath = path.join(tmp(), 'Sokuji');
  if (packaged !== undefined) fs.writeFileSync(path.join(resourcesPath, MARKER_FILE), packaged);
  if (recorded !== undefined) {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(path.join(userDataPath, MARKER_FILE), recorded);
  }
  return { resourcesPath, userDataPath };
}

describe('resolveDistributionChannel', () => {
  it('is the website build when there is no marker, and records nothing', () => {
    const p = layout();
    expect(resolveDistributionChannel(p)).toBe('website');
    expect(fs.existsSync(path.join(p.userDataPath, MARKER_FILE))).toBe(false);
  });

  it('is the Store build when the packaged marker says so, and records it in userData', () => {
    const p = layout({ packaged: STORE });
    expect(resolveDistributionChannel(p)).toBe('store');
    expect(JSON.parse(fs.readFileSync(path.join(p.userDataPath, MARKER_FILE), 'utf8'))).toEqual(STORE_MARKER);
  });

  it('stays the Store build after the in-app update installed the unmarked website build', () => {
    expect(resolveDistributionChannel(layout({ recorded: STORE }))).toBe('store');
  });

  it('treats a malformed or foreign marker as absent', () => {
    for (const packaged of ['', '{', '"store"', JSON.stringify({ channel: 'website' }), JSON.stringify({ channel: 'STORE' })]) {
      expect(resolveDistributionChannel(layout({ packaged }))).toBe('website');
    }
  });

  it('still answers store when the record cannot be written', () => {
    const p = layout({ packaged: STORE });
    const failing = { ...fs, mkdirSync: () => { throw new Error('EACCES'); }, writeFileSync: () => { throw new Error('EACCES'); } };
    expect(resolveDistributionChannel({ ...p, fs: failing })).toBe('store');
  });

  it('does not rewrite a record that is already there', () => {
    const p = layout({ packaged: STORE, recorded: STORE });
    const writes = [];
    const spy = { ...fs, writeFileSync: (...args) => { writes.push(args); } };
    expect(resolveDistributionChannel({ ...p, fs: spy })).toBe('store');
    expect(writes).toEqual([]);
  });

  it('answers website without a resources path (a development run)', () => {
    expect(resolveDistributionChannel({ resourcesPath: undefined, userDataPath: tmp() })).toBe('website');
  });
});
