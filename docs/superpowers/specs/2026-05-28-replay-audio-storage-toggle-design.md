# Replay Audio Storage Toggle — Design

**Date:** 2026-05-28
**Status:** Draft
**Scope:** Add a new `CommonSettings.keepReplayAudio` boolean (default `false`) that gates whether each provider client stores translated audio on conversation items for the inline replay button. When `false`, real-time audio playback and karaoke highlighting are unchanged, but per-item PCM buffers (`item.formatted.audio`) and the dead `item.formatted.file` WAV blob are no longer accumulated. The inline ▶ play button is hidden in `ConversationRow` when the setting is off. Also removes the orphan `decodeAudioToWav` call site (and the now-unused utility export) — the WAV blob is generated for every completed item but never read anywhere in the codebase.

## Problem

Every AI provider client (OpenAI GA + Translate, Gemini, Volcengine AST2, Local Inference, OpenAI Translate WebRTC) accumulates raw PCM audio chunks per conversation item and merges them into `item.formatted.audio` on completion. `MainPanel.tsx:1172-1182` then generates an additional WAV blob (`item.formatted.file`) for every completed assistant item. Both live in `sessionStore.items` until the session ends or the user clears the conversation.

A 10-minute session at 24 kHz Int16 mono is ~28 MB of PCM per channel, plus a similar-size WAV. For the symmetric speaker+participant channels in long meetings this compounds quickly. PR #251 (`cb15b71e fix(subtitle): strip heavy replay fields from overlay port payload`) had to band-aid this at the chrome.runtime port boundary because a single item's payload hit 5.4 MB and total cross-process payload reached 12 MB, crashing the overlay.

The only in-app consumer of `item.formatted.audio` is the inline ▶ play button in `ConversationRow.tsx:128-150` — a rarely-used feature for replaying a single translated message. `item.formatted.file` has **zero readers** in the active codebase (grep-verified): it is generated for every completed item but never used. Export uses text only; karaoke highlighting uses the small `audioSegments`/`audioTextEnd` timing metadata, not the raw audio.

## Goals

1. New `CommonSettings.keepReplayAudio: boolean`, default `false`. UI toggle in Settings → Language section.
2. When off, provider clients skip the per-item chunk accumulation at the push site — no transient or persistent per-item buffer is held. Real-time playback still flows directly to `audioService.addAudioData()`.
3. When off, the inline ▶ play button in `ConversationRow` is hidden entirely (not rendered, not just disabled). This is a new visibility gate (`replayEnabled` prop) layered on top of the existing `canPlay` enablement gate; the two are independent.
4. When off, `item.formatted.audio` is `undefined` → the existing WAV generation block in `MainPanel.tsx:1172-1182` naturally short-circuits.
5. Independently of the toggle: remove the WAV generation block and its `decodeAudioToWav` utility (zero readers). One coherent diff: "reduce replay-related memory footprint".
6. Karaoke highlight (`audioSegments` / `audioTextEnd`) continues to populate and animate correctly regardless of the toggle — independent metadata.
7. New installs default to off. Existing installs upgrade to off (missing storage key falls back to the default). Documented in release notes.

## Non-Goals

- No change to what providers generate (audio modality is still requested from the API). `textOnly` remains the toggle for that and is independent.
- No retroactive stripping of `formatted.audio` from items already accumulated before the toggle flip. New items honor the new value; existing items keep their buffers until session end / Clear Conversation. (Simpler; avoids edge cases around currently-playing items.)
- No mid-session reactivity. Each provider client caches `this.keepReplayAudio` at session construction (mirroring how `GeminiClient.ts:316` caches `textOnly`). Toggling the setting during an active session takes effect on the **next** session, not the current one. The setting is intended as "set once and forget" — the user's stated need is the default-off behavior, not live mid-session flipping.
- No basic-mode UI surface for the toggle. SimpleConfigPanel stays focused on the six core sections per CLAUDE.md; replay storage is a niche memory toggle for advanced users.
- No removal of `ExtensionContentScriptSubtitleSurface.stripHeavyItemFields`. Stays as defense-in-depth: users who explicitly enable replay storage AND use the subtitle overlay still need the wire payload bounded.
- No new "max replay history N items" / "auto-clear after N minutes" features. YAGNI — the user asked for one binary toggle.
- No localization beyond English (the fallback). Other 35+ locales inherit the English strings until a translation pass, consistent with `textOnly`.

## Design

### Setting shape — `src/stores/settingsStore.ts`

Add the field to `CommonSettings` (line 34) and `SettingsStore` (line 357):

```ts
export interface CommonSettings {
  // ... existing fields ...
  textOnly: boolean;
  keepReplayAudio: boolean;  // NEW — default false
  // ...
}
```

Default value in `defaultCommonSettings` (line 185):

