# India Region, Region Recommendation and the Voice Warning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Soniox's India region, a one-time measured region recommendation for managed Soniox and managed Qwen (hint strip + region list, live latency in every region drop-down), a voice warning before any Soniox region change, and the end of stale custom voice ids.

**Architecture:** Pure, injectable modules in `src/lib/region/` (probe, decision, record, provider table, run, region change) and `src/lib/soniox/voiceReconcile.ts`; three small zustand stores (latency cache, recommendation records, pending voice-warning question); thin React pieces in `src/components/Region/` mounted next to `VbCableIntro` in `MainLayout` and in `useBanners`; the two region selects call one `requestRegionChange`. Everything runs in the renderer.

**Tech Stack:** TypeScript (strict), React 19, zustand, i18next, Vitest + Testing Library (jsdom), Electron + MV3 extension sharing `src/`.

**Spec:** `docs/superpowers/specs/2026-11-14-region-recommendation-and-india-design.md` (binding). Background: the task's research notes (measurements, decisions).

## Global Constraints

- Never change a region without the user's click; the recommendation only recommends.
- Recommendation providers: `kizunaai_soniox` (regions `SONIOX_REGIONS`) and `kizunaai_qwen` (regions `QWEN_REGIONS`); never own-key providers; never across providers.
- Probe request, exactly: `fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal })`; 3 000 ms timeout per request; one warm-up round discarded; 5 rounds 200 ms apart; all regions in parallel per round; median of successes; fewer than 3 successes = unmeasured.
- Probe URLs: Soniox `https://${sonioxHosts(r).ttsRt}/`; Qwen the origin of the region's `ENDPOINTS[*].tokens` plus `/`.
- Recommend iff `best ≠ current` and (`current` unmeasured or `median(current) − median(best) ≥ 50`); `RECOMMEND_MIN_GAIN_MS = 50`, absolute.
- The recommendation record is device-local: `localStorage` key `regionRecommendation.<providerId>`; never `SettingsService` / `chrome.storage.sync`.
- Gate: selected provider is a recommendation provider, its entry loaded, signed in (and loaded), setup wizard closed, tour not active, run idle (`selectionLocked === false`), `navigator.onLine`, record absent or `unmeasured`; ~5 s (`RECOMMENDATION_DELAY_MS = 5000`) after the gate first holds.
- The hint is a `Banner` from `useBanners`, never during a session; closing it = keep. The region list is a `Modal`, no per-region notes, no price.
- Drop-down latency: managed Soniox, own-key Soniox, managed Qwen; " — measuring…" / " — 13 ms" / " — unreachable"; cache 10 min (`LATENCY_CACHE_MS = 600_000`) per region family; never measured while the select is disabled (a run); display only.
- Analytics: one `region_recommendation` event `{ provider, medians, current, recommended, outcome: 'switched'|'kept'|'no_change'|'gave_up', chosen }`; no IP or account fields.
- Soniox region changes go through `requestSonioxRegionChange`; no `voice*` field is ever copied across regions; refused unless the run phase is `idle`.
- Every automatic voice-field write is compare-before-write; a lookup that failed, or offline, changes nothing; a built-in voice name is never overwritten by reconciliation.
- Region names in copy are `SONIOX_REGION_LABELS` / `QWEN_REGION_LABELS`; new copy lives under the `region` namespace in all 30 catalogs (en authoritative).
- Failures are recorded with `reportWarning`/`reportError` (`src/lib/diagnostics/report.ts`); no new `console.error`/`console.warn` (`consoleLedger.consistency.test.ts`).
- Mobile is out of scope; `src/lib/region/probe.ts` and `decision.ts` stay platform-neutral (pinned in `MOBILE_SHARED_ROOTS`).
- Commit locally after each task (conventional commits); never push or open a PR from this plan.

## Review Focus

1. A session starts (keyboard Start) while the voice-warning dialog is open, then the user confirms → nothing is written. Test: Task 7.
2. A stored record that is malformed JSON or has an unknown status (older/newer build) → treated as absent, never throws. Test: Task 3.
3. The region is changed elsewhere (extension settings sync from another browser) to the recommended one while a hint is pending → the hint is hidden. Test: Task 10.
4. The user selects another provider (own-key Soniox) while a hint is pending → no hint; selecting the managed provider again shows it. Test: Task 10.
5. The account switches while a voice lookup is in flight → nothing is written for the old account. Test: Task 11.

---

## File map

Create: `src/lib/region/{probe,decision,record,regionalProviders,measure,runRecommendation,regionChange}.ts`; `src/stores/{regionLatencyStore,regionRecommendationStore,regionChangeStore}.ts`; `src/providers/soniox/{regionChange,voiceFieldReconcile}.ts`; `src/lib/soniox/voiceReconcile.ts`; `src/app/sonioxVoiceAccount.ts`; `src/components/Region/{RegionRecommendation,RegionChangeConfirm,RegionListModal}.tsx`, `useRegionHint.tsx`, `regionLatency.ts`, `useOnline.ts`, `Region.scss`; a colocated `*.test.ts(x)` for each.

---

### Task 1: India as a fourth Soniox region (spec A)

**Files:**
- Modify: `src/lib/soniox/regions.ts:19-35`
- Modify: `src/providers/soniox/settings.ts:18-26, 53-58, 71, 81-85, 114-136`
- Modify: `extension/manifest.json:120` (CSP `connect-src`)
- Test: `src/lib/soniox/regions.test.ts`, `src/providers/soniox/settings.test.ts`, `extension/manifest.consistency.test.ts:61-74`, `src/providers/soniox/config.test.ts:158`, `src/providers/soniox/lease.test.ts:223`, `src/providers/soniox/check.test.ts:42`, `src/providers/soniox/SonioxSettings.test.tsx:72`

**Interfaces:**
- Produces: `SonioxRegion = 'us'|'eu'|'jp'|'in'`; `SONIOX_REGIONS = ['us','eu','jp','in']`; `SONIOX_REGION_LABELS.in = 'India'`; `type SonioxKeyField = 'apiKey'|'apiKeyEu'|'apiKeyJp'|'apiKeyIn'`; `type SonioxVoiceField = 'voice'|'voiceEu'|'voiceJp'|'voiceIn'`; `SONIOX_KEY_FIELD: Readonly<Record<SonioxRegion, SonioxKeyField>>`; `SONIOX_VOICE_FIELD: Readonly<Record<SonioxRegion, SonioxVoiceField>>`; `sonioxKeyField(r)`, `sonioxVoiceField(r): SonioxVoiceField` (unchanged names); `SonioxSettings.voiceIn: string`.

- [ ] **Step 1: Write the failing tests**

```ts
// regions.test.ts
it('India: infix after the service name, labelled India, narrowed as itself', () => {
  expect(SONIOX_REGIONS).toEqual(['us', 'eu', 'jp', 'in']);
  expect(sonioxHosts('in')).toEqual({ api: 'api.in.soniox.com', sttRt: 'stt-rt.in.soniox.com', ttsRt: 'tts-rt.in.soniox.com' });
  expect(SONIOX_REGION_LABELS.in).toBe('India');
  expect(asSonioxRegion('in')).toBe('in');
});
// settings.test.ts — also add `voiceIn: 'Adrian'` to the SONIOX_DEFAULTS toEqual, and 'apiKeyIn' to the keys test
it('maps every region to its own key and voice field — India never reuses Japan', () => {
  expect(SONIOX_REGIONS.map((r) => sonioxKeyField(r))).toEqual(['apiKey', 'apiKeyEu', 'apiKeyJp', 'apiKeyIn']);
  expect(SONIOX_REGIONS.map((r) => sonioxVoiceField(r))).toEqual(['voice', 'voiceEu', 'voiceJp', 'voiceIn']);
  expect(sonioxCredentials.read({ apiKeyIn: 'k' }, signedOut)).toEqual({ region: 'in', stt: 'k', tts: 'k' });
  expect(sonioxSpeakerVoice({ ...SONIOX_DEFAULTS, region: 'in', voiceIn: 'clone-in', voiceJp: 'clone-jp' })).toBe('clone-in');
});
it('migration keeps voiceIn and defaults a wrong-typed one', () => {
  expect(migrateSonioxSettings({ ...SONIOX_DEFAULTS, voiceIn: 'clone-in' }).voiceIn).toBe('clone-in');
  expect(migrateSonioxSettings({ ...SONIOX_DEFAULTS, voiceIn: 7 }).voiceIn).toBe('Adrian');
});
// manifest.consistency.test.ts — extend the regional list:
//   'https://api.in.soniox.com', 'wss://stt-rt.in.soniox.com', 'wss://tts-rt.in.soniox.com', 'https://tts-rt.in.soniox.com'
// config.test.ts:  expect(build({ region: 'in', voiceIn: 'Clone-IN' }, speaker).tts).toEqual({ voice: 'Clone-IN', speed: 1 });
// lease.test.ts:   settings { region: 'in' } → body region 'in'; grant { region: 'in' } → credentials('speaker').region === 'in'
// check.test.ts:   K with region 'in' → url 'https://api.in.soniox.com/v1/auth/temporary-api-key'
// SonioxSettings.test.tsx:72 → ['United States', 'European Union', '日本 (Japan)', 'India']
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/soniox/regions.test.ts src/providers/soniox extension/manifest.consistency.test.ts`
Expected: FAIL (no `in` region, no `voiceIn`, India origins missing).

