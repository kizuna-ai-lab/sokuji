import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
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
  /** Ends the process at once, as a crash or a power cut would: nothing in the app gets to clean up. Relaunch on `userData` to see what it recovers. */
  kill(): Promise<void>;
  /** What the system's Save dialog answers from now on: the chosen path, or null for Cancel. Playwright cannot click a native dialog. */
  answerSaveDialog(filePath: string | null): Promise<void>;
  /** What the system's Open dialog answers from now on: the chosen paths, or null for Cancel. */
  answerOpenDialog(filePaths: string[] | null): Promise<void>;
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
    // The interface language: the app reads it from `i18nextLng` (the setting beside it is what Settings shows).
    // Without it the app follows the machine's language, and specs that find elements by their English names fail.
    i18nextLng: 'en',
    'settings.common.uiLanguage': 'en',
    // Noise suppression off: the recording keeps what is sent for recognition, after noise suppression, and the
    // enhanced mode (the app's default) now and then takes the injected microphone's steady tone for noise and
    // removes seconds of it. A spec about noise suppression sets its own mode.
    'audio.noiseSuppressionMode': 'off',
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
export async function launch(options: {
  userData?: string;
  seed?: Seed;
  /** The services the main process calls are answered by the test's fakes (e2e/support/main/fake-services.cjs). */
  fakeServices?: boolean;
} = {}): Promise<Sokuji> {
  const main = path.join(REPO, 'dist-electron/main.js');
  if (!fs.existsSync(path.join(REPO, 'build/index.html')) || !fs.existsSync(main)) {
    throw new Error('No E2E build found. Run `npm run e2e:build` first.');
  }
  // `npm run build` leaves the same two files. That build must never be started from here: it cleans and
  // recreates the system's virtual audio devices, whichever user-data directory it runs on.
  if (!fs.readFileSync(main, 'utf8').includes('SOKUJI_E2E_BUILD')) {
    throw new Error('build/ and dist-electron/ hold another build, not the E2E build. Run `npm run e2e:build`.');
  }
  const userData = options.userData ?? newUserData();
  const app = await electron.launch({
    cwd: REPO,
    args: [
      // Loaded into the main process before the app's own code, so that the app takes the fakes' `fetch`.
      ...(options.fakeServices ? ['-r', path.join(__dirname, 'main', 'fake-services.cjs')] : []),
      '.',
      `--user-data-dir=${userData}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ],
    env: { ...process.env, ...(process.platform === 'linux' && !process.env.DISPLAY ? { DISPLAY: ':1' } : {}) },
  });
  // Ends the app at once, with its renderer, GPU and utility processes: left alone they outlive the main process,
  // keep the user-data directory busy and hold the test runner open. Every process of this app carries the
  // user-data directory on its command line, and no other process does, so that is how they are found.
  // Taken now: once the app has closed, Playwright no longer hands its process out.
  const child = app.process();
  let ended = false;
  const kill = async () => {
    if (ended) return;
    ended = true;
    const gone = new Promise<void>((resolve) => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', () => resolve()); });
    // Playwright starts the app as the leader of its own process group: the group goes first, all at once.
    // (Killing the main process alone leaves the runner waiting two minutes at teardown.)
    try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); } catch { /* no such group */ }
    // Windows (not exercised yet: the tests have only run on Linux and macOS): the child is the launcher shell,
    // so the tree is ended by its pid while the shell still lives.
    if (child.pid && process.platform === 'win32') {
      try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
    }
    child.kill('SIGKILL');
    await gone;
    // Whatever left the group is found by its command line.
    if (process.platform !== 'win32') {
      const rows = execFileSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8' }).split('\n');
      for (const row of rows) {
        if (!row.includes(`--user-data-dir=${userData}`)) continue;
        const pid = Number(row.trim().split(/\s+/, 1)[0]);
        if (pid && pid !== process.pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
      }
    }
    await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 3_000))]);
  };
  const errors: string[] = [];
  let page: Page;
  try {
    const isMain = (candidate: Page) => candidate.url().endsWith('/build/index.html');
    page = app.windows().find(isMain) ?? await app.waitForEvent('window', { predicate: isMain });
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
    // Always, seed or not, restart or not: only a document loaded after the init script was registered has the microphone.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    // Chromium writes a page's storage to disk in batches. A user's settings are long on disk when the app crashes;
    // a test's were seeded a moment ago, and a kill() soon after would lose them and restart into the setup wizard.
    // So what was seeded is written out now. Settings a test changes later through the app are not: a crash right
    // after such a change is the app's own behaviour to test.
    if (storage) await app.evaluate(({ session }) => session.defaultSession.flushStorageData());
    if (!(await page.evaluate(() => Boolean((navigator.mediaDevices as MediaDevices & { __e2eMic?: boolean }).__e2eMic)))) {
      throw new Error('The E2E microphone was not installed in the page.');
    }
  } catch (error) {
    // A half-started app would keep its user-data directory and its processes; the next test must not meet it.
    await kill();
    throw error;
  }
  return {
    app, page, userData, errors,
    // A clean quit; whatever is still there afterwards is swept by kill(), which is then a no-op for the rest.
    close: async () => { await app.close().catch(() => undefined); await kill(); },
    kill,
    answerSaveDialog: (filePath) => app.evaluate(({ dialog }, chosen) => {
      dialog.showSaveDialog = (async () => (chosen === null ? { canceled: true, filePath: '' } : { canceled: false, filePath: chosen })) as typeof dialog.showSaveDialog;
    }, filePath),
    answerOpenDialog: (filePaths) => app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = (async () => (chosen === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: chosen })) as typeof dialog.showOpenDialog;
    }, filePaths),
  };
}

/** The Start / End session button. */
export const mainAction = (page: Page) => page.locator('[data-tour="main-action"]');
