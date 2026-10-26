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
3. **Install** — `autoUpdater.quitAndInstall()`: Squirrel closes the app and restarts it from
   the new folder (`Update.exe --processStart`). The old `app-<version>\` stays until Squirrel's
   next clean-up, so a failure anywhere leaves the previous version runnable.

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
damaged install), now with the download checked against `latest.yml` (size, sha512) and the
installer started only after every Sokuji process has exited (`electron/update-install-windows.js`).

## Testing an unreleased build

The feed URL can be overridden for one machine: set `SOKUJI_UPDATE_FEED` to a URL that serves
`RELEASES` and the nupkg (any static HTTP server over `out/make-web/squirrel.windows/x64/`), start
the installed app from a shell with that variable, and run Download → Install. Squirrel writes
`%LocalAppData%\Sokuji\SquirrelSetup.log`.

Do not check for updates on the `--squirrel-firstrun` launch: `Update.exe` still holds its lock
and the request fails (Electron docs); `UpdateManager.checkAfterDelay` skips it.

## Later: delta packages

`maker-squirrel`'s `remoteReleases` (pointed at the same feed URL) makes it download the previous
release at build time and emit a `-delta.nupkg`; `RELEASES` then lists both and `Update.exe`
downloads the delta when it applies. Updates drop from ~175 MB to a few MB.