```ts
const defaultCommonSettings: CommonSettings = {
  // ... existing ...
  textOnly: false,
  keepReplayAudio: false,  // NEW
  // ...
};
```

Action (mirror `setTextOnly` at line 889 including rollback-on-error):

```ts
setKeepReplayAudio: async (keepReplayAudio) => {
  const previous = get().keepReplayAudio;
  set({ keepReplayAudio });
  try {
    await service.setSetting('settings.common.keepReplayAudio', keepReplayAudio);
  } catch (error) {
    console.error('[SettingsStore] Error persisting keepReplayAudio setting:', error);
    set({ keepReplayAudio: previous });
  }
},
```

Load in `loadSettings` (line 1454 cluster):

```ts
const keepReplayAudio = await service.getSetting(
  'settings.common.keepReplayAudio',
  defaultCommonSettings.keepReplayAudio,
);
// ... include keepReplayAudio in the set() payload at line 1491
```

Propagate to clients in `getCurrentSessionConfig()` (line 1638):

```ts
config.textOnly = state.textOnly;
config.keepReplayAudio = state.keepReplayAudio;  // NEW
```

Selectors (line 1704 cluster):

```ts
export const useKeepReplayAudio = () => useSettingsStore((s) => s.keepReplayAudio);
export const useSetKeepReplayAudio = () => useSettingsStore((s) => s.setKeepReplayAudio);
```

### Config interface — `src/services/interfaces/IClient.ts`

Add to `BaseSessionConfig` (line 40), optional so legacy tests still type-check:

```ts
export interface BaseSessionConfig {
  // ... existing ...
  textOnly?: boolean;
  /** If false (default), provider clients skip per-item audio chunk accumulation
   *  — `item.formatted.audio` stays undefined and the inline replay button is hidden. */
  keepReplayAudio?: boolean;
}
```

### Provider client gating — uniform "Approach B"

Each client caches the flag once at session start (`private keepReplayAudio: boolean = false`) from `config.keepReplayAudio ?? false`, mirroring how `GeminiClient.ts:316` caches `textOnly`. Gating point is the **chunk-push site** primarily, with a belt-and-suspenders guard at the merge site too — so neither transient nor persistent per-item buffers exist when off, and any chunks pushed before a hypothetical mid-session toggle change (which only takes effect next session anyway) are still discarded at merge.

Per-client touchpoints:

| Client | Push site | Gating change |
|---|---|---|
| `OpenAIGAClient.ts` | line 499-502 (`this.audioChunks.get(itemId)!.push(audioData)`) | Wrap push in `if (this.keepReplayAudio)`. Also wrap the merge-into-`formatted.audio` block at line 586-596 in the same guard (belt-and-suspenders). |
| `OpenAITranslateGAClient.ts` | line 353-356 (per-item push) + line 249-259 (merge) | Wrap push in `if (this.keepReplayAudio)`. Also wrap the merge assignment in the same guard. |
| `GeminiClient.ts` | line 789 (`newAudioChunks.push(...)`) + line 645, 835 (`formatted.audio = combinedAudio`) | Wrap both the per-turn `newAudioChunks.push` and the `formatted.audio = combinedAudio` assignments in `if (this.keepReplayAudio)`. |
| `VolcengineAST2Client.ts` | line 744-749 (inline merge into `formatted.audio`) | Wrap the inline merge block in `if (this.keepReplayAudio)`. |
| `LocalInferenceClient.ts` | `appendItemAudio()` line 425-435 | Gate at each call site (less invasive than threading the flag inside). Function body stays a no-op pure helper. |
| `OpenAITranslateWebRTCClient.ts` | line 181 (`assistantItem.formatted.audio = merged`) | Wrap the single assignment in `if (this.keepReplayAudio)`. |

`PalabraAIClient.remoteAudioBuffer` (line 136) is a playback ring buffer, **not** per-item replay storage — no change.

**Invariants preserved when off:**
1. `audioService.addAudioData(...)` is still called for every chunk → real-time playback unchanged.
2. `formatted.audioSegments` / `formatted.audioTextEnd` still populated → karaoke highlight still works.
3. `formatted.transcript` / `formatted.text` untouched → user-visible text unaffected.

### MainPanel changes — `src/components/MainPanel/MainPanel.tsx`

**Remove the WAV-generation block** (line 1172-1182):

```ts
// DELETE:
if (item.status === 'completed' && item.formatted?.audio) {
  const wavFile = await decodeAudioToWav(item.formatted.audio as Int16Array, 24000, 24000);
  if (item.formatted) {
    item.formatted.file = wavFile;
  }
}
```

Prune the now-unused import at line 60:

```ts
// BEFORE:
import { getSafeAudioConfiguration, decodeAudioToWav } from '../../utils/audioUtils';
// AFTER:
import { getSafeAudioConfiguration } from '../../utils/audioUtils';
```

