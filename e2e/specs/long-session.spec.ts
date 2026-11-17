import { baseStorage, mainAction } from '../support/app';
import { readHistory } from '../support/history';
import { expect, test } from '../support/test';

const MINUTES = Number(process.env.E2E_LONG_MINUTES ?? 15);
const SESSION_MS = MINUTES * 60_000;
/** The fake service's long script: one exchange every three seconds, for twenty-five minutes. */
const EXCHANGE_EVERY_MS = 3_000;

// Tagged @long: left out of `npm run e2e`, run with `npm run e2e:long`. A meeting-length session on the fake service,
// for what only shows with time: every sentence kept, a recording as long as the meeting, memory that settles.
test(`@long a ${MINUTES}-minute session keeps every sentence and its whole recording, and memory settles`, async ({ launchApp }) => {
  test.setTimeout(SESSION_MS + 5 * 60_000);
  const sokuji = await launchApp({ seed: { storage: { ...baseStorage('fake'), 'settings.fake.script': 'long' } } });
  const { page, userData } = sokuji;
  // The page's process as the system sees it (Electron's own metrics). `performance.memory` is no use here: Chromium
  // rounds it into buckets and refreshes it rarely, so it reads the same number for the whole session.
  const memoryMb = () => sokuji.app.evaluate(({ app }) => Math.round(
    app.getAppMetrics().filter((p) => p.type === 'Tab').reduce((sum, p) => sum + p.memory.workingSetSize, 0) / 1024));

  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(page.getByText('The weather is nice today.').first()).toBeVisible({ timeout: 30_000 });
  const startedAt = Date.now();

  // A reading a minute. The first two minutes are the app warming up; the rest must not keep climbing.
  const memory: number[] = [];
  while (Date.now() - startedAt < SESSION_MS) {
    await page.waitForTimeout(Math.min(60_000, SESSION_MS - (Date.now() - startedAt)));
    memory.push(await memoryMb());
    await expect(mainAction(page)).toBeEnabled(); // still a running session with a live Stop button
  }
  test.info().annotations.push({ type: 'page memory MB, one reading a minute', description: memory.join(' ') });

  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 60_000 });
  const ranMs = Date.now() - startedAt;
  expect(sokuji.errors).toEqual([]);

  // The record opens and plays near its end.
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('[data-record] .history-row__open').first().click();
  const player = page.getByRole('group', { name: 'Recording' });
  await expect(player).toBeVisible({ timeout: 30_000 });
  const length = Number(await player.getByLabel('Position').getAttribute('max'));
  await player.getByLabel('Position').fill(String(length - 20_000));
  await player.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => page.evaluate(() => (document.querySelector('.record-player audio') as HTMLAudioElement).currentTime * 1000), { timeout: 15_000 })
    .toBeGreaterThan(length - 19_000);
  await player.getByRole('button', { name: 'Pause' }).click();
  await sokuji.close();

  const [record] = readHistory(userData);
  expect(readHistory(userData)).toHaveLength(1);
  expect(record.state).toBe('closed');
  // Every exchange the script played is a sentence in the record (the last one or two may still have been open at Stop).
  const exchanges = Math.floor(ranMs / EXCHANGE_EVERY_MS);
  test.info().annotations.push({ type: 'sentences kept / exchanges played', description: `${record.sentences} / ${exchanges}` });
  expect(record.sentences).toBeGreaterThanOrEqual(exchanges - 3);
  // The recording is whole and as long as the session, within a few seconds.
  const [track] = record.tracks;
  expect(track.fileBytes).toBe(track.bytes);
  expect(Math.abs(track.durationMs - ranMs)).toBeLessThan(10_000);

  // Memory: the mean of the last third of the readings is not far above the mean of the third before it.
  if (memory.length >= 9) {
    const third = Math.floor(memory.length / 3);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const middle = mean(memory.slice(third, 2 * third));
    const last = mean(memory.slice(2 * third));
    test.info().annotations.push({ type: 'page memory MB, middle third / last third', description: `${middle.toFixed(0)} / ${last.toFixed(0)}` });
    expect(last).toBeLessThan(middle * 1.3 + 50);
  }
});
