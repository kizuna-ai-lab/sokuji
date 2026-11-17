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
  // What the page still holds after a collection: the script heap in use, and the page process as the system
  // counts it. Collected first, on purpose: left alone, the process grows by several MB a minute with garbage the
  // engine has no reason yet to collect, which says nothing about what the app keeps. (`performance.memory` is no
  // use either: Chromium rounds it into buckets and refreshes it rarely.)
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const memoryMb = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const process = await sokuji.app.evaluate(({ app }) => app.getAppMetrics().filter((p) => p.type === 'Tab').reduce((sum, p) => sum + p.memory.workingSetSize, 0) / 1024);
    return { heap: Math.round(heap.usedSize / 1_048_576), process: Math.round(process) };
  };

  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(page.getByText('The weather is nice today.').first()).toBeVisible({ timeout: 30_000 });
  const startedAt = Date.now();

  // A reading a minute. The first two minutes are the app warming up; the rest must not keep climbing.
  const memory: { heap: number; process: number }[] = [];
  while (Date.now() - startedAt < SESSION_MS) {
    await page.waitForTimeout(Math.min(60_000, SESSION_MS - (Date.now() - startedAt)));
    memory.push(await memoryMb());
    await expect(mainAction(page)).toBeEnabled(); // still a running session with a live Stop button
  }
  test.info().annotations.push({ type: 'script heap / page process MB after a collection, one reading a minute', description: memory.map((m) => `${m.heap}/${m.process}`).join(' ') });

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

  // Memory, after a collection each time: neither the script heap nor the page process in the last third of the
  // readings is far above the third before it. (The conversation's own rows do add up: about fourteen elements each.)
  if (memory.length >= 9) {
    const third = Math.floor(memory.length / 3);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    for (const kind of ['heap', 'process'] as const) {
      const middle = mean(memory.slice(third, 2 * third).map((m) => m[kind]));
      const last = mean(memory.slice(2 * third).map((m) => m[kind]));
      test.info().annotations.push({ type: `${kind} MB, middle third / last third`, description: `${middle.toFixed(0)} / ${last.toFixed(0)}` });
      expect(last, kind).toBeLessThan(middle * 1.25 + 10);
    }
  }
});