- [ ] **Step 3: Implement**

`regions.ts`: add `'in'` to the type and list, `in: 'India'` to the labels (`sonioxHosts` needs nothing). `settings.ts`: add `voiceIn` to `SonioxSettings`, `SONIOX_DEFAULTS` (`SONIOX_DEFAULT_VOICE`), `StringField` and the `migrateSonioxSettings` object; replace both chained ternaries with the two exhaustive `Record` maps above; derive `SONIOX_KEY_FIELDS = SONIOX_REGIONS.map((r) => SONIOX_KEY_FIELD[r])` and `REGION_OF_KEY` by inverting `SONIOX_KEY_FIELD`; `sonioxSpeakerVoice(s: Pick<SonioxSettings, 'region' | SonioxVoiceField>)`. `apiKeyIn` is a credential key (it reaches `credentials.keys` through `SONIOX_KEY_FIELDS`), not a `SonioxSettings` field. Manifest: append the four India origins after the JP ones.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/soniox src/providers/soniox extension/manifest.consistency.test.ts src/components/SetupWizard`
Expected: PASS (the wizard fixtures with three key literals need no change).

- [ ] **Step 5: Commit**

```bash
git add src/lib/soniox/regions.ts src/lib/soniox/regions.test.ts src/providers/soniox extension/manifest.json extension/manifest.consistency.test.ts
git commit -m "feat(soniox): India region with exhaustive per-region key and voice fields"
```

---

### Task 2: The HEAD probe (spec B3)

**Files:**
- Create: `src/lib/region/probe.ts`, `src/lib/region/probe.test.ts`
- Modify: `src/lib/mobileShared.test.ts:15-28` (add `'src/lib/region/probe.ts'`)

**Interfaces:**
- Produces:
```ts
export type RegionMedians = Readonly<Record<string, number | null>>; // every probed region present; null = unmeasured
export interface ProbeTarget { region: string; url: string }
export interface ProbeDeps {
  fetch(url: string, init: RequestInit): Promise<unknown>;
  now(): number;                       // ms, monotonic (performance.now in the app)
  sleep(ms: number): Promise<void>;
  signal?: AbortSignal;                // cancels the whole measurement
}
export const PROBE_ROUNDS = 5, PROBE_GAP_MS = 200, PROBE_TIMEOUT_MS = 3000, PROBE_MIN_SUCCESSES = 3;
/** Null when `signal` aborted before the last round finished. */
export function probeRegions(targets: readonly ProbeTarget[], deps: ProbeDeps): Promise<RegionMedians | null>;
```

- [ ] **Step 1: Write the failing tests** (fake timers; `fetch` = a promise resolving after a scripted delay per URL and call index, rejecting when its `init.signal` aborts; `now = () => Date.now()`; `sleep = (ms) => new Promise((r) => setTimeout(r, ms))`)

```ts
it('sends HEAD, no-cors, no-store, no credentials — 1 warm-up + 5 rounds per region', async () => {
  // 2 targets → 12 calls; every init:
  expect(fetch.mock.calls[0][1]).toEqual({ method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: expect.any(AbortSignal) });
  expect(fetch).toHaveBeenCalledTimes(12);
});
it('discards the warm-up: a 900 ms first request does not reach the median', async () => {
  // us delays [900, 170, 180, 175, 160, 190] → 175; jp [800, 12, 14, 13, 11, 15] → 13
  await expect(run).resolves.toEqual({ us: 175, jp: 13 });
});
it('issues one request per region per round, in parallel', () => { /* after the first microtask both regions' calls are out */ });
it('a request still pending at 3000 ms fails and is aborted; fewer than 3 successes is unmeasured', async () => {
  // eu: rounds 1–3 never answer → 2 successes → { eu: null }; the hung calls' signals are aborted
});
it('takes the median of 4 successes as the mean of the middle two, rounded', () => { /* [10, 20, 31, 40] → 26 */ });
it('answers null when its signal aborts mid-measurement', async () => { /* abort after round 2 → null */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/region/probe.test.ts`
Expected: FAIL ("Cannot find module './probe'").

- [ ] **Step 3: Implement `probeRegions` in `src/lib/region/probe.ts`**

Imports nothing. Per request: own `AbortController` (also aborted by `deps.signal`), raced against `deps.sleep(PROBE_TIMEOUT_MS)` which aborts it; time `now()` before/after the awaited fetch; a rejection or timeout is a failure. Warm-up round first (results dropped), then 5 rounds with `sleep(PROBE_GAP_MS)` between rounds (none after the last). Median: sort; odd → middle, even → mean of the middle two; `Math.round`; `< PROBE_MIN_SUCCESSES` → `null`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/region/probe.test.ts src/lib/mobileShared.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/region/probe.ts src/lib/region/probe.test.ts src/lib/mobileShared.test.ts
git commit -m "feat(region): platform-neutral HEAD latency probe"
```

---

### Task 3: The decision and the device-local record (spec B4)

**Files:**
- Create: `src/lib/region/decision.ts`, `src/lib/region/record.ts`, tests beside them
- Modify: `src/lib/mobileShared.test.ts` (add `'src/lib/region/decision.ts'`)

**Interfaces:**
- Consumes: `RegionMedians` (Task 2).
- Produces:
```ts
// decision.ts
export const RECOMMEND_MIN_GAIN_MS = 50;
export type RegionDecision = { kind: 'unmeasured' } | { kind: 'no-change' } | { kind: 'recommend'; region: string };
export function decideRegion(regions: readonly string[], medians: RegionMedians, current: string): RegionDecision;
// record.ts
export type RegionRecordStatus = 'unmeasured' | 'hint' | 'acted' | 'no-change' | 'gave-up' | 'chose-manually';
export interface RegionRecord { status: RegionRecordStatus; medians?: Record<string, number | null>; recommended?: string; at: number; attempts: number }
export const MAX_MEASURE_ATTEMPTS = 3;
export function needsMeasurement(r: RegionRecord | null | undefined): boolean;       // !r || r.status === 'unmeasured'
export function recordAfterMeasurement(prev: RegionRecord | null | undefined, d: RegionDecision, medians: RegionMedians, now: number): RegionRecord;
export function markActed(r: RegionRecord, now: number): RegionRecord;
export function markChoseManually(prev: RegionRecord | null | undefined, now: number): RegionRecord;
export function regionRecordKey(providerId: string): string;                         // `regionRecommendation.${providerId}`
export function readRegionRecord(providerId: string, storage: Pick<Storage, 'getItem'> | null): RegionRecord | null;
export function writeRegionRecord(providerId: string, r: RegionRecord, storage: Pick<Storage, 'setItem'> | null): void;
```

`unmeasured` (attempts 1–2, retried on the next launch) is the one status the spec's union lacks; it is the only record that does not stop measurement.

- [ ] **Step 1: Write the failing tests**

```ts
const R = ['us', 'eu', 'jp', 'in'];
it('recommends at a 50 ms gain, not at 49', () => {
  expect(decideRegion(R, { us: 63, eu: 200, jp: 13, in: 136 }, 'us')).toEqual({ kind: 'recommend', region: 'jp' });
  expect(decideRegion(R, { us: 62, eu: 200, jp: 13, in: 136 }, 'us')).toEqual({ kind: 'no-change' });
});
it('recommends the best when the current region is unmeasured; nothing when best is current or tied', () => {
  expect(decideRegion(R, { us: null, eu: 240, jp: 13, in: null }, 'us')).toEqual({ kind: 'recommend', region: 'jp' });
  expect(decideRegion(R, { us: 177, eu: 240, jp: 13, in: 136 }, 'jp')).toEqual({ kind: 'no-change' });
  expect(decideRegion(['sg', 'cn'], { sg: 80, cn: 80 }, 'sg')).toEqual({ kind: 'no-change' });
});
it('every region unmeasured is unmeasured', () => expect(decideRegion(R, { us: null, eu: null, jp: null, in: null }, 'us')).toEqual({ kind: 'unmeasured' }));
it('counts failed attempts and gives up at the third', () => {
  const a = recordAfterMeasurement(null, { kind: 'unmeasured' }, {}, 1);
  expect(a).toEqual({ status: 'unmeasured', at: 1, attempts: 1 });
  const c = recordAfterMeasurement(recordAfterMeasurement(a, { kind: 'unmeasured' }, {}, 2), { kind: 'unmeasured' }, {}, 3);
  expect(c).toMatchObject({ status: 'gave-up', attempts: 3 });
  expect(needsMeasurement(a)).toBe(true); expect(needsMeasurement(c)).toBe(false);
});
it('a recommendation is a hint with its medians; nothing to recommend is no-change; both stop measuring', () => {
  const m = { us: 177, jp: 13 };
  expect(recordAfterMeasurement(null, { kind: 'recommend', region: 'jp' }, m, 5)).toEqual({ status: 'hint', medians: m, recommended: 'jp', at: 5, attempts: 1 });
  expect(recordAfterMeasurement(null, { kind: 'no-change' }, m, 5)).toMatchObject({ status: 'no-change', medians: m });
});
it('a manual change records chose-manually over any record, a hint included', () => {
  expect(markChoseManually({ status: 'hint', recommended: 'jp', at: 1, attempts: 1 }, 9)).toMatchObject({ status: 'chose-manually', at: 9 });
  expect(markChoseManually(null, 9)).toEqual({ status: 'chose-manually', at: 9, attempts: 0 });
});
it('round-trips through storage under regionRecommendation.<id>', () => { /* write then read on a Map-backed Storage */ });
it('reads malformed JSON, an unknown status or a missing storage as no record, without throwing', () => {
  // getItem → '{', '{"status":"maybe","at":1,"attempts":0}', null storage → null   (Review Focus 2)
});
it('a failed write is reported as a warning and does not throw', () => { /* setItem throws QuotaExceededError → reportWarning called */ });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/region` → FAIL (modules missing).

- [ ] **Step 3: Implement** — the decision rule, the only algorithm here:

```ts
const measured = regions.filter((r) => medians[r] != null);
if (measured.length === 0) return { kind: 'unmeasured' };
const start = medians[current] != null ? current : measured[0];          // a tie keeps the current region
const best = measured.reduce((a, b) => (medians[b]! < medians[a]! ? b : a), start);
if (best === current) return { kind: 'no-change' };
const cur = medians[current];
return cur == null || cur - medians[best]! >= RECOMMEND_MIN_GAIN_MS ? { kind: 'recommend', region: best } : { kind: 'no-change' };
```

`recordAfterMeasurement`: `attempts = (prev?.attempts ?? 0) + 1`; unmeasured → `unmeasured`, or `gave-up` once `attempts >= MAX_MEASURE_ATTEMPTS` (no medians stored). `writeRegionRecord` catches and calls `reportWarning('RegionRecommendation', …, { cause, dedupeKey: 'region:record' })`.

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/region src/lib/mobileShared.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/region/decision.ts src/lib/region/decision.test.ts src/lib/region/record.ts src/lib/region/record.test.ts src/lib/mobileShared.test.ts
git commit -m "feat(region): recommendation rule and device-local record"
```

---

### Task 4: The provider table, the measurement seam and the latency cache (spec B1, B7 data)

**Files:**
- Create: `src/lib/region/regionalProviders.ts`, `src/lib/region/measure.ts`, `src/stores/regionLatencyStore.ts`, tests beside each
- Modify: `src/setupTests.ts` (block the network for every test)

**Interfaces:**
- Consumes: `probeRegions`, `RegionMedians` (Task 2); `SONIOX_REGIONS`, `SONIOX_REGION_LABELS`, `sonioxHosts`, `asSonioxRegion`; `QWEN_REGIONS`, `QWEN_REGION_LABELS`, `asQwenRegion`; `ENDPOINTS`.
- Produces:
```ts
// regionalProviders.ts
export type RegionFamily = 'soniox' | 'qwen';
export interface RegionFamilySpec { vendor: 'Soniox' | 'Qwen'; regions: readonly string[]; label(r: string): string; probeUrl(r: string): string; narrow(v: unknown): string }
export const REGION_FAMILIES: Readonly<Record<RegionFamily, RegionFamilySpec>>;
export type RegionalProviderId = 'kizunaai_soniox' | 'soniox' | 'kizunaai_qwen';
export const REGION_FAMILY_OF: Readonly<Record<RegionalProviderId, RegionFamily>>;
export type RecommendedProviderId = 'kizunaai_soniox' | 'kizunaai_qwen';
export const RECOMMENDED_PROVIDER_IDS: readonly RecommendedProviderId[];
export function isRecommendedProvider(id: string | null | undefined): id is RecommendedProviderId;
export function currentRegion(providerId: RegionalProviderId, settings: unknown): string;   // narrow(settings?.region)
// measure.ts
export function measureRegionFamily(family: RegionFamily, signal?: AbortSignal): Promise<RegionMedians | null>;
export function setRegionMeasure(fn: ((family: RegionFamily, signal?: AbortSignal) => Promise<RegionMedians | null>) | null): void; // null = the real probe
// regionLatencyStore.ts
export const LATENCY_CACHE_MS = 600_000;
export type RegionLatency = number | 'unreachable';
export interface FamilyLatency { medians: Readonly<Record<string, RegionLatency>> | null; at: number | null; measuring: boolean }
export const useRegionLatencyStore: UseBoundStore<StoreApi<{
  families: Partial<Record<RegionFamily, FamilyLatency>>;
  ensureFresh(family: RegionFamily): void;                          // measure unless < 10 min old or in flight
  fill(family: RegionFamily, medians: RegionMedians, at: number): void;
}>>;
```
The cache is keyed by family, so own-key and managed Soniox share it (same hosts).

- [ ] **Step 1: Write the failing tests**

```ts
it('probes tts-rt for Soniox and the maas origin for Qwen; a new Soniox region joins automatically', () => {
  expect(REGION_FAMILIES.soniox.regions).toBe(SONIOX_REGIONS);
  expect(REGION_FAMILIES.soniox.probeUrl('in')).toBe('https://tts-rt.in.soniox.com/');
  expect(REGION_FAMILIES.soniox.probeUrl('us')).toBe('https://tts-rt.soniox.com/');
  expect(REGION_FAMILIES.qwen.probeUrl('sg')).toBe('https://maas.qwencloudapi.com/');
  expect(REGION_FAMILIES.qwen.probeUrl('cn')).toBe('https://maas.qianwenaiapi.com/');
});
it('recommends only for the managed providers', () => {
  expect(RECOMMENDED_PROVIDER_IDS).toEqual(['kizunaai_soniox', 'kizunaai_qwen']);
  expect(isRecommendedProvider('soniox')).toBe(false);
  expect(currentRegion('kizunaai_qwen', { region: 'mars' })).toBe('sg');
});
it('the real measurement sends HEAD to every region of the family', async () => {
  setRegionMeasure(null); vi.stubGlobal('fetch', vi.fn(async () => new Response(null)));
  // fake timers; run measureRegionFamily('soniox'); 4 regions × 6 calls; call[0][1].method === 'HEAD'
});
it('ensureFresh measures once, keeps the result 10 minutes, and maps null to unreachable', async () => {
  const measure = vi.fn(async () => ({ us: 177, eu: null, jp: 13, in: 136 }));
  setRegionMeasure(measure);
  useRegionLatencyStore.getState().ensureFresh('soniox');
  useRegionLatencyStore.getState().ensureFresh('soniox');               // in flight → no second call
  expect(useRegionLatencyStore.getState().families.soniox?.measuring).toBe(true);
  await flush();
  expect(useRegionLatencyStore.getState().families.soniox).toMatchObject({ measuring: false, medians: { us: 177, eu: 'unreachable', jp: 13, in: 136 } });
  vi.setSystemTime(Date.now() + LATENCY_CACHE_MS - 1); useRegionLatencyStore.getState().ensureFresh('soniox');
  expect(measure).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 2); useRegionLatencyStore.getState().ensureFresh('soniox');
  expect(measure).toHaveBeenCalledTimes(2);
});
it('a fill from the one-time measurement counts as fresh; a failed measurement keeps the last numbers', () => { /* … */ });
it('writes nothing to localStorage', () => { /* after ensureFresh + fill: localStorage.length === 0 */ });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/region src/stores/regionLatencyStore.test.ts` → FAIL.

- [ ] **Step 3: Implement** the three modules. `measure.ts` default: `probeRegions(regions.map((r) => ({ region: r, url: probeUrl(r) })), { fetch: (u, i) => fetch(u, i), now: () => performance.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), signal })`. `ensureFresh` on rejection sets `measuring: false` and reports nothing (display only). In `src/setupTests.ts` add `beforeEach(() => { setRegionMeasure(() => new Promise(() => {})); useRegionLatencyStore.setState({ families: {} }); })` — rendering a region select in any test never reaches the network; a test that cares sets its own measure.

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/region src/stores/regionLatencyStore.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/region src/stores/regionLatencyStore.ts src/stores/regionLatencyStore.test.ts src/setupTests.ts
git commit -m "feat(region): regional provider table, measurement seam and 10-minute latency cache"
```

