# Extension "Unsupported Site" Popup Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the browser extension popup's "unsupported site" and "detect-failure" states to lead with the desktop app, keep the supported-sites grid as a secondary path, add website/docs + GitHub-issue links, and translate all new copy across 55 locales.

**Architecture:** Both states are rendered by two functions in the vanilla-DOM `extension/popup.js`. They will share one HTML builder (`renderUnsupportedFirstHtml`) and one handler wirer (`setupUnsupportedHandlers`), differing only in the headline. Copy lives in `chrome.i18n` message catalogs under `extension/_locales/<locale>/messages.json`; new keys are added and orphaned keys removed. Styling lives in `extension/popup.css`. Click analytics reuse the existing PostHog `trackEvent` helper.

**Tech Stack:** Vanilla JS (ES module, bundled by Vite), Chrome extension MV3 `chrome.i18n` / `chrome.tabs`, `posthog-js-lite`, plain CSS.

---

## Background the engineer needs

- **The popup is plain DOM, not React, and has no unit-test runner.** `popup.js` builds HTML strings into `#content` and wires listeners. Verification for rendering is a **manual checklist** in Chrome. The only *automated* check in this plan is a Node script that validates the 55 locale JSON files (Task 6) — that part is genuinely testable, so it gets a real test.
- **Build command:** `npm run extension:build` (runs `cd extension && npx vite build`). Output goes to **`extension/dist/`**; `_locales`, `popup.html`, `popup.css`, and the bundled `popup.js` all land there. Load `extension/dist/` as an unpacked extension in Chrome to test.
- **`chrome.i18n.getMessage(key)` falls back to the `en` default locale** when a key is missing in the active locale, so the UI never breaks mid-migration — but the goal is full coverage.
- **Reused existing code (do not modify):** `generateSitesList()`, `SITE_INFO`, `SITE_GROUPS`, `setupSiteItemClickHandlers()`, `trackEvent()`, `getMessage()`.
- **Out of scope:** `showSupportedState`, the static `.footer` store-link row in `popup.html`, content-script surfaces, and onboarding guidance modals.

Reference (current code): `extension/popup.js` — `showUnsupportedState` at lines 335-360, `showErrorState` at lines 362-387, `setupEventListeners` at lines 426-508, `setupSiteItemClickHandlers` at lines 511-551.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `extension/_locales/en/messages.json` | English source of truth for copy | Add 9 keys, remove 11 orphaned keys |
| `extension/popup.js` | Render + wire the two states | Add 3 URL constants, rewrite 2 render fns, add 1 builder + 1 handler fn, trim `setupEventListeners` |
| `extension/popup.css` | Popup styling | Add `.status-headline`, `.cta-card*`, `.browser-sites-heading`, `.popup-footer-links` |
| `extension/_locales/<54 others>/messages.json` | Translated copy | Add 9 translated keys, remove 11 orphaned keys |

---

## Task 1: English message catalog — add new keys, remove orphaned keys

**Files:**
- Modify: `extension/_locales/en/messages.json`

- [ ] **Step 1: Remove the 11 orphaned keys**

Delete these top-level keys (they are referenced only by the soon-to-be-rewritten render functions): `notSupported`, `currentlyOn`, `unableToDetect`, `refreshAndTry`, `needMoreSites`, `contactUs`, `contributeCode`, `openSourceProject`, `needMoreSitesShort`, `contactUsShort`, `contributeCodeShort`.

Keep everything else (`sokujiAvailable`, `clickToStart`, `quickStart`, `quickStartInstructions`, `*Title`, `*Guidance`, `showMoreSites`, `showLessSites`, `popupTitle`, `openSokuji`, `chromeWebStore`, `edgeAddons`, etc.).

- [ ] **Step 2: Add the 9 new keys**

Insert this block (anywhere among the top-level keys; placing it where the removed keys were keeps the diff tidy):

