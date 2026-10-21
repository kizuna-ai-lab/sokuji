# Managed Qwen Beijing Region (client) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The managed Qwen provider (`kizunaai_qwen`) lets the user pick Singapore or Beijing, sends the choice with the session-key request, dials the endpoint the grant names, and captures the request id on the mainland socket too.

**Architecture:** A `region` field on the shared `QwenSettings` (default `sg`; BYOK ignores it), a Region dropdown rendered only by the managed settings view, one field added to the lease's request and read back from the grant, and the mainland host added to the two request-id capture filters.

**Tech Stack:** React + TypeScript, Vitest (`*.test.ts(x)`), 30 locale catalogs under `src/locales/<id>/translation.json`.

**Spec:** kizuna-ai-lab/sokuji-backend `docs/superpowers/specs/2026-10-21-qwen-beijing-region-design.md` §8 (the backend repo, branch `feat/qwen-beijing`). The managed-Qwen spec `docs/superpowers/specs/2026-10-17-kizuna-managed-qwen-design.md` gets an amendment pointing there (Task 4).

**Worktree:** `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/qwen-keepalive`, branch `feat/kizuna-managed-qwen` (local, unpushed). Tests: `npm run test -- <path>` from the worktree.

## Global Constraints

- Region ids `'sg' | 'cn'`; default `'sg'`; labels in the place's own language, not locale keys: `Singapore`, `北京 (Beijing)` (the `SONIOX_REGION_LABELS` rule).
- The request field is `region`; the grant's `region` and `endpoint` win over the setting. A grant without `region` (the backend before #… deploys) is still accepted.
- Never log, frame or test-fixture a token or key (the existing lease rules).
- Commits: conventional, English, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never push.

## Review Focus

1. A stored `region` of an unknown value (a downgrade, a hand edit) must load as `sg`, never break the settings view — Task 1's `narrows an unknown region to sg`.
2. A BYOK Qwen user must see no region dropdown and send nothing new — Task 2's `the own-key view shows no region`.
3. A grant that names `region: "cn"` with `endpoint: "cn"` must dial `wss://maas.qianwenaiapi.com/…` and nothing else — Task 3's `dials the endpoint the grant names`.

---

### Task 1: The region setting

**Files:**
- Create: `src/providers/qwen_livetranslate/regions.ts`
- Modify: `src/providers/qwen_livetranslate/settings.ts` (`QwenSettings.region`, `QWEN_DEFAULTS.region`, a `migrateQwenSettings`), `src/providers/qwen_livetranslate/provider.ts:27` (`settings: { key, defaults, migrate }`)
- Test: `src/providers/qwen_livetranslate/regions.test.ts` (create), `settings.test.ts`

**Interfaces:**
```ts
export type QwenRegion = 'sg' | 'cn';
export const QWEN_REGIONS: readonly QwenRegion[];
export const DEFAULT_QWEN_REGION: QwenRegion;
export const QWEN_REGION_LABELS: Record<QwenRegion, string>;   // { sg: 'Singapore', cn: '北京 (Beijing)' }
export function asQwenRegion(value: unknown): QwenRegion;       // defaults, like asSonioxRegion
export function migrateQwenSettings(stored: Readonly<Record<string, unknown>>): QwenSettings;
```

- [ ] **Step 1: Write the failing tests** — `regions.test.ts`: `asQwenRegion` returns `'cn'` for `'cn'`, `'sg'` for `'sg'`, `undefined`, `'us'`, `3`; labels as above. `settings.test.ts`: `narrows an unknown region to sg` (`migrateQwenSettings({ region: 'bj', voice: 'Tina' }).region === 'sg'`) and `QWEN_DEFAULTS.region === 'sg'`.
- [ ] **Step 2: Run** `npm run test -- src/providers/qwen_livetranslate/regions.test.ts src/providers/qwen_livetranslate/settings.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**; `migrate` narrows `region` and keeps every other field as `QWEN_DEFAULTS` + stored values (voices stay unchecked here, as today). Register `migrate` on the provider so `managed()` inherits it (`src/lib/provider/managed.ts:61`).
- [ ] **Step 4: Run** the folder's tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(qwen): a region setting, Singapore by default`