**Also remove the dead utility export** in `src/utils/audioUtils.ts:387` (`decodeAudioToWav`). Grep confirms it had exactly one caller, the one we're deleting. Keeping it as an unused export is rot.

**`handlePlayAudio` (line 2160-2240)**: no change. The existing early return at line 2171 (`if (!item.formatted?.audio)`) naturally handles the off case.

**Thread `keepReplayAudio` into the ConversationRow render**:

The render path is `MainPanel.tsx:3179 <ConversationBubble>` → `ConversationBubble` (defined at `MainPanel.tsx:115`, props destructured at line 115-125) → `<ConversationRow>` at `MainPanel.tsx:150-162`.

1. Read the setting once inside MainPanel (near where `canPlay` is computed at line 3172-3176) — call `useKeepReplayAudio()` at the top of the MainPanel component body, store in a local `replayEnabled`.
2. Pass `replayEnabled={replayEnabled}` to `<ConversationBubble>` at line 3179-3192.
3. Add `replayEnabled` to `ConversationBubble`'s props destructure (line 115-125) and forward it to `<ConversationRow>` at line 150-162 as `replayEnabled={replayEnabled}`.

The existing `canPlay` computation (line 3174-3176) — `canPlay = (completed|incomplete) && audioSize > 0` — keeps working unchanged: when `keepReplayAudio` is off, no audio is stored, so `audioSize` is always 0 and `canPlay` would be false anyway. `replayEnabled` is the separate visibility gate (hides the slot entirely); `canPlay` remains the enablement gate (controls disabled/enabled state when the slot is shown).

### ConversationRow changes — `src/components/MainPanel/ConversationRow.tsx`

Add the prop:

```ts
interface ConversationRowProps {
  // ... existing ...
  canPlay?: boolean;
  onPlay?: () => void;
  playDisabled?: boolean;
  replayEnabled?: boolean;  // NEW
  compact?: boolean;
}
```

Gate the button render (line 128):

```tsx
{!compact && onPlay && replayEnabled && isTranslation && source === 'speaker' && (
  <button
    type="button"
    className={`row-play-btn ${isPlaying ? 'playing' : ''}`}
    onClick={canPlay ? onPlay : undefined}
    disabled={!canPlay || playDisabled}
    aria-label={t('mainPanel.playItemAudio', "Play this item's audio")}
    title={t('mainPanel.playItemAudio', "Play this item's audio")}
  >
    <Play size={10} />
  </button>
)}
```

**Layout note**: The existing comment at line 128-139 explaining why the slot stays even when `canPlay=false` (to avoid text re-wrap on completion) becomes obsolete for the off case: when `replayEnabled=false` the slot is absent for the *entire session*, so layout is static. Update the comment to reflect both cases.

### Settings UI — `src/components/Settings/sections/LanguageSection.tsx`

Add the hook calls near the existing `useTextOnly` block (line 83):

```ts
const keepReplayAudio = useKeepReplayAudio();
const setKeepReplayAudio = useSetKeepReplayAudio();
```

Add the checkbox directly below the `textOnly` checkbox (line 512-520), unconditionally rendered (no provider-capability gate — applies to every provider):

```tsx
<Checkbox
  checked={keepReplayAudio}
  onChange={() => setKeepReplayAudio(!keepReplayAudio)}
  label={t('simpleConfig.keepReplayAudio', 'Keep audio for replay')}
  tooltip={t(
    'simpleConfig.keepReplayAudioDesc',
    'Store translated audio in memory so you can replay it later from each message. Off by default to reduce memory use during long sessions.'
  )}
/>
```

`textOnly` and `keepReplayAudio` are shown side-by-side independently. When `textOnly=true`, no audio is generated so `keepReplayAudio` is moot — but we don't grey it out. Both toggles can be flipped in either order; the user can reason about the relationship.

### i18n keys

Add to `src/locales/en/translation.json` (the English fallback). Other 35+ locales (`ar`, `bn`, `de`, `es`, `fa`, `fi`, `fil`, `fr`, `he`, `hi`, `id`, `it`, `ja`, `ko`, `ms`, `nl`, `pl`, `pt_BR`, `pt_PT`, `ru`, `sv`, `ta`, `te`, `th`, `tr`, `uk`, `vi`, `zh_CN`, `zh_TW`) inherit until translated, consistent with how `textOnly` strings ship. Under the `simpleConfig` namespace:

```json
{
  "simpleConfig": {
    "keepReplayAudio": "Keep audio for replay",
    "keepReplayAudioDesc": "Store translated audio in memory so you can replay it later from each message. Off by default to reduce memory use during long sessions."
  }
}
```

### Persistence / migration

