import type { Page } from '@playwright/test';
import { baseStorage, forgetSecrets, mainAction, type Sokuji } from '../support/app';
import { readHistory } from '../support/history';
import { clip, heardAndTranslated, PAUSES_MS, say, SENTENCES } from '../support/speech';
import { expect, test } from '../support/test';

// Tagged @real: these talk to real services, so they are left out of `npm run e2e` and run with `npm run e2e:real`.
// Each is skipped without what it needs from the environment.
//
// A line-up of two services against the services themselves. Soniox transcribes and translates, and Edge reads the
// translations aloud: once with the user's own Soniox key (E2E_SONIOX_KEY), once with Kizuna AI's Soniox, signed in
// (E2E_ACCOUNT_EMAIL and E2E_ACCOUNT_PASSWORD). And Soniox with the user's own key, read aloud by Kizuna AI's
// Soniox voice: that one needs the key and the account both. And transcription and translation apart: Soniox with
// the user's own key transcribes, Bing translates what it heard, and Edge reads the translations (the key alone).
//
// The ones with Kizuna AI need an E2E build that offers the hosted service and knows where it is:
//
//   VITE_ENABLE_KIZUNA_AI=true VITE_BACKEND_URL=<the backend's address> npm run e2e:build
//
// On the ordinary E2E build they are skipped: that build has no sign-in.
//
// What each checks: the sentences said are heard and translated (nine in ten, a real service being what it is),
// the voice's audio arrived for at least one translation, and History holds one record whose stages name the two
// services. Read by Edge, no connection to Soniox's own voice was ever opened (the session asks Soniox for text
// only); read by Kizuna AI's Soniox voice, one was. Translated by Bing, Soniox was asked for no translation: what
// its connection is first sent has no `translation` member.

const KEY = process.env.E2E_SONIOX_KEY ?? '';
const EMAIL = process.env.E2E_ACCOUNT_EMAIL ?? '';
const PASSWORD = process.env.E2E_ACCOUNT_PASSWORD ?? '';
/** How many times the eight sentences are said. */
const ROUNDS = 2;

// A key is typed into the app, or an account signed in: a trace or a screenshot would keep it.
test.use({ trace: 'off', screenshot: 'off' });

const lineUp = (text: string, speech: string, translation: string) => JSON.stringify({ version: 2, stages: { transcription: text, translation, speech, summarisation: null } });

/** `text` transcribes, and translates too unless `translation` names another service. */
const seed = (text: string, speech = 'edge', translation = text) => ({
  storage: {
    ...baseStorage(text),
    'settings.lineup': lineUp(text, speech, translation),
    'settings.common.sourceLanguage': 'ja',
    'settings.common.targetLanguage': 'en',
    // What is read aloud is kept for replay, so a row shows whether it has audio.
    'settings.common.keepReplayAudio': 'true',
    'e2e.mic': 'speech',
  },
});

/** Every WebSocket the page opens from now on, as host and path: the key travels elsewhere, never in the address. */
function socketsOf(page: Page): string[] {
  const opened: string[] = [];
  page.on('websocket', (socket) => {
    try {
      const url = new URL(socket.url());
      opened.push(`${url.host}${url.pathname}`);
    } catch {
      opened.push('unreadable address');
    }
  });
  return opened;
}

/**
 * The members of the first message sent on each connection to Soniox for transcription, from now on: its
 * configuration. Only the members' names are kept: the message itself holds the key.
 */
function sttConfigsOf(page: Page): string[][] {
  const configs: string[][] = [];
  page.on('websocket', (socket) => {
    if (!socket.url().split('?')[0].endsWith('/transcribe-websocket')) return;
    let first = true;
    socket.on('framesent', (frame) => {
      if (!first || typeof frame.payload !== 'string') return;
      first = false;
      try {
        configs.push(Object.keys(JSON.parse(frame.payload) as Record<string, unknown>));
      } catch {
        configs.push(['unreadable']);
      }
    });
  });
  return configs;
}

/**
 * Starts the session, says the sentences, ends it and closes the app. The session is on when the main button says
 * so: a start can be held for some seconds by a session that has only just ended on the same account.
 */
