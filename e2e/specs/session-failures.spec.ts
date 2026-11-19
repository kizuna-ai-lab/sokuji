import { baseStorage, mainAction } from '../support/app';
import { readHistory } from '../support/history';
import { expect, test } from '../support/test';

// What a user is left with when a session goes wrong: the fake service's fault knobs
// (src/providers/fake/settings.ts) fail it the way a real service does, and each test checks
// what the page says, whether Start works again, and what History kept.

const withFake = (settings: Record<string, string>) => ({ seed: { storage: { ...baseStorage('fake'), ...settings } } });

test('a session the service ends mid-run says so, keeps what was said, and a new one starts', async ({ launchApp }) => {
  // The long script says a sentence every 3 s from 0.5 s; the service fails at 6 s.
  const sokuji = await launchApp(withFake({ 'settings.fake.script': 'long', 'settings.fake.failAfterMs': '6000' }));
  const { page, userData } = sokuji;

  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(page.getByText('The weather is nice today.').first()).toBeVisible({ timeout: 30_000 });

  await expect(page.getByText('The session stopped: fake failure')).toBeVisible({ timeout: 15_000 });
  await expect(mainAction(page)).toHaveText(/Start Session/);
  await expect(mainAction(page)).toBeEnabled();
  // What was said before the failure is still on the page.
  await expect(page.getByText('Let us go to the park.').first()).toBeVisible();

  // Start works again after a failure, and makes a record of its own: the new run replaces the page's
  // conversation, so the failure's words go and the script's first sentence comes back.
  await mainAction(page).click();
  await expect(mainAction(page)).toHaveText(/End Session/, { timeout: 30_000 });
  await expect(page.getByText('The session stopped: fake failure')).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText('The weather is nice today.').first()).toBeVisible({ timeout: 15_000 });
  await mainAction(page).click();
  await expect(mainAction(page)).toHaveText(/Start Session/, { timeout: 30_000 });
  expect(sokuji.errors).toEqual([]);
  await sokuji.close();

  const stored = readHistory(userData);
  expect(stored).toHaveLength(2);
  const failed = stored.find((record) => record.segments.some((s) => s.text === 'Let us go to the park.'));
  expect(failed, 'the failed session has a record with what was said').toBeDefined();
  expect(failed!.state).toBe('closed');
  const texts = failed!.segments.map((s) => s.text);
  expect(texts).toEqual(expect.arrayContaining(['今日は天気がいいですね。', 'The weather is nice today.', '公園に行きましょう。', 'Let us go to the park.']));
  // The recording runs to the failure, whole on disk.
  const [track] = failed!.tracks;
  expect(track.fileBytes).toBe(track.bytes);
  expect(track.durationMs).toBeGreaterThan(4_000);
});

test('a connection that drops and comes back shows Reconnecting, goes on, and stays one record', async ({ launchApp }) => {
  // The reconnect script: a sentence at 0.5 s, the transport drops at 3 s and is back at 4.5 s, another sentence at 5 s.
  const sokuji = await launchApp(withFake({ 'settings.fake.script': 'reconnect' }));
  const { page, userData } = sokuji;

  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(page.getByText('Hello there.').first()).toBeVisible({ timeout: 30_000 });

  const reconnecting = page.getByText(/^Reconnecting/).first();
  await expect(reconnecting).toBeVisible({ timeout: 10_000 });
  await expect(mainAction(page)).toHaveText(/End Session/); // the session is not given up
  await expect(reconnecting).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText('Still here?').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('まだいますか？').first()).toBeVisible({ timeout: 10_000 });
  // What came before the drop is still there.
  await expect(page.getByText('Hello there.').first()).toBeVisible();

  await mainAction(page).click();
  await expect(mainAction(page)).toHaveText(/Start Session/, { timeout: 30_000 });
  expect(sokuji.errors).toEqual([]);
  await sokuji.close();

  const stored = readHistory(userData);
  expect(stored).toHaveLength(1);
  expect(stored[0].state).toBe('closed');
  expect(stored[0].segments.map((s) => s.text)).toEqual(expect.arrayContaining(['Hello there.', 'こんにちは。', 'Still here?', 'まだいますか？']));
  expect(stored[0].tracks).toHaveLength(1);
  expect(stored[0].tracks[0].fileBytes).toBe(stored[0].tracks[0].bytes);
});

test('a session that cannot start says why, stays startable, and leaves no empty record', async ({ launchApp }) => {
  const sokuji = await launchApp(withFake({ 'settings.fake.startThrows': 'true' }));
  const { page, userData } = sokuji;

  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();

  await expect(page.getByText("The session didn't start: The fake failed to start (fault knob).").first()).toBeVisible({ timeout: 15_000 });
  await expect(mainAction(page)).toHaveText(/Start Session/);
  await expect(mainAction(page)).toBeEnabled();
  // The runner logs the refused start as an error; nothing else may go wrong.
  expect(sokuji.errors.filter((error) => !error.includes('The session did not start: The fake failed to start'))).toEqual([]);
  await sokuji.close();

  expect(readHistory(userData)).toEqual([]);
});

for (const { knob, reason } of [
  { knob: 'settings.fake.checkFails', reason: 'The fake reports not ready (fault knob).' },
  { knob: 'settings.fake.requireKey', reason: 'Enter your API key in Settings before starting.' },
]) {
  test(`a service that is not ready keeps Start off and says why (${knob.split('.').pop()})`, async ({ launchApp }) => {
    const sokuji = await launchApp(withFake({ [knob]: 'true' }));
    const { page } = sokuji;

    await expect(page.getByText(reason).first()).toBeVisible({ timeout: 30_000 });
    await expect(mainAction(page)).toBeDisabled();
    expect(sokuji.errors).toEqual([]);
  });
}
