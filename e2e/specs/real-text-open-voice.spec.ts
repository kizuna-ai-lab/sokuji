import type { Page } from '@playwright/test';
import { baseStorage, forgetSecrets, mainAction, type Sokuji } from '../support/app';
import { readHistory } from '../support/history';
import { clip, heardAndTranslated, PAUSES_MS, say, SENTENCES } from '../support/speech';
import { expect, test } from '../support/test';

// Tagged @real: these talk to real services, so they are left out of `npm run e2e` and run with `npm run e2e:real`.
// Each is skipped without what it needs from the environment.
//
// A whole-unit service whose text-only session makes no audio, read aloud by Edge (owner, 2026-11-23): Kizuna AI's
// Qwen, signed in (E2E_ACCOUNT_EMAIL and E2E_ACCOUNT_PASSWORD, on an E2E build that offers the hosted service:
// `VITE_ENABLE_KIZUNA_AI=true VITE_BACKEND_URL=<the backend's address> npm run e2e:build`); Qwen with the user's own
// key (E2E_QWEN_KEY); OpenAI Realtime (E2E_OPENAI_KEY); Doubao AST 2.0 with an API key (E2E_DOUBAO_KEY).
//
// What each checks: the sentences said are heard and translated (eight in ten: the service decides its own
// sentences), the voice's audio arrived for at least one translation, History holds one record whose stages name the
// service for the text and Edge for the speech, and the service was asked for text alone: Qwen's and OpenAI's first
// configuration asks for the text modality only, and Kizuna AI's lease asks for no leg's voice.

const EMAIL = process.env.E2E_ACCOUNT_EMAIL ?? '';
const PASSWORD = process.env.E2E_ACCOUNT_PASSWORD ?? '';
const QWEN_KEY = process.env.E2E_QWEN_KEY ?? '';
const OPENAI_KEY = process.env.E2E_OPENAI_KEY ?? '';
const DOUBAO_KEY = process.env.E2E_DOUBAO_KEY ?? '';

// A key is typed into the app, or an account signed in: a trace or a screenshot would keep it.
test.use({ trace: 'off', screenshot: 'off' });

const seed = (text: string, storage: Record<string, string> = {}) => ({
  storage: {
    ...baseStorage(text),
    'settings.lineup': JSON.stringify({ version: 2, stages: { transcription: text, translation: text, speech: 'edge', summarisation: null } }),
    'settings.common.sourceLanguage': 'ja',
    'settings.common.targetLanguage': 'en',
    // What is read aloud is kept for replay, so a row shows whether it has audio.
    'settings.common.keepReplayAudio': 'true',
    'e2e.mic': 'speech',
    ...storage,
  },
});

/**
 * The output modalities each WebSocket's messages ask for, from now on: the `session.update` a Qwen or OpenAI
 * Realtime session is configured with. Only that member is kept: nothing else of a message is read.
 */
function modalitiesOf(page: Page): unknown[] {
  const asked: unknown[] = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', (frame) => {
      if (typeof frame.payload !== 'string') return;
      try {
        const message = JSON.parse(frame.payload) as { type?: string; session?: { output_modalities?: unknown } };
        if (message.type === 'session.update' && message.session && 'output_modalities' in message.session) asked.push(message.session.output_modalities);
      } catch {
        // Not JSON: not a configuration.
      }
    });
  });
  return asked;
}

/** The `speech` member of each request for a managed Qwen session key: which legs Kizuna AI's lease asks to voice. */
function leaseSpeechOf(page: Page): unknown[] {
  const asked: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !/qwen/i.test(new URL(request.url()).pathname)) return;
    try {
      const body = JSON.parse(request.postData() ?? '') as { speech?: unknown };
      if (body.speech !== undefined) asked.push(body.speech);
    } catch {
      // Not the key request.
    }
  });
  return asked;
}

