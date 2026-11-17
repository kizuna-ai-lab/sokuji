# End-to-end tests (desktop)

Playwright drives the real Electron app. Each test starts its own app on its own
user-data directory, so nothing here touches your settings, your history or a
Sokuji you have open.

```bash
npm run e2e:build   # the E2E build: build/ and dist-electron/
npm run e2e         # every spec in e2e/specs
npm run e2e -- session-to-history   # one spec
```

Rebuild after changing anything under `src/` or `electron/`. A failed test keeps
its trace and a screenshot in `e2e/test-results/` (`npx playwright show-trace <trace.zip>`)
and leaves its user-data directory in the system temp directory (`sokuji-e2e-*`).

Linux: the app is started with `--no-sandbox` and on `DISPLAY=:1` when `DISPLAY`
is not set.

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

- `launch({ seed, userData })` starts the app and returns `{ app, page, userData, errors, close }`.
  A new directory is a first run; passing the directory of an app that was closed is a restart on the same state.
- `baseStorage('fake')` is the seed every session test wants: the setup wizard and the tour are done,
  the interface is English, the fake provider runs every stage.
- `sokuji.kill()` ends the process at once (a crash); launch again on the same `userData` to test recovery.
- `sokuji.answerSaveDialog(path)` / `answerOpenDialog(paths)` set what the system dialog answers (`null` is Cancel);
  Playwright cannot click a native dialog.
- `mainAction(page)` is the Start / End session button.
- `readHistory(userData)` reads `history/history.db` from disk. Call it after `close()`.
- `removeUserData(userData)` at the end of a test that passed.

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

- Name the test after its scenario id (`A1 …`).
- Wait for what the user would see (`expect(locator).toBeVisible()`), not for time.
- Find elements by role and name (the interface is English); add a `data-testid` where that is not enough.
- Scripts that run in the page are plain `.js` files or source text. A function passed from a `.ts` file
  is transpiled by the runner and carries helpers the page does not have.
- Register init scripts after the window exists (`launch` does); added earlier, they are not applied to it.
- One worker: the apps share the machine's display and audio.

Not covered here: the other side's audio (system capture), sign-in and balance,
real providers.