```json
  "unsupportedHeadline": {
    "message": "Sokuji isn't available on $HOSTNAME$ yet.",
    "placeholders": {
      "hostname": {
        "content": "$1",
        "example": "example.com"
      }
    }
  },
  "desktopCtaTitle": {
    "message": "Translate in any app"
  },
  "desktopCtaBody": {
    "message": "The desktop app adds a virtual microphone that works system-wide — with OBS, YouTube, Twitch, native desktop clients, and any other app. Windows · macOS · Linux."
  },
  "desktopCtaButton": {
    "message": "Download desktop app"
  },
  "browserSitesHeading": {
    "message": "Prefer the browser? Sokuji works on these — click to open:"
  },
  "requestSiteLink": {
    "message": "Don't see your site? Request it →"
  },
  "learnMore": {
    "message": "Learn more →"
  },
  "detectFailHeadline": {
    "message": "Couldn't detect this tab"
  },
  "detectFailBody": {
    "message": "Refresh the page and reopen Sokuji."
  },
```

- [ ] **Step 3: Validate the JSON parses**

Run:
```bash
node -e 'JSON.parse(require("fs").readFileSync("extension/_locales/en/messages.json","utf8")); console.log("en OK")'
```
Expected: `en OK` (no SyntaxError).

- [ ] **Step 4: Commit**

```bash
git add extension/_locales/en/messages.json
git commit -m "feat(extension): add desktop-first popup copy keys (en), drop orphaned keys"
```

---

## Task 2: Rewrite the popup render functions and handlers

**Files:**
- Modify: `extension/popup.js`

- [ ] **Step 1: Add URL constants**

Immediately after the `ENABLED_SITES` array (ends at line 108), add:

```javascript
// Destinations for the desktop-first unsupported/error states
const DOWNLOAD_URL = 'https://sokuji.kizuna.ai/';
const WEBSITE_URL = 'https://sokuji.kizuna.ai/docs';
const REQUEST_SITE_URL =
  'https://github.com/kizuna-ai-lab/sokuji/issues/new?labels=site-request&title=Site%20request%3A%20';
```

Note: a non-existent `site-request` label does **not** 404 — GitHub still opens the prefilled new-issue form. Creating the label later is optional.

- [ ] **Step 2: Add the shared HTML builder**

Add this function just above `showUnsupportedState` (above line 335):

```javascript
// Shared markup for both the unsupported-site and detect-failure states.
// `headlineHtml` is the only part that differs between the two.
function renderUnsupportedFirstHtml(headlineHtml) {
  return `
    <div class="status-headline">
      ${headlineHtml}
    </div>

    <div class="cta-card">
      <div class="cta-card-title">💻 ${getMessage('desktopCtaTitle')}</div>
      <p class="cta-card-body">${getMessage('desktopCtaBody')}</p>
      <button id="downloadDesktop" class="primary-button cta-card-button">${getMessage('desktopCtaButton')}</button>
    </div>

    <div class="supported-sites">
      <p class="browser-sites-heading">${getMessage('browserSitesHeading')}</p>
      <ul class="sites-list" id="sitesList">
        ${generateSitesList()}
      </ul>
    </div>

    <div class="popup-footer-links">
      <a id="requestSiteLink" href="${REQUEST_SITE_URL}" target="_blank" rel="noopener">${getMessage('requestSiteLink')}</a>
      <a id="learnMoreLink" href="${WEBSITE_URL}" target="_blank" rel="noopener">${getMessage('learnMore')}</a>
    </div>
  `;
}
```

- [ ] **Step 3: Add the shared handler wirer**

Add this function just above `renderUnsupportedFirstHtml`:

```javascript
// Wire the CTA buttons/links plus the (reused) supported-sites grid.
// `source` is 'unsupported' | 'error'; `hostname` may be null in the error state.
function setupUnsupportedHandlers(source, hostname) {
  const trackingHostname = hostname || 'unknown';

  const downloadBtn = document.getElementById('downloadDesktop');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      trackEvent('popup_desktop_download_clicked', { source, hostname: trackingHostname });
      chrome.tabs.create({ url: DOWNLOAD_URL });
      window.close();
    });
  }

  const learnMoreLink = document.getElementById('learnMoreLink');
  if (learnMoreLink) {
    learnMoreLink.addEventListener('click', () => {
      trackEvent('popup_website_clicked', { source, hostname: trackingHostname });
    });
  }

  const requestSiteLink = document.getElementById('requestSiteLink');
  if (requestSiteLink) {
    requestSiteLink.addEventListener('click', () => {
      trackEvent('popup_request_site_clicked', { source, hostname: trackingHostname });
    });
  }

  // Reuse the existing grid navigation + extension_site_navigated tracking.
  setupSiteItemClickHandlers(false, hostname);
}
```

