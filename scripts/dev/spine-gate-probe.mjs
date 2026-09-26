#!/usr/bin/env node
/**
 * A start the gate refuses, on the preview's panel, before Start is pressed
 * (Stage 2 foundation, F7): the basic footer's main action is disabled and
 * its title is the refusal in the notice's own words. By default the web
 * page — which has no participant source — with the audio mode at both.
 * Group check B also runs it on the leased fake while signed out.
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force   # another shell
 *   node scripts/dev/spine-gate-probe.mjs [url] [words]
 *
 * Exits 1 unless, within 10 s, the button is disabled and its title is `words`.
 */
import { evaluate, sleep, withPage } from './headless.mjs';

const url = process.argv[2] ?? 'http://localhost:5199/?preview=spine&panel=1&mode=both';
// `notices.participant_source_unavailable` in `src/locales/en/translation.json`.
const words = process.argv[3] ?? "Translating other participants isn't available here.";
const READ = `(() => { const b = document.querySelector('.spine-panel [data-tour="main-action"]'); return b ? { disabled: b.disabled, title: b.title } : null; })()`;

process.exitCode = await withPage(url, async (send) => {
  let seen = null;
  for (let i = 0; i < 50; i++) {
    seen = await evaluate(send, READ);
    if (seen && seen.disabled && seen.title === words) break;
    await sleep(200);
  }
  console.log(`main action: ${JSON.stringify(seen)}`);
  return seen && seen.disabled && seen.title === words ? 0 : 1;
});