---

### Task 5: The recommendation store, the run and its gate (spec B2, B4, B6)

**Files:**
- Modify: `src/lib/analytics.ts:122` (add the event beside `settings_modified`)
- Create: `src/stores/regionRecommendationStore.ts`, `src/lib/region/runRecommendation.ts`, tests beside them

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
```ts
// analytics.ts, AnalyticsEvents
'region_recommendation': { provider: 'kizunaai_soniox' | 'kizunaai_qwen'; medians: Record<string, number | null>; current: string;
  recommended: string | null; outcome: 'switched' | 'kept' | 'no_change' | 'gave_up'; chosen: string };
// regionRecommendationStore.ts
export function loadRegionRecords(storage: Pick<Storage, 'getItem'> | null): Partial<Record<RecommendedProviderId, RegionRecord>>;
export const useRegionRecommendationStore: UseBoundStore<StoreApi<{
  records: Partial<Record<RecommendedProviderId, RegionRecord>>;   // loaded from localStorage at creation
  listOpen: RecommendedProviderId | null;
  setRecord(p: RecommendedProviderId, r: RegionRecord): void;      // memory + writeRegionRecord
  openList(p: RecommendedProviderId): void;
  closeList(): void;
}>>;
// runRecommendation.ts
export const RECOMMENDATION_DELAY_MS = 5000;
export interface GateInputs { provider: string | null; loaded: boolean; signedIn: boolean; wizardOpen: boolean; tourActive: boolean; locked: boolean; online: boolean; record: RegionRecord | undefined }
export function recommendationGate(i: GateInputs): boolean;
export function regionRecommendationEvent(provider: RecommendedProviderId, record: RegionRecord, current: string,
  outcome: AnalyticsEvents['region_recommendation']['outcome'], chosen: string): AnalyticsEvents['region_recommendation'];
export function runRegionRecommendation(provider: RecommendedProviderId, deps: { signal: AbortSignal; track(e: AnalyticsEvents['region_recommendation']): void; now?(): number }): Promise<void>;
export function resetRecommendationAttemptsForTests(): void;
```
`runRegionRecommendation`: returns unless `needsMeasurement(record)` and not yet attempted this launch (module `Set`); `measureRegionFamily(REGION_FAMILY_OF[provider], signal)`; `null`/aborted → forget the attempt (may run again this launch) and write nothing; otherwise `fill` the latency store, `decideRegion` against `currentRegion(provider, useProviderStore.getState().entries[provider]?.settings)`, `setRecord(recordAfterMeasurement(…))`, and track `no_change` (`recommended: null, chosen: current`) or `gave_up` (`medians` all null). `hint` and `unmeasured` track nothing.

