#!/usr/bin/env node
/**
 * Plays the development preview's fake session in headless Chromium and
 * prints what its playback did: the clips its queues played, the loudest
 * sample the tts tap heard, and — with `&monitor=1` — a peak on the real bus
 * after the routes (the page's `[data-probe=playback]` line; plan 1e-3b-1
 * ruling 3).
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/spine-audio-probe.mjs ['http://localhost:5199/?preview=spine&autostart=1&monitor=1&capture=device'] [seconds] [--max-gaps N]
 *
 * Exits 1 when no clip played, the tap heard nothing, (with `&monitor=1`)
 * the real bus's meter never read a peak, or the gaps the tap heard exceed
 * `--max-gaps`; with `capture=device`, the fake microphone is captured too,
 * and it must deliver.
 */
import { evaluate, sleep, withPage } from './headless.mjs';

const args = process.argv.slice(2);
const maxAt = args.indexOf('--max-gaps');
const maxGaps = maxAt >= 0 ? Number(args[maxAt + 1]) : null;
if (maxAt >= 0 && !Number.isInteger(maxGaps)) {
  console.log('--max-gaps needs a whole number');
  process.exit(2);
}
const positional = args.filter((_, i) => maxAt < 0 || (i !== maxAt && i !== maxAt + 1));
const url = positional[0] ?? 'http://localhost:5199/?preview=spine&autostart=1&monitor=1';
const seconds = Number(positional[1] ?? 12);

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
  const gapMatch = /gaps: (\d+) \((\d+) ms\) at (\S+)/.exec(text);
  const gaps = Number(gapMatch?.[1] ?? 0);
  if (url.includes('script=refless-stream')) {
    // The script's steady phase is its first 15 s of audio (`REFLESS_STREAM.steadyMs`, src/providers/fake/generate.ts).
    const at = gapMatch && gapMatch[3] !== '-' ? gapMatch[3].split(',').map(Number) : [];
    console.log(`steady gaps: ${at.filter((s) => s < 15).length} · hiccup gaps: ${at.filter((s) => s >= 15).length}`);
  }
  const gapsOk = maxGaps === null || gaps <= maxGaps;
  return heard !== '-' && peak > 0 && captureOk && monitorOk && gapsOk ? 0 : 1;
}, { flags: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
