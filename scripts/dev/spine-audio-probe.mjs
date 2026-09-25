#!/usr/bin/env node
/**
 * Plays the development preview's fake session in headless Chromium and
 * prints what its playback did: the clips its queues played, the loudest
 * sample the tts tap heard, and — with `&monitor=1` — a peak on the real bus
 * after the routes (the page's `[data-probe=playback]` line; plan 1e-3b-1
 * ruling 3).
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/spine-audio-probe.mjs ['http://localhost:5199/?preview=spine&autostart=1&monitor=1&capture=device'] [seconds]
 *
 * Exits 1 when no clip played, the tap heard nothing, or (with `&monitor=1`)
 * the real bus's meter never read a peak; with `capture=device`, the fake
 * microphone is captured too, and it must deliver.
 */
import { evaluate, sleep, withPage } from './headless.mjs';

const url = process.argv[2] ?? 'http://localhost:5199/?preview=spine&autostart=1&monitor=1';
const seconds = Number(process.argv[3] ?? 12);

process.exitCode = await withPage(url, async (send) => {
  await sleep(seconds * 1000);
  const text = (await evaluate(send, 'document.querySelector("[data-probe=playback]")?.textContent ?? ""')) ?? '';
  console.log(text || 'no playback probe on the page');
  const heard = /heard: (\S+)/.exec(text)?.[1] ?? '-';
  const peak = Number(/tap peak: ([\d.]+)/.exec(text)?.[1] ?? 0);
  const monitor = url.includes('monitor=1');
  const busPeak = Number(/bus peak: ([\d.]+)/.exec(text)?.[1] ?? 0);
  const deviceCapture = url.includes('capture=device');
  const chunks = Number(/captured: (\d+)/.exec(text)?.[1] ?? 0);
  const micPeak = Number(/mic peak: ([\d.]+)/.exec(text)?.[1] ?? 0);
  const captureOk = !deviceCapture || (chunks > 0 && micPeak > 0);
  const monitorOk = !monitor || busPeak > 0;
  return heard !== '-' && peak > 0 && captureOk && monitorOk ? 0 : 1;
}, { flags: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
