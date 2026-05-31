# Extension "Unsupported Site" Popup Redesign — Design

**Date:** 2026-05-31
**Status:** Approved design, ready for implementation plan

## Problem

The browser extension only works on a fixed list of meeting platforms
(`meet.google.com`, Teams, `app.zoom.us`, Slack, Gather, Whereby, Discord,
Jitsi). When a user opens the extension popup on any other site, the popup's
"unsupported" state:

- Leads with an amber `⚠ Not supported on this site` warning box, which reads
  as *something is broken*.
- Shows a grid of the supported sites (good), then ends with a
  developer-flavored footer: "Need support for more sites? Contact us at
  support@kizuna.ai / contribute to our open source project."
- **Never mentions the desktop app or the website**, even though the desktop
  app is the genuine solution for "this site isn't in the list."

The desktop app installs a system-wide **virtual microphone** that works with
*any* application — confirmed across all three platforms:

- **Windows** — VB-CABLE driver (`electron/windows-audio-utils.js`)
- **macOS** — bundled "Sokuji Virtual Audio" HAL driver (`electron/macos-audio-utils.js`)
- **Linux** — PulseAudio/PipeWire virtual sink + source (`electron/pulseaudio-utils.js`)

So "install the desktop app to translate anywhere" is honest advice for nearly
every user. (CLAUDE.md's "Linux only" note for virtual devices is stale.)

## Goal

Redesign the popup's unsupported-site experience to **lead with the desktop
app** as the primary call to action, keep the supported-sites grid as a
secondary path, and point users to the website/docs — converting a dead end
into an upgrade path.

## Scope

Two render functions in `extension/popup.js` that today share near-duplicate
markup:

- `showUnsupportedState(hostname)` — current site not in `ENABLED_SITES`.
- `showErrorState()` — current tab URL can't be detected (e.g. `chrome://` pages).

**Out of scope:** the *supported* state (`showSupportedState`), the in-page
content-script subtitle surface, and the per-platform onboarding guidance
modals (`gatherTownGuidance`, `slackGuidance`, etc.). The supported-sites grid
itself (`generateSitesList()` and `SITE_INFO`/`SITE_GROUPS`) is reused unchanged.

## Design

### Layout (desktop-app-first)

Both states share one layout. The only difference is the headline.

```
┌─────────────────────────────────┐
│ 🌐 Sokuji                       │   header — unchanged
├─────────────────────────────────┤
│ Sokuji isn't available on       │   headline (neutral, no amber box)
│ example.com yet.                │   hostname inline
│ ┌─────────────────────────────┐ │
│ │ 💻 Translate in any app     │ │   HERO card (.cta-card), brand accent
│ │ The desktop app adds a      │ │
│ │ virtual mic that works      │ │
│ │ system-wide — with OBS,     │ │
│ │ YouTube, Twitch, native     │ │
│ │ clients & any other app.    │ │
│ │ Windows · macOS · Linux     │ │
│ │     [ Download desktop ▸ ]  │ │   primary button → sokuji.kizuna.ai/
│ └─────────────────────────────┘ │
│ Prefer the browser? Sokuji      │   secondary heading
│ works on these — click to open: │
│ [Meet ][Teams][Zoom ][Disc ]    │   REUSES generateSitesList() as-is
│ [Slack][Gthr ][Wher ][Jitsi]    │
│ ─────────────────────────────── │
│ Don't see your site? Request it→│   slim footer line 1 → GitHub issue
│ Learn more →                    │   slim footer line 2 → sokuji.kizuna.ai/docs
└─────────────────────────────────┘
```

**Error state** is identical, with the headline replaced by
`Couldn't detect this tab` + a one-line body `Refresh the page and reopen
Sokuji.` Everything below (hero card, sites grid, footer) is the same. This
unifies the two states, removing today's duplicated markup.

### Why these choices

- **No amber warning box.** The amber `.status-unsupported` styling frames the
  situation as an error. Desktop-first reframes it as "here's the better tool,"
  so visual emphasis moves to the hero card (accent border + gradient button).
  The headline becomes plain text.
- **Hero card lists only desktop-only scenarios** (OBS, YouTube, Twitch, native
  desktop clients). Listing Zoom/Teams/Slack would be self-undermining — those
  already appear in the browser grid directly below. The differentiator is
  precisely what the extension *cannot* reach.
- **Footer slimmed to two one-line links**, replacing the multi-sentence
  email + GitHub paragraph.

### Link targets (constants near the top of `popup.js`)

| Constant | URL | Used by |
|---|---|---|
| `DOWNLOAD_URL` | `https://sokuji.kizuna.ai/` | Download desktop button |
| `WEBSITE_URL`  | `https://sokuji.kizuna.ai/docs` | Learn more |
| `REQUEST_SITE_URL` | `https://github.com/kizuna-ai-lab/sokuji/issues/new?labels=site-request&title=Site+request:+` | Request it |

The `sokuji.kizuna.ai` homepage (`docs/index.html`) already hosts the OS
installer buttons inline (it has no `#download` anchor), so the site root is the
correct download destination. Learn-more points to `/docs`, keeping the two
links distinct.

### Copy — new i18n keys

Added to `extension/_locales/en/messages.json` and translated into **all 55
locales** (see Localization). Only `unsupportedHeadline` carries a placeholder.

| Key | English message |
|---|---|
| `unsupportedHeadline` | `Sokuji isn't available on $HOSTNAME$ yet.` |
| `desktopCtaTitle` | `Translate in any app` |
| `desktopCtaBody` | `The desktop app adds a virtual microphone that works system-wide — with OBS, YouTube, Twitch, native desktop clients, and any other app. Windows · macOS · Linux.` |
| `desktopCtaButton` | `Download desktop app` |
| `browserSitesHeading` | `Prefer the browser? Sokuji works on these — click to open:` |
| `requestSiteLink` | `Don't see your site? Request it →` |
| `learnMore` | `Learn more →` |
| `detectFailHeadline` | `Couldn't detect this tab` |
| `detectFailBody` | `Refresh the page and reopen Sokuji.` |

`unsupportedHeadline` keeps the existing `$HOSTNAME$` placeholder block shape
used by today's `currentlyOn` key.

### Orphaned keys to remove

Verified referenced **only** inside `popup.js` (the rewritten file), so they are
pruned from `en/messages.json` and all 55 locale files in the same pass:

`notSupported`, `currentlyOn`, `unableToDetect`, `refreshAndTry`,
`needMoreSites`, `contactUs`, `contributeCode`, `openSourceProject`,
`needMoreSitesShort`, `contactUsShort`, `contributeCodeShort`.

(Keys for the supported state and onboarding modals — `sokujiAvailable`,
`clickToStart`, `quickStart`, `*Guidance`, etc. — are kept.)

### Styling — `extension/popup.css`

- New `.cta-card`: light accent background (`#f5f3ff`), accent border in the
  popup's existing purple (`#667eea`) — matching `.primary-button` and `.link`
  rather than introducing the app's green `#10a37f`, so the popup stays
  internally consistent. Contains a title row with the 💻 glyph, body text, and
  a full-width button.
- The Download button reuses the existing `.primary-button` gradient styling.
- New `.browser-sites-heading` (secondary, muted) above the reused
  `.sites-list` grid.
- New `.popup-footer-links` for the two slim one-line links.
- `.status-unsupported` amber box is no longer used by these states; leave the
  rule in place (harmless) or remove if unused elsewhere.

### Analytics — `trackEvent` (existing PostHog wiring)

Keep `extension_popup_unsupported_state_shown`. Add events to measure whether
the redesign converts:

- `popup_desktop_download_clicked` — `{ source: 'unsupported' | 'error', hostname }`
- `popup_website_clicked` — `{ source, hostname }`
- `popup_request_site_clicked` — `{ source, hostname }`

The existing `extension_site_navigated` event (sites grid clicks) is preserved.

### Localization

Translate the 9 new keys into all 55 locales under `extension/_locales/*/messages.json`:

```
am ar bg bn ca cs da de el en en_AU en_GB en_US es es_419 et fa fi fil fr
gu he hi hr hu id it ja kn ko lt lv ml mr ms nl no pl pt_BR pt_PT ro ru sk
sl sr sv sw ta te th tr uk vi zh_CN zh_TW
```

Requirements:

- Preserve the `$HOSTNAME$` placeholder (and its `placeholders` block) verbatim
  in every locale's `unsupportedHeadline`.
- Keep proper nouns untranslated: `Sokuji`, `OBS`, `YouTube`, `Twitch`,
  `Windows`, `macOS`, `Linux`, `sokuji.kizuna.ai`.
- Respect regional variants (`en_AU`/`en_GB`/`en_US`, `es`/`es_419`,
  `pt_BR`/`pt_PT`, `zh_CN`/`zh_TW`).
- Remove the orphaned keys from every locale file in the same edit.

`chrome.i18n` falls back to the `en` default locale for any missing key, so the
UI is never broken mid-migration — but the goal here is complete coverage in one
pass.

## Files touched

- `extension/popup.js` — rewrite `showUnsupportedState` + `showErrorState`; add
  `DOWNLOAD_URL` / `WEBSITE_URL` / `REQUEST_SITE_URL` constants and click
  handlers with tracking.
- `extension/popup.css` — add `.cta-card`, `.browser-sites-heading`,
  `.popup-footer-links`; reuse `.primary-button`.
- `extension/_locales/en/messages.json` — add 9 keys, remove 11 orphaned keys.
- `extension/_locales/<54 others>/messages.json` — translated 9 keys, remove 11
  orphaned keys.

## Testing

The popup is vanilla DOM (no unit-test harness), so verification is a manual
checklist with the extension loaded unpacked:

1. **Supported site** (e.g. `meet.google.com`) — supported state unchanged.
2. **Unsupported site** (e.g. `example.com`) — new desktop-first layout renders;
   headline shows the hostname; Download opens `sokuji.kizuna.ai/`; sites grid
   still navigates; "Request it" opens the prefilled GitHub issue; "Learn more"
   opens `sokuji.kizuna.ai/docs`.
3. **Undetectable tab** (e.g. `chrome://extensions`) — error layout renders with
   the `Couldn't detect this tab` headline and the same hero card + grid + footer.
4. **Tracking** — `popup_desktop_download_clicked` / `popup_website_clicked` /
   `popup_request_site_clicked` fire with correct `source` and `hostname` (visible
   in the popup console debug logs).
5. **Locale spot-check** — switch browser UI language to `ja` and `zh_CN`;
   confirm the new strings render translated and `$HOSTNAME$` interpolates.

## Decisions captured

- Layout: **desktop-app-first** (option A).
- Download → official site `https://sokuji.kizuna.ai/`.
- Learn more → `https://sokuji.kizuna.ai/docs`.
- Footer → slimmed to a one-line **Request it** link → **GitHub issue**.
- Scope → both the unsupported and detect-failure states.
- Desktop card lists desktop-only apps (OBS, YouTube, Twitch, native clients),
  not already-supported browser sites.
- Localization handled in the same pass — all 55 locales, no follow-up.
```