- [ ] **Step 4: Replace `showUnsupportedState`**

Replace the entire existing `showUnsupportedState` function (lines 335-360) with:

```javascript
function showUnsupportedState(hostname) {
  const content = document.getElementById('content');

  // Track unsupported state shown
  trackEvent('extension_popup_unsupported_state_shown', {
    hostname: hostname,
    supported_sites_count: ENABLED_SITES.length
  });

  const headline = `<strong>${getMessage('unsupportedHeadline', [`<code>${hostname}</code>`])}</strong>`;
  content.innerHTML = renderUnsupportedFirstHtml(headline);

  setupUnsupportedHandlers('unsupported', hostname);
}
```

- [ ] **Step 5: Replace `showErrorState`**

Replace the entire existing `showErrorState` function (lines 362-387) with:

```javascript
function showErrorState() {
  const content = document.getElementById('content');

  // Track error state shown
  trackEvent('extension_popup_error', {
    error_type: 'no_tab_info',
    error_message: 'Unable to detect current site'
  });

  const headline = `<strong>${getMessage('detectFailHeadline')}</strong><br>${getMessage('detectFailBody')}`;
  content.innerHTML = renderUnsupportedFirstHtml(headline);

  setupUnsupportedHandlers('error', null);
}
```

- [ ] **Step 6: Remove the now-duplicated grid wiring from `setupEventListeners`**

In `setupEventListeners` (lines 426-508), the grid is now wired by `setupUnsupportedHandlers`. Delete the line that double-binds it (line 490):

```javascript
  // Handle site item clicks (navigate to supported sites) 
  setupSiteItemClickHandlers(isSupported, currentHostname);
```

Leave the rest of `setupEventListeners` (the `openSidePanel` button handler and the `storeLink` handler) unchanged. Leave `setupSiteItemClickHandlers` itself unchanged (still called from `setupUnsupportedHandlers`).

- [ ] **Step 7: Build to confirm it bundles without errors**

Run:
```bash
npm run extension:build
```
Expected: build completes, `extension/dist/popup.js` is regenerated, no Rollup/ESM errors.

- [ ] **Step 8: Commit**

```bash
git add extension/popup.js
git commit -m "feat(extension): desktop-first unsupported & detect-failure popup states"
```

---

## Task 3: Add the popup styles

**Files:**
- Modify: `extension/popup.css`

- [ ] **Step 1: Append the new style rules**

Add to the end of `extension/popup.css` (before the closing `@media` block is fine; appending at EOF is simplest):

```css
/* Desktop-first unsupported / detect-failure states */
.status-headline {
  margin-bottom: 12px;
  font-size: 15px;
  line-height: 1.4;
  color: #1a1a1a;
}

.status-headline code {
  background: #f1f5f9;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 13px;
}

.cta-card {
  background-color: #f5f3ff;
  border: 1px solid #667eea;
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 16px;
}

.cta-card-title {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 6px;
}

.cta-card-body {
  margin: 0 0 12px 0;
  font-size: 12px;
  line-height: 1.5;
  color: #475569;
}

.cta-card-button {
  width: 100%;
}

.browser-sites-heading {
  margin: 0 0 8px 0;
  font-size: 12px;
  color: #64748b;
}

.popup-footer-links {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #e5e5e5;
}

.popup-footer-links a {
  font-size: 12px;
  color: #667eea;
  text-decoration: none;
}

.popup-footer-links a:hover {
  text-decoration: underline;
}
```

Note: `.cta-card-button` works *with* the existing `.primary-button` rule (the button element carries both classes), so it inherits the purple gradient and only adds full width.

- [ ] **Step 2: Build**

Run:
```bash
npm run extension:build
```
Expected: build succeeds; `extension/dist/popup.css` updated.

- [ ] **Step 3: Commit**

```bash
git add extension/popup.css
git commit -m "style(extension): cta-card + slim footer styles for unsupported popup"
```

---

