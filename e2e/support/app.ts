import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO = path.resolve(__dirname, '../..');

export interface Sokuji {
  app: ElectronApplication;
  page: Page;
  /** The app's whole state: settings (localStorage), history/history.db, history/records/. */
  userData: string;
  /** Console errors and uncaught page errors seen so far. */
  errors: string[];
  /** Quits the app. The user-data directory stays, for a relaunch or for reading the history. */
  close(): Promise<void>;
}

/** What the first-run wizard would have stored, plus the choices every test wants: the wizard and the tour are done, the interface is English. */
export interface Seed {
  /** localStorage entries written before the app's own code runs. */
  storage?: Record<string, string>;
}

const now = () => new Date().toISOString();

export function baseStorage(provider = 'fake'): Record<string, string> {
  return {
    'settings.setup': JSON.stringify({ version: 1, scenario: 'subtitle-myself', providerPath: 'own-key', provider, completedAt: now() }),
    'settings.tour': JSON.stringify({ version: 1, completedChapters: ['basics'], completedAt: now(), method: 'skipped' }),
    'settings.common.provider': provider,
    'settings.lineup': JSON.stringify({ transcription: provider, translation: provider, speech: provider, summarisation: null }),
    'settings.common.uiLanguage': 'en',
  };
}

export function newUserData(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sokuji-e2e-'));
}

/** Deletes a user-data directory. For the end of a test that passed: a failed test leaves its directory behind to be looked at. */
export function removeUserData(userData: string): void {
  if (path.basename(userData).startsWith('sokuji-e2e-')) fs.rmSync(userData, { recursive: true, force: true });
}

/**
 * Starts the E2E build (`npm run e2e:build`) on `userData`. A new directory is a first run;
 * passing the directory of an app that was closed (or killed) is a restart on the same state.
 */
export async function launch(options: { userData?: string; seed?: Seed } = {}): Promise<Sokuji> {
  if (!fs.existsSync(path.join(REPO, 'build/index.html')) || !fs.existsSync(path.join(REPO, 'dist-electron/main.js'))) {
    throw new Error('No E2E build found. Run `npm run e2e:build` first.');
  }
  const userData = options.userData ?? newUserData();
  const app = await electron.launch({
    cwd: REPO,
    args: [
      '.',
      `--user-data-dir=${userData}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ],
    env: { ...process.env, ...(process.platform === 'linux' && !process.env.DISPLAY ? { DISPLAY: ':1' } : {}) },
  });
  const isMain = (page: Page) => page.url().endsWith('/build/index.html');
  const page = app.windows().find(isMain) ?? await app.waitForEvent('window', { predicate: isMain });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.waitForLoadState('domcontentloaded');
  // Registered once the window is known: an init script added before Playwright has attached to the
  // window is not applied to it (seen with Electron 44 and Playwright 1.65).
  await app.context().addInitScript({ path: path.join(__dirname, 'page/mic.js') });
  // The window began loading before this process could reach it, so its first document ran without the
  // microphone and without the seed. Write the seed into the page that is there, then load once more.
  // Only where nothing was seeded yet: a restart must find what the app itself wrote.
  const storage = options.seed?.storage;
  if (storage) {
    await page.evaluate((entries) => {
      if (localStorage.getItem('e2e.seeded')) return;
      localStorage.clear();
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
      localStorage.setItem('e2e.seeded', '1');
    }, storage);
  }
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  if (!(await page.evaluate(() => Boolean((navigator.mediaDevices as MediaDevices & { __e2eMic?: boolean }).__e2eMic)))) {
    throw new Error('The E2E microphone was not installed in the page.');
  }
  return {
    app, page, userData, errors,
    close: async () => { await app.close().catch(() => undefined); },
  };
}

/** The Start / End session button. */
export const mainAction = (page: Page) => page.locator('[data-tour="main-action"]');
