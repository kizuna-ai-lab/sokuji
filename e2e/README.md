# End-to-end tests (desktop)

Playwright drives the real Electron app. Each test starts its own app on its own
user-data directory, so nothing here touches your settings, your history or a
Sokuji you have open.

```bash
npm run e2e:build   # the E2E build: build/ and dist-electron/
npm run e2e         # every spec in e2e/specs
npm run e2e -- session-to-history   # one spec
npm run e2e:long    # the meeting-length session (15 minutes; E2E_LONG_MINUTES=3 for a shorter one)
E2E_SONIOX_KEY=... npm run e2e:real   # the same length against Soniox itself (skipped without the key)
```

Node 22.20 or newer (the history reader uses `node:sqlite`; 22.19's has a bug).

Rebuild after changing anything under `src/` or `electron/`. A failed test keeps
its trace and a screenshot in `e2e/test-results/` (`npx playwright show-trace <trace.zip>`)
and leaves its user-data directory in the system temp directory (`sokuji-e2e-*`).

Linux: the app is started with `--no-sandbox` and on `DISPLAY=:1` when `DISPLAY`
is not set.

A spec whose title carries `@long` is left out of `npm run e2e` and run by `npm run e2e:long`. The long session
plays the fake service's long script for fifteen minutes and checks what only shows with time: every sentence kept,
a recording as long as the meeting that plays to its end, and the page's memory (as the system counts it) not
running away. Its readings are attached to the report as annotations.

A spec whose title carries `@real` talks to a real service and is run by `npm run e2e:real` only. The one there is
types a Soniox key (`E2E_SONIOX_KEY`) into Settings as a user would, then holds a fifteen-minute Japanese-to-English
session: the repository's eight recorded sentences are played into the microphone in rounds, with over a minute of
silence in the middle, and the record must carry the words heard and translated before and after it, nothing made up
during it, and a whole recording. It costs fifteen minutes of Soniox usage a run. The test leaves the key nowhere: that spec records no trace, and the app's settings
(where the app keeps the key) are deleted from its user-data directory when it ends, passed or failed.

## The E2E build

`vite build --mode e2e` is the production bundle with a few compile-time
differences, all behind `import.meta.env.MODE === 'e2e'`, which a release build
folds to `false`:

| Where | What changes |
|---|---|
| `electron/main.js` | Loads `build/index.html` although the app is not packaged (no dev server, no DevTools, web security on). Does not create or clean the system's virtual audio devices. Does not check for updates. |
| `src/providers/registry.ts` | Keeps the fake providers (`src/providers/fake`). |
| `src/lib/lineup/catalog.ts` | A line-up may name the fake providers. |
| `src/config/analytics.ts` | Never reports. |
| `vite.react-grab.ts` | The development toolbar stays out. |

Why not the development build: it opens DevTools, turns web security off, signs
in from another origin and is tied to port 5173. Why not the packaged app: the
fake providers are not in it, and packaging takes minutes. Both of them clean
and recreate the `sokuji_*` virtual audio devices at startup, which takes the
audio away from any Sokuji already running on the machine.

## What a test gets (`e2e/support`)

- `test` from `support/test.ts` gives a spec `launchApp({ seed, userData })`. It returns `{ app, page, userData, errors, close, kill, … }`.
  A new directory is a first run; passing the directory of an app that was closed is a restart on the same state.
  Every app a test started is killed when the test ends, passed or failed; the user-data directories of a test that passed are deleted.
- The launch refuses anything but the E2E build (it looks for the build's marker in `dist-electron/main.js`): a release or
  development build started from here would clean and recreate the system's virtual audio devices.
- `baseStorage('fake')` is the seed every session test wants: the setup wizard and the tour are done,
  the interface is English, noise suppression is off (the enhanced mode sometimes removes seconds of the
  injected microphone's tone from the recording), the fake provider runs every stage.
  Another interface language: `{ ...baseStorage('fake'), i18nextLng: 'ja' }`.
- `sokuji.kill()` ends the process at once (a crash); launch again on the same `userData` to test recovery.
  The seeded settings are written to disk at launch, so they survive a kill; settings changed later through the app are
  on disk only when Chromium gets to them (seconds), as for a user.
- `sokuji.answerSaveDialog(path)` / `answerOpenDialog(paths)` set what the system dialog answers (`null` is Cancel);
  Playwright cannot click a native dialog.
- `mainAction(page)` is the Start / End session button.
- `fakeOpenAi(sokuji)` (`support/openai.ts`) answers the app's requests to api.openai.com from the test, in the page's network
  layer: notes (a chat-completions request) and the key check (the model list). The app is not changed and nothing leaves the
  machine. By default every notes prompt gets a usable answer; `answerChat(...)` swaps in a refusal (`{ status, message }`) or
  no answer at all (`{ hang: true }`); `requests` is what the app sent. The user's key is seeded as `settings.openai.apiKey`.
- `seedHistory(userData, records)` (`support/seed.ts`) writes closed records into History with the app's own store before the
  app starts (`newUserData()` first, then `launchApp({ userData, seed })`). Notes need a record of a minute or more, and no test
  should wait a minute for one. `meeting(18)` is eighteen sentences ten seconds apart.
- `fakeTranscription(sokuji)` (`support/transcription.ts`) is the file transcription service (importing a file, transcribing
  a record again), faked. That service is called from the app's **main process**, which the page's network routes do not
  reach, so the app is launched with `launchApp({ fakeServices: true })`: `support/main/fake-services.cjs` is then loaded into
  the main process before the app (`electron -r`), and sends each request by its host to the fake registered for it. Any other
  request leaving the main process is refused and listed by `refused()`, so a service without a fake shows up at once. The
  test speaks of no particular service: `answerWith({ sentences })`, `{ hold: true }` (stays at "transcribing" until
  `release()`), or `{ fail: 'no-credit' | 'bad-key' | 'unreadable' | 'service' }`. An answer is for the transcriptions
  started after it: each keeps the one it started with. `kept()` is what the service still holds (the app deletes its
  uploads and jobs when done). Fakes are registered under their service's id in the line-up, and
  `fakeTranscription` takes the one for the line-up's transcription service. Soniox is the one registered today
  (`support/main/transcription-soniox.cjs`); another service is another file there, registered in `fake-services.cjs`.
  `addTranscriptionKey(sokuji)` puts the key in from Settings, as a user does.
- `e2e/fixtures/audio/` holds a few seconds of the same repository recording in each format a file may come in
  (`make.sh` makes them; the m4a and AC-3 ones were made on macOS). Never use synthesised speech for them.
- `readHistory(userData)` reads `history/history.db` from disk. Call it after `close()`.

## The microphone

`--use-fake-device-for-media-stream` gives the app a device to select. The audio
itself is injected in the page (`support/page/mic.js`, an init script):
`getUserMedia` answers with a looping buffer. Chromium's
`--use-file-for-fake-audio-capture` is silent under Electron 44. The app's
constraints (echo cancellation, noise suppression) do not apply to the injected
stream.

The fake provider speaks from its script, not from the microphone, so what the
conversation shows does not depend on the injected sound; the recording does.

## Writing a spec

- Name the test after the behaviour it checks, in words a reader of the repository understands (no tracker or checklist ids).
- Wait for what the user would see (`expect(locator).toBeVisible()`), not for time.
- Find elements by role and name (the interface is English); add a `data-testid` where that is not enough.
- Scripts that run in the page are plain `.js` files or source text. A function passed from a `.ts` file
  is transpiled by the runner and carries helpers the page does not have.
- Register init scripts after the window exists (`launch` does); added earlier, they are not applied to it.
- One worker: the apps share the machine's display and audio.
- The microphone plays a synthetic tone. For real speech seed `'e2e.mic': 'speech'` and play clips with
  `navigator.mediaDevices.__e2eSay(pcm16Base64, rate)` from the page (see `real-soniox.spec.ts`).

Not covered here: the other side's audio (system capture), sign-in and balance,
Kizuna AI's own notes service, real providers other than Soniox.
