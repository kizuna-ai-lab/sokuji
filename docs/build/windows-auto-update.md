# Windows auto-update

The Windows app is installed by Squirrel.Windows (`@electron-forge/maker-squirrel`):
`%LocalAppData%\Sokuji\Update.exe` beside one `app-<version>\` folder per installed version.
In-app updates go through that `Update.exe`, driven by Electron's built-in `autoUpdater`
(`electron/squirrel-update.js`, wired in `electron/update-manager.js`).

## How an update runs

1. **Check** — unchanged: `electron-updater` reads `latest.yml` from the latest GitHub release
   for the version and the release notes. Nothing is downloaded.
2. **Download** — the user confirms; `autoUpdater.setFeedURL({ url })` points Squirrel at
   `https://github.com/kizuna-ai-lab/sokuji/releases/latest/download` and
   `autoUpdater.checkForUpdates()` makes `Update.exe` fetch `RELEASES` from there, download the
   `Sokuji-<version>-full.nupkg` it names, verify the package against the SHA1 and size in
   `RELEASES`, and unpack it into `app-<version>\` **next to** the running version. Squirrel
   reports no byte counts, so the renderer shows an indeterminate "downloading" state.
3. **Install** — `autoUpdater.quitAndInstall()`: Electron runs
   `Update.exe --processStartAndWait sokuji.exe` and quits; `--processStartAndWait` waits for its
   parent (this app) to exit before starting the new executable, which is what makes the restart
   safe even when the close handshake holds the quit for a moment. The old `app-<version>\` stays
   until Squirrel's next clean-up, so a failure anywhere leaves the previous version runnable.

A package Squirrel has applied is remembered for the rest of the process: a later "Check for
updates" (which clears the renderer's state) offers Download again, and that download resolves at
once instead of asking Squirrel, which would now report nothing newer.

The release workflow uploads `RELEASES` together with the nupkg (`windows-nupkg` artifact →
`release-assets/`). Both come from the website build (`out/make-web`), never the Store build.

## What it replaced, and why

Until 0.46.4 the app downloaded the full `Sokuji-<version>.Setup.exe`, opened it, and quit
500 ms later. Squirrel's `--install` on an existing install first deletes the whole install
directory ("Install path … already exists, burning it to the ground"); with the old app still
exiting it hit a locked `sokuji.exe`, crashed, and left the machine with no app
(`Squirrel-Install.log`, 2026-10-27 02:34 JST). Every update was an uninstall-and-reinstall
with no fallback, and the download was never verified.

That path still exists as the fallback for a run without `Update.exe` (a development run, or a
damaged install), now with the download checked against `latest.yml` (size, sha512; a file the
manifest does not describe is not run) and the installer started by a detached PowerShell only
after every process under the install root — `sokuji.exe` and the audio helper — has exited. If
they have not within the bound, it writes `<installer>.launch.log` and exits without installing: a
blocked update leaves a working app (`electron/update-install-windows.js`). The root it watches is
`%LocalAppData%\Sokuji`, which is where Setup.exe installs — and first deletes — whatever directory
the running copy came from. A second Install click while the helper waits is refused with a
message, not silently accepted.

## The one-time transition from 0.46.x

Every installed 0.46.4 or earlier still runs the **old** updater once, when it updates to the
first release that carries this change: it downloads that release's `Setup.exe`, opens it and
quits 500 ms later — the race described above. This repository cannot change shipped clients, so
that release's notes must say: quit Sokuji completely before confirming the update, and if the
app is gone afterwards, reinstall it from the website; settings and sign-in survive in
`%AppData%\Sokuji`. From the next update on, Squirrel's path applies.

## Testing an unreleased build

The feed URL can be overridden for one machine: set `SOKUJI_UPDATE_FEED` to a URL that serves
`RELEASES` and the nupkg (any static HTTP server over `out/make-web/squirrel.windows/x64/`), start
the installed app from a shell with that variable, and run Download → Install. A packaged build
accepts only a loopback address (`http://127.0.0.1:…` or `http://localhost:…`): Squirrel installs
whatever the feed's `RELEASES` names, so a packaged app must not take a remote feed from its
environment; a development run also accepts https. Squirrel writes
`%LocalAppData%\Sokuji\SquirrelSetup.log`.

Precondition: the override redirects only the Squirrel **download**. The **check** still reads
`latest.yml` from the latest GitHub release and offers Download only when that version is newer
than the installed one, so the installed build must be older than GitHub's latest (install an
older release first), and the test feed's `RELEASES` must name a version newer than it.

On the `--squirrel-firstrun` launch `Update.exe` still holds its lock (Electron docs):
`UpdateManager.checkAfterDelay` skips the startup check, and a download requested during that
launch is refused with "restart it before updating again"; the next launch behaves as usual.

## Later: delta packages

`maker-squirrel`'s `remoteReleases` (pointed at the same feed URL) makes it download the previous
release at build time and emit a `-delta.nupkg`; `RELEASES` then lists both and `Update.exe`
downloads the delta when it applies. Updates drop from ~175 MB to a few MB.