| Scenario | Stored value | Loaded value | Result |
|---|---|---|---|
| New install | (missing) | `false` (default) | Off — matches intent |
| Existing user upgrades | (missing — key didn't exist before) | `false` (default) | Off — matches intent |
| User explicitly turned on, then upgrades | `true` | `true` | Stays on |
| User explicitly turned off, then upgrades | `false` | `false` | Stays off |

Release notes line (single user-facing regression for the small set who relied on the replay button):

> Replay storage is now off by default to reduce memory use during long sessions. Re-enable in Settings → Language → "Keep audio for replay".

## Testing

### Store — `src/stores/settingsStore.test.ts`

Mirror existing `textOnly` cases:
- Default value: fresh store has `keepReplayAudio === false`.
- `setKeepReplayAudio(true)` updates state AND writes `settings.common.keepReplayAudio` to the settings service.
- Rollback on persistence failure: if `service.setSetting` rejects, state rolls back to previous value (mirror line 889-897 pattern).
- `getCurrentSessionConfig()` includes `keepReplayAudio: <store value>` in every provider branch.
- Loaded from storage: when key present (`true`/`false`), state reflects it; when missing, defaults to `false`.

### Provider clients — add cases to existing test files

`GeminiClient.test.ts`, `OpenAITranslateGAClient.test.ts`, `VolcengineAST2Client.test.ts`:

For each:
- **With `keepReplayAudio: true`** — feed N audio deltas + completion → `item.formatted.audio` is an `Int16Array` of expected total length.
- **With `keepReplayAudio: false`** — same input → `item.formatted.audio` is `undefined`. Assert `audioService.addAudioData` (or mock equivalent) was still called for every chunk.
- **`audioSegments` / `audioTextEnd` still populated when off** — independent of replay storage.

For `OpenAIGAClient`, `LocalInferenceClient`, `OpenAITranslateWebRTCClient` (no existing test files): rely on store-test config-propagation coverage + code review + manual smoke. Do not scaffold new test infrastructure (YAGNI).

### ConversationRow — `ConversationRow.test.tsx`

Add cases:
- Button is **not rendered** when `replayEnabled={false}` (even with `isTranslation=true`, `source='speaker'`, `canPlay=true`, `onPlay` provided).
- Button is rendered when `replayEnabled={true}` (existing assertions stay; just default the new prop to `true` in existing tests so they don't break).

### Subtitle overlay — `ExtensionContentScriptSubtitleSurface.test.ts`

No test changes. The `stripHeavyItemFields` test stays as-is. Update the doc comment at line 46-65 to reflect that `formatted.audio` is now usually absent (only present when the user explicitly enables `keepReplayAudio`); the strip remains belt-and-suspenders for that case.

### Manual smoke checklist (for PR description)

1. New install → toggle off; no ▶ buttons; real-time audio plays; karaoke highlight animates during streaming.
2. Toggle on → next completed item has a working ▶ button; clicking replays.
3. Toggle off mid-session → next completed item has no ▶ button; previously-buffered items keep theirs until cleared.
4. `textOnly` on AND `keepReplayAudio` on → no audio generated, no ▶ buttons (because `formatted.audio` stays empty).
5. Subtitle overlay with `keepReplayAudio` on → wire payload still bounded (strip still runs).
6. Long session (10+ min) memory check via DevTools Memory profiler → noticeably lower retained `sessionStore.items` size with toggle off vs on.

## Files Changed

**Created:** (none — all changes are edits to existing files)

**Modified:**
- `src/stores/settingsStore.ts` — add field, default, action, selector, loader, config propagation
- `src/services/interfaces/IClient.ts` — add `keepReplayAudio?` to `BaseSessionConfig`
- `src/services/clients/OpenAIGAClient.ts` — gate chunk push
- `src/services/clients/OpenAITranslateGAClient.ts` — gate chunk push
- `src/services/clients/OpenAITranslateWebRTCClient.ts` — gate single assignment
- `src/services/clients/GeminiClient.ts` — gate chunk push + assignments
- `src/services/clients/VolcengineAST2Client.ts` — gate inline merge
- `src/services/clients/LocalInferenceClient.ts` — gate `appendItemAudio()` call sites
- `src/components/MainPanel/MainPanel.tsx` — delete WAV-generation block, prune import, thread `replayEnabled` prop
- `src/components/MainPanel/ConversationRow.tsx` — add `replayEnabled` prop, gate button render, update comment
- `src/components/Settings/sections/LanguageSection.tsx` — add checkbox + hooks
- `src/utils/audioUtils.ts` — remove `decodeAudioToWav` export (now zero callers)
- `src/locales/en/translation.json` — two new i18n keys under `simpleConfig`
- Test files: `settingsStore.test.ts`, `GeminiClient.test.ts`, `OpenAITranslateGAClient.test.ts`, `VolcengineAST2Client.test.ts`, `ConversationRow.test.tsx`

**Removed:** (none — only the dead code block and utility export listed above)