async function runSession(sokuji: Sokuji): Promise<number[]> {
  const { page } = sokuji;
  const clips = SENTENCES.map((sentence) => clip(sentence.file));
  await expect(mainAction(page)).toBeEnabled({ timeout: 60_000 });
  await mainAction(page).click();
  await expect(mainAction(page)).toHaveText(/^\s*(End Session|Stop)\s*$/, { timeout: 90_000 });

  const spoken: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    for (let i = 0; i < SENTENCES.length; i++) {
      spoken.push(i);
      await say(page, clips[i]);
      await page.waitForTimeout(PAUSES_MS[i]);
    }
    // The round's first sentence is on the screen, translated, before the next round or the end.
    await expect(page.getByText(/umbrella/i).first()).toBeVisible({ timeout: 30_000 });
  }
  await page.waitForTimeout(8_000); // the last sentence's translation arriving

  // The voice read something aloud. A row's audio is the voice's of the line-up, whichever that is: a row can be
  // replayed only once the voice's audio for it has arrived. One row is enough: Edge now and then refuses a
  // sentence, which leaves that row without audio.
  await expect(page.getByRole('button', { name: "Play this item's audio", disabled: false }).first()).toBeVisible({ timeout: 30_000 });

  await mainAction(page).click();
  await expect(mainAction(page)).toHaveText(/^\s*(Start Session|Start)\s*$/, { timeout: 60_000 });
  await expect(mainAction(page)).toBeEnabled({ timeout: 60_000 });
  return spoken;
}

/**
 * What the session left: one record that names its services, the sentences heard and translated, and a connection
 * to Soniox's voice exactly when a Soniox voice is the line-up's (`speech`: the line-up's id for the speech stage).
 * `translation`: the line-up's id for the translation stage, where it is not the service that transcribes.
 */
function checkOutcome(sokuji: Sokuji, text: string, speech: string, spoken: readonly number[], sockets: readonly string[], translation = text): void {
  const stored = readHistory(sokuji.userData);
  expect(stored).toHaveLength(1);
  const [record] = stored;
  expect(record.state).toBe('closed');
  const services = JSON.parse(record.services) as { provider: string; stages?: Record<string, string> };
  expect(services.provider).toBe(text);
  expect(services.stages).toEqual({ transcription: text, translation, speech });

  const { heard, translated } = heardAndTranslated(record, spoken);
  test.info().annotations.push({ type: 'sentences said / heard / translated', description: `${spoken.length} / ${heard} / ${translated}` });
  // Nine in ten, rounded up: of 16 sentences, 15.
  const enough = Math.ceil(spoken.length * 0.9);
  expect(heard).toBeGreaterThanOrEqual(enough);
  expect(translated).toBeGreaterThanOrEqual(enough);

  // Soniox was reached for the text; for its voice, never when Edge speaks and at least once when Soniox's does.
  expect(sockets.some((address) => address.endsWith('/transcribe-websocket')), 'a connection to Soniox for transcription').toBe(true);
  const voice = sockets.filter((address) => address.includes('tts-websocket'));
  if (speech === 'edge') expect(voice).toEqual([]);
  else expect(voice.length, "a connection to Soniox's voice").toBeGreaterThan(0);

  // Nothing in the page threw. What the page logged as an error is attached, not judged: Edge now and then refuses
  // the connection for one sentence, which the session says and survives.
  expect(sokuji.errors.filter((error) => error.startsWith('pageerror:'))).toEqual([]);
  const logged = sokuji.errors.filter((error) => !error.startsWith('pageerror:'));
  if (logged.length > 0) test.info().annotations.push({ type: 'errors logged by the page', description: String(logged.length) });
}

/** The key goes in the way a user puts it in: Settings, Accounts and keys, Soniox. */
async function addSonioxKey(page: Page): Promise<void> {
  await page.locator('[data-tour="settings-button"]').click();
  await page.getByRole('navigation').getByRole('button', { name: /^Accounts and keys/ }).click();
  await page.getByRole('group', { name: 'Soniox', exact: true }).getByRole('button', { name: 'Add key' }).click();
  await page.getByPlaceholder('Soniox API key').fill(KEY);
  await page.getByRole('button', { name: 'Save and find its region' }).click();
  await expect(page.locator('.soniox-key__line')).toContainText(/Key works · Belongs to /, { timeout: 60_000 });
  await page.keyboard.press('Escape');
}