- [ ] **Step 1: Write the failing tests**

```ts
const open: GateInputs = { provider: 'kizunaai_soniox', loaded: true, signedIn: true, wizardOpen: false, tourActive: false, locked: false, online: true, record: undefined };
it('opens only for a managed regional provider, signed in, after setup and the tour, idle and online, with no final record', () => {
  expect(recommendationGate(open)).toBe(true);
  for (const k of ['signedIn', 'loaded', 'online'] as const) expect(recommendationGate({ ...open, [k]: false })).toBe(false);
  for (const k of ['wizardOpen', 'tourActive', 'locked'] as const) expect(recommendationGate({ ...open, [k]: true })).toBe(false);
  expect(recommendationGate({ ...open, provider: 'soniox' })).toBe(false);
  expect(recommendationGate({ ...open, record: { status: 'acted', at: 1, attempts: 1 } })).toBe(false);
  expect(recommendationGate({ ...open, record: { status: 'unmeasured', at: 1, attempts: 1 } })).toBe(true);
});
it('measures an existing user once whatever region is stored, and records the hint', async () => {
  seedEntry('kizunaai_soniox', { ...SONIOX_DEFAULTS, region: 'jp' });   // providerStore.setState
  setRegionMeasure(async () => ({ us: 177, eu: 240, jp: 300, in: 136 }));
  await runRegionRecommendation('kizunaai_soniox', { signal: live(), track });
  expect(useRegionRecommendationStore.getState().records.kizunaai_soniox).toMatchObject({ status: 'hint', recommended: 'in' });
  expect(localStorage.getItem('regionRecommendation.kizunaai_soniox')).toContain('"hint"');
  expect(useRegionLatencyStore.getState().families.soniox?.medians).toMatchObject({ in: 136 });
  expect(track).not.toHaveBeenCalled();
  await runRegionRecommendation('kizunaai_soniox', { signal: live(), track });             // a record → never again
  expect(measure).toHaveBeenCalledTimes(1);
});
it('no-change tracks no_change; the third failed launch tracks gave_up', async () => { /* resetRecommendationAttemptsForTests between "launches" */ });
it('an aborted measurement writes nothing and may run again this launch', async () => { /* … */ });
it('records survive a relaunch: loadRegionRecords reads what setRecord wrote', () => { /* … */ });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/region/runRecommendation.test.ts src/stores/regionRecommendationStore.test.ts` → FAIL.

