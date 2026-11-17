import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { baseStorage, mainAction } from '../support/app';
import { expect, test } from '../support/test';

/** A session on the fake service through both of its exchanges, ended. The panel is empty first: the text found is this session's. */
async function recordASession(page: Page) {
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(page.getByText('Click Start to begin real-time translation')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('元気です。ありがとう。').first()).toBeVisible({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
}

const audio = (page: Page) => page.evaluate(() => {
  const a = document.querySelector('.record-player audio') as HTMLAudioElement;
  return { at: a.currentTime, rate: a.playbackRate, muted: a.muted, volume: a.volume };
});

/**
 * How loud a recording file is, decoded the way the page decodes audio: the share of its 100 ms windows that carry
 * sound. The page cannot read a recording it plays (the recordings' address gives it none of the bytes), so the file
 * is read from disk here and handed to the page to decode.
 */
const loudShare = (page: Page, file: string) => page.evaluate(async (base64) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const decoded = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(bytes.buffer);
  const samples = decoded.getChannelData(0);
  const window = Math.round(decoded.sampleRate / 10);
  let loud = 0;
  let windows = 0;
  for (let start = 0; start + window <= samples.length; start += window) {
    let sum = 0;
    for (let i = start; i < start + window; i++) sum += samples[i] * samples[i];
    windows += 1;
    if (Math.sqrt(sum / window) > 0.02) loud += 1;
  }
  return { share: loud / windows, seconds: decoded.duration };
}, fs.readFileSync(file).toString('base64'));

// What a person hears can only be checked by ear (the page is not allowed to read the sound it plays, and the test
// machine has no speakers to listen to). Short of that: the kept recording is sound, not silence, in the shape the
// microphone gave it; the player plays it unmuted at full volume; 1.5× runs at one and a half times the pace; and at
// the end it stops, and Play starts it again from the beginning.
test('a recording plays as sound, faster at 1.5×, and from the beginning again once it has ended', async ({ launchApp }) => {
  // The recording keeps what is sent to be transcribed, after noise suppression; at its default ("enhanced") level it
  // now and then takes the test microphone's steady tone for noise and removes seconds of it. This test is about the
  // recording and its playback, so suppression is off.
  const sokuji = await launchApp({ seed: { storage: { ...baseStorage('fake'), 'audio.noiseSuppressionMode': 'off' } } });
  const { page, userData } = sokuji;
  await recordASession(page);

  // The kept file: the microphone's bursts (1.4 s of sound, 0.6 s of pause), so about seven windows in ten are loud.
  const folder = path.join(userData, 'history', 'records');
  const [id] = fs.readdirSync(folder);
  const kept = await loudShare(page, path.join(folder, id, 'speaker.opus'));
  expect(kept.seconds).toBeGreaterThan(3);
  expect(kept.share).toBeGreaterThan(0.5);
  expect(kept.share).toBeLessThan(0.9);

  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('[data-record] .history-row__open').first().click();
  const player = page.getByRole('group', { name: 'Recording' });
  await expect(player).toBeVisible();
  expect(await audio(page)).toMatchObject({ muted: false, volume: 1 });

  // 1.5×: recording time against the page's own clock, once it plays.
  await player.getByLabel('Speed').selectOption('1.5');
  await player.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => (await audio(page)).at, { timeout: 5_000 }).toBeGreaterThan(0.2);
  const pace = await page.evaluate(() => new Promise<number>((resolve) => {
    const a = document.querySelector('.record-player audio') as HTMLAudioElement;
    const [t0, w0] = [a.currentTime, performance.now()];
    setTimeout(() => resolve((a.currentTime - t0) / ((performance.now() - w0) / 1000)), 1_500);
  }));
  expect(pace).toBeGreaterThan(1.2);
  expect(pace).toBeLessThan(1.8);

  // To the end: it stops there, and Play starts it from the beginning.
  const length = Number(await player.getByLabel('Position').getAttribute('max'));
  await player.getByLabel('Position').fill(String(Math.max(0, Math.round((length - 1_000) / 100) * 100)));
  await expect(player.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 5_000 });
  // At the end: the time shown is the length (the bar itself moves in 100 ms steps, so it shows the last step).
  const [shown, total] = (await player.locator('.record-player__time').innerText()).split(' / ');
  expect(shown).toBe(total);
  await player.getByRole('button', { name: 'Play' }).click();
  await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect.poll(async () => Number(await player.getByLabel('Position').inputValue()), { timeout: 3_000 }).toBeLessThan(1_500);
  expect((await audio(page)).at).toBeLessThan(1.5);
  expect(sokuji.errors).toEqual([]);
});
