import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { Sokuji } from './app';

/** A sentence the fake transcription returns: what was said, and when in the file. */
export interface TranscribedSentence {
  text: string;
  startMs: number;
  endMs: number;
  speaker?: string;
}

/**
 * What the next file transcriptions do, in words of no particular service: each fake (e2e/support/main/) answers it in
 * its own service's shape.
 */
export type TranscriptionAnswer =
  /** It finishes and returns these sentences. */
  | { sentences: TranscribedSentence[] }
  /** It stays at "transcribing" until `release()`. */
  | { hold: true }
  /** It fails, for this reason. */
  | { fail: 'no-credit' | 'bad-key' | 'unreadable' | 'service'; message?: string };

export interface FakeTranscription {
  /** How the transcriptions started from now on answer. Default: two short English sentences. */
  answerWith(answer: TranscriptionAnswer): Promise<void>;
  /** A transcription held by `{ hold: true }` finishes, with the default sentences. */
  release(): Promise<void>;
  /** The requests the service was sent, in its own terms: for a failure's message. */
  asked(): Promise<string[]>;
  /** The uploads and transcriptions the service still keeps: the app deletes them when it is done, or gives up. */
  kept(): Promise<number>;
  /** Requests from the main process that no fake answered (they were refused, not sent). */
  refused(): Promise<string[]>;
}

type Control = {
  answerWith(a: TranscriptionAnswer): void;
  release(): void;
  asked(): string[];
  kept(): number;
};
/** The fakes the main process was given at launch (e2e/support/main/fake-services.cjs). */
type Fakes = { refused: string[]; services: { transcription: Control } };
/** The main process's global object, with the fakes on it. */
type Main = typeof globalThis & { e2eFakes: Fakes };

/**
 * The file transcription service, faked. The app must have been launched with `fakeServices: true`: the service is
 * called from the main process, which the page's network routes do not reach.
 */
export async function fakeTranscription(sokuji: Sokuji): Promise<FakeTranscription> {
  const { app } = sokuji;
  const ready = await app.evaluate(() => Boolean((globalThis as { e2eFakes?: unknown }).e2eFakes));
  if (!ready) throw new Error('The fakes are not in the main process: launch the app with `fakeServices: true`.');
  await sonioxAcceptsKeys(sokuji);
  // Each runs in the main process, which sees nothing of this file but what is passed (so no shared helper).
  return {
    answerWith: (answer) => app.evaluate((_e, a) => { (globalThis as Main).e2eFakes.services.transcription.answerWith(a); }, answer),
    release: () => app.evaluate(() => { (globalThis as Main).e2eFakes.services.transcription.release(); }),
    asked: () => app.evaluate(() => (globalThis as Main).e2eFakes.services.transcription.asked()),
    kept: () => app.evaluate(() => (globalThis as Main).e2eFakes.services.transcription.kept()),
    refused: () => app.evaluate(() => [...(globalThis as Main).e2eFakes.refused]),
  };
}

// --- Soniox, the one service with file transcription today -------------------------------------------------------
// Its key is checked from the page (a temporary key asked for on each region's host), and put in from Settings.

const keysAccepted = new WeakSet<Sokuji>();
/** Soniox takes any key, on the US region; the other regions refuse it, as they do a real US key. Once per app. */
async function sonioxAcceptsKeys(sokuji: Sokuji) {
  if (keysAccepted.has(sokuji)) return;
  keysAccepted.add(sokuji);
  await sokuji.app.context().route(/^https:\/\/api(\.[a-z]+)?\.soniox\.com\/v1\/auth\/temporary-api-key$/, (route) => {
    const us = new URL(route.request().url()).hostname === 'api.soniox.com';
    return route.fulfill(us
      ? { status: 201, contentType: 'application/json', body: JSON.stringify({ api_key: 'e2e-temporary-key', expires_at: new Date(Date.now() + 3_600_000).toISOString() }) }
      : { status: 401, contentType: 'application/json', body: JSON.stringify({ error_type: 'unauthenticated', message: 'Invalid API key.' }) });
  });
}

/**
 * The transcription service's key put in from Settings, as a user does, and checked. Finding the key's region asks
 * every region, and the ones it does not belong to refuse it: the 401s logged while this runs are taken out of
 * `sokuji.errors`, and nothing else.
 */
export async function addTranscriptionKey(sokuji: Sokuji, page: Page = sokuji.page) {
  const before = sokuji.errors.length;
  await page.locator('[data-tour="settings-button"]').click();
  await page.getByRole('navigation').getByRole('button', { name: /^Accounts and keys/ }).click();
  await page.getByRole('group', { name: 'Soniox', exact: true }).getByRole('button', { name: 'Add key' }).click();
  await page.getByPlaceholder('Soniox API key').fill('e2e-not-a-real-key');
  await page.getByRole('button', { name: 'Save and find its region' }).click();
  await expect(page.locator('.soniox-key__line')).toContainText(/Key works/, { timeout: 30_000 });
  await page.keyboard.press('Escape');
  for (let i = sokuji.errors.length - 1; i >= before; i--) if (/status of 401/.test(sokuji.errors[i])) sokuji.errors.splice(i, 1);
}

/** The line-up that transcribes with the service that has file transcription. */
export const transcriptionLineUp = { transcription: 'soniox', translation: 'soniox', speech: null, summarisation: null };