- [ ] **Step 3: Implement** per the interfaces. Storage access: `typeof localStorage === 'undefined' ? null : localStorage`, inside `try`.

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics.ts src/stores/regionRecommendationStore.ts src/stores/regionRecommendationStore.test.ts src/lib/region/runRecommendation.ts src/lib/region/runRecommendation.test.ts
git commit -m "feat(region): one-time recommendation run, its gate and the region_recommendation event"
```

---

### Task 6: The recommendation host in MainLayout (spec B2 timing)

**Files:**
- Create: `src/components/Region/RegionRecommendation.tsx`, `src/components/Region/useOnline.ts`, `src/components/Region/RegionRecommendation.test.tsx`
- Modify: `src/components/MainLayout/MainLayout.tsx:7, 224`; `src/components/MainLayout/MainLayout.setup.test.tsx`, `MainLayout.keepAlive.test.tsx` (mock it as `VbCableIntro` is)

**Interfaces:**
- Consumes: `recommendationGate`, `runRegionRecommendation`, `RECOMMENDATION_DELAY_MS` (Task 5); `useAuthContext`; `useTour`; `useSetupWizardOpen`; `useProviderStore` (`selected`, `entries`, `selectionLocked`); `useAnalytics`.
- Produces: `export default function RegionRecommendation(): JSX.Element` — the host later tasks render the confirm dialog (Task 8) and the region list (Task 10) in; `export function useOnline(): boolean` (`useSyncExternalStore` on `online`/`offline`, `navigator.onLine !== false`).

- [ ] **Step 1: Write the failing tests** (fake timers; mocks: `../Tour/TourProvider`, `../providers/useAuthContext`, `../../lib/analytics`, and `runRegionRecommendation` as a spy keeping the real gate)

```ts
it('runs the selected managed provider’s measurement 5 s after the gate opens, once', () => {
  render(<RegionRecommendation />);
  act(() => vi.advanceTimersByTime(4999)); expect(run).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(run).toHaveBeenCalledWith('kizunaai_soniox', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
it('waits for the tour and for an idle run; a session starting aborts the pending run', () => { /* selectionLocked: true → nothing; flip false → 5 s → run; flip true during run → signal.aborted */ });
it('never measures for own-key Soniox, signed out, or with a final record', () => { /* … */ });
// MainLayout.setup.test.tsx
it('mounts the region recommendation with the layout, never with the first-run wizard or in a subtitle takeover', () => { /* mirror the VbCableIntro cases with testid 'region-recommendation' */ });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/Region src/components/MainLayout` → FAIL.

- [ ] **Step 3: Implement** — an effect keyed on `[ready, selected]` arms `setTimeout(RECOMMENDATION_DELAY_MS)` with an `AbortController`; cleanup clears the timer and aborts. Mount `{!electronSubtitleTakeover && <RegionRecommendation />}` right after `<VbCableIntro />`.

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Region src/components/MainLayout
git commit -m "feat(region): measure once in the background after the main screen settles"
```

---

### Task 7: The region change path and the voice warning (spec C, logic)

**Files:**
- Modify: `src/lib/soniox/ttsCatalog.ts` (add the shared built-in check); `src/providers/soniox/voiceClaim.ts:29,43` (use it); `src/stores/providerStore.ts:117` (export `loadedProvider`)
- Create: `src/stores/regionChangeStore.ts`, `src/providers/soniox/regionChange.ts`, `src/lib/region/regionChange.ts`, tests beside each
- Test: `src/stores/providerStore.test.ts`

**Interfaces:**
- Consumes: `sonioxVoiceField`, `SONIOX_DEFAULT_VOICE`; `currentRunPhase` (`src/app/runPhase.ts`); `markChoseManually` (Task 3); `useRegionRecommendationStore` (Task 5); `currentRegion`, `REGION_FAMILY_OF`, `isRecommendedProvider` (Task 4).
- Produces:
```ts
export function isSonioxBuiltInVoice(id: string): boolean;                                   // ttsCatalog.ts
export function loadedProvider(id: string): AnyProvider | undefined;                        // providerStore.ts, reads loadedProviders
export type SonioxRegionWarning = { kind: 'built-in'; name: string } | { kind: 'custom' };
export function sonioxRegionWarning(s: SonioxSettings, from: SonioxRegion, to: SonioxRegion): SonioxRegionWarning | null;
export interface RegionChangeQuestion { providerId: 'soniox' | 'kizunaai_soniox'; managed: boolean; from: SonioxRegion; to: SonioxRegion; warning: SonioxRegionWarning }
export const useRegionChangeStore: UseBoundStore<StoreApi<{ question: RegionChangeQuestion | null; ask(q: RegionChangeQuestion): Promise<boolean>; answer(ok: boolean): void }>>;
export function requestSonioxRegionChange(p: AnyProvider, from: SonioxRegion, to: SonioxRegion, auth?: AuthContext): Promise<boolean>;
export type RegionChangeOrigin = 'select' | 'list';
export function requestRegionChange(r: { providerId: string; to: string; origin: RegionChangeOrigin; auth?: AuthContext }): Promise<boolean>;
```
`sonioxRegionWarning`: `null` unless `from`'s field is non-empty and not built-in; `custom` when `to`'s field is non-empty and not built-in; else `built-in` with `name = s[toField] || SONIOX_DEFAULT_VOICE`. `ask` answers a still-open earlier question `false`. `requestSonioxRegionChange`: `false` when `from === to` or the phase is not idle; with a warning, `await ask(...)`, then re-check the phase is idle and the entry's region is still `from`; then `updateSettings(p, { region: to })` only. `requestRegionChange`: resolves `loadedProvider`, refuses when not idle, `to = REGION_FAMILIES[family].narrow(to)`, delegates Soniox ids to `requestSonioxRegionChange`, writes Qwen directly; on success with `origin === 'select'` and a recommended provider, `setRecord(id, markChoseManually(prev, Date.now()))`.

- [ ] **Step 1: Write the failing tests** (`ServiceFactory` mocked as in `src/app/session.test.ts:9-16`; real `kizunaSonioxProvider`, `sonioxProvider`, `kizunaQwenProvider` loaded; `registerRunPhase` to simulate a run)

```ts
it('warns only for a custom voice in the current region, naming what the new region will use', () => {
  expect(sonioxRegionWarning({ ...S, voice: 'Kenji' }, 'us', 'jp')).toBeNull();
  expect(sonioxRegionWarning({ ...S, voice: 'uuid-us', voiceJp: '' }, 'us', 'jp')).toEqual({ kind: 'built-in', name: 'Adrian' });
  expect(sonioxRegionWarning({ ...S, voice: 'uuid-us', voiceJp: 'Kenji' }, 'us', 'jp')).toEqual({ kind: 'built-in', name: 'Kenji' });
  expect(sonioxRegionWarning({ ...S, voice: 'uuid-us', voiceJp: 'uuid-jp' }, 'us', 'jp')).toEqual({ kind: 'custom' });
});
it('a built-in voice switches at once, without asking', async () => { /* region 'jp', question stays null */ });
it('asks for a custom voice; cancel changes nothing; confirm changes only the region', async () => {
  const pending = requestSonioxRegionChange(kizunaSonioxProvider, 'us', 'jp');
  expect(useRegionChangeStore.getState().question).toMatchObject({ providerId: 'kizunaai_soniox', managed: true, from: 'us', to: 'jp' });
  useRegionChangeStore.getState().answer(true);
  await expect(pending).resolves.toBe(true);
  expect(settings()).toMatchObject({ region: 'jp', voice: 'uuid-us', voiceJp: 'Adrian' });   // nothing copied
});
it('own key asks with managed: false', async () => { /* sonioxProvider */ });
it('refuses during a session, and when a session started while the question was open', async () => {
  // registerRunPhase(() => 'running') → false, no question; idle → ask → flip to 'running' → answer(true) → false, region 'us'   (Review Focus 1)
});
it('a select change records chose-manually; a list change does not; own key records nothing', async () => { /* … */ });
it('Qwen changes without a warning and records chose-manually from the select', async () => { /* region 'cn' */ });
it('loadedProvider answers the definition an entry was loaded from', async () => { /* providerStore.test.ts */ });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/providers/soniox/regionChange.test.ts src/lib/region/regionChange.test.ts src/stores/regionChangeStore.test.ts src/stores/providerStore.test.ts` → FAIL.

- [ ] **Step 3: Implement** per the interfaces. Do not import `src/providers/registry` from these modules (a cycle through `SonioxSettings.tsx`, whose `SonioxSettingsView` const `provider.ts` reads at load); `loadedProvider` is the lookup.

- [ ] **Step 4: Run to verify pass** — same command plus `src/providers/soniox/voiceClaim.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/soniox/ttsCatalog.ts src/providers/soniox/voiceClaim.ts src/stores/providerStore.ts src/stores/providerStore.test.ts src/stores/regionChangeStore.ts src/stores/regionChangeStore.test.ts src/providers/soniox/regionChange.ts src/providers/soniox/regionChange.test.ts src/lib/region/regionChange.ts src/lib/region/regionChange.test.ts
git commit -m "feat(region): one region change path with the Soniox voice warning"
```

---

### Task 8: The voice-warning dialog, and both selects go through the path (spec C, UI)

**Files:**
- Create: `src/components/Region/RegionChangeConfirm.tsx`, `src/components/Region/RegionChangeConfirm.test.tsx`, `src/components/Region/Region.scss`
- Modify: `src/components/Region/RegionRecommendation.tsx` (render `<RegionChangeConfirm />` last, so it stacks above the list); `src/providers/soniox/SonioxSettings.tsx:15-31, 62-73, 187`; `src/providers/soniox/kizuna.ts:13`; `src/providers/qwen_livetranslate/QwenSettings.tsx:266-289`; `src/locales/en/translation.json` (+ sync)
- Test: `src/providers/soniox/SonioxSettings.test.tsx:44, 66-79`, `src/providers/qwen_livetranslate/QwenSettings.test.tsx:535-540`

**Interfaces:**
- Consumes: `useRegionChangeStore`, `requestRegionChange` (Task 7); `REGION_FAMILIES` (Task 4).
- Produces: `SonioxSettingsFlavour.providerId: 'soniox' | 'kizunaai_soniox'` (required; `kizuna.ts` passes `'kizunaai_soniox'`, the own view `'soniox'`). Both selects call `void requestRegionChange({ providerId, to: e.target.value, origin: 'select', auth: account?.auth })` and never `update({ region })`.

New en keys (namespace `region`):

```json
"changeTitle": "Switch region?",
"changeBuiltIn": "Your custom voice is saved in the {{from}} region and can't be used in {{to}}. Sessions in {{to}} will use the built-in voice {{name}} until you create a custom voice there. Your {{from}} voice stays; switching back to {{from}} uses it again.",
"changeCustom": "Sessions in {{to}} will use the custom voice you created there. Your {{from}} voice stays in {{from}}.",
"changeBuiltInOwnKey": "Your custom voice is in your {{from}} Soniox project and can't be used in {{to}}. Sessions in {{to}} will use the built-in voice {{name}} until you create a custom voice in your {{to}} project. Your {{from}} voice stays; switching back to {{from}} uses it again.",
"changeCustomOwnKey": "Sessions in {{to}} will use the custom voice in your {{to}} Soniox project. Your {{from}} voice stays in your {{from}} project.",
"changeConfirm": "Switch to {{to}}"
```
Cancel reuses `common.cancel`. `{{from}}`/`{{to}}` are `SONIOX_REGION_LABELS`.

- [ ] **Step 1: Write the failing tests** (`t` mock interpolating the fallback: `(k, d, o) => typeof d === 'string' ? d.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o?.[n])) : k`)

```ts
it('says what really happens: the built-in voice the new region will use, and the old voice staying', () => {
  useRegionChangeStore.setState({ question: { providerId: 'kizunaai_soniox', managed: true, from: 'us', to: 'jp', warning: { kind: 'built-in', name: 'Adrian' } } });
  render(<RegionChangeConfirm />);
  expect(screen.getByRole('dialog', { name: 'Switch region?' })).toHaveTextContent('can\'t be used in 日本 (Japan)');
  expect(screen.getByText(/built-in voice Adrian/)).toBeTruthy();
});
it('names the user’s own Soniox project for an own key, and the custom voice there when it has one', () => { /* changeBuiltInOwnKey / changeCustom */ });
it('Switch answers true; Cancel and × answer false', () => { /* answer spy */ });
// SonioxSettings.test.tsx (mock '../../lib/region/regionChange'):
it('the region select asks for the change through the region path and never writes the region itself', () => {
  fireEvent.change(select, { target: { value: 'in' } });
  expect(requestRegionChange).toHaveBeenCalledWith({ providerId: 'soniox', to: 'in', origin: 'select', auth: expect.anything() });
  expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ region: expect.anything() }));
});
// QwenSettings.test.tsx: picking Beijing → requestRegionChange({ providerId: 'kizunaai_qwen', to: 'cn', origin: 'select', … })
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/Region src/providers/soniox/SonioxSettings.test.tsx src/providers/qwen_livetranslate/QwenSettings.test.tsx` → FAIL.

- [ ] **Step 3: Implement** the dialog (`Modal`, two buttons in a `.region-change__actions` row styled like `LicenseConsentModal`'s actions, existing colour variables only), the provider id flavour, and the two `onChange`s. Add the keys to `src/locales/en/translation.json` under a new top-level `"region"` object, then `node scripts/sync-locale-keys.mjs` (copies them as placeholders; Task 14 translates).

- [ ] **Step 4: Run to verify pass** — same command plus `src/locales` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Region src/providers/soniox/SonioxSettings.tsx src/providers/soniox/SonioxSettings.test.tsx src/providers/soniox/kizuna.ts src/providers/qwen_livetranslate/QwenSettings.tsx src/providers/qwen_livetranslate/QwenSettings.test.tsx src/locales
git commit -m "feat(region): voice warning dialog; region selects use the region change path"
```

---

### Task 9: Latency in every region drop-down (spec B7, UI)

**Files:**
- Create: `src/components/Region/regionLatency.ts`, `src/components/Region/regionLatency.test.tsx`
- Modify: `src/providers/soniox/SonioxSettings.tsx:71`, `src/providers/qwen_livetranslate/QwenSettings.tsx:290`; en catalog (+ sync)
- Test: `src/providers/soniox/SonioxSettings.test.tsx`, `src/providers/qwen_livetranslate/QwenSettings.test.tsx:526-533`

**Interfaces:**
- Consumes: `useRegionLatencyStore`, `REGION_FAMILY_OF` (Task 4).
- Produces:
```ts
export type ShownLatency = RegionLatency | 'measuring';
export function useRegionLatencies(family: RegionFamily, live: boolean): Readonly<Record<string, ShownLatency>> | null; // live → ensureFresh on mount
export function regionOptionLabel(t: TFunction, label: string, latency: ShownLatency | undefined): string;          // `${label} — ${suffix}` or label
```
While `measuring` every region shows `measuring`; otherwise the cached medians; nothing cached → `null` (plain labels). Soniox passes `live = !disabled` and family `'soniox'`; Qwen `'qwen'`.

New en keys: `"latencyMeasuring": "measuring…"`, `"latencyMs": "{{ms}} ms"`, `"latencyUnreachable": "unreachable"`.

- [ ] **Step 1: Write the failing tests**

```ts
it('options read measuring… until the result, then the milliseconds or unreachable', async () => {
  let done!: (m: RegionMedians) => void; setRegionMeasure(() => new Promise((r) => { done = r; }));
  render(<BYOK {...props()} />);
  expect(optionTexts()).toEqual(['United States — measuring…', 'European Union — measuring…', '日本 (Japan) — measuring…', 'India — measuring…']);
  await act(async () => done({ us: 177, eu: 237, jp: 13, in: null }));
  expect(optionTexts()).toEqual(['United States — 177 ms', 'European Union — 237 ms', '日本 (Japan) — 13 ms', 'India — unreachable']);
});
it('reopening within 10 minutes reuses the numbers', () => { /* unmount + render → measure called once */ });
it('measures nothing during a session and keeps the last numbers', () => { /* disabled: true → measure not called; seeded cache shown */ });
it('never writes the recommendation record nor opens the hint', () => { /* records {} and no regionRecommendation.* key */ });
// QwenSettings: ['Singapore — 80 ms', '北京 (Beijing) — 150 ms']
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/Region src/providers/soniox/SonioxSettings.test.tsx src/providers/qwen_livetranslate/QwenSettings.test.tsx` → FAIL.

- [ ] **Step 3: Implement** the hook and label, use them in both `<option>`s; add the keys under `region` in en and run `node scripts/sync-locale-keys.mjs`.

- [ ] **Step 4: Run to verify pass** — same command plus `src/locales` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Region src/providers/soniox/SonioxSettings.tsx src/providers/soniox/SonioxSettings.test.tsx src/providers/qwen_livetranslate/QwenSettings.tsx src/providers/qwen_livetranslate/QwenSettings.test.tsx src/locales
git commit -m "feat(region): live latency in the region drop-downs"
```

---

### Task 10: The hint strip and the region list (spec B5, B6)

**Files:**
- Create: `src/components/Region/useRegionHint.tsx`, `src/components/Region/RegionListModal.tsx`, tests beside them
- Modify: `src/components/Banner/useBanners.tsx:95-96` (push the hint last); `src/components/Region/RegionRecommendation.tsx` (render `<RegionListModal />` before the confirm); `src/components/Region/Region.scss`; en catalog (+ sync)

**Interfaces:**
- Consumes: `useRegionRecommendationStore`, `regionRecommendationEvent` (Task 5); `requestRegionChange` (Task 7); `REGION_FAMILIES`, `REGION_FAMILY_OF`, `currentRegion` (Task 4); `markActed` (Task 3); `useAnalytics`; `useAuthContext`.
- Produces: `export function useRegionHint(): BannerProps | null`; `export default function RegionListModal(): JSX.Element | null`.

`useRegionHint` shows `{ id: 'region-hint', tone: 'brand', icon: <Gauge size={14} aria-hidden="true" /> }` only when `selected` is a recommended provider whose record is `hint`, `selectionLocked` is false and the live current region ≠ `record.recommended`. Text: gain = `medians[current] − medians[recommended]` rounded to the nearest 10 → `region.hintFaster`; current `null` → `region.hintCurrentUnreachable`. Action opens the list; dismiss = keep (`markActed`, event `kept`, `chosen: current`). The list rows come from the record's medians in family order: label, "13 ms" or "Couldn't reach", tags `Recommended` (record.recommended) and `Current` (live), a `Switch` button on each measured non-current row; footer `Keep {current}`. Switch → `requestRegionChange({ providerId, to: r, origin: 'list', auth })`; `true` → `markActed`, event `switched` with `chosen: r`, close; `false` → stays open, nothing written. ×/backdrop/Keep → `markActed`, event `kept`, close, region untouched.

New en keys:

```json
"hintFaster": "{{region}} is about {{ms}} ms faster than your current region ({{current}})",
"hintCurrentUnreachable": "{{region}} answers in {{ms}} ms; your current region ({{current}}) could not be reached",
"hintAction": "See each region's speed",
"listTitle": "Choose a faster region",
"listIntro": "We measured your connection to each {{vendor}} region:",
"recommended": "Recommended", "current": "Current", "unreachable": "Couldn't reach", "switch": "Switch", "keep": "Keep {{region}}"
```

- [ ] **Step 1: Write the failing tests** (mock `../../lib/analytics` and `../../lib/region/regionChange`)

```ts
const hint: RegionRecord = { status: 'hint', medians: { us: 177, eu: 237, jp: 13, in: 136 }, recommended: 'jp', at: 1, attempts: 1 };
it('shows the hint for the selected managed provider, outside a session, and opens the list', () => {
  render(<Banners />);
  expect(screen.getByText('日本 (Japan) is about 160 ms faster than your current region (United States)')).toBeTruthy();
  fireEvent.click(screen.getByText("See each region's speed"));
  expect(useRegionRecommendationStore.getState().listOpen).toBe('kizunaai_soniox');
});
it('closing the hint keeps the region and resolves it for good', () => {
  // dismiss → record.status 'acted'; trackEvent('region_recommendation', { provider: 'kizunaai_soniox', medians: hint.medians, current: 'us', recommended: 'jp', outcome: 'kept', chosen: 'us' })
});
it('no hint without a pending recommendation, during a session, or when the current region is unmeasured… uses the unreachable wording', () => { /* … */ });
it('hides the hint once the region is already the recommended one (changed elsewhere)', () => { /* settings region 'jp' → no banner   (Review Focus 3) */ });
it('hides the hint while another provider is selected and shows it again on return', () => { /* selected 'soniox' → none; back → shown   (Review Focus 4) */ });
// RegionListModal
it('lists every region with its median, marks recommended and current, one Switch per measured non-current row', () => {
  // rows: United States 177 ms Current | European Union 237 ms [Switch] | 日本 (Japan) 13 ms Recommended [Switch] | India 136 ms [Switch]
  expect(screen.getAllByRole('button', { name: 'Switch' })).toHaveLength(3);
});
it('an unmeasured region reads Couldn’t reach and has no button', () => { /* in: null */ });
it('Switch goes through the region path; a confirmed switch resolves the hint as switched', async () => {
  requestRegionChange.mockResolvedValue(true);
  // click jp's Switch → called with { providerId: 'kizunaai_soniox', to: 'jp', origin: 'list', auth: … }; record 'acted'; event outcome 'switched', chosen 'jp'; list closed
});
it('a cancelled switch leaves the list open and the record pending', async () => { /* mockResolvedValue(false) */ });
it('Keep and × keep the region and write the record', () => { /* requestRegionChange not called; outcome 'kept' */ });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/Region src/components/Banner` → FAIL.

- [ ] **Step 3: Implement** per the description; add the keys to en and run `node scripts/sync-locale-keys.mjs`.

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/components/Region src/components/Banner src/components/dev src/locales` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Region src/components/Banner/useBanners.tsx src/locales
git commit -m "feat(region): recommendation hint strip and the region list"
```

---

### Task 11: Reconcile a region's voice field — after a region change and an account change (spec D1, D2, D6)

**Files:**
- Create: `src/lib/soniox/voiceReconcile.ts`, `src/providers/soniox/voiceFieldReconcile.ts`, `src/app/sonioxVoiceAccount.ts`, tests beside each
- Modify: `src/providers/soniox/regionChange.ts` (after the write), `src/app/session.ts:314-322` (one more entry in `offs`)
- Test: `src/providers/soniox/regionChange.test.ts`

**Interfaces:**
- Consumes: `isSonioxBuiltInVoice` (Task 7); `ManagedVoicesClient.mine()`, `SonioxVoicesClient.list()`, `loadVoiceClip`; `sonioxVoiceField`, `sonioxKeyField`.
- Produces:
```ts
// lib/soniox/voiceReconcile.ts (pure)
export function reconcileSonioxVoice(stored: string, ownedVoices: readonly string[] | null, hasDeviceClip: boolean): string;
export function reconcileManagedSonioxVoice(stored: string, mine: { voiceId: string; status: string } | null | undefined, hasDeviceClip: boolean): string;
// providers/soniox/voiceFieldReconcile.ts
export interface VoiceFieldReconcileDeps {
  managedClient?(getToken: () => Promise<string | null>, region: SonioxRegion): Pick<ManagedVoicesClient, 'mine'>;
  ownKeyClient?(key: string, region: SonioxRegion): Pick<SonioxVoicesClient, 'list'>;
  hasDeviceClip?(userId: string | null | undefined): Promise<boolean>;
  online?(): boolean;
}
export function reconcileSonioxVoiceField(p: AnyProvider, region: SonioxRegion, auth: () => AuthContext | undefined, deps?: VoiceFieldReconcileDeps): Promise<void>;
// app/sonioxVoiceAccount.ts
export function watchSonioxVoiceAccount(o: { auth(): AuthContext; watchSignIn(fn: () => void): () => void; providers(): readonly AnyProvider[];
  reconcile?: typeof reconcileSonioxVoiceField }): () => void;
```
Rules. `reconcileSonioxVoice`: empty or built-in → `stored`; `ownedVoices === null` (lookup failed) → `stored`; owned (any status, processing included) → `stored`; `hasDeviceClip` → `stored`; else `SONIOX_DEFAULT_VOICE`. `reconcileManagedSonioxVoice`: `undefined` → `stored`; empty or built-in → `stored`; `mine` not `failed` and `mine.voiceId !== stored` → `mine.voiceId`; else `reconcileSonioxVoice(stored, mine ? [mine.voiceId] : [], hasDeviceClip)`. The service: entry snapshot; field = `sonioxVoiceField(region)`; nothing when empty/built-in or offline; managed (`p.kind === 'managed'`) needs `signedIn && loaded !== false`, `mine()` failure → nothing; own key needs that region's key, `list()` failure → nothing; before writing, the entry's field must still equal the snapshot and `auth()?.userId` the one the lookup started with; write through `useProviderStore.getState().updateSettings(p, { [field]: next })` (not `persistIfUnchanged`: `appShape` imports the registry). Region change: after `updateSettings`, `void reconcileSonioxVoiceField(p, to, () => auth)`. Account change: the watcher keeps the last signed-in `userId`; on a loaded sign-in with a new `userId` it loads `kizunaai_soniox`'s entry if missing and reconciles its current region; signing out forgets the last user.

- [ ] **Step 1: Write the failing tests**

```ts
it('reconcileSonioxVoice: the table', () => {
  expect(reconcileSonioxVoice('Kenji', [], false)).toBe('Kenji');                 // built-in kept
  expect(reconcileSonioxVoice('v1', ['v1'], false)).toBe('v1');                    // owned (processing too) kept
  expect(reconcileSonioxVoice('v1', [], true)).toBe('v1');                         // unknown + this account's clip: Start rebuilds
  expect(reconcileSonioxVoice('v1', [], false)).toBe('Adrian');                    // unknown, no clip
  expect(reconcileSonioxVoice('v1', null, false)).toBe('v1');                      // list error → unchanged
});
it('reconcileManagedSonioxVoice adopts the account’s own usable voice, never over a built-in', () => {
  expect(reconcileManagedSonioxVoice('stale', { voiceId: 'v-jp', status: 'ready' }, false)).toBe('v-jp');
  expect(reconcileManagedSonioxVoice('stale', { voiceId: 'v-jp', status: 'failed' }, false)).toBe('Adrian');
  expect(reconcileManagedSonioxVoice('Kenji', { voiceId: 'v-jp', status: 'ready' }, false)).toBe('Kenji');
  expect(reconcileManagedSonioxVoice('stale', undefined, false)).toBe('stale');
});
it('a region change into a stale field selects the account’s voice there; with none and no clip, the default', async () => { /* service, voiceJp 'stale' */ });
it('own key keeps an id still in list() and resets a stale one', async () => { /* … */ });
it('offline, signed out, a failed lookup or a built-in field change nothing; a built-in field is never looked up', async () => { /* … */ });
it('never overwrites a choice made during the lookup', async () => { /* user sets voiceJp 'Kenji' while mine() pending → 'Kenji' */ });
it('writes nothing when the account changed during the lookup', async () => { /* auth().userId flips before mine() resolves   (Review Focus 5) */ });
it('a confirmed region change reconciles the new region’s field', async () => { /* regionChange.test.ts, vi.mock('./voiceFieldReconcile') spy called with (p, 'jp', expect.any(Function)) */ });
it('an account change reconciles the managed field once per new user', () => {
  // watcher: user a → reconcile ×1; same a again → ×1; user b → ×2; signed out → ×2; a again → ×3; loaded: false → nothing
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/soniox/voiceReconcile.test.ts src/providers/soniox/voiceFieldReconcile.test.ts src/providers/soniox/regionChange.test.ts src/app/sonioxVoiceAccount.test.ts` → FAIL.

- [ ] **Step 3: Implement** per the rules; in `session.ts` `attach()` add `watchSonioxVoiceAccount({ auth: () => bridges.auth, watchSignIn: (fn) => { signInWatchers.add(fn); return () => { signInWatchers.delete(fn); }; }, providers: () => presentProviders() })` to `offs`.

- [ ] **Step 4: Run to verify pass** — same command plus `src/app/session.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/soniox/voiceReconcile.ts src/lib/soniox/voiceReconcile.test.ts src/providers/soniox/voiceFieldReconcile.ts src/providers/soniox/voiceFieldReconcile.test.ts src/providers/soniox/regionChange.ts src/providers/soniox/regionChange.test.ts src/app/sonioxVoiceAccount.ts src/app/sonioxVoiceAccount.test.ts src/app/session.ts
git commit -m "fix(soniox): reconcile stale custom voice ids on region and account changes"
```

---

### Task 12: The voice list reconciles on load and never shows "(deleted voice)" (spec D2, D3, D4)

**Files:**
- Modify: `src/components/Settings/sections/voiceLibrarySource.ts:43-66, 152-176` (`hasDeviceClip` on the managed source); `src/components/Settings/sections/SonioxVoiceSection.tsx:210-256, 803-845`; en catalog (remove `settings.sonioxVoiceDeletedPlaceholder`, then sync)
- Test: `src/components/Settings/sections/SonioxVoiceSection.test.tsx:402-424, 974-992, 1062-1087, 1132-1149`; `src/components/Settings/sections/voiceLibrarySource.test.ts`

**Interfaces:**
- Consumes: `reconcileSonioxVoice`, `reconcileManagedSonioxVoice` (Task 11); `isSonioxBuiltInVoice` (Task 7); `loadVoiceClip`.
- Produces: `VoiceLibrarySource.hasDeviceClip?(): Promise<boolean>` — managed: `(await loadVoiceClip(accountId)) !== null`; BYOK: absent (= false).

Behaviour: an effect on `[listState, clones, source]` — when `listState === 'idle'` and `settings.voice` is non-empty, not built-in and not among `clones`: managed → `reconcileManagedSonioxVoice(stored, clones[0] && { voiceId: clones[0].id, status: isFailed(clones[0]) ? 'failed' : 'ready' }, await source.hasDeviceClip?.() ?? false)`; BYOK → `reconcileSonioxVoice(stored, clones.map((c) => c.id), false)`; call `onUpdate({ voice: next })` only if `next !== stored`, `selectedVoiceRef.current === stored` and `sourceRef.current === source`. The unknown-id entry is pushed in every list state, labelled `t('settings.voiceCustom', 'Custom voice')`; its `removable` rule is unchanged (managed, source, list known).

- [ ] **Step 1: Write/rewrite the failing tests**

```ts
it('resets a stale id to the default once the list has loaded, and never shows "(deleted voice)"', async () => {
  listMock.mockResolvedValue([]);
  const { onUpdate } = mount({ settings: { voice: 'gone-uuid', apiKey: 'k', targetLanguage: 'ja', ttsSpeed: 1 } });
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ voice: SONIOX_DEFAULT_VOICE }));
  expect(screen.queryByText(/deleted voice/i)).toBeNull();
});
it('a retired built-in name (Maya) is reset the same way', async () => { /* … */ });
it('managed adopts the account’s own voice when the stored id is another', async () => { /* list [cloned({ id: 'mine' })], voice 'other' → onUpdate({ voice: 'mine' }) */ });
it('managed keeps an unknown id this account can rebuild from its clip; its neutral row stays deletable', async () => {
  // fakeSource({ hasDeviceClip: async () => true }) → onUpdate not called; row 'Custom voice' with a Delete button
});
it('a failed or loading list changes nothing and labels the id neutrally', async () => { /* 'Custom voice', no delete, onUpdate not called */ });
it('a pick made while the clip check runs is kept', async () => { /* … */ });
// voiceLibrarySource.test.ts
it('managed hasDeviceClip answers for this account only', async () => { /* clip saved for ACCOUNT → true; for another → false */ });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/Settings/sections/SonioxVoiceSection.test.tsx src/components/Settings/sections/voiceLibrarySource.test.ts` → FAIL.

- [ ] **Step 3: Implement** per the behaviour; delete `settings.sonioxVoiceDeletedPlaceholder` from en and run `node scripts/sync-locale-keys.mjs` (drops it everywhere).

- [ ] **Step 4: Run to verify pass** — same command plus `src/providers/soniox src/locales` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/SonioxVoiceSection.tsx src/components/Settings/sections/SonioxVoiceSection.test.tsx src/components/Settings/sections/voiceLibrarySource.ts src/components/Settings/sections/voiceLibrarySource.test.ts src/locales
git commit -m "fix(soniox): voice list reconciles stale ids instead of showing a deleted voice"
```

---

### Task 13: Start persists the default when no clip can rebuild; a clip is cleared only by its owner (spec D2, D5)

**Files:**
- Modify: `src/providers/soniox/voicePrep.ts:229-286`; `src/providers/soniox/voiceClaim.ts:54-59`; `src/lib/soniox/voiceClipStorage.ts:139-163`; `src/components/Settings/sections/voiceLibrarySource.ts:265`
- Test: `src/providers/soniox/voicePrep.test.ts:328`, `src/providers/soniox/voiceClaim.test.ts:70-86`, `src/lib/soniox/voiceClipStorage.test.ts:51-90`, `src/components/Settings/sections/voiceLibrarySource.test.ts:125`

**Interfaces:**
- Produces: `resolveVoicePrepOutcome` answers `settingsPatch: { voice: builtinFallbackVoice }` together with the notice for `clip_required` only (other failures stay per run: `settingsPatch: null`); `voiceClaim` returns `persist: patch` whenever `outcome.settingsPatch` is set, with or without a notice; `clearVoiceClip(accountId: string): Promise<void>` deletes the record only when it belongs to `accountId` (still throws on a storage failure).

- [ ] **Step 1: Write the failing tests**

```ts
it('clip_required with no clip here persists the default; the other fallbacks stay per run', () => {
  expect(resolveVoicePrepOutcome({ ok: false, reason: 'clip_required' }, 'v1', 'Adrian')).toMatchObject({ sessionVoice: 'Adrian', settingsPatch: { voice: 'Adrian' }, notice: { code: 'voice_clip_missing' } });
});
// voiceClaim.test.ts loop: clip_required → toEqual({ override: { voiceEu: 'Adrian' }, notice: …, persist: { voiceEu: 'Adrian' } }); the three others keep not.toHaveProperty('persist')
it('clearVoiceClip only removes the clip of the account deleting its voice', async () => {
  await saveVoiceClip(ACCOUNT_A, clip([1]));
  await clearVoiceClip(ACCOUNT_B); expect(await loadVoiceClip(ACCOUNT_A)).not.toBeNull();
  await clearVoiceClip(ACCOUNT_A); expect(await loadVoiceClip(ACCOUNT_A)).toBeNull();
});
// voiceLibrarySource.test.ts: managed delete by 'acct-b' leaves acct-a's clip
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/providers/soniox/voicePrep.test.ts src/providers/soniox/voiceClaim.test.ts src/lib/soniox/voiceClipStorage.test.ts src/components/Settings/sections/voiceLibrarySource.test.ts` → FAIL.

- [ ] **Step 3: Implement**; update the two docstrings that state the opposite (`resolveVoicePrepOutcome`'s "a fallback is never persisted", `clearVoiceClip`'s "Deliberately NOT account-scoped"); `managedVoiceSource.delete` calls `clearVoiceClip(accountId)`; existing `clearVoiceClip()` test calls pass `ACCOUNT_A`.

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/soniox/voicePrep.ts src/providers/soniox/voicePrep.test.ts src/providers/soniox/voiceClaim.ts src/providers/soniox/voiceClaim.test.ts src/lib/soniox/voiceClipStorage.ts src/lib/soniox/voiceClipStorage.test.ts src/components/Settings/sections/voiceLibrarySource.ts src/components/Settings/sections/voiceLibrarySource.test.ts
git commit -m "fix(soniox): persist the default voice when no clip can rebuild; clear only the owner's clip"
```

---

### Task 14: Translate the new copy into the 29 other catalogs

**Files:**
- Modify: `src/locales/*/translation.json` (all but `en`)

The `region.*` keys of Tasks 8–10 (19 keys) sit in every catalog as English placeholders. Translate each into the catalog's language; keep every `{{…}}` placeholder verbatim, keep "Soniox" untranslated, keep the meaning of the en text (a voice does not follow a region change; "Keep" = stay on the current region). `region.latencyMs` may stay `"{{ms}} ms"`.

- [ ] **Step 1: Translate** the 19 keys in the 29 catalogs.

- [ ] **Step 2: Check nothing was left in English**

Run: `node -e 'const fs=require("fs");const en=require("./src/locales/en/translation.json").region;for(const l of fs.readdirSync("src/locales")){const p="src/locales/"+l+"/translation.json";if(l==="en"||!fs.existsSync(p))continue;const r=JSON.parse(fs.readFileSync(p)).region;for(const k of Object.keys(en))if(k!=="latencyMs"&&r[k]===en[k])console.log(l,k)}'`
Expected: no output.

- [ ] **Step 3: Run the catalog tests** — `npx vitest run src/locales` → PASS (keys and placeholders in lockstep, no empty strings).

- [ ] **Step 4: Commit**

```bash
git add src/locales
git commit -m "i18n(region): translate the region recommendation and voice warning copy"
```

---

### Task 15: Whole-branch verification

- [ ] **Step 1: Full test suite** — `npx vitest run`
Expected: everything passes except the five files that already fail on `b4be845ac` in this worktree: `src/lib/reading/ja/engine.test.ts`, `src/lib/reading/ja/furigana.lindera.test.ts`, `src/lib/reading/notices.consistency.test.ts`, `src/lib/reading/ja/dictionary.test.ts`, `electron/squirrel-nuspec.consistency.test.js`.

- [ ] **Step 2: Type check** — `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: ≤ 97 (the baseline count), and `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/(lib/region|components/Region|stores/region|app/sonioxVoiceAccount|providers/soniox/(regionChange|voiceFieldReconcile)|lib/soniox/voiceReconcile)"` prints nothing.

- [ ] **Step 3: App build** — `npm run build` → exits 0.

- [ ] **Step 4: Extension build** — if `extension/node_modules` is missing in the worktree, `(cd extension && npm ci)` first; then `npm run extension:build` → exits 0, and `grep -o 'tts-rt.in.soniox.com' extension/dist/manifest.json` prints at least one match.

- [ ] **Step 5: Manual check (desktop, then the extension side panel)** — signed in on Kizuna AI Soniox, region US, from a Japan connection: ~5 s after the main screen, the brand strip says Japan is faster; "See each region's speed" lists four regions; with a custom US voice, Switch on Japan shows the voice warning; Cancel keeps US; the Advanced → Provider region drop-down shows each region's milliseconds. Report anything that differs.