/** Starts the session, says the sentences once, ends it and closes nothing. */
async function runSession(sokuji: Sokuji): Promise<number[]> {
  const { page } = sokuji;
  const clips = SENTENCES.map((sentence) => clip(sentence.file));
  await expect(mainAction(page)).toBeEnabled({ timeout: 60_000 });
  await mainAction(page).click();
  await expect(mainAction(page)).toHaveText(/^\s*(End Session|Stop)\s*$/, { timeout: 90_000 });
  const spoken: number[] = [];
  for (let i = 0; i < SENTENCES.length; i++) {
    spoken.push(i);
    await say(page, clips[i]);
    await page.waitForTimeout(PAUSES_MS[i]);
  }
  await page.waitForTimeout(10_000); // the last sentence's translation arriving
  // Edge read something aloud: a row can be replayed once the voice's audio for it has arrived.
  await expect(page.getByRole('button', { name: "Play this item's audio", disabled: false }).first()).toBeVisible({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(mainAction(page)).toHaveText(/^\s*(Start Session|Start)\s*$/, { timeout: 60_000 });
  return spoken;
}

/** One record, its stages the service's and Edge's, and eight sentences in ten heard and translated. */
function checkOutcome(sokuji: Sokuji, text: string, spoken: readonly number[]): void {
  const stored = readHistory(sokuji.userData);
  expect(stored).toHaveLength(1);
  const [record] = stored;
  expect(record.state).toBe('closed');
  const services = JSON.parse(record.services) as { provider: string; stages?: Record<string, string> };
  expect(services.provider).toBe(text);
  expect(services.stages).toEqual({ transcription: text, translation: text, speech: 'edge' });
  const { heard, translated } = heardAndTranslated(record, spoken);
  test.info().annotations.push({ type: 'sentences said / heard / translated', description: `${spoken.length} / ${heard} / ${translated}` });
  const enough = Math.ceil(spoken.length * 0.8);
  expect(heard).toBeGreaterThanOrEqual(enough);
  expect(translated).toBeGreaterThanOrEqual(enough);
  expect(sokuji.errors.filter((error) => error.startsWith('pageerror:'))).toEqual([]);
}

/** Signed in the way a user signs in; false where the build does not offer the hosted service. */
async function signIn(page: Page): Promise<boolean> {
  await expect(page.locator('[data-tour="settings-button"]')).toBeVisible({ timeout: 30_000 });
  const button = page.getByRole('banner').getByRole('button', { name: 'Sign In', exact: true });
  if (await button.count() === 0) return false;
  await button.click();
  await page.locator('.account-popover__btn', { hasText: /^Sign In$/ }).click();
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(button).toHaveCount(0, { timeout: 60_000 });
  return true;
}

/** A key goes in the way a user puts it in: Settings, Accounts and keys, the service's row. */
async function addKey(page: Page, row: string, key: string): Promise<void> {
  await page.locator('[data-tour="settings-button"]').click();
  await page.getByRole('navigation').getByRole('button', { name: /^Accounts and keys/ }).click();
  const group = page.getByRole('group', { name: row, exact: true });
  await group.getByRole('button', { name: 'Add key' }).click();
  await group.getByLabel('API key', { exact: true }).fill(key);
  const validate = group.getByRole('button', { name: 'Validate' });
  if (await validate.count()) await validate.click();
  await page.keyboard.press('Escape');
}

test("@real Kizuna AI's Qwen is read aloud by Edge, signed in: the lease asks for no voice, and Qwen for text alone", async ({ launchApp }) => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ACCOUNT_EMAIL and E2E_ACCOUNT_PASSWORD are not set');
  test.setTimeout(8 * 60_000);
  const sokuji = await launchApp({ seed: seed('kizunaai_qwen') });
  const { page } = sokuji;
  try {
    test.skip(!(await signIn(page)), 'this build does not offer the hosted service (see the top of this file)');
    sokuji.errors.length = 0;
    const modalities = modalitiesOf(page);
    const lease = leaseSpeechOf(page);
    const spoken = await runSession(sokuji);
    await sokuji.close();
    checkOutcome(sokuji, 'kizunaai_qwen', spoken);
    expect(lease.length, 'a lease was asked for').toBeGreaterThan(0);
    for (const speech of lease) expect(speech).toEqual({ speaker: false, participant: false });
    expect(modalities.length, 'Qwen was configured').toBeGreaterThan(0);
    for (const asked of modalities) expect(asked).toEqual(['text']);
  } finally {
    await sokuji.kill();
    forgetSecrets(sokuji.userData);
  }
});

test('@real Qwen with an own key is read aloud by Edge, and Qwen is asked for text alone', async ({ launchApp }) => {
  test.skip(!QWEN_KEY, 'E2E_QWEN_KEY is not set');
  test.setTimeout(8 * 60_000);
  const sokuji = await launchApp({ seed: seed('qwen_livetranslate') });
  const { page } = sokuji;
  try {
    await addKey(page, 'Qwen LiveTranslate', QWEN_KEY);
    sokuji.errors.length = 0;
    const modalities = modalitiesOf(page);
    const spoken = await runSession(sokuji);
    await sokuji.close();
    checkOutcome(sokuji, 'qwen_livetranslate', spoken);
    expect(modalities.length, 'Qwen was configured').toBeGreaterThan(0);
    for (const asked of modalities) expect(asked).toEqual(['text']);
  } finally {
    await sokuji.kill();
    forgetSecrets(sokuji.userData);
  }
});

test('@real OpenAI Realtime is read aloud by Edge, and OpenAI is asked for text alone', async ({ launchApp }) => {
  test.skip(!OPENAI_KEY, 'E2E_OPENAI_KEY is not set');
  test.setTimeout(8 * 60_000);
  const sokuji = await launchApp({ seed: seed('openai') });
  const { page } = sokuji;
  try {
    await addKey(page, 'OpenAI', OPENAI_KEY); // the row of OpenAI's own key, shared by its services
    sokuji.errors.length = 0;
    const modalities = modalitiesOf(page);
    const spoken = await runSession(sokuji);
    await sokuji.close();
    checkOutcome(sokuji, 'openai', spoken);
    expect(modalities.length, 'OpenAI was configured').toBeGreaterThan(0);
    for (const asked of modalities) expect(asked).toEqual(['text']);
  } finally {
    await sokuji.kill();
    forgetSecrets(sokuji.userData);
  }
});

test('@real Doubao AST 2.0 is read aloud by Edge', async ({ launchApp }) => {
  test.skip(!DOUBAO_KEY, 'E2E_DOUBAO_KEY is not set');
  test.setTimeout(8 * 60_000);
  // Its API-key mode: the one key a user types.
  const sokuji = await launchApp({ seed: seed('volcengine_ast2', { 'settings.volcengineAST2.authMode': 'apiKey' }) });
  const { page } = sokuji;
  try {
    await addKey(page, 'Doubao AST 2.0', DOUBAO_KEY);
    sokuji.errors.length = 0;
    const spoken = await runSession(sokuji);
    await sokuji.close();
    checkOutcome(sokuji, 'volcengine_ast2', spoken);
  } finally {
    await sokuji.kill();
    forgetSecrets(sokuji.userData);
  }
});