/**
 * Signed in the way a user signs in: the title bar's button, its popover, the form. False where the build does not
 * offer the hosted service: the title bar offers the sign-in only where it does.
 */
async function signIn(page: Page): Promise<boolean> {
  await expect(page.locator('[data-tour="settings-button"]')).toBeVisible({ timeout: 30_000 });
  const button = page.getByRole('banner').getByRole('button', { name: 'Sign In', exact: true });
  if (await button.count() === 0) return false;
  await button.click();
  await page.locator('.account-popover__btn', { hasText: /^Sign In$/ }).click();
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  // Signed in: the title bar no longer offers it.
  await expect(button).toHaveCount(0, { timeout: 60_000 });
  return true;
}

test('@real Soniox with an own key is read aloud by Edge, and no connection to Soniox\'s voice is opened', async ({ launchApp }) => {
  test.skip(!KEY, 'E2E_SONIOX_KEY is not set');
  test.setTimeout(10 * 60_000);
  const sokuji = await launchApp({ seed: seed('soniox') });
  const { page } = sokuji;
  try {
    await addSonioxKey(page);
    // Finding the key's region asks every region, and the ones the key does not belong to refuse it: expected.
    sokuji.errors.length = 0;

    const sockets = socketsOf(page);
    const spoken = await runSession(sokuji);
    await sokuji.close();
    checkOutcome(sokuji, 'soniox', 'edge', spoken, sockets);
  } finally {
    // The app keeps the key in its settings: whatever happened, it does not stay on disk.
    await sokuji.kill();
    forgetSecrets(sokuji.userData);
  }
});

test('@real Kizuna AI\'s Soniox is read aloud by Edge, signed in, and no connection to Soniox\'s voice is opened', async ({ launchApp }) => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ACCOUNT_EMAIL and E2E_ACCOUNT_PASSWORD are not set');
  test.setTimeout(10 * 60_000);
  const sokuji = await launchApp({ seed: seed('kizunaai_soniox') });
  const { page } = sokuji;
  try {
    test.skip(!(await signIn(page)), 'this build does not offer the hosted service (see the top of this file)');
    sokuji.errors.length = 0;

    const sockets = socketsOf(page);
    const spoken = await runSession(sokuji);
    await sokuji.close();
    checkOutcome(sokuji, 'kizunaai_soniox', 'edge', spoken, sockets);
  } finally {
    // The sign-in is kept in the profile: whatever happened, it does not stay on disk.
    await sokuji.kill();
    forgetSecrets(sokuji.userData);
  }
});

test('@real Soniox with an own key is read aloud by Kizuna AI\'s Soniox voice, signed in, over a connection to Soniox\'s voice', async ({ launchApp }) => {
  test.skip(!KEY, 'E2E_SONIOX_KEY is not set');
  test.skip(!EMAIL || !PASSWORD, 'E2E_ACCOUNT_EMAIL and E2E_ACCOUNT_PASSWORD are not set');
  test.setTimeout(10 * 60_000);
  const sokuji = await launchApp({ seed: seed('soniox', 'kizunaai_soniox') });
  const { page } = sokuji;
  try {
    // The voice is paid from the account's balance, the text from the key: the session needs both.
    test.skip(!(await signIn(page)), 'this build does not offer the hosted service (see the top of this file)');
    await addSonioxKey(page);
    // Finding the key's region asks every region, and the ones the key does not belong to refuse it: expected.
    sokuji.errors.length = 0;

    const sockets = socketsOf(page);
    const spoken = await runSession(sokuji);
    await sokuji.close();
    // The record is the transcribing provider's, and its speech stage names Kizuna AI's Soniox.
    checkOutcome(sokuji, 'soniox', 'kizunaai_soniox', spoken, sockets);
  } finally {
    // The key and the sign-in are kept in the profile: whatever happened, they do not stay on disk.
    await sokuji.kill();
    forgetSecrets(sokuji.userData);
  }
});

