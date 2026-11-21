import type { Page } from '@playwright/test';
import { baseStorage, forgetSecrets, mainAction, type Sokuji } from '../support/app';
import { readHistory } from '../support/history';
import { clip, heardAndTranslated, PAUSES_MS, say, SENTENCES } from '../support/speech';
import { expect, test } from '../support/test';

// Tagged @real: these talk to real services, so they are left out of `npm run e2e` and run with `npm run e2e:real`.
// Each is skipped without what it needs from the environment.
//
// A line-up of two services against the services themselves: Soniox transcribes and translates, Edge reads the
// translations aloud. Once with the user's own Soniox key (E2E_SONIOX_KEY), once with Kizuna AI's Soniox, signed in
// (E2E_ACCOUNT_EMAIL and E2E_ACCOUNT_PASSWORD).
//
// The Kizuna AI one needs an E2E build that offers the hosted service and knows where it is:
//
//   VITE_ENABLE_KIZUNA_AI=true VITE_BACKEND_URL=<the backend's address> npm run e2e:build
//
// On the ordinary E2E build it is skipped: that build has no sign-in.
//
// What each checks: the sentences said are heard and translated (nine in ten, a real service being what it is),
// Edge's audio arrived for at least one translation, History holds one record whose stages name the two services,
// and no connection to Soniox's own voice was ever opened (the session asks Soniox for text only).

const KEY = process.env.E2E_SONIOX_KEY ?? '';
const EMAIL = process.env.E2E_ACCOUNT_EMAIL ?? '';
const PASSWORD = process.env.E2E_ACCOUNT_PASSWORD ?? '';
/** How many times the eight sentences are said. */
const ROUNDS = 2;

// A key is typed into the app, or an account signed in: a trace or a screenshot would keep it.
test.use({ trace: 'off', screenshot: 'off' });

const lineUp = (text: string) => JSON.stringify({ version: 2, stages: { transcription: text, translation: text, speech: 'edge', summarisation: null } });

const seed = (text: string) => ({
  storage: {
    ...baseStorage(text),
    'settings.lineup': lineUp(text),
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

  // Edge read something aloud. Soniox's voice is not asked for in this line-up, so a row's audio is Edge's: a row
  // can be replayed only once Edge's audio for it has arrived. One row is enough: Edge now and then refuses a
  // sentence, which leaves that row without audio.
  await expect(page.getByRole('button', { name: "Play this item's audio", disabled: false }).first()).toBeVisible({ timeout: 30_000 });

  await mainAction(page).click();
  await expect(mainAction(page)).toHaveText(/^\s*(Start Session|Start)\s*$/, { timeout: 60_000 });
  await expect(mainAction(page)).toBeEnabled({ timeout: 60_000 });
  return spoken;
}

/** What the session left: one record that names both services, the sentences heard and translated, and no connection to Soniox's voice. */
function checkOutcome(sokuji: Sokuji, text: string, spoken: readonly number[], sockets: readonly string[]): void {
  const stored = readHistory(sokuji.userData);
  expect(stored).toHaveLength(1);
  const [record] = stored;
  expect(record.state).toBe('closed');
  const services = JSON.parse(record.services) as { provider: string; stages?: Record<string, string> };
  expect(services.provider).toBe(text);
  expect(services.stages).toEqual({ transcription: text, translation: text, speech: 'edge' });

  const { heard, translated } = heardAndTranslated(record, spoken);
  test.info().annotations.push({ type: 'sentences said / heard / translated', description: `${spoken.length} / ${heard} / ${translated}` });
  // Nine in ten, rounded up: of 16 sentences, 15.
  const enough = Math.ceil(spoken.length * 0.9);
  expect(heard).toBeGreaterThanOrEqual(enough);
  expect(translated).toBeGreaterThanOrEqual(enough);

  // Soniox was reached for the text, and never for its voice.
  expect(sockets.some((address) => address.endsWith('/transcribe-websocket')), 'a connection to Soniox for transcription').toBe(true);
  expect(sockets.filter((address) => address.includes('tts-websocket'))).toEqual([]);

  // Nothing in the page threw. What the page logged as an error is attached, not judged: Edge now and then refuses
  // the connection for one sentence, which the session says and survives.
  expect(sokuji.errors.filter((error) => error.startsWith('pageerror:'))).toEqual([]);
  const logged = sokuji.errors.filter((error) => !error.startsWith('pageerror:'));
  if (logged.length > 0) test.info().annotations.push({ type: 'errors logged by the page', description: String(logged.length) });
}

test('@real Soniox with an own key is read aloud by Edge, and no connection to Soniox\'s voice is opened', async ({ launchApp }) => {
  test.skip(!KEY, 'E2E_SONIOX_KEY is not set');
  test.setTimeout(10 * 60_000);
  const sokuji = await launchApp({ seed: seed('soniox') });
  const { page } = sokuji;
  try {
    // The key goes in the way a user puts it in: Settings, Accounts and keys, Soniox.
    await page.locator('[data-tour="settings-button"]').click();
    await page.getByRole('navigation').getByRole('button', { name: /^Accounts and keys/ }).click();
    await page.getByRole('group', { name: 'Soniox', exact: true }).getByRole('button', { name: 'Add key' }).click();
    await page.getByPlaceholder('Soniox API key').fill(KEY);
    await page.getByRole('button', { name: 'Save and find its region' }).click();
    await expect(page.locator('.soniox-key__line')).toContainText(/Key works · Belongs to /, { timeout: 60_000 });
    await page.keyboard.press('Escape');
    // Finding the key's region asks every region, and the ones the key does not belong to refuse it: expected.
    sokuji.errors.length = 0;

    const sockets = socketsOf(page);
    const spoken = await runSession(sokuji);
    await sokuji.close();
    checkOutcome(sokuji, 'soniox', spoken, sockets);
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
    // The title bar offers the sign-in only where the build offers the hosted service.
    await expect(page.locator('[data-tour="settings-button"]')).toBeVisible({ timeout: 30_000 });
    const signIn = page.getByRole('banner').getByRole('button', { name: 'Sign In', exact: true });
    test.skip(await signIn.count() === 0, 'this build does not offer the hosted service (see the top of this file)');

    // Signed in the way a user signs in: the title bar's button, its popover, the form.
    await signIn.click();
    await page.locator('.account-popover__btn', { hasText: /^Sign In$/ }).click();
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    // Signed in: the title bar no longer offers it.
    await expect(signIn).toHaveCount(0, { timeout: 60_000 });
    sokuji.errors.length = 0;

    const sockets = socketsOf(page);
    const spoken = await runSession(sokuji);
    await sokuji.close();
    checkOutcome(sokuji, 'kizunaai_soniox', spoken, sockets);
  } finally {
    // The sign-in is kept in the profile: whatever happened, it does not stay on disk.
    await sokuji.kill();
    forgetSecrets(sokuji.userData);
  }
});