## Task 4: Manual verification of the English UI

**Files:** none (verification only). No commit unless a fix is needed.

- [ ] **Step 1: Build and load**

Run:
```bash
npm run extension:build
```
Then in Chrome: `chrome://extensions` → enable Developer mode → "Load unpacked" → select `extension/dist/`. (If already loaded, click the reload icon on the Sokuji card.)

- [ ] **Step 2: Supported site (regression)**

Open `https://meet.google.com`, click the Sokuji toolbar icon.
Expected: unchanged supported state — "Sokuji is available on Google Meet!" + "Open Sokuji" button. No layout change.

- [ ] **Step 3: Unsupported site**

Open `https://example.com`, click the Sokuji icon.
Expected:
- Headline: "Sokuji isn't available on `example.com` yet." (hostname in a code pill, no amber box).
- Purple-bordered card: 💻 "Translate in any app" + the OBS/YouTube/Twitch body + full-width "Download desktop app" button.
- "Prefer the browser? Sokuji works on these — click to open:" + the sites grid.
- Two footer links: "Don't see your site? Request it →" and "Learn more →".

- [ ] **Step 4: Verify link behavior**

- Click "Download desktop app" → opens `https://sokuji.kizuna.ai/` in a new tab; popup closes.
- Reopen popup on `example.com`; click a site tile (e.g. Zoom) → opens `https://app.zoom.us` (grid still works).
- Reopen; click "Request it →" → opens a GitHub new-issue page titled "Site request: ".
- Reopen; click "Learn more →" → opens `https://sokuji.kizuna.ai/docs`.

- [ ] **Step 5: Detect-failure state**

Open `chrome://extensions` (a page with no accessible tab URL), click the Sokuji icon.
Expected: same layout, headline "Couldn't detect this tab" + "Refresh the page and reopen Sokuji.", hero card + grid + footer present.

- [ ] **Step 6: Verify analytics fire**

Right-click the popup → Inspect → Console. Repeat the clicks from Step 4 and confirm debug lines:
- `popup_desktop_download_clicked` with `{ source: 'unsupported', hostname: 'example.com' }`
- `popup_website_clicked`, `popup_request_site_clicked` with the same shape.
- On the `chrome://extensions` popup, the download click logs `source: 'error', hostname: 'unknown'`.