test('@real Soniox with an own key transcribes, Bing translates what it heard, and Edge reads it aloud: Soniox is asked for no translation', async ({ launchApp }) => {
  test.skip(!KEY, 'E2E_SONIOX_KEY is not set');
  test.setTimeout(10 * 60_000);
  const sokuji = await launchApp({ seed: seed('soniox', 'edge', 'bing') });
  const { page } = sokuji;
  try {
    await addSonioxKey(page);
    // Finding the key's region asks every region, and the ones the key does not belong to refuse it: expected.
    sokuji.errors.length = 0;

    const sockets = socketsOf(page);
    const configs = sttConfigsOf(page);
    // The sentences are heard by Soniox and shown as source rows; their translations are Bing's (the round's first
    // sentence, translated, is waited for on the screen), and at least one is read aloud by Edge.
    const spoken = await runSession(sokuji);
    await sokuji.close();
    // The record names the three stages, under the provider that transcribes; no connection to Soniox's voice.
    checkOutcome(sokuji, 'soniox', 'edge', spoken, sockets, 'bing');
    // Soniox transcribed alone: its connection was configured, and never asked to translate.
    expect(configs.length, 'a configured connection to Soniox for transcription').toBeGreaterThan(0);
    for (const members of configs) {
      expect(members).toContain('model');
      expect(members).not.toContain('translation');
    }
    // The record names each stage's model: Soniox's recognition, and Bing for the translation.
    const [record] = readHistory(sokuji.userData);
    const services = JSON.parse(record.services) as { models?: Record<string, string> };
    expect(services.models?.translationModel).toBe('bing-translator');
  } finally {
    // The app keeps the key in its settings: whatever happened, it does not stay on disk.
    await sokuji.kill();
    forgetSecrets(sokuji.userData);
  }
});

// Text models (part B): Soniox with the user's own key transcribes, a text model with the user's own key translates
// what it heard, and Edge reads it aloud. OpenAI's with E2E_OPENAI_KEY, Gemini's with E2E_GEMINI_KEY; Soniox's key
// is needed too.
const OPENAI_KEY = process.env.E2E_OPENAI_KEY ?? '';
const GEMINI_KEY = process.env.E2E_GEMINI_KEY ?? '';

/** A key goes in the way a user puts it in: Settings, Accounts and keys, the service's row, then its check. */
async function addKey(page: Page, row: string, key: string): Promise<void> {
  await page.locator('[data-tour="settings-button"]').click();
  await page.getByRole('navigation').getByRole('button', { name: /^Accounts and keys/ }).click();
  const group = page.getByRole('group', { name: row, exact: true });
  await group.getByRole('button', { name: 'Add key' }).click();
  await group.getByLabel('API key', { exact: true }).fill(key);
  await group.getByRole('button', { name: 'Validate' }).click();
  await page.keyboard.press('Escape');
}

for (const [model, row, key, variable, family] of [
  ['openai_text', 'OpenAI', OPENAI_KEY, 'E2E_OPENAI_KEY', /^(?:gpt-|o\d)/],
  ['gemini_text', 'Google Gemini', GEMINI_KEY, 'E2E_GEMINI_KEY', /^(?:gemini-|gemma-)/],
] as const) {
  test(`@real Soniox with an own key transcribes, ${model} translates what it heard with an own key, and Edge reads it aloud`, async ({ launchApp }) => {
    test.skip(!KEY, 'E2E_SONIOX_KEY is not set');
    test.skip(!key, `${variable} is not set`);
    test.setTimeout(10 * 60_000);
    const sokuji = await launchApp({ seed: seed('soniox', 'edge', model) });
    const { page } = sokuji;
    try {
      await addSonioxKey(page);
      await addKey(page, row, key);
      // Finding the Soniox key's region asks every region, and the ones the key does not belong to refuse it: expected.
      sokuji.errors.length = 0;

      const sockets = socketsOf(page);
      const configs = sttConfigsOf(page);
      const spoken = await runSession(sokuji);
      await sokuji.close();
      checkOutcome(sokuji, 'soniox', 'edge', spoken, sockets, model);
      // Soniox transcribed alone: never asked to translate.
      expect(configs.length, 'a configured connection to Soniox for transcription').toBeGreaterThan(0);
      for (const members of configs) expect(members).not.toContain('translation');
      // The record names the text model that translated: the service's automatic one.
      const [record] = readHistory(sokuji.userData);
      const services = JSON.parse(record.services) as { models?: Record<string, string> };
      expect(services.models?.translationModel ?? '').toMatch(family);
    } finally {
      // The app keeps the keys in its settings: whatever happened, they do not stay on disk.
      await sokuji.kill();
      forgetSecrets(sokuji.userData);
    }
  });
}
