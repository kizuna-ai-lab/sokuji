import type { Page } from '@playwright/test';
import { baseStorage, mainAction } from '../support/app';
import { expect, test } from '../support/test';

/** The fake service playing its long script: a new exchange every three seconds. */
const longSession = () => ({ ...baseStorage('fake'), 'settings.fake.script': 'long' });

/** A session on the fake service, long enough for several sentences and a recording to play. */
async function recordASession(page: Page) {
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(page.getByText('今日は天気がいいですね。', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(14_000);
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
}

/** The record page of the only record in History. */
async function openTheRecord(page: Page) {
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('[data-record] .history-row__open').first().click();
  await expect(page.getByRole('group', { name: 'Recording' })).toBeVisible();
}

/** Where the recording is, in seconds, and how fast it plays. */
const audio = (page: Page) => page.evaluate(() => {
  const a = document.querySelector('.record-player audio') as HTMLAudioElement;
  return { at: a.currentTime, rate: a.playbackRate, paused: a.paused };
});
/** The rows of the transcript, in order, and which one is marked as being played. */
const rows = (page: Page) => page.locator('.record-page__transcript .record-row');
const playingIndex = (page: Page) => page.evaluate(() => [...document.querySelectorAll('.record-page__transcript .record-row')]
  .findIndex((row) => row.classList.contains('is-playing')));
/** Each row's start, in seconds, from the time it shows (m:ss, "~" before an estimated one); a row that goes on from the
 * one before shows none. */
const rowStarts = (page: Page) => page.locator('.record-page__transcript .record-row').evaluateAll((list) => {
  let last = 0;
  return list.map((row) => {
    const shown = row.querySelector('.record-row__time')?.textContent?.match(/(\d+):(\d{2})/);
    if (shown) last = Number(shown[1]) * 60 + Number(shown[2]);
    return last;
  });
});

// A recorded session plays back from its record: the sentence being played is marked and moves on with the sound;
// "Play from here" starts at that sentence; after a change of speed or a jump on the position bar, the sound and
// the marked sentence agree.
test('a recorded session plays back with the sentence being played marked, from a sentence, faster, and from a jump', async ({ launchApp }) => {
  const sokuji = await launchApp({ seed: { storage: longSession() } });
  const { page } = sokuji;
  await recordASession(page);
  await openTheRecord(page);
  const player = page.getByRole('group', { name: 'Recording' });
  expect(await rows(page).count()).toBeGreaterThanOrEqual(4);

  // Play: the sound goes on, and the marked sentence moves on with it.
  await player.getByRole('button', { name: 'Play' }).click();
  await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect.poll(async () => (await audio(page)).at, { timeout: 10_000 }).toBeGreaterThan(0.5);
  await expect.poll(() => playingIndex(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(0);
  const first = await playingIndex(page);
  await expect.poll(() => playingIndex(page), { timeout: 20_000 }).toBeGreaterThan(first);

  // Play from here, on the last sentence: the sound starts there and that sentence is the marked one. From the
  // start first, so a "Play from here" that did not move the sound would leave it seconds short of the sentence.
  await player.getByRole('button', { name: 'Pause' }).click();
  await player.getByLabel('Position').fill('0');
  const last = (await rows(page).count()) - 1;
  const lastStart = (await rowStarts(page))[last];
  expect(lastStart).toBeGreaterThan(8);
  await rows(page).nth(last).getByRole('button', { name: 'Play from here' }).click();
  // Where the sound is: the sentence's start (its label is whole seconds), 2.5 s earlier for a time the service did
  // not give, and up to 1.5 s less again as the recording starts a little after the record.
  let fromHere = 0;
  await expect.poll(async () => (fromHere = (await audio(page)).at), { timeout: 2_000 }).toBeGreaterThan(lastStart - 4.5);
  expect(fromHere).toBeLessThan(lastStart + 1.5);
  await expect.poll(() => playingIndex(page), { timeout: 5_000 }).toBe(last);

  // Twice as fast: the recording plays at 2x and covers about twice the time.
  await player.getByRole('button', { name: 'Pause' }).click();
  await player.getByLabel('Speed').selectOption('2');
  expect((await audio(page)).rate).toBe(2);
  await player.getByLabel('Position').fill('0');
  await player.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => (await audio(page)).at, { timeout: 5_000 }).toBeGreaterThan(0.2);
  // Recording time against the page's own clock, once it plays: about two seconds of recording a second.
  const pace = await page.evaluate(() => new Promise<number>((resolve) => {
    const a = document.querySelector('.record-player audio') as HTMLAudioElement;
    const [t0, w0] = [a.currentTime, performance.now()];
    setTimeout(() => resolve((a.currentTime - t0) / ((performance.now() - w0) / 1000)), 2_000);
  }));
  expect(pace).toBeGreaterThan(1.6);
  expect(pace).toBeLessThan(2.4);

  // A jump on the position bar to the middle: the sound is there, and the marked sentence is the one for that time.
  // The recording may start a little after the record does (the microphone opening), so the sound's own time can be
  // up to that much earlier than the record's.
  await player.getByRole('button', { name: 'Pause' }).click();
  const length = Number(await player.getByLabel('Position').getAttribute('max'));
  // The bar moves in steps of 100 ms: the target is on a step, so what is filled is what the bar keeps.
  const middleMs = Math.round(length / 2 / 100) * 100;
  await player.getByLabel('Position').fill(String(middleMs));
  await expect(player.getByLabel('Position')).toHaveValue(String(middleMs));
  await expect.poll(async () => (await audio(page)).at * 1000 - middleMs, { timeout: 5_000 }).toBeGreaterThan(-2_000);
  expect((await audio(page)).at * 1000 - middleMs).toBeLessThan(500);
  // The marked row starts at or before that time (its label is whole seconds), and the next one after it.
  const marked = await playingIndex(page);
  const starts = await rowStarts(page);
  const middle = middleMs / 1000;
  expect(marked).toBeGreaterThanOrEqual(0);
  expect(starts[marked]).toBeLessThanOrEqual(middle);
  if (marked + 1 < starts.length) expect(starts[marked + 1]).toBeGreaterThan(middle - 1);
  expect(sokuji.errors).toEqual([]);
});