### Task 2: The Region dropdown on the managed view

**Files:**
- Modify: `src/providers/qwen_livetranslate/QwenSettings.tsx` (export `KizunaQwenSettingsView`, a wrapper rendering the region section in Soniox's markup — `settings-section` / `h2` + `Tooltip` / `setting-item` / `select.select-dropdown` with id `qwen-region-select` — above `QwenSettingsView`), `src/providers/qwen_livetranslate/kizuna.ts:21` (`Settings: KizunaQwenSettingsView`)
- Modify: `src/locales/*/translation.json` ×30: `settings.qwenRegion` ("Region") and `settings.qwenRegionTooltip` ("Qwen runs a separate deployment per region. Your audio is processed in the region you pick. Applies from the next session.")
- Test: `QwenSettings.test.tsx`, `kizuna.test.ts`

- [ ] **Step 1: Write the failing tests** — `renders a Region select with Singapore and 北京 (Beijing) on the managed view, selected from settings`; `the own-key view shows no region` (`QwenSettingsView` renders no `#qwen-region-select`); `picking Beijing updates { region: 'cn' }`; `kizuna.test.ts`: the managed provider's `Settings` is `KizunaQwenSettingsView`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Add the two keys to all 30 catalogs with a small script (English text in every catalog where no translation is written; the catalogs' parity test, if any, must pass — run `npm run test -- src/locales` to find it).
- [ ] **Step 4: Run** the folder's tests and `npm run test -- src/locales` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(qwen): a Region dropdown on the managed settings`

### Task 3: The lease sends the region and dials the grant's endpoint

**Files:**
- Modify: `src/providers/qwen_livetranslate/lease.ts` (`sent.region = asQwenRegion(s.region)` at :241; `parseGrant` accepts an optional `region` and keeps requiring a known `endpoint`; the `session.key_requested` frame shows `region`)
- Test: `lease.test.ts`

- [ ] **Step 1: Write the failing tests** — `sends the setting's region with the session-key request` (settings `{ region: 'cn' }` → POST body `region: 'cn'`; default settings → `region: 'sg'`); `dials the endpoint the grant names` (grant `{ endpoint: 'cn', region: 'cn' }` → `credentials('speaker').endpoint === 'cn'`); `accepts a grant without region` (today's backend); the 400 for an invalid region and the 503 `Qwen region not available` map to the existing `AdapterStartError` codes the lease uses for a refused start (assert the code, not the words).
- [ ] **Step 2: Run** `npm run test -- src/providers/qwen_livetranslate/lease.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the folder's tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(qwen): the lease asks for a region and follows the grant's endpoint`

### Task 4: Request-id capture on the mainland host; spec amendment

**Files:**
- Modify: `electron/better-auth-adapter.js:160-162` (`'wss://maas.qianwenaiapi.com/*'` beside the QwenCloud pattern), `extension/background/background.js:337` (same), the extension's consistency test if one pins the filter list
- Modify: `docs/superpowers/specs/2026-10-17-kizuna-managed-qwen-design.md` (an "Amendment 2026-10-21: regions" paragraph pointing at the backend spec; the "Beijing out of scope" line struck)
- Test: `extension/*.consistency.test.ts` if it covers `background.js` filters; else the change is checked by `npm run build` of the extension

- [ ] **Step 1:** Add the host to both filters; run the extension consistency tests and `npm run test -- electron` (if any cover the adapter) — Expected: PASS.
- [ ] **Step 2:** Amend the spec.
- [ ] **Step 3: Commit** `feat(qwen): capture the request id on the mainland socket too`

---

## Self-review notes

- Spec §8 coverage: setting + dropdown (Tasks 1–2), request/grant (Task 3), capture filters and the amendment (Task 4). `kizunaBudget.ts`'s Singapore minimum balance stays as the floor for both regions on purpose (Beijing is cheaper, so it over-asks slightly); no task changes it.
- The PR for this branch carries the whole managed-Qwen client and is asked for separately; this plan adds four commits to it.