(If `POSTHOG_KEY` is unset locally, `trackEvent` no-ops — that's fine; the goal is no errors thrown. To see the debug logs, build with a `.env` `POSTHOG_KEY` set.)

- [ ] **Step 7: If any step failed, fix in the relevant file and re-run; otherwise proceed.**

---

## Task 5: Translate the 9 keys into all 54 non-English locales (and remove orphaned keys)

**Files:**
- Modify: every `extension/_locales/<locale>/messages.json` except `en` (54 files).

The 54 locales: `am ar bg bn ca cs da de el en_AU en_GB en_US es es_419 et fa fi fil fr gu he hi hr hu id it ja kn ko lt lv ml mr ms nl no pl pt_BR pt_PT ro ru sk sl sr sv sw ta te th tr uk vi zh_CN zh_TW`.

**Invariants for every file:**
1. Add all 9 new keys; remove the same 11 orphaned keys as Task 1.
2. In `unsupportedHeadline`, keep the `$HOSTNAME$` token in the translated `message` **and** keep the identical `placeholders` block (copy it verbatim from the en version).
3. Do **not** translate proper nouns: `Sokuji`, `OBS`, `YouTube`, `Twitch`, `Windows`, `macOS`, `Linux`. Keep the `·` separators and the trailing `→` on `requestSiteLink`/`learnMore`.
4. `en_AU`/`en_GB`/`en_US` reuse the en strings (regional spelling tweaks optional). `es`/`es_419` and `pt_BR`/`pt_PT` and `zh_CN`/`zh_TW` get region-appropriate wording.
5. Valid JSON, UTF-8, same indentation style as the existing file.

- [ ] **Step 1: Apply the four worked-example locales first (templates for the rest)**

These are complete, correct translations. Add the 9 keys (with the `unsupportedHeadline` placeholder block from en) and remove the 11 orphaned keys in each.

**ja:**
```
unsupportedHeadline: "Sokujiは$HOSTNAME$ではまだご利用いただけません。"
desktopCtaTitle:     "どんなアプリでも翻訳"
desktopCtaBody:      "デスクトップアプリは、システム全体で動作する仮想マイクを追加します。OBS、YouTube、Twitch、ネイティブのデスクトップクライアントなど、あらゆるアプリで利用できます。Windows · macOS · Linux。"
desktopCtaButton:    "デスクトップアプリをダウンロード"
browserSitesHeading: "ブラウザをご利用ですか？Sokujiは以下のサイトで動作します。クリックして開いてください:"
requestSiteLink:     "サイトが見つかりませんか？リクエストする →"
learnMore:           "詳しく見る →"
detectFailHeadline:  "このタブを検出できませんでした"
detectFailBody:      "ページを再読み込みして、Sokujiを開き直してください。"
```

**zh_CN:**
```
unsupportedHeadline: "Sokuji 暂不支持 $HOSTNAME$。"
desktopCtaTitle:     "在任意应用中翻译"
desktopCtaBody:      "桌面应用会添加一个系统级虚拟麦克风，适用于 OBS、YouTube、Twitch、原生桌面客户端以及任何其他应用。Windows · macOS · Linux。"
desktopCtaButton:    "下载桌面应用"
browserSitesHeading: "想用浏览器？Sokuji 支持以下网站，点击即可打开："
requestSiteLink:     "没有你的网站？申请支持 →"
learnMore:           "了解更多 →"
detectFailHeadline:  "无法识别当前标签页"
detectFailBody:      "请刷新页面后重新打开 Sokuji。"
```

**es:**
```
unsupportedHeadline: "Sokuji aún no está disponible en $HOSTNAME$."
desktopCtaTitle:     "Traduce en cualquier aplicación"
desktopCtaBody:      "La aplicación de escritorio añade un micrófono virtual que funciona en todo el sistema: con OBS, YouTube, Twitch, clientes de escritorio nativos y cualquier otra aplicación. Windows · macOS · Linux."
desktopCtaButton:    "Descargar la app de escritorio"
browserSitesHeading: "¿Prefieres el navegador? Sokuji funciona en estos sitios; haz clic para abrir:"
requestSiteLink:     "¿No ves tu sitio? Solicítalo →"
learnMore:           "Más información →"
detectFailHeadline:  "No se pudo detectar esta pestaña"
detectFailBody:      "Actualiza la página y vuelve a abrir Sokuji."
```

**fr:**
```
unsupportedHeadline: "Sokuji n'est pas encore disponible sur $HOSTNAME$."
desktopCtaTitle:     "Traduisez dans n'importe quelle application"
desktopCtaBody:      "L'application de bureau ajoute un microphone virtuel qui fonctionne sur tout le système : avec OBS, YouTube, Twitch, les clients de bureau natifs et toute autre application. Windows · macOS · Linux."
desktopCtaButton:    "Télécharger l'application de bureau"
browserSitesHeading: "Vous préférez le navigateur ? Sokuji fonctionne sur ces sites — cliquez pour ouvrir :"
requestSiteLink:     "Votre site n'apparaît pas ? Demandez-le →"
learnMore:           "En savoir plus →"
detectFailHeadline:  "Impossible de détecter cet onglet"
detectFailBody:      "Actualisez la page et rouvrez Sokuji."
```

- [ ] **Step 2: Translate the remaining 50 locales**

For each remaining locale (`am ar bg bn ca cs da de el en_AU en_GB en_US es_419 et fa fi fil gu he hi hr hu id it kn ko lt lv ml mr ms nl no pl pt_BR pt_PT ro ru sk sl sr sv sw ta te th tr uk vi zh_TW`), add the 9 keys translated into that language following the four templates and the invariants, and remove the 11 orphaned keys. Use the existing strings in each file (e.g. how `sokujiAvailable`/`quickStart` are phrased) as the tone/spelling reference for that locale. For RTL locales (`ar`, `fa`, `he`) translate the text normally; keep the literal `$HOSTNAME$`, `·`, and `→` characters as-is.

- [ ] **Step 3: Validate every locale parses, has the 9 keys, lacks the 11, and keeps the placeholder**

Run:
```bash
node -e '
const fs = require("fs"), d = "extension/_locales";
const need = ["unsupportedHeadline","desktopCtaTitle","desktopCtaBody","desktopCtaButton","browserSitesHeading","requestSiteLink","learnMore","detectFailHeadline","detectFailBody"];
const gone = ["notSupported","currentlyOn","unableToDetect","refreshAndTry","needMoreSites","contactUs","contributeCode","openSourceProject","needMoreSitesShort","contactUsShort","contributeCodeShort"];
let ok = true;
for (const l of fs.readdirSync(d).sort()) {
  const f = `${d}/${l}/messages.json`;
  let j;
  try { j = JSON.parse(fs.readFileSync(f, "utf8")); }
  catch (e) { console.log(`${l}: INVALID JSON — ${e.message}`); ok = false; continue; }
  for (const k of need) if (!j[k] || !j[k].message) { console.log(`${l}: MISSING ${k}`); ok = false; }
  for (const k of gone) if (j[k]) { console.log(`${l}: STILL HAS ${k}`); ok = false; }
  if (j.unsupportedHeadline && !/\$HOSTNAME\$/.test(j.unsupportedHeadline.message || "")) { console.log(`${l}: unsupportedHeadline missing $HOSTNAME$`); ok = false; }
  if (j.unsupportedHeadline && !(j.unsupportedHeadline.placeholders && j.unsupportedHeadline.placeholders.hostname)) { console.log(`${l}: unsupportedHeadline missing placeholders block`); ok = false; }
}
console.log(ok ? "ALL 55 LOCALES OK" : "FAILURES ABOVE");
process.exit(ok ? 0 : 1);
'
```
Expected: `ALL 55 LOCALES OK` and exit code 0. Fix any reported locale and re-run until clean.

- [ ] **Step 4: Commit**

```bash
git add extension/_locales
git commit -m "i18n(extension): translate desktop-first popup copy across 55 locales"
```

---

## Task 6: Final build + localized spot-check

**Files:** none (verification only).

- [ ] **Step 1: Clean build**

Run:
```bash
npm run extension:build
```
Expected: success; `extension/dist/_locales` contains all 55 locale folders with the new keys.

- [ ] **Step 2: Confirm the built output carries the new keys**

Run:
```bash
node -e 'const j=JSON.parse(require("fs").readFileSync("extension/dist/_locales/zh_CN/messages.json","utf8")); console.log(j.desktopCtaButton.message, "||", j.unsupportedHeadline.message)'
```
Expected: prints the zh_CN download-button text and the headline containing `$HOSTNAME$`.

- [ ] **Step 3: Localized UI spot-check**

Reload the unpacked `extension/dist/` in Chrome. Set Chrome's UI language to Japanese (`chrome://settings/languages` → move 日本語 to top → relaunch), open `https://example.com`, click the Sokuji icon.
Expected: the popup renders the Japanese strings, and the headline interpolates `example.com` into the `$HOSTNAME$` slot. Repeat for `zh_CN` if convenient.

- [ ] **Step 4: Done**

No further commit. The feature is complete: desktop-first unsupported + detect-failure states, 55-locale copy, slim GitHub-issue footer, website/docs links, and three new analytics events.

---

## Self-review notes (for the implementer)

- **Spec coverage:** desktop-first layout (Task 2/3), copy keys (Task 1), 55-locale translation (Task 5), orphaned-key removal (Tasks 1 & 5), download→`sokuji.kizuna.ai/` and learn-more→`/docs` and request→GitHub issue (Task 2 constants), three analytics events (Task 2), both unsupported + error states (Task 2). All present.
- **Type/name consistency:** the builder `renderUnsupportedFirstHtml`, wirer `setupUnsupportedHandlers(source, hostname)`, constants `DOWNLOAD_URL`/`WEBSITE_URL`/`REQUEST_SITE_URL`, and element ids `downloadDesktop`/`learnMoreLink`/`requestSiteLink` are used identically in every task that references them.
- **No new test harness invented:** the popup has none; rendering is verified manually (Tasks 4, 6), and the one automatable surface — the 55 JSON catalogs — gets a real validating script (Task 5 Step 3).
```