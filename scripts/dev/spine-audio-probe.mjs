#!/usr/bin/env node
/**
 * Plays the development preview's fake session in headless Chromium and
 * prints what its playback did: the clips its queues played and the loudest
 * sample the tts tap heard (the page's `[data-probe=playback]` line).
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/spine-audio-probe.mjs ['http://localhost:5199/?preview=spine&autostart=1&capture=device'] [seconds]
 *
 * Exits 1 when no clip played or the tap heard nothing; with `capture=device`,
 * the fake microphone is captured too, and it must deliver.
 */
import { evaluate, sleep, withPage } from './headless.mjs';

const url = process.argv[2] ?? 'http://localhost:5199/?preview=spine&autostart=1';
const seconds = Number(process.argv[3] ?? 12);

process.exitCode = await withPage(url, async (send) => {
  await sleep(seconds * 1000);
  const text = (await evaluate(send, 'document.querySelector("[data-probe=playback]")?.textContent ?? ""')) ?? '';
  console.log(text || 'no playback probe on the page');
  const heard = /heard: (\S+)/.exec(text)?.[1] ?? '-';
  const peak = Number(/tap peak: ([\d.]+)/.exec(text)?.[1] ?? 0);
  const deviceCapture = url.includes('capture=device');
  const chunks = Number(/captured: (\d+)/.exec(text)?.[1] ?? 0);
  const micPeak = Number(/mic peak: ([\d.]+)/.exec(text)?.[1] ?? 0);
  const captureOk = !deviceCapture || (chunks > 0 && micPeak > 0);
  return heard !== '-' && peak > 0 && captureOk ? 0 : 1;
}, { flags: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
