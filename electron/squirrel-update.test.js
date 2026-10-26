// electron/squirrel-update.test.js
//
// The Windows update through Squirrel's own updater (Electron's built-in
// autoUpdater driving the installed Update.exe): the new version lands in its
// own app-<version> folder next to the running one, verified against RELEASES,
// and the old version stays if anything fails. These pin the wiring around it.
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  squirrelFeedUrl,
  isSquirrelInstall,
  isSquirrelFirstRun,
  createSquirrelDownload,
} from './squirrel-update.js';

describe('squirrelFeedUrl', () => {
  it("is the repository's latest-release download URL, where RELEASES and the nupkg live", () => {
    expect(squirrelFeedUrl({ owner: 'kizuna-ai-lab', repo: 'sokuji', env: {} }))
      .toBe('https://github.com/kizuna-ai-lab/sokuji/releases/latest/download');
  });

  it('can be pointed at a loopback or https address for a test machine', () => {
    for (const url of ['http://127.0.0.1:8765/feed', 'http://localhost:8765/feed', 'https://staging.example/feed']) {
      expect(squirrelFeedUrl({ owner: 'kizuna-ai-lab', repo: 'sokuji', env: { SOKUJI_UPDATE_FEED: url } })).toBe(url);
    }
  });

  it('ignores a plain-http override to a remote host', () => {
    expect(squirrelFeedUrl({ owner: 'kizuna-ai-lab', repo: 'sokuji', env: { SOKUJI_UPDATE_FEED: 'http://evil.example/feed' } }))
      .toBe('https://github.com/kizuna-ai-lab/sokuji/releases/latest/download');
  });
});

describe('isSquirrelInstall', () => {
  it('is true when Update.exe sits beside the app-<version> folder', () => {
    const seen = [];
    const existsSync = (p) => { seen.push(p); return true; };
    expect(isSquirrelInstall({ execPath: 'C:\\Users\\j\\AppData\\Local\\Sokuji\\app-0.46.4\\sokuji.exe', existsSync, sep: '\\' })).toBe(true);
    expect(seen).toEqual(['C:\\Users\\j\\AppData\\Local\\Sokuji\\Update.exe']);
  });

  it('is false for a development run or a damaged install', () => {
    expect(isSquirrelInstall({ execPath: 'C:\\dev\\node_modules\\electron\\dist\\electron.exe', existsSync: () => false, sep: '\\' })).toBe(false);
  });

  it('is false for a bare executable name, without probing a bogus path', () => {
    const seen = [];
    expect(isSquirrelInstall({ execPath: 'sokuji.exe', existsSync: (p) => { seen.push(p); return true; }, sep: '\\' })).toBe(false);
    expect(seen).toEqual([]);
  });
});

describe('isSquirrelFirstRun', () => {
  it('recognises the launch right after an install, when Update.exe still holds its lock', () => {
    expect(isSquirrelFirstRun(['sokuji.exe', '--squirrel-firstrun'])).toBe(true);
    expect(isSquirrelFirstRun(['sokuji.exe'])).toBe(false);
  });
});

function fakeAutoUpdater() {
  const au = new EventEmitter();
  au.feed = null;
  au.checks = 0;
  au.setFeedURL = (o) => { au.feed = o; };
  au.checkForUpdates = () => { au.checks += 1; };
  au.quitAndInstall = () => { au.quit = true; };
  return au;
}

describe('createSquirrelDownload', () => {
  const feedUrl = 'https://github.com/kizuna-ai-lab/sokuji/releases/latest/download';

  it('points the updater at the feed, reports downloading, and resolves once Squirrel has applied the package', async () => {
    const au = fakeAutoUpdater();
    const statuses = [];
    const d = createSquirrelDownload({ autoUpdater: au, feedUrl, onStatus: (s) => statuses.push(s) });
    const p = d.download();
    expect(au.feed).toEqual({ url: feedUrl });
    expect(au.checks).toBe(1);
    expect(statuses).toEqual([{ status: 'downloading', indeterminate: true }]);
    au.emit('update-available');
    au.emit('update-downloaded', {}, '', '0.46.5', new Date(), feedUrl);
    await expect(p).resolves.toEqual({ releaseName: '0.46.5' });
    expect(statuses.at(-1)).toEqual({ status: 'downloaded' });
  });

  it('rejects when the feed lists nothing newer than what is installed', async () => {
    const au = fakeAutoUpdater();
    const d = createSquirrelDownload({ autoUpdater: au, feedUrl, onStatus: () => {} });
    const p = d.download();
    au.emit('update-not-available');
    await expect(p).rejects.toThrow('The update feed lists no version newer than the installed one');
  });

  it('rejects, cleans up and can be retried when the updater throws synchronously', async () => {
    const au = fakeAutoUpdater();
    let fail = true;
    au.checkForUpdates = () => { au.checks += 1; if (fail) throw new Error('Can not find Squirrel'); };
    const d = createSquirrelDownload({ autoUpdater: au, feedUrl, onStatus: () => {} });
    await expect(d.download()).rejects.toThrow('Can not find Squirrel');
    for (const ev of ['update-downloaded', 'update-not-available', 'error']) expect(au.listenerCount(ev)).toBe(0);
    fail = false;
    const p = d.download();
    expect(au.checks).toBe(2);
    au.emit('update-downloaded', {}, '', '0.46.5', new Date(), feedUrl);
    await expect(p).resolves.toEqual({ releaseName: '0.46.5' });
  });

  it('remembers an applied package: a later download resolves at once instead of asking Squirrel again', async () => {
    const au = fakeAutoUpdater();
    const statuses = [];
    const d = createSquirrelDownload({ autoUpdater: au, feedUrl, onStatus: (s) => statuses.push(s) });
    const p = d.download();
    au.emit('update-downloaded', {}, '', '0.46.5', new Date(), feedUrl);
    await p;
    await expect(d.download()).resolves.toEqual({ releaseName: '0.46.5' });
    expect(au.checks).toBe(1);
    expect(statuses.at(-1)).toEqual({ status: 'downloaded' });
    expect(d.applied()).toEqual({ releaseName: '0.46.5' });
  });

  it("rejects with Squirrel's error and leaves no listener behind", async () => {
    const au = fakeAutoUpdater();
    const d = createSquirrelDownload({ autoUpdater: au, feedUrl, onStatus: () => {} });
    const p = d.download();
    au.emit('error', new Error('Update.exe exited with 1'));
    await expect(p).rejects.toThrow('Update.exe exited with 1');
    for (const ev of ['update-downloaded', 'update-not-available', 'error']) expect(au.listenerCount(ev)).toBe(0);
  });

  it('shares one download between two requests', async () => {
    const au = fakeAutoUpdater();
    const d = createSquirrelDownload({ autoUpdater: au, feedUrl, onStatus: () => {} });
    const p1 = d.download();
    const p2 = d.download();
    expect(p1).toBe(p2);
    expect(au.checks).toBe(1);
    au.emit('update-downloaded', {}, '', '0.46.5', new Date(), feedUrl);
    await p1;
  });

  it('installs by handing over to Squirrel, which restarts the app', () => {
    const au = fakeAutoUpdater();
    const d = createSquirrelDownload({ autoUpdater: au, feedUrl, onStatus: () => {} });
    d.quitAndInstall();
    expect(au.quit).toBe(true);
  });
});
