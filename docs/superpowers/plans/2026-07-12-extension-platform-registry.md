# Extension Platform Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the set of supported meeting platforms one source of truth (`extension/platforms.ts`), so adding a platform is one registry row instead of ~10 hand-edited sites across 6 files — and structurally eliminate the `slack.com` vs `app.slack.com` divergence that already shipped.

**Architecture:** `extension/platforms.ts` holds one entry per platform (hostname, match pattern, content-script profile, display/short names, base64 icon, optional group + group label, i18n guidance key, optional site-plugin key). Bundled consumers (`popup.js`, the subtitle surface) import it directly. Vanilla copied scripts (`background.js`, `content.js`, `site-plugins.js`) that cannot ESM-import instead consume a `platforms.generated.js` emitted by a small Vite plugin at build time. `manifest.json` stays hand-authored (browser-critical, store-reviewed) but is guarded by a consistency test that fails if its content-script/web-accessible host lists drift from the registry.

**Tech Stack:** TypeScript, Vite (`vite-plugin-static-copy` already in `extension/vite.config.ts`), vitest, Chrome MV3 extension.

## Global Constraints

- Repo test gate is **vitest**, not tsc (~135 pre-existing tsc errors on `main`). Do not add NEW tsc errors to files you touch; do not try to make tsc clean.
- All comments and identifiers in English. Conventional commit format. Never `git push` — local commits only.
- This is a **behavior-preserving** refactor with exactly ONE intended behavior change: the `slack.com` entry in `background.js`'s `ENABLED_SITES` becomes `app.slack.com` (the canonical host every other surface already uses; `slack.com` is the marketing site where no content script injects — a latent dead entry). Call this out in the commit and PR.
- Do NOT touch `_locales/` — guidance/title text is human-translated content, not derivable. The registry references it by key only.
- Do NOT change the behavior implementations inside `site-plugins.js` (each plugin's `init`/`showGuidance`, its CSS gradients) or `content.js`'s notification logic — only the hostname→X *maps* are generated.
- The 11 canonical platform hostnames and their profiles (verified against the current code, 2026-07-12):
  | hostname | contentProfile | group | groupLabel | guidanceKey | pluginKey |
  |---|---|---|---|---|---|
  | meet.google.com | standard | — | — | (default) | — |
  | teams.live.com | standard | teams | Free | teams | teams |
  | teams.microsoft.com | standard | teams | Work | teams | teams |
  | teams.cloud.microsoft | standard | teams | M365 | teams | teams |
  | app.zoom.us | zoom | — | — | (default) | — |
  | app.gather.town | standard | — | — | gatherTown | gatherTown |
  | app.v2.gather.town | standard | — | — | gatherTown | gatherTown |
  | whereby.com | standard | — | — | whereby | whereby |
  | discord.com | standard | — | — | discord | discord |
  | app.slack.com | standard | — | — | slack | slack |
  | meet.jit.si | jitsi | — | — | jitsi | jitsi |

  `contentProfile` maps to the manifest's content_scripts entries: **standard** = `content.js` + `subtitle-overlay-content.js` at `document_start`; **jitsi** = `content.js` (all_frames) + `subtitle-overlay-content.js`, both `document_start`; **zoom** = `zoom-content.js` (all_frames, `document_start`) + `subtitle-overlay-content.js` (`document_idle`). Verify each against `extension/manifest.json` before encoding.
- `meet.google.com` and `app.zoom.us` have NO site-plugin and use the DEFAULT guidance (they are absent from `content.js`'s guidance chain and from `sitePluginsRegistry`) — encode `guidanceKey`/`pluginKey` as undefined for them, and make consumers fall back exactly as today.

## Design decisions already fixed (do not relitigate)

1. Build-time codegen for the 3 vanilla scripts (not runtime shared file, not consistency-test-only).
2. Locales stay in `_locales/`; registry references by key.
3. Icons (base64) live in the registry (`platforms.ts`), the popup's only consumer.
4. `manifest.json` is guarded by a consistency test, not regenerated (the golden-file safety net).

---

### Task 1: `extension/platforms.ts` registry + types + internal-consistency test

**Files:**
- Create: `extension/platforms.ts`
- Create: `extension/platforms.test.ts`

**Interfaces:**
- Produces:
  - `type ContentProfile = 'standard' | 'jitsi' | 'zoom'`
  - `interface PlatformEntry { hostname: string; matchPattern: string; contentProfile: ContentProfile; displayName: string; shortName: string; icon: string; group?: string; groupLabel?: string; guidanceKey?: string; pluginKey?: string }`
  - `const PLATFORMS: readonly PlatformEntry[]`
  - `const PLATFORM_HOSTNAMES: readonly string[]` (= `PLATFORMS.map(p => p.hostname)`)
  - helper `platformsByProfile(profile: ContentProfile): PlatformEntry[]`

- [ ] **Step 1: Write the failing test**

```typescript
// extension/platforms.test.ts
import { describe, it, expect } from 'vitest';
import { PLATFORMS, PLATFORM_HOSTNAMES, platformsByProfile } from './platforms';

describe('platform registry', () => {
  it('has the 11 canonical platforms with unique hostnames', () => {
    expect(PLATFORMS).toHaveLength(11);
    expect(new Set(PLATFORM_HOSTNAMES).size).toBe(11);
  });

  it('every match pattern is https://<hostname>/*', () => {
    for (const p of PLATFORMS) {
      expect(p.matchPattern, p.hostname).toBe(`https://${p.hostname}/*`);
    }
  });

  it('every entry has a non-empty display name, short name, and icon', () => {
    for (const p of PLATFORMS) {
      expect(p.displayName, p.hostname).toBeTruthy();
      expect(p.shortName, p.hostname).toBeTruthy();
      expect(p.icon.startsWith('data:image/'), p.hostname).toBe(true);
    }
  });

  it('grouped entries share a groupLabel and a consistent group key', () => {
    const grouped = PLATFORMS.filter(p => p.group);
    for (const p of grouped) expect(p.groupLabel, p.hostname).toBeTruthy();
    // teams is the only group today: 3 members
    expect(grouped.filter(p => p.group === 'teams')).toHaveLength(3);
  });

  it('uses app.slack.com (not slack.com) as the canonical Slack host', () => {
    expect(PLATFORM_HOSTNAMES).toContain('app.slack.com');
    expect(PLATFORM_HOSTNAMES).not.toContain('slack.com');
  });

  it('partitions cleanly by content profile', () => {
    expect(platformsByProfile('zoom').map(p => p.hostname)).toEqual(['app.zoom.us']);
    expect(platformsByProfile('jitsi').map(p => p.hostname)).toEqual(['meet.jit.si']);
    expect(platformsByProfile('standard')).toHaveLength(9);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './platforms'`).

Run: `npm run test -- --run extension/platforms.test.ts`

- [ ] **Step 3: Create `extension/platforms.ts`**

Populate all 11 entries from the Global Constraints table. Copy each `icon` base64 string VERBATIM from `extension/popup.js`'s `SITE_INFO` (meet.google.com, the 3 teams share the teams icon, app.zoom.us, app.slack.com, app.gather.town, app.v2.gather.town, whereby.com, discord.com, meet.jit.si). `displayName`/`shortName` also come from `SITE_INFO`. Example shape (fill all 11):

```typescript
export type ContentProfile = 'standard' | 'jitsi' | 'zoom';

export interface PlatformEntry {
  hostname: string;
  matchPattern: string;
  contentProfile: ContentProfile;
  displayName: string;
  shortName: string;
  icon: string;          // data:image/... base64, from popup SITE_INFO
  group?: string;        // e.g. 'teams' — members render as one popup card
  groupLabel?: string;   // e.g. 'Free' | 'Work' | 'M365'
  guidanceKey?: string;  // i18n key prefix: `${guidanceKey}Title` / `${guidanceKey}Guidance`; undefined = default
  pluginKey?: string;    // site-plugins.js plugin key; undefined = no plugin
}

export const PLATFORMS: readonly PlatformEntry[] = [
  { hostname: 'meet.google.com', matchPattern: 'https://meet.google.com/*', contentProfile: 'standard',
    displayName: 'Google Meet', shortName: 'Meet', icon: 'data:image/png;base64,<VERBATIM>' },
  { hostname: 'teams.live.com', matchPattern: 'https://teams.live.com/*', contentProfile: 'standard',
    displayName: 'Microsoft Teams Free', shortName: 'Teams', icon: 'data:image/png;base64,<VERBATIM>',
    group: 'teams', groupLabel: 'Free', guidanceKey: 'teams', pluginKey: 'teams' },
  // ... teams.microsoft.com (Work), teams.cloud.microsoft (M365) ...
  // ... app.zoom.us (contentProfile: 'zoom', no guidanceKey/pluginKey) ...
  // ... app.gather.town, app.v2.gather.town (guidanceKey/pluginKey: 'gatherTown') ...
  // ... whereby.com, discord.com, app.slack.com ...
  { hostname: 'meet.jit.si', matchPattern: 'https://meet.jit.si/*', contentProfile: 'jitsi',
    displayName: 'Jitsi Meet', shortName: 'Jitsi', icon: 'data:image/png;base64,<VERBATIM>',
    guidanceKey: 'jitsi', pluginKey: 'jitsi' },
];

export const PLATFORM_HOSTNAMES: readonly string[] = PLATFORMS.map(p => p.hostname);

export function platformsByProfile(profile: ContentProfile): PlatformEntry[] {
  return PLATFORMS.filter(p => p.contentProfile === profile);
}
```

Note on `meet.google.com`: current `SITE_INFO` gives it no `group`. It also has no guidance entry and no plugin — leave `guidanceKey`/`pluginKey` undefined. Same for `app.zoom.us`.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add extension/platforms.ts extension/platforms.test.ts
git commit -m "feat(extension): single platform registry (platforms.ts)"
```

---

### Task 2: Bundled consumers import the registry (popup + subtitle surface)

**Files:**
- Modify: `extension/popup.js` (replace `ENABLED_SITES`, `SITE_INFO`, `SITE_GROUPS` with registry-derived values)
- Modify: `src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts:6-15` (`SUPPORTED_HOSTS`)
- Test: `extension/platforms.derived.test.ts`

**Interfaces:**
- Consumes: `PLATFORMS`, `PLATFORM_HOSTNAMES` from Task 1.
- Produces: derived-structure helpers exported from `platforms.ts` — add `deriveEnabledSites()`, `deriveSiteInfo()`, `deriveSiteGroups()` so popup and the golden test share one derivation.

- [ ] **Step 1: Write the failing test** — pin that the derived structures deep-equal the CURRENT hand-written popup structures.

```typescript
// extension/platforms.derived.test.ts
import { describe, it, expect } from 'vitest';
import { deriveEnabledSites, deriveSiteInfo, deriveSiteGroups, PLATFORM_HOSTNAMES } from './platforms';

describe('derived popup structures match the pre-registry hand-written values', () => {
  it('ENABLED_SITES = all canonical hostnames', () => {
    expect(deriveEnabledSites().sort()).toEqual([...PLATFORM_HOSTNAMES].sort());
  });

  it('SITE_INFO has name/shortName/icon per hostname and group on grouped members', () => {
    const info = deriveSiteInfo();
    expect(info['meet.google.com']).toMatchObject({ name: 'Google Meet', shortName: 'Meet' });
    expect(info['meet.google.com'].icon.startsWith('data:image/')).toBe(true);
    expect(info['meet.google.com'].group).toBeUndefined();
    expect(info['teams.live.com'].group).toBe('teams');
  });

  it('SITE_GROUPS builds the teams card with Free/Work/M365 sub-labels', () => {
    const groups = deriveSiteGroups();
    expect(Object.keys(groups)).toEqual(['teams']);
    expect(groups.teams.shortName).toBe('Teams');
    expect(groups.teams.sites).toEqual([
      { domain: 'teams.live.com', label: 'Free' },
      { domain: 'teams.microsoft.com', label: 'Work' },
      { domain: 'teams.cloud.microsoft', label: 'M365' },
    ]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (derive helpers don't exist).

- [ ] **Step 3: Add the derive helpers to `platforms.ts`**

```typescript
export function deriveEnabledSites(): string[] {
  return PLATFORMS.map(p => p.hostname);
}

export function deriveSiteInfo(): Record<string, { name: string; shortName: string; icon: string; group?: string }> {
  const out: Record<string, { name: string; shortName: string; icon: string; group?: string }> = {};
  for (const p of PLATFORMS) {
    out[p.hostname] = { name: p.displayName, shortName: p.shortName, icon: p.icon, ...(p.group ? { group: p.group } : {}) };
  }
  return out;
}

export function deriveSiteGroups(): Record<string, { shortName: string; icon: string; sites: { domain: string; label: string }[] }> {
  const out: Record<string, { shortName: string; icon: string; sites: { domain: string; label: string }[] }> = {};
  for (const p of PLATFORMS) {
    if (!p.group) continue;
    if (!out[p.group]) out[p.group] = { shortName: p.shortName, icon: p.icon, sites: [] };
    out[p.group].sites.push({ domain: p.hostname, label: p.groupLabel! });
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS.** (If SITE_INFO/SITE_GROUPS shapes differ from the current popup literals, adjust the derive helpers until deep-equal — the current literals in `popup.js:119-210` are the golden reference.)

- [ ] **Step 5: Wire popup.js**

`popup.html` is a rollup input (`extension/vite.config.ts:119`), so `popup.js` is bundled and CAN import. Replace the three hand-written literals with:

```javascript
import { deriveEnabledSites, deriveSiteInfo, deriveSiteGroups } from './platforms';
const ENABLED_SITES = deriveEnabledSites();
const SITE_INFO = deriveSiteInfo();
const SITE_GROUPS = deriveSiteGroups();
```

Delete the old literal blocks (`popup.js` ~96, ~119-180, ~181-210). Leave every consumer of these three names unchanged.

- [ ] **Step 6: Wire the subtitle surface**

`src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts:6` currently hardcodes `const SUPPORTED_HOSTS = new Set([...11 hosts...])`. Replace with an import (path from `src/components/Subtitle/surfaces/` to `extension/platforms.ts` is `../../../../extension/platforms`):

```typescript
import { PLATFORM_HOSTNAMES } from '../../../../extension/platforms';
const SUPPORTED_HOSTS = new Set<string>(PLATFORM_HOSTNAMES);
```

Verify tsconfig/vite resolves an import from `src/` into `extension/` — if the extension build's tsconfig excludes `src/` or vice-versa, keep the import but confirm `npm run build` (root) and `npm run test` both resolve it; if resolution fails, report it before improvising a path alias.

- [ ] **Step 7: Run** `npm run test -- --run extension/ src/components/Subtitle/` — PASS, including the existing `ExtensionContentScriptSubtitleSurface.test.ts`.

- [ ] **Step 8: Commit** — `git commit -am "refactor(extension): popup and subtitle surface derive hosts from the registry"`

---

### Task 3: `manifest.json` consistency guard (the golden safety net)

**Files:**
- Create: `extension/manifest.consistency.test.ts`
- Add to `platforms.ts`: `deriveContentScripts()` and `deriveSubtitleWebAccessibleMatches()`

**Interfaces:**
- Consumes: `PLATFORMS`, `platformsByProfile`.
- Produces: `deriveContentScripts()` returning the manifest `content_scripts` array the registry implies; `deriveSubtitleWebAccessibleMatches()` returning the subtitle web-accessible matches list.

- [ ] **Step 1: Write the failing test** — the guard: manifest's content-script + web-accessible host lists must equal what the registry implies. This is what fails loudly if someone adds a platform to `platforms.ts` but forgets `manifest.json` (or vice-versa).

```typescript
// extension/manifest.consistency.test.ts
import { describe, it, expect } from 'vitest';
import manifest from './manifest.json';
import { deriveContentScripts, deriveSubtitleWebAccessibleMatches } from './platforms';

describe('manifest stays consistent with the platform registry', () => {
  it('content_scripts match the registry (grouped by content profile)', () => {
    // Compare as sets-of-(matches,js,run_at,all_frames) so ordering is irrelevant.
    const norm = (arr: any[]) => arr
      .map(e => JSON.stringify({ matches: [...e.matches].sort(), js: e.js, run_at: e.run_at ?? null, all_frames: e.all_frames ?? false }))
      .sort();
    expect(norm(manifest.content_scripts)).toEqual(norm(deriveContentScripts()));
  });

  it('subtitle web-accessible matches = every platform host', () => {
    const war = manifest.web_accessible_resources.find((w: any) =>
      w.resources.includes('subtitle-overlay.js'));
    expect([...war!.matches].sort()).toEqual(deriveSubtitleWebAccessibleMatches().sort());
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (derive functions missing).

- [ ] **Step 3: Implement the derivations in `platforms.ts`**

Encode the three content profiles exactly as the current manifest (verify against `extension/manifest.json:47-76` first):

```typescript
export function deriveContentScripts(): Array<{ matches: string[]; js: string[]; run_at: string; all_frames?: boolean }> {
  const patterns = (profile: ContentProfile) => platformsByProfile(profile).map(p => p.matchPattern);
  const standard = patterns('standard');
  const zoom = patterns('zoom');
  const jitsi = patterns('jitsi');
  return [
    { matches: [...standard], js: ['content.js', 'subtitle-overlay-content.js'], run_at: 'document_start' },
    { matches: [...jitsi], js: ['content.js'], run_at: 'document_start', all_frames: true },
    { matches: [...jitsi], js: ['subtitle-overlay-content.js'], run_at: 'document_start' },
    { matches: [...zoom], js: ['zoom-content.js'], run_at: 'document_start', all_frames: true },
    { matches: [...zoom], js: ['subtitle-overlay-content.js'], run_at: 'document_idle' },
  ];
}

export function deriveSubtitleWebAccessibleMatches(): string[] {
  return PLATFORMS.map(p => p.matchPattern);
}
```

- [ ] **Step 4: Run — expect PASS.** If it fails, the FIRST run tells you whether the registry table or the manifest is the truth. The current `manifest.json` is the golden reference — adjust the derive functions (profiles, js order, run_at, all_frames) until the test passes WITHOUT editing manifest.json. Do NOT edit manifest.json in this task.

- [ ] **Step 5: Commit** — `git commit -am "test(extension): guard manifest against platform-registry drift"`

---

### Task 4: Vite codegen for the vanilla scripts (background, content, site-plugins)

**Files:**
- Modify: `extension/vite.config.ts` (add a small plugin that emits `platforms.generated.js`)
- Modify: `extension/background/background.js` (consume generated `ENABLED_SITES`)
- Modify: `extension/content/content.js` (consume generated guidance map)
- Modify: `extension/content/site-plugins.js` (consume generated hostname→pluginKey map)
- Modify: `extension/manifest.json` (add `platforms.generated.js` ahead of `content.js` in the standard/jitsi content_scripts `js` arrays; add it to `background.service_worker` load or import; add to web_accessible if site-plugins needs it)
- Test: `extension/platforms.generated.test.ts`

**Interfaces:**
- Consumes: `PLATFORMS`.
- Produces: at build, `dist/platforms.generated.js` assigning `globalThis.SOKUJI_PLATFORMS` a plain-data array `[{ hostname, guidanceKey, pluginKey, contentProfile }]` (NO icons — vanilla scripts don't need them). Add `serializePlatformsForVanilla(): string` to `platforms.ts` so the plugin and a unit test share one serializer.

**IMPORTANT — this is the browser-runtime-risky task.** Manifest content-script load order and service-worker module semantics are involved; a wrong wiring means the extension silently stops injecting. Do the wiring conservatively and verify `npm run extension:build` produces the generated file and a manifest that still lists every script.

- [ ] **Step 1: Write the failing test** for the serializer (pure, testable without a browser).

```typescript
// extension/platforms.generated.test.ts
import { describe, it, expect } from 'vitest';
import { serializePlatformsForVanilla, PLATFORM_HOSTNAMES } from './platforms';

describe('vanilla platform serialization', () => {
  it('emits a global assignment with hostname/guidanceKey/pluginKey per platform', () => {
    const js = serializePlatformsForVanilla();
    expect(js).toContain('globalThis.SOKUJI_PLATFORMS');
    // Eval in a bare sandbox to read the data back.
    const g: any = {};
    new Function('globalThis', js)(g);
    expect(g.SOKUJI_PLATFORMS.map((p: any) => p.hostname).sort()).toEqual([...PLATFORM_HOSTNAMES].sort());
    const slack = g.SOKUJI_PLATFORMS.find((p: any) => p.hostname === 'app.slack.com');
    expect(slack.guidanceKey).toBe('slack');
    expect(slack.pluginKey).toBe('slack');
    const meet = g.SOKUJI_PLATFORMS.find((p: any) => p.hostname === 'meet.google.com');
    expect(meet.guidanceKey).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `serializePlatformsForVanilla()` in `platforms.ts`**

```typescript
export function serializePlatformsForVanilla(): string {
  const data = PLATFORMS.map(p => ({
    hostname: p.hostname,
    contentProfile: p.contentProfile,
    ...(p.guidanceKey ? { guidanceKey: p.guidanceKey } : {}),
    ...(p.pluginKey ? { pluginKey: p.pluginKey } : {}),
  }));
  return `// AUTO-GENERATED from extension/platforms.ts — do not edit.\n` +
    `globalThis.SOKUJI_PLATFORMS = ${JSON.stringify(data, null, 2)};\n`;
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Add the Vite emit plugin** to `extension/vite.config.ts`. It must write `platforms.generated.js` into the build output root (next to `background.js`/`content.js`). Import the serializer and emit via `generateBundle`:

```typescript
// near the other imports
import { serializePlatformsForVanilla } from './platforms';

// add to the plugins array (after viteStaticCopy)
{
  name: 'sokuji-emit-platforms',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'platforms.generated.js', source: serializePlatformsForVanilla() });
  },
},
```

- [ ] **Step 6: Wire manifest + vanilla scripts**

(a) `manifest.json` — prepend `platforms.generated.js` in the two content_scripts entries that run `content.js` (standard + jitsi), so `globalThis.SOKUJI_PLATFORMS` exists before `content.js` runs:
```json
{ "matches": [...standard...], "js": ["platforms.generated.js", "content.js", "subtitle-overlay-content.js"], "run_at": "document_start" },
{ "matches": ["https://meet.jit.si/*"], "js": ["platforms.generated.js", "content.js"], "run_at": "document_start", "all_frames": true },
```
Also add `platforms.generated.js` to `web_accessible_resources` (the first block's `resources`) since `site-plugins.js` is web-accessible and will read the global too. Re-run Task 3's consistency test — update `deriveContentScripts()` to include `'platforms.generated.js'` at the front of the two `content.js` entries' `js` arrays so the guard still matches.

(b) `background.js` — the service worker is `type: module`. Static-import is available, but the generated file assigns a global, so the simplest robust wiring is `importScripts` — NOT available in module workers. Instead, static-import a generated ESM. To keep ONE generated artifact, have `background.js` read the same global by adding `platforms.generated.js` via `import './platforms.generated.js'` at the top of `background.js` (a module worker executes it, setting `globalThis.SOKUJI_PLATFORMS`), then:
```javascript
import './platforms.generated.js';
const ENABLED_SITES = globalThis.SOKUJI_PLATFORMS.map(p => p.hostname);
```
Delete the hand-written `ENABLED_SITES` array. VERIFY the emit plugin writes `platforms.generated.js` to the same directory `background.js` is copied to (build root) so the relative import resolves.

(c) `content.js` — replace the guidance `if/else` chain (lines ~89-111) with a lookup over the global:
```javascript
const entry = (globalThis.SOKUJI_PLATFORMS || []).find(p => p.hostname === hostname);
const guidanceKey = entry?.guidanceKey;  // undefined → default
title = chrome.i18n.getMessage(guidanceKey ? `${guidanceKey}Title` : 'defaultTitle');
guidance = chrome.i18n.getMessage(guidanceKey ? `${guidanceKey}Guidance` : 'defaultGuidance');
```
This reproduces the exact chain (gatherTown/whereby/discord/slack/teams/jitsi → their keys; everything else → default). Note the current chain keys `teams.*` three hosts to `teamsGuidance` and both gather hosts to `gatherTownGuidance` — the registry's `guidanceKey` already encodes that.

(d) `site-plugins.js` — replace the hand-written `sitePluginsRegistry` object (lines ~467-480) with a lookup that maps the current hostname to its plugin via the generated `pluginKey`. Keep the plugin OBJECTS (`gatherTownPlugin`, etc.) exactly as-is; only the hostname→object map is generated:
```javascript
const PLUGIN_BY_KEY = { gatherTown: gatherTownPlugin, whereby: wherebyPlugin, discord: discordPlugin, slack: slackPlugin, teams: teamsPlugin, jitsi: jitsiPlugin };
function pluginForHost(hostname) {
  const entry = (globalThis.SOKUJI_PLATFORMS || []).find(p => p.hostname === hostname);
  return entry?.pluginKey ? PLUGIN_BY_KEY[entry.pluginKey] : null;
}
// in loadCurrentSitePlugin(): const plugin = pluginForHost(window.location.hostname);
```
`site-plugins.js` is web-accessible and loaded on demand; ensure `platforms.generated.js` is loaded before it (it's now in web_accessible_resources; the loader that injects site-plugins.js must inject platforms.generated.js first — check how site-plugins.js is injected and mirror that. If site-plugins.js is loaded via a `<script>` the page/content script controls, add platforms.generated.js ahead of it; if it can't be guaranteed, fall back to `PLUGIN_BY_KEY[hostname-derived]` — but prefer the global). If load-order for the web-accessible script cannot be guaranteed, STOP and report — do not ship a race.

- [ ] **Step 7: Run** `npm run test -- --run extension/` (all green, including the consistency guard updated for `platforms.generated.js`), then `npm run extension:build` and verify: `platforms.generated.js` exists in the build output, and `grep -c platforms.generated.js <build>/manifest.json` shows it wired. Report the build output tail.

- [ ] **Step 8: Manual load check (report only, do not block):** note that a full verification requires loading the unpacked extension in Chrome and confirming the side panel enables + guidance shows on at least one standard site (e.g. discord.com), one grouped site (teams), zoom, and jitsi. If you cannot load Chrome headless-ly, say so and leave it for the human.

- [ ] **Step 9: Commit** — `git commit -am "refactor(extension): vanilla scripts consume generated platform table; fix slack.com host"`

---

### Task 5: Recipe doc + cross-surface consistency test + final sweep

**Files:**
- Modify: `CLAUDE.md` (the extension "add a platform" surfaces — replace the scattered recipe with the registry one)
- Modify: `CONTEXT.md` (add a "Platform registry" glossary entry)
- Create/Modify: `extension/platforms.consistency.test.ts` (cross-surface: registry vs manifest vs generated, one test that a reviewer can read as the contract)

**Interfaces:** none new.

- [ ] **Step 1: Add the cross-surface consistency test**

```typescript
// extension/platforms.consistency.test.ts
import { describe, it, expect } from 'vitest';
import { PLATFORM_HOSTNAMES, deriveContentScripts } from './platforms';
import manifest from './manifest.json';

describe('every platform is reachable through the manifest', () => {
  it('each registry hostname appears in some content_scripts matches entry', () => {
    const manifestHosts = new Set(
      manifest.content_scripts.flatMap((e: any) => e.matches.map((m: string) => new URL(m.replace('/*', '/')).hostname)),
    );
    for (const host of PLATFORM_HOSTNAMES) expect(manifestHosts.has(host), host).toBe(true);
  });

  it('deriveContentScripts includes platforms.generated.js before content.js', () => {
    for (const e of deriveContentScripts()) {
      if (e.js.includes('content.js')) {
        expect(e.js.indexOf('platforms.generated.js')).toBeLessThan(e.js.indexOf('content.js'));
      }
    }
  });
});
```

- [ ] **Step 2: Run — expect PASS** (green after Tasks 3-4).

- [ ] **Step 3: Rewrite the CLAUDE.md "add a platform" guidance**

Find the extension platform section (if none exists, add under "Extension-Specific Information"):

```markdown
### Adding a Supported Meeting Platform
1. Add one row to `extension/platforms.ts` (`PLATFORMS`): hostname, matchPattern
   `https://<host>/*`, contentProfile (`standard` | `jitsi` | `zoom`), displayName,
   shortName, icon (base64), and — if applicable — group/groupLabel, guidanceKey, pluginKey.
2. If the platform needs a site plugin, add its plugin object to `site-plugins.js`
   and register the key in that file's `PLUGIN_BY_KEY`.
3. Add `<guidanceKey>Title` / `<guidanceKey>Guidance` to `_locales/*/messages.json`.
4. Update `manifest.json`'s content_scripts + subtitle web_accessible matches to match
   — the consistency tests (`extension/manifest.consistency.test.ts`) fail loudly if you don't.
popup, the subtitle surface, background, and content guidance all derive from the
registry automatically.
```

- [ ] **Step 4: Add the CONTEXT.md glossary entry** under the domain terms:

```markdown
- **Platform registry** — `extension/platforms.ts`: one row per supported meeting platform (hostname, match pattern, content-script profile, names, icon, optional group, guidance i18n key, site-plugin key). The single source of truth. Bundled consumers (popup, subtitle surface) import it; vanilla copied scripts (background, content, site-plugins) read a build-emitted `platforms.generated.js`; `manifest.json` stays hand-authored but is guarded by consistency tests. `app.slack.com` is the canonical Slack host (never `slack.com`).
```

- [ ] **Step 5: Final verification** — `npm run test -- --run` (all green), `npm run build` (root build succeeds — the subtitle surface's cross-dir import must resolve), `npm run extension:build` (extension build succeeds, `platforms.generated.js` emitted). Record all three outcomes.

- [ ] **Step 6: Commit** — `git commit -am "docs(extension): platform-registry recipe and glossary; cross-surface guard"`

---

## Self-Review Notes (already applied)

- **Coverage vs decisions:** build-time codegen = Task 4; locales untouched (referenced by key) = Tasks 1/4; icons in registry = Task 1; manifest golden guard = Task 3. All four fixed decisions have a task.
- **Intended behavior change:** `background.js` `slack.com` → `app.slack.com` (Task 4), flagged in commit + must appear in PR body. No other behavior change intended.
- **Highest-risk task is 4** (manifest content-script load order, module-worker import of the generated global, web-accessible load order for site-plugins.js). Its steps include explicit STOP-and-report gates for the two race conditions (background module import path; site-plugins.js load order) rather than shipping a guess.
- **Cross-dir import risk** (src/ → extension/) is called out in Task 2 Step 6 and re-verified in Task 5 Step 5; if it can't resolve, the implementer reports before improvising a path alias.
- **Out of scope (do not drift):** `_locales/` translation text; the plugin behavior implementations in `site-plugins.js`; the notification UI in `content.js`; any non-platform manifest fields (CSP, permissions).
