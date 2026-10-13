# Local inference speaks the other side's translation (#619) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With local inference, Translation I hear gets a TTS slot and a voice of its own, and a leg that should speak but cannot says so instead of going silent.

**Architecture:** Voices move from two shared fields into a per-direction table (`voices[dir]`) read through one accessor. The build records why a speaking leg has no TTS (`ttsUnavailable`). `admit` gains a third answer that drops only the participant's TTS when it alone tips the memory budget. The adapter turns `ttsUnavailable` into one `degraded` warning per leg, whose click opens that direction's TTS slot. The engine page, the Settings chips, the Library and the Speech block's voice line then show the participant direction's TTS while that leg speaks.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest + Testing Library, i18next (30 catalogs).

**Spec:** `docs/superpowers/specs/2026-10-12-local-inference-participant-tts-design.md` (approved 2026-10-12). Read it before starting; this plan argues from it.

## Global Constraints

- Code, comments, tests and commit messages in English; conventional commits; every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No one-time migration code: `edgeTtsVoice`/`ttsSpeakerId` simply leave `LOCAL_INFERENCE_DEFAULTS`; each user's local-inference voice resets once to the default (stated departure).
- Local inference has no `settings.migrate`; stored values pass through, so `voices` is only ever read through `directionVoice` (a field of the wrong kind reads as absent; nothing is written back).
- `ttsSpeed` stays one shared value. Speaker id default: `ttsConfig.defaultSid` (Supertonic 7), else 0.
- Warning codes (severity warning): `speaker_tts_missing`, `participant_tts_missing`, `participant_tts_over_budget`; English words exactly:
  - `speaker_tts_missing`: "Translation the other side hears is text only: no speech model speaks {{target}}."
  - `participant_tts_missing`: "Translation I hear is text only: no speech model speaks {{target}}."
  - `participant_tts_over_budget`: "Translation I hear is text only: not enough memory to load the other side's speech model too."
- zh_CN words exactly: 「对方听到的翻译只显示文字：没有能说{{target}}的语音模型。」「我听到的翻译只显示文字：没有能说{{target}}的语音模型。」「我听到的翻译只显示文字：内存不够同时加载对方的语音模型。」
- Start is never blocked by a missing TTS; over budget with ASR + translation alone still refuses with `memory_exceeded`.
- Every caught failure is recorded with `reportError`/`reportWarning`, never `console.error`/`console.warn` (CLAUDE.md, Error Handling); adapters only `emit`.
- Settings UI follows the existing control dialect (28px controls, 13px #ccc labels); reuse sibling markup, add no new styles unless a render shows a need.
- Out of scope: per-direction speed, a speaker id per model, Local Native (#578).
- Type-check baseline: `npx tsc --noEmit -p .` reports 93 errors on main; the branch must report the same 93 (compare sorted lists, not counts).

## Review Focus

1. A pair swap (ja→en becomes en→ja) keeps both voices: each direction's entry stays under its own key, so the user who set a Japanese voice for one direction and an English one for the other finds both again. Pinned in Task 9 (SettingsInitializer writes nothing after a swap when both stored voices are valid).
2. The participant direction resolving to Edge while Translation I hear is off: nothing writes its entry. Pinned in Task 9.
3. Over budget where the participant's TTS is a cloud model (Edge): dropping it frees nothing, so the run is refused, not started text only. Pinned in Task 5.
4. Deleting an imported Supertonic voice that the other direction uses: that direction falls back to the model default too, not only the one the Library was opened for. Pinned in Task 8.
5. A warning clicked after the pair changed opens the current pair's direction for that leg, not a stale one; under a provider with no engine it opens the Provider tab and leaves no slot target behind. Pinned in Task 6.

---

### Task 1: The per-direction voice table and its helpers

**Files:**
- Create: `src/providers/localInference/voices.ts`
- Create: `src/providers/localInference/voices.test.ts`
- Modify: `src/providers/localInference/settings.ts:16-58`
- Modify: `src/lib/edge-tts/voiceList.ts:88-99`
- Create: `src/lib/edge-tts/voiceList.test.ts`

**Interfaces:**
- Produces: `interface DirectionVoice { edge?: string; speaker?: number }` (exported from `settings.ts`); `LocalInferenceSettings.voices: Record<string, DirectionVoice>` (default `{}`); from `voices.ts`: `directionVoice(voices: LocalInferenceSettings['voices'], dir: string): DirectionVoice`, `speakerIdFor(voice: DirectionVoice, modelId: string): number`, `withDirectionVoice(voices: LocalInferenceSettings['voices'], dir: string, patch: DirectionVoice): Pick<LocalInferenceSettings, 'voices'>`; from `voiceList.ts`: `voiceNameFromShortName(shortName: string): string`.
- `edgeTtsVoice` and `ttsSpeakerId` stay in `LocalInferenceSettings` until Task 9 so every intermediate commit compiles.

- [ ] **Step 1: Write the failing tests**

`src/providers/localInference/voices.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { directionVoice, speakerIdFor, withDirectionVoice } from './voices';
import type { LocalInferenceSettings } from './settings';

const table = (v: unknown) => v as LocalInferenceSettings['voices'];

describe('directionVoice', () => {
  it("reads a direction's Edge voice and speaker id", () => {
    expect(directionVoice(table({ 'ja→en': { edge: 'en-US-AvaNeural', speaker: 3 } }), 'ja→en')).toEqual({ edge: 'en-US-AvaNeural', speaker: 3 });
  });

  it('reads another direction as nothing set', () => {
    expect(directionVoice(table({ 'ja→en': { edge: 'en-US-AvaNeural' } }), 'en→ja')).toEqual({});
  });

  it('reads a field of the wrong kind as absent, keeping the other', () => {
    expect(directionVoice(table({ d: { edge: 5, speaker: 2 } }), 'd')).toEqual({ speaker: 2 });
    expect(directionVoice(table({ d: { edge: '', speaker: 'x' } }), 'd')).toEqual({});
    expect(directionVoice(table({ d: { edge: 'v', speaker: Number.NaN } }), 'd')).toEqual({ edge: 'v' });
  });

  it('reads a stored table that is not one as nothing set', () => {
    for (const stored of [null, undefined, 'x', 7, [], { d: 'voice' }]) {
      expect(directionVoice(table(stored), 'd'), JSON.stringify(stored)).toEqual({});
    }
  });
});

describe('speakerIdFor', () => {
  it("uses the direction's own speaker id", () => {
    expect(speakerIdFor({ speaker: 4 }, 'supertonic-3')).toBe(4);
  });

  it("falls back to the model's default speaker, Supertonic's 7", () => {
    expect(speakerIdFor({}, 'supertonic-3')).toBe(7);
  });

  it('falls back to 0 for a model with no default, or an unknown one', () => {
    expect(speakerIdFor({}, 'piper-cy-bu_tts-medium')).toBe(0);
    expect(speakerIdFor({}, 'no-such-model')).toBe(0);
  });
});

describe('withDirectionVoice', () => {
  it("writes one direction's field, keeping its other field and every other direction", () => {
    const voices = table({ 'ja→en': { edge: 'en-US-AvaNeural', speaker: 3 }, 'en→ja': { speaker: 5 } });
    expect(withDirectionVoice(voices, 'ja→en', { edge: 'en-US-GuyNeural' })).toEqual({
      voices: { 'ja→en': { edge: 'en-US-GuyNeural', speaker: 3 }, 'en→ja': { speaker: 5 } },
    });
  });

  it('starts a fresh table over a stored value that is not one', () => {
    expect(withDirectionVoice(table('x'), 'd', { speaker: 1 })).toEqual({ voices: { d: { speaker: 1 } } });
  });
});
```

`src/lib/edge-tts/voiceList.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Voice } from './edgeTts';
import { getVoiceDisplayName, voiceNameFromShortName } from './voiceList';

describe('voiceNameFromShortName', () => {
  it('names a voice from its ShortName, without locale or the Neural suffix', () => {
    expect(voiceNameFromShortName('zh-CN-XiaoxiaoNeural')).toBe('Xiaoxiao');
    expect(voiceNameFromShortName('en-US-AvaMultilingualNeural')).toBe('Ava Multilingual');
  });
});

describe('getVoiceDisplayName', () => {
  it('adds the gender and locale to that name', () => {
    expect(getVoiceDisplayName({ ShortName: 'zh-HK-HiuGaaiNeural', Gender: 'Female', Locale: 'zh-HK' } as Voice)).toBe('Hiu Gaai (Female, zh-HK)');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/providers/localInference/voices.test.ts src/lib/edge-tts/voiceList.test.ts`
Expected: FAIL — `./voices` does not exist; `voiceNameFromShortName` is not exported.

- [ ] **Step 3: Implement**

In `src/providers/localInference/settings.ts`, add above `LocalInferenceSettings`:

```ts
/** One direction's voice (#619): an Edge TTS voice ShortName, and a speaker id for Supertonic and the multi-speaker local models. */
export interface DirectionVoice {
  edge?: string;
  speaker?: number;
}
```

and in `LocalInferenceSettings`, after `selections`:

```ts
  /**
   * Each direction's voice, keyed `src→tgt` like `selections` (#619). Stored
   * values pass through unvalidated (no `migrate`): read it through
   * `directionVoice`, never directly.
   */
  voices: Record<string, DirectionVoice>;
```

and in `LOCAL_INFERENCE_DEFAULTS`, after `selections: {},`: `voices: {},`.

`src/providers/localInference/voices.ts`:

```ts
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import type { DirectionVoice, LocalInferenceSettings } from './settings';

/**
 * A direction's stored voice, read field by field (#619). Local inference has
 * no `migrate`, so `voices` holds whatever was stored: a table that is not an
 * object, an entry that is not one, or a field of the wrong kind reads as
 * absent. Nothing is converted or written back.
 */
export function directionVoice(voices: LocalInferenceSettings['voices'], dir: string): DirectionVoice {
  // An array is an object too, and never a table of directions.
  const entry: unknown = voices && typeof voices === 'object' && !Array.isArray(voices) ? voices[dir] : undefined;
  if (!entry || typeof entry !== 'object') return {};
  const { edge, speaker } = entry as Record<string, unknown>;
  return {
    ...(typeof edge === 'string' && edge !== '' ? { edge } : {}),
    ...(typeof speaker === 'number' && Number.isFinite(speaker) ? { speaker } : {}),
  };
}

/** The speaker id a run uses: the direction's own, else the model's default (`ttsConfig.defaultSid`, Supertonic's 7), else 0. */
export function speakerIdFor(voice: DirectionVoice, modelId: string): number {
  return voice.speaker ?? getManifestEntry(modelId)?.ttsConfig?.defaultSid ?? 0;
}

/** The settings patch writing `patch` into one direction's entry; its other field and every other direction's entry stay as stored. */
export function withDirectionVoice(voices: LocalInferenceSettings['voices'], dir: string, patch: DirectionVoice): Pick<LocalInferenceSettings, 'voices'> {
  const table = voices && typeof voices === 'object' && !Array.isArray(voices) ? voices : {};
  return { voices: { ...table, [dir]: { ...directionVoice(table, dir), ...patch } } };
}
```

In `src/lib/edge-tts/voiceList.ts`, replace `getVoiceDisplayName` with:

```ts
/**
 * A voice's own name from its ShortName: "zh-CN-XiaoxiaoNeural" → "Xiaoxiao",
 * "en-US-AvaMultilingualNeural" → "Ava Multilingual". Needs no voice list.
 */
export function voiceNameFromShortName(shortName: string): string {
  return shortName.split('-').slice(2).join('-').replace(/Neural$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * Get a display-friendly name for a voice.
 * E.g. "zh-HK-HiuGaaiNeural" → "Hiu Gaai (Female, zh-HK)"
 * The locale suffix is included so users can distinguish regional variants
 * (e.g. Mandarin `zh-CN` vs Cantonese `zh-HK` vs Taiwanese `zh-TW`).
 */
export function getVoiceDisplayName(voice: Voice): string {
  return `${voiceNameFromShortName(voice.ShortName)} (${voice.Gender}, ${voice.Locale})`;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/providers/localInference src/lib/edge-tts`
Expected: PASS (the existing local-inference tests are unaffected: `voices` only adds a default).

- [ ] **Step 5: Commit**

```bash
git add src/providers/localInference/voices.ts src/providers/localInference/voices.test.ts src/providers/localInference/settings.ts src/lib/edge-tts/voiceList.ts src/lib/edge-tts/voiceList.test.ts
git commit -m "feat(local-inference): a voice per direction, read through one accessor"
```

---

### Task 2: `degraded` carries notice params through L1

**Files:**
- Modify: `src/lib/contract/adapter.ts:99-105`
- Modify: `src/lib/conversation/Conversation.ts:95-99`
- Test: `src/lib/conversation/Conversation.test.ts` (in `describe('Conversation — notices and closing')`, after the first test)

**Interfaces:**
- Produces: `AdapterEvents.degraded(e: { code: ClientDiagnosticCode; message: string; cause?: unknown; reason?: string; params?: Record<string, string | number> })`; L1 copies `params` into the notice it records.

- [ ] **Step 1: Write the failing test**

```ts
  it("carries a degraded event's params into its notice, and records none without them", () => {
    const { conv, apply } = make();
    apply({ kind: 'degraded', payload: { code: 'tts_degraded', message: 'no voice', params: { target: 'ja' } } });
    apply({ kind: 'degraded', payload: { code: 'parse_error', message: 'bad frame' } });
    const [withParams, without] = conv.snapshot().notices;
    expect(withParams).toMatchObject({ code: 'tts_degraded', params: { target: 'ja' } });
    expect(without).not.toHaveProperty('params');
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/conversation/Conversation.test.ts -t "carries a degraded"`
Expected: FAIL — the first notice has no `params`.

- [ ] **Step 3: Implement**

In `src/lib/contract/adapter.ts`, the `degraded` member becomes:

```ts
  /**
   * Running, degraded. `reason`: a short machine-readable token for
   * analytics only (`tts_408`, `tts_connect_failed`) — never user text,
   * never the cause; absent, the runner's `api_error` reads `code`
   * (Stage 2 Kizuna Soniox, ruling 8). `params`: the values the notice's
   * words name (`{{target}}`), which L1 records on the notice.
   */
  degraded(e: { code: ClientDiagnosticCode; message: string; cause?: unknown; reason?: string; params?: Record<string, string | number> }): void;
```

In `src/lib/conversation/Conversation.ts`, the `degraded` case becomes:

```ts
      case 'degraded': {
        const { code, message, params } = event.payload;
        if (!this.admitDegraded(code)) return;
        return this.addNotice({ severity: CLIENT_DIAGNOSTICS[code]?.severity ?? 'warning', message, code, ...(params ? { params } : {}) });
      }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/conversation src/lib/contract`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/contract/adapter.ts src/lib/conversation/Conversation.ts src/lib/conversation/Conversation.test.ts
git commit -m "feat(contract): a degraded event carries the params its notice names"
```

---

### Task 3: `admit` may answer with adjusted configs

**Files:**
- Modify: `src/lib/session/types.ts:98-103`
- Modify: `src/lib/session/run.ts:180-189`
- Test: `src/lib/session/runner.hooks.test.ts` (in `describe('runner — admit')`)

**Interfaces:**
- Produces: `export interface AdmittedConfigs<C> { configs: Partial<Record<LegName, C>> }` in `src/lib/session/types.ts`; `SessionHooks.admit?(configs: Partial<Record<LegName, C>>): true | ProviderRefusal | AdmittedConfigs<C>`. The runner starts each leg it runs with `admitted.configs[leg]` when present, else the built config; the legs never change.

- [ ] **Step 1: Write the failing test**

Add to `describe('runner — admit')`:

```ts
  it('starts each leg admit answers for with its config in place of the one built, the other leg as built', async () => {
    const started: Array<{ source: string; script: unknown }> = [];
    const start: AnyProvider['start'] = (request, events) => {
      started.push({ source: request.context.direction.source, script: (request.config as { script: unknown }).script });
      return fakeProvider.start(request as never, events);
    };
    const admit = (configs: Partial<Record<LegName, unknown>>) => ({ configs: { participant: { ...(configs.participant as object), script: 'cjk' } } });
    const { runner } = setup(withHooks({ admit }, { start }), ['speaker', 'participant']);
    await runner.start();
    // The pair is en → ja: the speaker leg's source is en, the participant's ja.
    expect(started).toEqual(expect.arrayContaining([{ source: 'en', script: 'exchange' }, { source: 'ja', script: 'cjk' }]));
    expect(started).toHaveLength(2);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/session/runner.hooks.test.ts -t "admit answers for"`
Expected: FAIL — the runner treats the `{ configs }` answer as a refusal (`lastEnd.reason: 'refused'`), so nothing starts.

- [ ] **Step 3: Implement**

In `src/lib/session/types.ts`, above `SessionHooks`:

```ts
/** `admit`'s third answer (#619): start, running these legs' configs in place of the ones built. The legs stay as built. */
export interface AdmittedConfigs<C> {
  configs: Partial<Record<LegName, C>>;
}
```

and the `admit` member:

```ts
  /** Cross-leg checks over the configs actually built: run them, refuse, or run some legs on adjusted configs. */
  admit?(configs: Partial<Record<LegName, C>>): true | ProviderRefusal | AdmittedConfigs<C>;
```

In `src/lib/session/run.ts`, the admit block becomes:

```ts
    if (p.session?.admit) {
      const admitted = p.session.admit(configs);
      if (admitted !== true && 'refused' in admitted) {
        throw new RefusedError({
          code: admitted.code ?? ('admit_refused' satisfies RunNoticeCode),
          message: admitted.refused,
          ...(admitted.params ? { params: admitted.params } : {}),
        });
      }
      // The third answer (#619): a leg it names runs that config instead; the legs stay as built.
      if (admitted !== true && 'configs' in admitted) {
        for (const leg of shape.legs) {
          const adjusted = admitted.configs[leg];
          if (adjusted) configs[leg] = adjusted;
        }
      }
    }
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run src/lib/session`
Expected: PASS.
Run: `npx tsc --noEmit -p . 2>&1 | grep -E "session/(run|types)\.ts"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session/types.ts src/lib/session/run.ts src/lib/session/runner.hooks.test.ts
git commit -m "feat(session): admit may start legs on adjusted configs"
```

---

### Task 4: The three warning codes, worded in all 30 catalogs

**Files:**
- Modify: `src/lib/diagnostics/clientDiagnostics.ts:26-45`
- Modify: `src/lib/view/noticeText.ts:66-73`
- Modify: `src/locales/*/translation.json` (30 files, `notices`)
- Test: `src/lib/view/noticeText.test.ts`, `src/locales/locales.consistency.test.ts`

**Interfaces:**
- Produces: `ClientDiagnosticCode` gains `'speaker_tts_missing' | 'participant_tts_missing' | 'participant_tts_over_budget'` (severity warning); `NOTICE_WORDS` and `notices.<code>` in every catalog.

- [ ] **Step 1: Write the failing tests**

In `src/lib/view/noticeText.test.ts`, after `"puts the local engines' notices into words"`:

```ts
  it("words local inference's text-only warnings, naming the target language as every language menu does (#619)", () => {
    expect(noticeText(t, { code: 'speaker_tts_missing', params: { target: 'ja' }, message: 'x' }))
      .toBe(`notices.speaker_tts_missing|Translation the other side hears is text only: no speech model speaks ${languageLabel('ja', i18next.language)}.`);
    expect(noticeText(t, { code: 'participant_tts_missing', params: { target: 'en' }, message: 'x' }))
      .toBe(`notices.participant_tts_missing|Translation I hear is text only: no speech model speaks ${languageLabel('en', i18next.language)}.`);
    expect(noticeText(t, { code: 'participant_tts_over_budget', message: 'x' }))
      .toBe("notices.participant_tts_over_budget|Translation I hear is text only: not enough memory to load the other side's speech model too.");
  });
```

(If `i18next` is not yet imported in this test file, add `import i18next from 'i18next';`.)

In `src/locales/locales.consistency.test.ts`, after the `notices that name a button` describe:

```ts
describe("the text-only warnings name the row they are about, as that locale labels it (#619)", () => {
  const ROWS: Record<string, string> = {
    'notices.speaker_tts_missing': 'audioPanel.otherHears',
    'notices.participant_tts_missing': 'audioPanel.iHear',
    'notices.participant_tts_over_budget': 'audioPanel.iHear',
  };

  it.each(Object.entries(ROWS))('%s names %s in every locale', (key, rowKey) => {
    const offenders: string[] = [];
    for (const [lang, cat] of [['en', EN] as const, ...locales]) {
      const row = cat[rowKey];
      const notice = cat[key];
      if (typeof row !== 'string' || typeof notice !== 'string') continue; // key-parity is another test's job
      if (!notice.toLocaleLowerCase().includes(row.toLocaleLowerCase())) offenders.push(`${lang}: ${JSON.stringify(notice)} omits ${JSON.stringify(row)}`);
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/view/noticeText.test.ts src/locales/locales.consistency.test.ts`
Expected: FAIL — no words for the three codes; the new describe finds no keys (it skips missing keys, so it passes; the noticeText test fails).

- [ ] **Step 3: Implement**

In `src/lib/diagnostics/clientDiagnostics.ts`, append to `CLIENT_DIAGNOSTICS`:

```ts
  /** Local inference: Translation the other side hears is text only, no speech model speaking its language (#619). */
  speaker_tts_missing: { severity: 'warning' },
  /** Local inference: Translation I hear is text only, no speech model speaking my language (#619). */
  participant_tts_missing: { severity: 'warning' },
  /** Local inference: Translation I hear is text only, its speech model dropped to fit the memory budget (#619). */
  participant_tts_over_budget: { severity: 'warning' },
```

In `src/lib/view/noticeText.ts`, after `translation_unavailable` in `NOTICE_WORDS`:

```ts
  // A leg that should speak but cannot (#619).
  speaker_tts_missing: 'Translation the other side hears is text only: no speech model speaks {{target}}.',
  participant_tts_missing: 'Translation I hear is text only: no speech model speaks {{target}}.',
  participant_tts_over_budget: "Translation I hear is text only: not enough memory to load the other side's speech model too.",
```

Then add the catalog entries with this script. Save it OUTSIDE the repository (for example `$CLAUDE_JOB_DIR/tmp/add-tts-notices.mjs`) and run `node <that path> src/locales`. A JSON round trip of every catalog was checked to be byte-identical, so the script only appends three keys at the end of `notices`.

```js
import { readFileSync, writeFileSync } from 'node:fs';

const W = {
  ar: ['الترجمة التي يسمعها الطرف الآخر نص فقط: لا يوجد نموذج صوتي يتحدث {{target}}.', 'الترجمة التي أسمعها نص فقط: لا يوجد نموذج صوتي يتحدث {{target}}.', 'الترجمة التي أسمعها نص فقط: الذاكرة لا تكفي لتحميل النموذج الصوتي للطرف الآخر أيضًا.'],
  bn: ['অপর পক্ষ যে অনুবাদ শোনে তা শুধু লেখায় দেখানো হচ্ছে: কোনো বাক মডেল {{target}} বলতে পারে না।', 'আমি যে অনুবাদ শুনি তা শুধু লেখায় দেখানো হচ্ছে: কোনো বাক মডেল {{target}} বলতে পারে না।', 'আমি যে অনুবাদ শুনি তা শুধু লেখায় দেখানো হচ্ছে: অপর পক্ষের বাক মডেলও লোড করার মতো যথেষ্ট মেমরি নেই।'],
  de: ['Übersetzung, die das Gegenüber hört, erscheint nur als Text: Kein Sprachausgabemodell spricht {{target}}.', 'Übersetzung, die ich höre, erscheint nur als Text: Kein Sprachausgabemodell spricht {{target}}.', 'Übersetzung, die ich höre, erscheint nur als Text: Nicht genug Speicher, um auch das Sprachausgabemodell der Gegenseite zu laden.'],
  en: ['Translation the other side hears is text only: no speech model speaks {{target}}.', 'Translation I hear is text only: no speech model speaks {{target}}.', "Translation I hear is text only: not enough memory to load the other side's speech model too."],
  es: ['La traducción que oye la otra parte se muestra solo como texto: ningún modelo de voz habla {{target}}.', 'La traducción que yo oigo se muestra solo como texto: ningún modelo de voz habla {{target}}.', 'La traducción que yo oigo se muestra solo como texto: no hay memoria suficiente para cargar también el modelo de voz de la otra parte.'],
  fa: ['ترجمه‌ای که طرف مقابل می‌شنود فقط به‌صورت متن است: هیچ مدل گفتاری به زبان {{target}} صحبت نمی‌کند.', 'ترجمه‌ای که من می‌شنوم فقط به‌صورت متن است: هیچ مدل گفتاری به زبان {{target}} صحبت نمی‌کند.', 'ترجمه‌ای که من می‌شنوم فقط به‌صورت متن است: حافظه برای بارگذاری مدل گفتاری طرف مقابل هم کافی نیست.'],
  fi: ['Käännös, jonka toinen osapuoli kuulee, näkyy vain tekstinä: mikään puhemalli ei puhu kieltä {{target}}.', 'Käännös, jonka kuulen, näkyy vain tekstinä: mikään puhemalli ei puhu kieltä {{target}}.', 'Käännös, jonka kuulen, näkyy vain tekstinä: muisti ei riitä lataamaan myös toisen osapuolen puhemallia.'],
  fil: ['Teksto lang ang salin na naririnig ng kabilang panig: walang modelo ng pananalita na nagsasalita ng {{target}}.', 'Teksto lang ang salin na naririnig ko: walang modelo ng pananalita na nagsasalita ng {{target}}.', 'Teksto lang ang salin na naririnig ko: kulang ang memory para i-load din ang modelo ng pananalita ng kabilang panig.'],
  fr: ["La traduction entendue par l'autre s'affiche en texte seul : aucun modèle vocal ne parle {{target}}.", "La traduction que j'entends s'affiche en texte seul : aucun modèle vocal ne parle {{target}}.", "La traduction que j'entends s'affiche en texte seul : pas assez de mémoire pour charger aussi le modèle vocal de l'autre."],
  he: ['התרגום שהצד השני שומע מוצג כטקסט בלבד: אין מודל דיבור שמדבר {{target}}.', 'התרגום שאני שומע מוצג כטקסט בלבד: אין מודל דיבור שמדבר {{target}}.', 'התרגום שאני שומע מוצג כטקסט בלבד: אין מספיק זיכרון כדי לטעון גם את מודל הדיבור של הצד השני.'],
  hi: ['सामने वाले को सुनाई देने वाला अनुवाद केवल टेक्स्ट में है: कोई वाक् मॉडल {{target}} नहीं बोलता।', 'मुझे सुनाई देने वाला अनुवाद केवल टेक्स्ट में है: कोई वाक् मॉडल {{target}} नहीं बोलता।', 'मुझे सुनाई देने वाला अनुवाद केवल टेक्स्ट में है: सामने वाले का वाक् मॉडल भी लोड करने के लिए पर्याप्त मेमोरी नहीं है।'],
  id: ['Terjemahan yang didengar pihak lain hanya berupa teks: tidak ada model suara yang berbicara {{target}}.', 'Terjemahan yang saya dengar hanya berupa teks: tidak ada model suara yang berbicara {{target}}.', 'Terjemahan yang saya dengar hanya berupa teks: memori tidak cukup untuk memuat model suara pihak lain juga.'],
  it: ["La traduzione che sente l'altra parte è solo testo: nessun modello vocale parla {{target}}.", 'La traduzione che sento io è solo testo: nessun modello vocale parla {{target}}.', "La traduzione che sento io è solo testo: memoria insufficiente per caricare anche il modello vocale dell'altra parte."],
  ja: ['相手に聞こえる翻訳は文字のみです: {{target}}を話せる音声モデルがありません。', '自分に聞こえる翻訳は文字のみです: {{target}}を話せる音声モデルがありません。', '自分に聞こえる翻訳は文字のみです: 相手側の音声モデルも読み込むにはメモリが足りません。'],
  ko: ['상대방에게 들리는 번역은 텍스트로만 표시됩니다: {{target}}용 음성 모델이 없습니다.', '내가 듣는 번역은 텍스트로만 표시됩니다: {{target}}용 음성 모델이 없습니다.', '내가 듣는 번역은 텍스트로만 표시됩니다: 상대방 쪽 음성 모델까지 불러올 메모리가 부족합니다.'],
  ms: ['Terjemahan yang didengar pihak lain hanya dalam bentuk teks: tiada model suara yang bertutur dalam {{target}}.', 'Terjemahan yang saya dengar hanya dalam bentuk teks: tiada model suara yang bertutur dalam {{target}}.', 'Terjemahan yang saya dengar hanya dalam bentuk teks: memori tidak mencukupi untuk memuatkan model suara pihak lain juga.'],
  nl: ['De vertaling die de ander hoort, is alleen tekst: geen spraakmodel spreekt {{target}}.', 'De vertaling die ik hoor, is alleen tekst: geen spraakmodel spreekt {{target}}.', 'De vertaling die ik hoor, is alleen tekst: niet genoeg geheugen om ook het spraakmodel van de ander te laden.'],
  pl: ['Tłumaczenie, które słyszy druga strona, jest tylko tekstem: brak modelu mowy (język: {{target}}).', 'Tłumaczenie, które słyszę, jest tylko tekstem: brak modelu mowy (język: {{target}}).', 'Tłumaczenie, które słyszę, jest tylko tekstem: za mało pamięci, by wczytać także model mowy drugiej strony.'],
  pt_BR: ['A tradução que o outro lado ouve aparece só como texto: nenhum modelo de voz fala {{target}}.', 'A tradução que eu ouço aparece só como texto: nenhum modelo de voz fala {{target}}.', 'A tradução que eu ouço aparece só como texto: não há memória suficiente para carregar também o modelo de voz do outro lado.'],
  pt_PT: ['A tradução que o outro lado ouve é apresentada apenas como texto: nenhum modelo de voz fala {{target}}.', 'A tradução que eu ouço é apresentada apenas como texto: nenhum modelo de voz fala {{target}}.', 'A tradução que eu ouço é apresentada apenas como texto: não há memória suficiente para carregar também o modelo de voz do outro lado.'],
  ru: ['Перевод, который слышит собеседник, показывается только текстом: нет модели синтеза речи для языка «{{target}}».', 'Перевод, который слышу я, показывается только текстом: нет модели синтеза речи для языка «{{target}}».', 'Перевод, который слышу я, показывается только текстом: не хватает памяти, чтобы загрузить ещё и модель синтеза речи собеседника.'],
  sv: ['Översättning som motparten hör visas bara som text: ingen talmodell talar {{target}}.', 'Översättning som jag hör visas bara som text: ingen talmodell talar {{target}}.', 'Översättning som jag hör visas bara som text: inte tillräckligt med minne för att även läsa in motpartens talmodell.'],
  ta: ['எதிர்த்தரப்பு கேட்கும் மொழிபெயர்ப்பு உரையாக மட்டுமே காட்டப்படும்: {{target}} பேசும் குரல் மாடல் எதுவும் இல்லை.', 'நான் கேட்கும் மொழிபெயர்ப்பு உரையாக மட்டுமே காட்டப்படும்: {{target}} பேசும் குரல் மாடல் எதுவும் இல்லை.', 'நான் கேட்கும் மொழிபெயர்ப்பு உரையாக மட்டுமே காட்டப்படும்: எதிர்த்தரப்பின் குரல் மாடலையும் ஏற்ற போதுமான நினைவகம் இல்லை.'],
  te: ['అవతలి వైపు వినే అనువాదం వచనంగా మాత్రమే చూపబడుతుంది: {{target}} మాట్లాడే వాక్ మోడల్ ఏదీ లేదు.', 'నేను వినే అనువాదం వచనంగా మాత్రమే చూపబడుతుంది: {{target}} మాట్లాడే వాక్ మోడల్ ఏదీ లేదు.', 'నేను వినే అనువాదం వచనంగా మాత్రమే చూపబడుతుంది: అవతలి వైపు వాక్ మోడల్‌ను కూడా లోడ్ చేయడానికి తగినంత మెమరీ లేదు.'],
  th: ['คำแปลที่อีกฝ่ายได้ยินแสดงเป็นข้อความเท่านั้น: ไม่มีโมเดลเสียงพูดที่พูด{{target}}ได้', 'คำแปลที่ฉันได้ยินแสดงเป็นข้อความเท่านั้น: ไม่มีโมเดลเสียงพูดที่พูด{{target}}ได้', 'คำแปลที่ฉันได้ยินแสดงเป็นข้อความเท่านั้น: หน่วยความจำไม่พอที่จะโหลดโมเดลเสียงพูดของอีกฝ่ายด้วย'],
  tr: ['Karşı tarafın duyduğu çeviri yalnızca metin: {{target}} konuşan bir ses modeli yok.', 'Duyduğum çeviri yalnızca metin: {{target}} konuşan bir ses modeli yok.', 'Duyduğum çeviri yalnızca metin: karşı tarafın ses modelini de yüklemeye yetecek bellek yok.'],
  uk: ['Переклад, який чує співрозмовник, показується лише текстом: немає моделі синтезу мовлення для мови «{{target}}».', 'Переклад, який чую я, показується лише текстом: немає моделі синтезу мовлення для мови «{{target}}».', "Переклад, який чую я, показується лише текстом: бракує пам'яті, щоб завантажити ще й модель синтезу мовлення співрозмовника."],
  vi: ['Bản dịch bên kia nghe chỉ hiển thị chữ: không có mô hình giọng nói nào nói được {{target}}.', 'Bản dịch tôi nghe chỉ hiển thị chữ: không có mô hình giọng nói nào nói được {{target}}.', 'Bản dịch tôi nghe chỉ hiển thị chữ: không đủ bộ nhớ để tải thêm mô hình giọng nói của bên kia.'],
  zh_CN: ['对方听到的翻译只显示文字：没有能说{{target}}的语音模型。', '我听到的翻译只显示文字：没有能说{{target}}的语音模型。', '我听到的翻译只显示文字：内存不够同时加载对方的语音模型。'],
  zh_TW: ['對方聽到的翻譯只顯示文字：沒有能說{{target}}的語音模型。', '我聽到的翻譯只顯示文字：沒有能說{{target}}的語音模型。', '我聽到的翻譯只顯示文字：記憶體不足，無法同時載入對方的語音模型。'],
};

const dir = process.argv[2];
for (const [lang, [speaker, participant, overBudget]] of Object.entries(W)) {
  const path = `${dir}/${lang}/translation.json`;
  const catalog = JSON.parse(readFileSync(path, 'utf8'));
  Object.assign(catalog.notices, {
    speaker_tts_missing: speaker,
    participant_tts_missing: participant,
    participant_tts_over_budget: overBudget,
  });
  writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`);
}
console.log(`wrote ${Object.keys(W).length} catalogs`);
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/view src/locales src/lib/diagnostics src/viewer`
Expected: PASS — including "has words for every code the runner, the capture and the adapters record", "matches the English locale word for word", the lockstep/placeholder tests, and the new row-name describe.
Run: `git diff --stat src/locales` — expected: 30 files, 3 insertions each.

- [ ] **Step 5: Commit**

```bash
git add src/lib/diagnostics/clientDiagnostics.ts src/lib/view/noticeText.ts src/lib/view/noticeText.test.ts src/locales
git commit -m "feat(notices): words for a leg that should speak but cannot"
```

---

### Task 5: Local inference builds each leg's voice, admits a text-only participant, and warns

**Files:**
- Modify: `src/providers/localInference/config.ts` (imports, `LocalInferenceConfig`, `buildLocalInference:116-126`, `admitLocalInference:162-197`)
- Modify: `src/providers/localInference/adapter.ts:123`, `:305-310`
- Test: `src/providers/localInference/config.test.ts`, `src/providers/localInference/adapter.test.ts`

**Interfaces:**
- Consumes: `directionVoice`, `speakerIdFor` (Task 1); `degraded.params` (Task 2); `AdmittedConfigs` (Task 3); the three codes (Task 4).
- Produces: `export type TtsUnavailableCode = 'speaker_tts_missing' | 'participant_tts_missing' | 'participant_tts_over_budget'` and `LocalInferenceConfig.ttsUnavailable?: TtsUnavailableCode` in `config.ts`; `admitLocalInference(configs): true | ProviderRefusal | AdmittedConfigs<LocalInferenceConfig>`.
- The spec's `ttsUnavailable: 'no-model'` / `'over-budget'` are recorded as the notice codes themselves: one value then says both the reason and the leg, and the adapter emits it as is.

- [ ] **Step 1: Write the failing tests**

In `src/providers/localInference/config.test.ts`, widen the manifest stub's type (line 42) so a test can give a TTS model its default speaker:

```ts
let mockManifest: Record<string, { type?: string; asrEngine?: string; astLanguages?: unknown; asrWorkerType?: string; ttsConfig?: { defaultSid?: number } }> = {};
```

Add to `describe('buildLocalInference')`:

```ts
  it("speaks each leg in its own direction's voice", () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't', tts: 'piper-en' }, 'en>ja': { asr: 'a', translation: 't', tts: 'piper-ja' } });
    const s = settings({ voices: { 'ja→en': { edge: 'en-US-AvaNeural', speaker: 3 }, 'en→ja': { speaker: 5 } } });
    const mine = buildLocalInference(ctx({ source: 'ja', target: 'en' }, { speech: true }), s, shared()) as LocalInferenceConfig;
    const theirs = buildLocalInference(ctx({ source: 'en', target: 'ja' }, { speech: true }), s, shared({ reversed: true })) as LocalInferenceConfig;
    expect(mine.tts).toEqual({ modelId: 'piper-en', speakerId: 3, speed: 1, edgeVoice: 'en-US-AvaNeural' });
    expect(theirs.tts).toEqual({ modelId: 'piper-ja', speakerId: 5, speed: 1, edgeVoice: undefined });
  });

  it("speaks in the model's default speaker when the direction has none", () => {
    mockManifest = { 'supertonic-3': { type: 'tts', ttsConfig: { defaultSid: 7 } } };
    resolved({ 'ja>en': { asr: 'a', translation: 't', tts: 'supertonic-3' }, 'en>ja': { asr: 'a', translation: 't', tts: 'piper-ja' } });
    expect((buildLocalInference(ctx({ source: 'ja', target: 'en' }, { speech: true }), settings(), shared()) as LocalInferenceConfig).tts?.speakerId).toBe(7);
    expect((buildLocalInference(ctx({ source: 'en', target: 'ja' }, { speech: true }), settings(), shared({ reversed: true })) as LocalInferenceConfig).tts?.speakerId).toBe(0);
  });

  it('records which leg cannot speak when no TTS model resolves, and nothing for a leg that does not speak', () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't', tts: null }, 'en>ja': { asr: 'a', translation: 't', tts: null } });
    expect(buildLocalInference(ctx({ source: 'ja', target: 'en' }, { speech: true }), settings(), shared())).toMatchObject({ ttsUnavailable: 'speaker_tts_missing' });
    expect(buildLocalInference(ctx({ source: 'en', target: 'ja' }, { speech: true }), settings(), shared({ reversed: true }))).toMatchObject({ ttsUnavailable: 'participant_tts_missing' });
    expect(buildLocalInference(ctx({ source: 'ja', target: 'en' }, { speech: false }), settings(), shared())).not.toHaveProperty('ttsUnavailable');
  });
```

Add to `describe('describeLocalInference / admitLocalInference')`:

```ts
  it("runs the other side's leg text only when its speech model alone tips the budget, saying why", () => {
    budget(1_000);
    sizes({ a: 200, t: 150, x: 200 });
    const speaker = cfg({ asr: 'a', translation: 't', tts: 'x' });
    const participant = cfg({ asr: 'a', translation: 't', tts: 'x' });
    const answer = admitLocalInference({ speaker, participant });
    expect(answer).toEqual({ configs: { participant: expect.objectContaining({ ttsUnavailable: 'participant_tts_over_budget' }) } });
    const adjusted = (answer as { configs: { participant: LocalInferenceConfig } }).configs.participant;
    expect(adjusted).not.toHaveProperty('tts');
    expect(adjusted.asr).toEqual(participant.asr);
    // The config built is left as built.
    expect(participant.tts).toBeDefined();
  });

  it("refuses when dropping the other side's speech model is not enough", () => {
    budget(1_000);
    sizes({ a: 400, t: 300, x: 200 });
    expect(admitLocalInference({ speaker: cfg({ asr: 'a', translation: 't', tts: 'x' }), participant: cfg({ asr: 'a', translation: 't', tts: 'x' }) })).toMatchObject({ code: 'memory_exceeded' });
  });

  it("refuses when the other side's speech model takes no memory: a cloud voice frees nothing", () => {
    budget(1_000);
    sizes({ a: 400, t: 300 });
    expect(admitLocalInference({ speaker: cfg({ asr: 'a', translation: 't' }), participant: cfg({ asr: 'a', translation: 't', tts: 'edge-tts' }) })).toMatchObject({ code: 'memory_exceeded' });
  });

  it('never drops my own speech model: a speaker-only run over budget refuses', () => {
    budget(1_000);
    sizes({ a: 500, t: 300, x: 300 });
    expect(admitLocalInference({ speaker: cfg({ asr: 'a', translation: 't', tts: 'x' }) })).toMatchObject({ code: 'memory_exceeded' });
  });
```

In `src/providers/localInference/adapter.test.ts`, add a describe after `'the LocalInference adapter — loading'`:

```ts
describe('the LocalInference adapter — a leg that should speak but cannot (#619)', () => {
  const speaking: SessionContext = { ...auto, speech: true };

  it('says so once, after the start, naming the target language', async () => {
    const t = await open(makeConfig({ ttsUnavailable: 'participant_tts_missing' }), speaking);
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'participant_tts_missing', params: { target: 'en' } })]);
    await t.session.stop();
    expectConformant(t.log, t.context);
  });

  it('says the over-budget reason the same way', async () => {
    const t = await open(makeConfig({ ttsUnavailable: 'participant_tts_over_budget' }), speaking);
    expect(ofKind(t.log, 'degraded').map((d) => d.code)).toEqual(['participant_tts_over_budget']);
    await t.session.stop();
  });

  it('says nothing for a leg that does not speak', async () => {
    const t = await open(makeConfig({ ttsUnavailable: 'speaker_tts_missing' }), auto);
    expect(ofKind(t.log, 'degraded')).toEqual([]);
    await t.session.stop();
  });

  it('reaches the conversation as a warning carrying its target', async () => {
    const clock = createVirtualClock();
    const conversation = new Conversation({ leg: 'speaker', session: 's', languages: speaking.direction, clock });
    const fakes = createFakeEngines();
    const starting = createLocalInferenceAdapter(fakes.engines).start(
      { context: speaking, config: makeConfig({ ttsUnavailable: 'speaker_tts_missing' }), credentials: {}, clock, signal: new AbortController().signal },
      eventsFrom((e) => conversation.apply(e)),
    );
    fakes.asr.ready();
    fakes.translation.ready();
    const session = await starting;
    expect(conversation.snapshot().notices).toEqual([expect.objectContaining({ severity: 'warning', code: 'speaker_tts_missing', params: { target: 'en' } })]);
    await session.stop();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/providers/localInference/config.test.ts src/providers/localInference/adapter.test.ts`
Expected: FAIL — `tts.speakerId` reads `ttsSpeakerId` (0), no `ttsUnavailable`, admit refuses instead of answering `{ configs }`, no degraded event.

- [ ] **Step 3: Implement `config.ts`**

Imports: add `import { directionKey } from '../../lib/local-inference/selection/types';`, `import type { AdmittedConfigs } from '../../lib/session/types';` and `import { directionVoice, speakerIdFor } from './voices';`.

Above `LocalInferenceConfig`:

```ts
/** Why a leg that should speak will not (#619): the notice code its adapter emits at the start. */
export type TtsUnavailableCode = 'speaker_tts_missing' | 'participant_tts_missing' | 'participant_tts_over_budget';
```

In `LocalInferenceConfig`, after `tts?`:

```ts
  /**
   * Set when this leg should speak but will not (#619): no TTS model speaks
   * its target, or the memory budget dropped the other side's speech model.
   * The adapter says so once, at the start.
   */
  ttsUnavailable?: TtsUnavailableCode;
```

Replace the TTS block at the end of `buildLocalInference`:

```ts
  if (context.speech && resolved.tts) {
    // Each direction speaks in its own voice (#619).
    const voice = directionVoice(s.voices, directionKey(source, target));
    config.tts = {
      modelId: resolved.tts.modelId,
      speakerId: speakerIdFor(voice, resolved.tts.modelId),
      speed: s.ttsSpeed,
      edgeVoice: voice.edge,
    };
  } else if (context.speech) {
    // Which leg this is, the runner tells outright (`shared.reversed`).
    config.ttsUnavailable = shared.reversed(context.direction) ? 'participant_tts_missing' : 'speaker_tts_missing';
  }
  return config;
```

Replace `admitLocalInference` (keep `readDebugNumber` and the two constants above it) with:

```ts
/** The models these configs load: every leg's ASR, its translation model when a real engine loads (AST shares the ASR engine — no second model to count), and TTS where a leg speaks. */
function modelIdsOf(configs: Partial<Record<LegName, LocalInferenceConfig>>): string[] {
  const ids: string[] = [];
  for (const config of Object.values(configs)) {
    if (!config) continue;
    ids.push(config.asr.modelId);
    if (config.translation.kind === 'engine') ids.push(config.translation.modelId);
    if (config.tts) ids.push(config.tts.modelId);
  }
  return ids;
}

/** Whether these models fit: VRAM only when its budget is set via localStorage (no API reports GPU memory), RAM always. */
function fitsBudget(modelIds: string[]): boolean {
  const { vramMb, ramMb } = estimateModelMemoryByDevice(modelIds, useModelStore.getState().deviceFeatures);
  const vramBudgetMb = readDebugNumber('debug:vram-budget');
  if (vramBudgetMb !== null && vramMb > vramBudgetMb) return false;
  const deviceMemoryGb = readDebugNumber('debug:device-memory')
    ?? (navigator as unknown as { deviceMemory?: number }).deviceMemory
    ?? DEFAULT_DEVICE_MEMORY_GB;
  return ramMb <= Math.round(deviceMemoryGb * RAM_BUDGET_RATIO * 1024);
}

/**
 * The memory budget (spec: "`admit`"; ports `createParticipantLocalInferenceConfig`'s
 * budget check, `localParticipantConfig.ts` ~96-124), summed over exactly the
 * configs given. When only the other side's speech model tips it (#619, R1),
 * that leg runs text only and says why; a cloud speech model takes no memory,
 * so dropping one never helps. My own leg's speech model is never dropped.
 */
export function admitLocalInference(configs: Partial<Record<LegName, LocalInferenceConfig>>): true | ProviderRefusal | AdmittedConfigs<LocalInferenceConfig> {
  if (fitsBudget(modelIdsOf(configs))) return true;
  const refusal: ProviderRefusal = { refused: 'The models need more memory than this device has.', code: 'memory_exceeded' };
  const { participant } = configs;
  if (!participant?.tts) return refusal;
  const textOnly: LocalInferenceConfig = { ...participant, ttsUnavailable: 'participant_tts_over_budget' };
  delete textOnly.tts;
  if (!fitsBudget(modelIdsOf({ ...configs, participant: textOnly }))) return refusal;
  return { configs: { participant: textOnly } };
}
```

- [ ] **Step 4: Implement `adapter.ts`**

Import the type: `import type { LocalInferenceConfig, TtsUnavailableCode } from './config';` (merge with the existing `config` import).

Line 123, the queued notices carry params too:

```ts
  private notices: Array<{ code: ClientDiagnosticCode; message: string; cause?: unknown; params?: Record<string, string | number> }> = [];
```

`announce()` becomes, with a new method below `announceTranslationUnavailable`:

```ts
  /** The notices the start found, transcription-only's own and a missing voice's, once the start has resolved. */
  announce(): void {
    for (const notice of this.notices) this.emit('degraded', notice);
    this.notices = [];
    if (this.config.translation.kind === 'none') this.announceTranslationUnavailable();
    if (this.config.ttsUnavailable && this.request.context.speech) this.announceTtsUnavailable(this.config.ttsUnavailable);
  }
```

```ts
  /** A leg that should speak but cannot says so once, at the start (#619), naming the language no model speaks. */
  private announceTtsUnavailable(code: TtsUnavailableCode): void {
    const { target } = this.request.context.direction;
    const row = code === 'speaker_tts_missing' ? 'Translation the other side hears' : 'Translation I hear';
    const message = code === 'participant_tts_over_budget'
      ? "Translation I hear is text only: not enough memory to load the other side's speech model too."
      : `${row} is text only: no speech model speaks ${target}.`;
    this.emit('degraded', { code, message, params: { target } });
  }
```

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run src/providers/localInference src/lib/session src/providers/sessionSide.consistency.test.ts`
Expected: PASS (the existing "admits only what fits" test still holds: a=400, t=300, x=200 refuses both ways).
Run: `npx tsc --noEmit -p . 2>&1 | grep -E "providers/localInference"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/providers/localInference/config.ts src/providers/localInference/config.test.ts src/providers/localInference/adapter.ts src/providers/localInference/adapter.test.ts
git commit -m "feat(local-inference): each leg's own voice, a text-only participant over budget, and a warning when a leg cannot speak"
```

---

### Task 6: A warning's click opens that leg's TTS slot

**Files:**
- Create: `src/components/providers/openTtsSlot.ts`
- Create: `src/components/providers/openTtsSlot.test.ts`
- Modify: `src/lib/view/noticeActions.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx:218-227`
- Test: `src/lib/view/noticeActions.test.ts`

**Interfaces:**
- Consumes: the three codes (Task 4).
- Produces: `openTtsSlot(leg: LegName): void`; `NoticeActionSpec` gains `{ kind: 'engine-slot'; leg: LegName; stage: 'tts' }`; `actionForCode` keeps its one-argument signature (each code names its leg).

- [ ] **Step 1: Write the failing tests**

`src/components/providers/openTtsSlot.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));

import { LOCAL_INFERENCE_DEFAULTS } from '../../providers/localInference/settings';
import { SONIOX_DEFAULTS } from '../../providers/soniox/settings';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { openTtsSlot } from './openTtsSlot';

const select = (id: string, settings: object, pair = { source: 'ja', target: 'en' }) =>
  useProviderStore.setState({ selected: id, entries: { [id]: { settings, credentials: {}, pair } } } as never);

beforeEach(() => {
  useSettingsStore.setState({ engineSlotTarget: null, settingsNavigationTarget: null });
});

describe('openTtsSlot', () => {
  it("opens the TTS slot of the direction each leg speaks, on the Provider tab", () => {
    select('local_inference', LOCAL_INFERENCE_DEFAULTS);
    openTtsSlot('speaker');
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'ja→en', stage: 'tts' });
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider');
    openTtsSlot('participant');
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'en→ja', stage: 'tts' });
  });

  it('follows the pair as it is now, not as it was when the warning was filed', () => {
    select('local_inference', LOCAL_INFERENCE_DEFAULTS, { source: 'zh', target: 'ko' });
    openTtsSlot('participant');
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'ko→zh', stage: 'tts' });
  });

  it('under a provider with no engine, opens the Provider tab and leaves no slot target behind', () => {
    select('soniox', SONIOX_DEFAULTS);
    openTtsSlot('participant');
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider');
  });
});
```

In `src/lib/view/noticeActions.test.ts`, add to `describe('actionForCode')`:

```ts
  it("sends local inference's text-only warnings to the TTS slot of the leg each names (#619)", () => {
    expect(actionForCode('speaker_tts_missing')).toEqual({ kind: 'engine-slot', leg: 'speaker', stage: 'tts' });
    expect(actionForCode('participant_tts_missing')).toEqual({ kind: 'engine-slot', leg: 'participant', stage: 'tts' });
    expect(actionForCode('participant_tts_over_budget')).toEqual({ kind: 'engine-slot', leg: 'participant', stage: 'tts' });
  });
```

and to `describe('actionLabel')`'s test:

```ts
    expect(actionLabel({ kind: 'engine-slot', leg: 'participant', stage: 'tts' })).toEqual({ key: 'settings.title', fallback: 'Settings' });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/providers/openTtsSlot.test.ts src/lib/view/noticeActions.test.ts`
Expected: FAIL — `./openTtsSlot` does not exist; the codes map to `null`.

- [ ] **Step 3: Implement**

`src/components/providers/openTtsSlot.ts`:

```ts
import type { LegName } from '../../lib/conversation/types';
import { directionKey } from '../../lib/local-inference/selection/types';
import { selectedFromStores } from '../../lib/session/appShape';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * Opens the TTS slot of the direction `leg` speaks under the pair as it is
 * now (#619), by the model chips' path: the slot target, then Settings on the
 * Provider tab — Simple pushes the engine page from the target, Advanced's
 * `ProviderEngine` opens the slot. A provider with no `Engine` gets the
 * Provider tab only: nothing there would consume a slot target, and a stale
 * one would open later under another provider.
 */
export function openTtsSlot(leg: LegName): void {
  const { setEngineSlotTarget, navigateToSettings } = useSettingsStore.getState();
  const selection = selectedFromStores();
  if (selection?.provider.Engine) {
    const { source, target } = selection.entry.pair;
    setEngineSlotTarget({ dir: leg === 'speaker' ? directionKey(source, target) : directionKey(target, source), stage: 'tts' });
  }
  navigateToSettings('provider');
}
```

In `src/lib/view/noticeActions.ts`: add `import type { LegName } from '../conversation/types';`, the union member, the map and the branch:

```ts
export type NoticeActionSpec =
  | { kind: 'settings'; target: string }
  | { kind: 'top-up' }
  | { kind: 'sign-in' }
  | { kind: 'system-settings'; pane: 'screen-recording' | 'audio-capture' }
  | { kind: 'show-in-folder'; dir: string }
  | { kind: 'engine-slot'; leg: LegName; stage: 'tts' };
```

```ts
/** Local inference's text-only warnings (#619), each naming its leg: the fix is that direction's TTS slot. */
const TTS_SLOT_LEGS: ReadonlyMap<string, LegName> = new Map([
  ['speaker_tts_missing', 'speaker'],
  ['participant_tts_missing', 'participant'],
  ['participant_tts_over_budget', 'participant'],
]);
```

In `actionForCode`, after the `sign_in_required` line:

```ts
  const leg = TTS_SLOT_LEGS.get(code);
  if (leg) return { kind: 'engine-slot', leg, stage: 'tts' };
```

In `actionLabel`'s switch:

```ts
    case 'engine-slot': return { key: 'settings.title', fallback: 'Settings' };
```

In `src/components/MainPanel/MainPanel.tsx`, import `import { openTtsSlot } from '../providers/openTtsSlot';` and add to `runNoticeAction`'s switch, before `default`:

```ts
      case 'engine-slot': openTtsSlot(spec.leg); return;
```

The subtitle takeover (`SubtitleTakeover.tsx`, `TakeoverStatusLine.tsx`) honours only `settings` and `show-in-folder` and needs no change; `NoticesPreview` draws the label through `actionLabel`.

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run src/components/providers src/lib/view src/components/MainPanel src/components/Subtitle src/components/dev`
Expected: PASS.
Run: `npx tsc --noEmit -p . 2>&1 | grep -E "noticeActions|MainPanel\.tsx|openTtsSlot|Takeover|NoticesPreview"`
Expected: no output (the exhaustive `never` in MainPanel compiles with the new case).

- [ ] **Step 5: Commit**

```bash
git add src/components/providers/openTtsSlot.ts src/components/providers/openTtsSlot.test.ts src/lib/view/noticeActions.ts src/lib/view/noticeActions.test.ts src/components/MainPanel/MainPanel.tsx
git commit -m "feat(notices): a text-only warning opens that leg's TTS slot"
```

---

### Task 7: The participant direction's TTS slot, chip and memory, while that leg speaks

**Files:**
- Modify: `src/components/Settings/engine/useWasmEngineAdapter.ts:19-24`, `:125`, deps at `:128`
- Modify: `src/providers/localInference/LocalInferenceEngine.tsx`
- Modify: `src/providers/localInference/LocalInferenceEngineSummary.tsx`
- Modify: `src/components/providers/ProviderOwnSettings.tsx` (`ProviderEngine`)
- Modify: `src/components/providers/ProviderPicker.tsx:58-60`, `:216-218`
- Test: `src/components/Settings/engine/useWasmEngineAdapter.test.ts`, `src/providers/localInference/LocalInferenceEngineSummary.test.tsx`, `src/components/providers/ProviderOwnSettings.test.tsx`, `src/components/providers/ProviderPicker.test.tsx`

**Interfaces:**
- Consumes: `SettingsProps.participantSpeaks?: boolean` (already exists; `EngineProps` and `EngineSummaryProps` extend `SettingsProps`).
- Produces: `WasmEngineAdapterOverride.participantSpeaks?: boolean`; the hosts pass `participantSpeaks = provider.participantSpeech !== false && store.speech.participantSpeech` to `Engine` and `EngineSummary`, the formula `ProviderOwnSettings` already uses for `Settings`.

- [ ] **Step 1: Write the failing tests**

In `useWasmEngineAdapter.test.ts`, give the helper the flag and add a test:

```ts
function useHeldAdapter(pair: LanguagePair = JA_EN, participantSpeaks = false) {
  const [settings, setSettings] = useState<LocalInferenceSettings>({ ...LOCAL_INFERENCE_DEFAULTS, selections: {} });
  const update = useCallback((patch: Partial<LocalInferenceSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const override = useMemo(() => ({ settings, update, pair, participantSpeaks }), [settings, update, pair, participantSpeaks]);
  return { adapter: useWasmEngineAdapter(false, override), settings };
}
```

```ts
  it("gives the participant direction a TTS slot while that leg speaks (#619)", () => {
    const { result } = renderHook(() => useHeldAdapter(JA_EN, true));
    expect(result.current.adapter.stagesFor('en→ja', false)).toEqual(['asr', 'translation', 'tts']);
    expect(result.current.adapter.stagesFor('ja→en', true)).toEqual(['asr', 'translation', 'tts']);
  });
```

In `LocalInferenceEngineSummary.test.tsx`, add `'local-tts': { name: 'Local Voice' }` to `MANIFEST`, and add:

```ts
  it("adds the other side's TTS chip while that leg speaks, and counts its model unless it is a cloud voice (#619)", () => {
    mockResolve.mockImplementation((src: string) =>
      src === 'ja'
        ? { asr: { modelId: 'asr-model' }, translation: { modelId: 'asr-model' }, tts: { modelId: 'cloud-tts' }, ...noNotes }
        : { asr: { modelId: 'asr-model' }, translation: { modelId: 'asr-model' }, tts: { modelId: 'local-tts' }, ...noNotes },
    );
    const openSlot = vi.fn();
    const { container, rerender } = render(
      <LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['speaker', 'participant']} openSlot={openSlot} />,
    );
    expect(container.querySelectorAll('.model-chip')).toHaveLength(5);
    expect(mockEstimate).toHaveBeenLastCalledWith(['asr-model', 'asr-model', undefined, 'asr-model', 'asr-model'], []);

    rerender(
      <LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['speaker', 'participant']} openSlot={openSlot} participantSpeaks />,
    );
    expect(container.querySelectorAll('.model-chip')).toHaveLength(6);
    expect(screen.getByText('Local Voice')).toBeInTheDocument();
    expect(mockEstimate).toHaveBeenLastCalledWith(['asr-model', 'asr-model', undefined, 'asr-model', 'asr-model', 'local-tts'], []);
    fireEvent.click(screen.getByText('Local Voice'));
    expect(openSlot).toHaveBeenCalledWith({ dir: 'en→ja', stage: 'tts' });
  });

  it("shows the other side's TTS as None in the warning colour when nothing speaks my language", () => {
    mockResolve.mockImplementation((src: string) =>
      src === 'ja'
        ? { asr: { modelId: 'asr-model' }, translation: null, tts: null, ...noNotes }
        : { asr: { modelId: 'asr-model' }, translation: null, tts: null, ...noNotes },
    );
    const { container } = render(<LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['participant']} openSlot={vi.fn()} participantSpeaks />);
    const chips = container.querySelectorAll('.model-chip');
    expect(chips).toHaveLength(3);
    expect(chips[2].querySelector('.model-chip-value')).toHaveClass('model-warn');
  });

  it("leaves a note about the other side's TTS out while that leg does not speak", () => {
    mockResolve.mockImplementation((src: string) =>
      src === 'ja'
        ? { asr: { modelId: 'asr-model' }, translation: null, tts: null, ...noNotes }
        : { asr: null, translation: null, tts: null, notes: [{ direction: 'en→ja', stage: 'tts', from: 'old-asr', to: 'asr-model', reason: 'not-downloaded' }], prunes: [] },
    );
    const { rerender } = render(<LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['speaker', 'participant']} openSlot={vi.fn()} />);
    expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();
    rerender(<LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['speaker', 'participant']} openSlot={vi.fn()} participantSpeaks />);
    expect(screen.getByTestId('language-resolution-notes')).toBeInTheDocument();
  });
```

In `ProviderOwnSettings.test.tsx`, add to `describe('ProviderEngine')`:

```ts
  it('hands the Engine participantSpeaks: the store\'s switch, unless the provider never speaks the participant', () => {
    useProviderStore.setState({
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'auto', target: 'en' } } },
      speech: { textOnly: false, participantSpeech: true },
    });
    const seen: EngineProps<FakeSettings>[] = [];
    const Engine = (props: EngineProps<FakeSettings>) => { seen.push(props); return null; };
    const { rerender } = render(<ProviderEngine providers={[{ ...fakeProvider, Engine }]} />);
    expect(seen[seen.length - 1].participantSpeaks).toBe(true);
    rerender(<ProviderEngine providers={[{ ...fakeProvider, participantSpeech: false, Engine }]} />);
    expect(seen[seen.length - 1].participantSpeaks).toBe(false);
  });
```

In `ProviderPicker.test.tsx`, in `"shows a provider's EngineSummary, with the store's legs and openSlot passed through"`, set `speech` alongside `legs` and assert it:

```ts
    useProviderStore.setState({ legs: ['speaker', 'participant'], speech: { textOnly: false, participantSpeech: true } });
```

```ts
    expect(props?.participantSpeaks).toBe(true);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/Settings/engine/useWasmEngineAdapter.test.ts src/providers/localInference/LocalInferenceEngineSummary.test.tsx src/components/providers/ProviderOwnSettings.test.tsx src/components/providers/ProviderPicker.test.tsx`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement**

`useWasmEngineAdapter.ts` — the override:

```ts
export interface WasmEngineAdapterOverride {
  settings: LocalInferenceSettings;
  update: (patch: Partial<LocalInferenceSettings>) => void;
  pair: LanguagePair;
  /** The participant leg would speak (#619): its direction shows a TTS slot too. */
  participantSpeaks?: boolean;
}
```

`stagesFor` (its memo already depends on `override`):

```ts
      // The participant direction's TTS slot shows only while that leg speaks (#619).
      stagesFor: (_dir, isSpeaker): Stage[] => (isSpeaker || override.participantSpeaks ? ['asr', 'translation', 'tts'] : ['asr', 'translation']),
```

`LocalInferenceEngine.tsx` — take `participantSpeaks = false` from the props and put it in the memoized override:

```tsx
export function LocalInferenceEngine({
  settings, update, disabled = false, pair = FALLBACK_PAIR, legs, initialSlot, onInitialSlotConsumed, participantSpeaks = false,
}: EngineProps<LocalInferenceSettings>) {
  // A fresh object literal every render would defeat useWasmEngineAdapter's
  // own useMemo (its deps array holds this `override` reference). Keyed on
  // the pair's languages: the store hands out a new pair object on every
  // settings write.
  const { source, target } = pair;
  const override = useMemo(
    () => ({ settings, update, pair: { source, target }, participantSpeaks }),
    [settings, update, source, target, participantSpeaks],
  );
```

`LocalInferenceEngineSummary.tsx`:
- Destructure `participantSpeaks = false` from the props.
- After `isParticipantChannelInScope`: 

```ts
  // The other side's TTS (#619): a chip and its memory only while that leg runs and speaks.
  const participantTts = isParticipantChannelInScope && participantSpeaks;
```

- Replace the `memoryEstimate` memo:

```ts
  const memoryEstimate = useMemo(() => {
    // Skip cloud TTS models (e.g. Edge TTS) — they don't consume local memory.
    const localTts = (resolved: DirectionResult): string | undefined => {
      const id = resolved.tts?.modelId;
      return id && !getManifestEntry(id)?.isCloudModel ? id : undefined;
    };
    const mainIds = [speakerResolved.asr?.modelId, speakerResolved.translation?.modelId, localTts(speakerResolved)];
    const participantIds = isParticipantChannelInScope
      ? [participantResolved.asr?.modelId, participantResolved.translation?.modelId, ...(participantTts ? [localTts(participantResolved)] : [])]
      : [];
    return estimateModelMemoryByDevice([...mainIds, ...participantIds], deviceFeatures);
  }, [deviceFeatures, isParticipantChannelInScope, participantTts, participantResolved, speakerResolved]);
```

- In `renderChipGroups`, the two `renderChips(participant, tgt, src, false)` calls become `renderChips(participant, tgt, src, participantTts)`, and the comment above it reads `'participant' → 2 chips (ASR/MT) for the REVERSE tgt→src, 3 while that leg speaks (#619)`.
- The `fallbackNotes` memo drops a participant TTS note while that leg is silent (its slot is not rendered):

```ts
  const fallbackNotes = useMemo(
    () => [...speakerResolved.notes, ...(isParticipantChannelInScope ? participantResolved.notes.filter((n) => n.stage !== 'tts' || participantTts) : [])]
      .filter((n: ResolutionNote) => n.reason !== 'no-candidate'),
    [speakerResolved, participantResolved, isParticipantChannelInScope, participantTts],
  );
```

`ProviderOwnSettings.tsx` — `ProviderEngine`:

```tsx
export function ProviderEngine({ providers, disabled, initialSlot, onInitialSlotConsumed }: ProviderEngineProps) {
  const legs = useProviderStore((s) => s.legs);
  const speechParticipant = useProviderStore((s) => s.speech.participantSpeech);
  const selection = useSelectedProvider(providers);
  if (!selection?.entry) return null;
  const Engine = selection.provider.Engine;
  if (!Engine) return null;
  // As for Settings above: the switch, unless the provider never speaks the participant.
  const participantSpeaks = selection.provider.participantSpeech !== false && speechParticipant;
  return (
    <Engine
      {...ownProps(selection, selection.entry, disabled)}
      legs={legs}
      participantSpeaks={participantSpeaks}
      initialSlot={initialSlot}
      onInitialSlotConsumed={onInitialSlotConsumed}
    />
  );
}
```

`ProviderPicker.tsx` — read the switch beside `legs` (before the early return, with the other hooks):

```ts
  const speechParticipant = useProviderStore((s) => s.speech.participantSpeech);
```

and the summary mount:

```tsx
      {openSlot && provider.EngineSummary && entry && (
        <provider.EngineSummary
          {...ownProps(selection, entry, disabled)}
          legs={legs}
          // As ProviderOwnSettings hands Settings: the switch, unless the provider never speaks the participant.
          participantSpeaks={provider.participantSpeech !== false && speechParticipant}
          openSlot={openSlot}
        />
      )}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/Settings/engine src/providers/localInference src/components/providers src/components/Settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/engine/useWasmEngineAdapter.ts src/components/Settings/engine/useWasmEngineAdapter.test.ts src/providers/localInference/LocalInferenceEngine.tsx src/providers/localInference/LocalInferenceEngineSummary.tsx src/providers/localInference/LocalInferenceEngineSummary.test.tsx src/components/providers/ProviderOwnSettings.tsx src/components/providers/ProviderOwnSettings.test.tsx src/components/providers/ProviderPicker.tsx src/components/providers/ProviderPicker.test.tsx
git commit -m "feat(local-inference): the other side's TTS slot and chip while its leg speaks"
```

---

### Task 8: The Library edits the voice of the direction it was opened for

**Files:**
- Modify: `src/components/Settings/sections/LocalInferenceVoiceSection.tsx`
- Modify: `src/components/Settings/sections/ModelManagementSection.tsx:600-676`, `:895-922`
- Test: `src/components/Settings/sections/LocalInferenceVoiceSection.test.tsx`, `src/components/Settings/sections/ModelManagementSection.test.tsx:1-16`, `:385-480`

**Interfaces:**
- Consumes: `DirectionVoice`, `directionVoice`, `speakerIdFor`, `withDirectionVoice` (Task 1).
- Produces: `LocalInferenceVoiceSectionProps` renames `edgeTtsVoice` → `edgeVoice: string` (`''` when unset), `ttsSpeakerId` → `speakerId: number`, `onUpdate(patch: DirectionVoice)` (writes `{ edge }` or `{ speaker }`).

- [ ] **Step 1: Write the failing tests**

`LocalInferenceVoiceSection.test.tsx` — the base and the three writing tests become:

```ts
const base = {
  isSessionActive: false,
  edgeVoices: [{ ShortName: 'en-US-A', label: 'A' }, { ShortName: 'en-US-B', label: 'B' }],
  edgeVoiceStatus: 'loaded' as const,
  edgeVoice: 'en-US-A',
  supertonicVoices: [{ id: 'preset:0', label: 'Sarah', group: 'builtin' as const, removable: false }],
  supertonicSelectedId: 'preset:0',
  onImportVoice: vi.fn(), onRenameVoice: vi.fn(), onDeleteVoice: vi.fn(),
  speakerId: 0, numSpeakers: 8,
  onUpdate: vi.fn(),
};
```

and in `'edge engine → <select> writes edgeTtsVoice'` (rename it `'edge engine → <select> writes the edge voice'`) the expectation becomes `expect(onUpdate).toHaveBeenCalledWith({ edge: 'en-US-B' });`; in the Supertonic select test `{ speaker: 7 }`; in the slider test `{ speaker: 3 }`.

`ModelManagementSection.test.tsx`: the fixture (lines 11-15):

```ts
const defaultSettings = {
  sourceLanguage: 'en', targetLanguage: 'en',
  ttsSpeed: 1, voices: {} as LocalInferenceSettings['voices'],
  selections: {} as Selections,
};
```

and in `beforeEach`: `Object.assign(mockSettings, defaultSettings, { selections: {}, voices: {} });`.

Replace the whole `edgeTtsVoice ownership (freeze bug)` describe (lines 385-480) with:

```ts
// Freeze bug (2026-08-23): two writers of ONE shared voice field — the Library
// against its slot's target, SettingsInitializer against the forward target —
// ping-ponged it forever. Since #619 each direction owns its entry, and both
// writers compute the same first voice for the same target, so they agree.
describe('ModelManagementSection — voices per direction (#619)', () => {
  const voiceWrites = () => mockUpdate.mock.calls.filter(([p]) => p && 'voices' in p).map(([p]) => p.voices);

  it("a reversed-direction Library fixes that direction's Edge voice only, against its own target", async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockSettings.voices = { 'en→ja': { edge: 'ja-JP-NanamiNeural' } };

    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="tts" direction="ja→en" />);

    await waitFor(() => expect(voiceWrites()).toHaveLength(1));
    expect(voiceWrites()[0]).toEqual({ 'en→ja': { edge: 'ja-JP-NanamiNeural' }, 'ja→en': { edge: 'en-US-AriaNeural' } });
  });

  it("a reversed-direction TTS Library edits that direction's voice", async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockSettings.voices = { 'en→ja': { edge: 'ja-JP-NanamiNeural' }, 'ja→en': { edge: 'en-US-AriaNeural' } };

    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="tts" direction="ja→en" />);
    const select = await screen.findByDisplayValue(/Aria/);
    expect(select).toBeInTheDocument();
    expect(within(select).queryByText(/Nanami/)).toBeNull();
  });

  it('the forward render fixes an invalid voice once, and not again on a re-render with unchanged inputs', async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockSettings.voices = { 'en→ja': { edge: 'en-US-AriaNeural' } }; // wrong language for target ja

    const { rerender } = render(<ModelManagementSection isSessionActive={false} {...slice()} />);
    await waitFor(() => expect(voiceWrites()).toHaveLength(1));
    expect(voiceWrites()[0]).toEqual({ 'en→ja': { edge: 'ja-JP-NanamiNeural' } });

    rerender(<ModelManagementSection isSessionActive={false} {...slice()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(voiceWrites()).toHaveLength(1);
  });

  it('writes nothing when the direction already has a voice of its target', async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockSettings.voices = { 'en→ja': { edge: 'ja-JP-NanamiNeural' } };

    render(<ModelManagementSection isSessionActive={false} {...slice()} />);
    await waitFor(() => expect(mockGetEdgeTtsVoices).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(voiceWrites()).toEqual([]);
  });
});
```

Add to `describe('ModelManagementSection — embedded voice')`:

```ts
  it("deleting an imported Supertonic voice resets every direction that spoke in it, not only this one (Review Focus 4)", async () => {
    const storage = await import('../../../lib/local-inference/voiceStorage');
    vi.mocked(storage.listVoices).mockResolvedValueOnce([{ id: 2, name: 'Mine' } as never]);
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockSettings.selections = {
      [directionKey('en', 'ja')]: { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: 'supertonic-3' } },
    };
    // Sid 12 is imported voice #2 (`importedSidFromDbKey`); the reverse direction speaks in it too.
    mockSettings.voices = { 'en→ja': { speaker: 12 }, 'ja→en': { speaker: 12, edge: 'en-US-AriaNeural' }, 'zh→ja': { speaker: 3 } };
    mockStatuses['supertonic-3'] = 'downloaded';

    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="tts" direction="en→ja" />);
    const card = await screen.findByTestId('model-card-supertonic-3');
    await within(card).findByText('Mine');
    // VoiceLibrarySection's delete for a custom row: open its menu, then confirm (see VoiceLibrarySection.test.tsx for the exact controls).
    fireEvent.click(within(card).getByRole('button', { name: /delete/i }));
    fireEvent.click(await within(card).findByRole('button', { name: /delete/i }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({
      voices: { 'en→ja': { speaker: 7 }, 'ja→en': { speaker: 7, edge: 'en-US-AriaNeural' }, 'zh→ja': { speaker: 3 } },
    }));
  });
```

Before running, open `src/components/Settings/sections/VoiceLibrarySection.test.tsx` and make the two delete clicks above match the real controls (label and confirm step); keep the expectation.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/Settings/sections/LocalInferenceVoiceSection.test.tsx src/components/Settings/sections/ModelManagementSection.test.tsx`
Expected: FAIL — the section writes `edgeTtsVoice`/`ttsSpeakerId`; the reversed Library hides the voice and writes nothing.

- [ ] **Step 3: Implement `LocalInferenceVoiceSection.tsx`**

Import `import type { DirectionVoice } from '../../../providers/localInference/settings';`. The props:

```ts
export interface LocalInferenceVoiceSectionProps {
  ttsModel: string;
  isSessionActive?: boolean;
  // edge-tts
  edgeVoices: { ShortName: string; label: string }[];
  edgeVoiceStatus: EdgeVoiceStatus;
  /** This direction's Edge voice ShortName, '' while none is set. */
  edgeVoice: string;
  // supertonic
  supertonicVoices: VoiceEntry[];
  supertonicSelectedId: string;
  onImportVoice: (file: File) => Promise<void>;
  onRenameVoice: (sid: number, name: string) => Promise<void>;
  onDeleteVoice: (sid: number) => Promise<void>;
  // other engines
  /** This direction's speaker id, the model default when none is set. */
  speakerId: number;
  numSpeakers: number;
  /** Writes this direction's voice (#619). */
  onUpdate: (patch: DirectionVoice) => void;
}
```

In the component: destructure `edgeVoice` and `speakerId`; `onSupertonicSelect` calls `onUpdate({ speaker: sidFromVoiceId(id) })`; the Edge `<select>` reads `value={edgeVoice}` and writes `onUpdate({ edge: e.target.value })`; the slider shows `{speakerId}`, reads `value={Math.min(speakerId, numSpeakers - 1)}` and writes `onUpdate({ speaker: parseInt(e.target.value) })`.

- [ ] **Step 4: Implement `ModelManagementSection.tsx`**

Imports: `import { directionVoice, speakerIdFor, withDirectionVoice } from '../../../providers/localInference/voices';` and the `DirectionVoice` type from `../../../providers/localInference/settings`.

After `selectedTts` (near line 424), the direction whose voice this Library edits:

```ts
  // The voice this Library edits is its own direction's (#619): the opening
  // slot's when pushed, the forward pair's otherwise — the pair everything
  // above already reads.
  const voiceDir = directionKey(sourceLanguage, targetLanguage);
  const voice = directionVoice(settings.voices, voiceDir);
  const speakerId = speakerIdFor(voice, selectedTts);
  const writeVoice = useCallback(
    (patch: DirectionVoice) => updateLocalInference(withDirectionVoice(settings.voices, voiceDir, patch)),
    [settings.voices, voiceDir, updateLocalInference],
  );
```

`supertonicSelectedId` reads `speakerId`:

```ts
  const supertonicSelectedId = useMemo(() => {
    const match = supertonicVoices.find((v) => v.sid === speakerId);
    const source = match?.source === 'imported' ? 'custom' : 'preset';
    return `${source}:${speakerId}`;
  }, [supertonicVoices, speakerId]);
```

`handleDeleteVoice` resets the sid in every direction that spoke in it:

```ts
  const handleDeleteVoice = useCallback(async (sid: number) => {
    const dbKey = dbKeyFromImportedSid(sid);
    if (dbKey === null) return;
    await voiceStorage.deleteVoice(dbKey);
    const defaultSid = supertonicTtsEntry?.ttsConfig?.defaultSid ?? 0;
    // Every direction that spoke in the deleted voice, not only this one (#619): the other direction may have picked it too.
    const stored: LocalInferenceSettings['voices'] = settings.voices && typeof settings.voices === 'object' && !Array.isArray(settings.voices) ? settings.voices : {};
    const users = Object.keys(stored).filter((dir) => directionVoice(stored, dir).speaker === sid);
    if (users.length > 0) {
      updateLocalInference({ voices: Object.fromEntries(Object.entries(stored).map(([dir, v]) => [dir, users.includes(dir) ? { ...v, speaker: defaultSid } : v])) });
    }
    await refreshImportedVoices();
    setHasPendingChanges(true);
  }, [supertonicTtsEntry, settings.voices, updateLocalInference, refreshImportedVoices]);
```

Replace the `ownsVoiceSettings` block and its effect with:

```ts
  // An Edge voice belongs to a language: keep this direction's valid for its
  // own target. SettingsInitializer keeps every speaking direction valid the
  // same way, with the same first voice, so the two writers of one entry
  // always agree (the 2026-08-23 freeze needed two targets for ONE field).
  const edgeVoice = voice.edge;
  useEffect(() => {
    if (!isEdgeTtsSelected || filteredVoices.length === 0) return;
    if (filteredVoices.some((v) => v.ShortName === edgeVoice)) return;
    writeVoice({ edge: filteredVoices[0].ShortName });
  }, [isEdgeTtsSelected, filteredVoices, edgeVoice, writeVoice]);
```

`renderTtsCardBody` loses the `ownsVoiceSettings` guard and its comment's forward-only sentences; it reads:

```tsx
  // Voice control embedded in the selected TTS card only. The card's
  // `isSelected && children` gate is the real guard; the id check just
  // avoids building the body for non-selected cards. It edits this
  // Library's own direction's voice (#619).
  const renderTtsCardBody = (entry: ModelManifestEntry) => entry.id === selectedTts ? (
    <>
      <LocalInferenceVoiceSection
        ttsModel={entry.id}
        isSessionActive={isSessionActive}
        edgeVoices={edgeVoices}
        edgeVoiceStatus={edgeTtsVoiceStatus}
        edgeVoice={voice.edge ?? ''}
        supertonicVoices={supertonicVoiceEntries}
        supertonicSelectedId={supertonicSelectedId}
        onImportVoice={handleImportVoice}
        onRenameVoice={handleRenameVoice}
        onDeleteVoice={handleDeleteVoice}
        speakerId={speakerId}
        numSpeakers={supertonicTtsEntry?.numSpeakers ?? getManifestEntry(entry.id)?.numSpeakers ?? 1}
        onUpdate={writeVoice}
      />
```

(the rest of the fragment is unchanged). Remove `forwardSource`/`forwardTarget` uses that only fed `ownsVoiceSettings`; keep them where they still pick the pair.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/Settings/sections src/providers/localInference`
Expected: PASS.
Run: `grep -n "edgeTtsVoice\|ttsSpeakerId\|ownsVoiceSettings" src/components/Settings/sections/ModelManagementSection.tsx src/components/Settings/sections/LocalInferenceVoiceSection.tsx`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/sections/LocalInferenceVoiceSection.tsx src/components/Settings/sections/LocalInferenceVoiceSection.test.tsx src/components/Settings/sections/ModelManagementSection.tsx src/components/Settings/sections/ModelManagementSection.test.tsx
git commit -m "feat(local-inference): the Library edits the voice of the direction it opened for"
```

---

### Task 9: SettingsInitializer keeps each speaking direction's Edge voice; the shared fields retire

**Files:**
- Modify: `src/components/SettingsInitializer/SettingsInitializer.tsx`
- Modify: `src/providers/localInference/settings.ts` (remove `ttsSpeakerId`, `edgeTtsVoice`)
- Test: `src/components/SettingsInitializer/SettingsInitializer.test.tsx`

**Interfaces:**
- Consumes: `directionVoice`, `withDirectionVoice` (Task 1); `providerStore.legs`, `providerStore.speech.participantSpeech`.
- Produces: no new names. After this task nothing reads or writes `edgeTtsVoice`/`ttsSpeakerId` (the `settings.edgeTtsVoice*` locale keys are UI labels and stay).

- [ ] **Step 1: Write the failing tests**

In `SettingsInitializer.test.tsx`, replace `selectLocal` and the Edge describe:

```ts
/** LocalInference as the store holds it once loaded: `en → ja`, these voices, these legs, Translation I hear on or off. */
function selectLocal(voices: Record<string, unknown> = {}, o: { legs?: Array<'speaker' | 'participant'>; participantSpeech?: boolean; pair?: { source: string; target: string } } = {}): void {
  useProviderStore.setState({
    selected: localInferenceProvider.id,
    entries: { [localInferenceProvider.id]: { settings: { ...LOCAL_INFERENCE_DEFAULTS, voices }, credentials: {}, pair: o.pair ?? { source: 'en', target: 'ja' } } },
    legs: o.legs ?? ['speaker'],
    speech: { textOnly: false, participantSpeech: o.participantSpeech ?? false },
  } as never);
}
```

The voice list mock returns Japanese and English voices:

```ts
const edge = vi.hoisted(() => ({
  voices: vi.fn(async () => [
    { ShortName: 'ja-JP-NanamiNeural', Locale: 'ja-JP' },
    { ShortName: 'ja-JP-KeitaNeural', Locale: 'ja-JP' },
    { ShortName: 'en-US-AvaNeural', Locale: 'en-US' },
  ]),
}));
```

```ts
  describe('the Edge TTS voice of each direction that will speak (#619)', () => {
    let updateSettings: Mock<ProviderStore['updateSettings']>;
    beforeEach(() => {
      updateSettings = vi.fn<ProviderStore['updateSettings']>();
      useProviderStore.setState({ updateSettings });
      useModelStore.setState({ initialized: true });
    });

    it("picks my direction's first voice of its target when it has none", async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      selectLocal();
      render(<SettingsInitializer />);
      await settle();
      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(updateSettings).toHaveBeenCalledWith(localInferenceProvider, { voices: { 'en→ja': { edge: 'ja-JP-NanamiNeural' } } });
    });

    it("writes nothing when my direction's voice already matches its target", async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      selectLocal({ 'en→ja': { edge: 'ja-JP-KeitaNeural' } });
      render(<SettingsInitializer />);
      await settle();
      expect(edge.voices).toHaveBeenCalled();
      expect(updateSettings).not.toHaveBeenCalled();
    });

    it("leaves the other side's direction alone while Translation I hear is off, even when it resolves to Edge (Review Focus 2)", async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      selectLocal({ 'en→ja': { edge: 'ja-JP-KeitaNeural' } }, { legs: ['speaker', 'participant'], participantSpeech: false });
      render(<SettingsInitializer />);
      await settle();
      expect(updateSettings).not.toHaveBeenCalled();
    });

    it("keeps both speaking directions valid, each against its own target, in one write", async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      selectLocal({}, { legs: ['speaker', 'participant'], participantSpeech: true });
      render(<SettingsInitializer />);
      await settle();
      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(updateSettings).toHaveBeenCalledWith(localInferenceProvider, {
        voices: { 'en→ja': { edge: 'ja-JP-NanamiNeural' }, 'ja→en': { edge: 'en-US-AvaNeural' } },
      });
    });

    it('a pair swap finds both voices where they were: nothing to write (Review Focus 1)', async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      selectLocal({ 'en→ja': { edge: 'ja-JP-KeitaNeural' }, 'ja→en': { edge: 'en-US-AvaNeural' } }, { legs: ['speaker', 'participant'], participantSpeech: true, pair: { source: 'ja', target: 'en' } });
      render(<SettingsInitializer />);
      await settle();
      expect(updateSettings).not.toHaveBeenCalled();
    });

    it('writes nothing when no speaking direction uses Edge', async () => {
      useModelStore.setState({ resolve: () => direction('piper-ja') });
      selectLocal({}, { legs: ['speaker', 'participant'], participantSpeech: true });
      render(<SettingsInitializer />);
      await settle();
      expect(edge.voices).not.toHaveBeenCalled();
      expect(updateSettings).not.toHaveBeenCalled();
    });
  });
```

The model-scan tests call `selectLocal()` with no arguments.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/SettingsInitializer`
Expected: FAIL — the initializer writes `edgeTtsVoice` for the forward pair only.

- [ ] **Step 3: Implement**

`SettingsInitializer.tsx` — imports gain `import { directionKey } from '../../lib/local-inference/selection/types';` and `import { directionVoice, withDirectionVoice } from '../../providers/localInference/voices';`. The doc comment's second job reads "an Edge TTS voice that matches each speaking direction's target language". The component body:

```tsx
export function SettingsInitializer() {
  const selected = useProviderStore((s) => s.selected);
  const entry = useProviderStore((s) => s.entries[localInferenceProvider.id]);
  const legs = useProviderStore((s) => s.legs);
  const participantSpeech = useProviderStore((s) => s.speech.participantSpeech);
  const modelStatuses = useModelStatuses();
  const isLocal = selected === localInferenceProvider.id;
  const settings = entry?.settings as LocalInferenceSettings | undefined;
  const source = entry?.pair.source;
  const target = entry?.pair.target;
  // Local inference sets no `participantSpeech` flag: the other side speaks when its leg runs and its switch is on.
  const participantSpeaks = legs.includes('participant') && participantSpeech;

  useEffect(() => {
    if (!isLocal || useModelStore.getState().initialized) return;
    useModelStore.getState().initialize().catch((error: unknown) =>
      reportWarning('SettingsInitializer', `Scanning the downloaded models failed: ${describeCause(error)}`, { cause: error }));
  }, [isLocal]);

  // Each direction that will speak keeps an Edge voice of its own target (#619): mine always, as
  // before; the other side's only while its leg speaks. The picker's own effect runs only while
  // Settings is open; both pick the target's first voice, so they never disagree.
  useEffect(() => {
    if (!isLocal || !settings || !source || !target) return;
    const spoken = [{ src: source, tgt: target }, ...(participantSpeaks ? [{ src: target, tgt: source }] : [])];
    const { resolve } = useModelStore.getState();
    const onEdge = spoken.filter((d) => resolve(d.src, d.tgt, settings.selections).tts?.modelId === 'edge-tts');
    if (onEdge.length === 0) return;
    let cancelled = false;
    getEdgeTtsVoices()
      .then((voices) => {
        if (cancelled) return;
        // The table as it is now: the Library may have written another direction since this effect ran.
        const latest = useProviderStore.getState().entries[localInferenceProvider.id]?.settings as LocalInferenceSettings | undefined;
        if (!latest) return;
        let table = latest.voices;
        for (const { src, tgt } of onEdge) {
          const dir = directionKey(src, tgt);
          const candidates = filterVoicesByLanguage(voices, tgt);
          if (candidates.length === 0 || candidates.some((v) => v.ShortName === directionVoice(table, dir).edge)) continue;
          table = withDirectionVoice(table, dir, { edge: candidates[0].ShortName }).voices;
        }
        if (table !== latest.voices) useProviderStore.getState().updateSettings(localInferenceProvider, { voices: table });
      })
      .catch((error: unknown) =>
        reportWarning('SettingsInitializer', `Choosing an Edge TTS voice failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'edge-voice' }));
    return () => { cancelled = true; };
  }, [isLocal, settings?.selections, settings?.voices, source, target, participantSpeaks, modelStatuses]);

  return null;
}
```

`settings.ts` — delete `ttsSpeakerId: number;` and the `edgeTtsVoice` field with its comment from `LocalInferenceSettings`, and `ttsSpeakerId: 0,` / `edgeTtsVoice: '',` from `LOCAL_INFERENCE_DEFAULTS`. The `voices` comment gains: "Retires `ttsSpeakerId`/`edgeTtsVoice`, one pair both directions shared: each user's voice resets once to the default (no one-time migration code)."

- [ ] **Step 4: Sweep, test, type-check**

Run: `grep -rnw "edgeTtsVoice\|ttsSpeakerId" src --include='*.ts' --include='*.tsx'`
Expected: no output (the run reads `config.speakerId`/`config.edgeVoice`, which stay). Any hit is a leftover to fix in this task.
Run: `npx vitest run src/components/SettingsInitializer src/providers src/components/Settings src/stores`
Expected: PASS.
Run: `npx tsc --noEmit -p . 2>&1 | grep "error TS" | sed -E 's/\([0-9]+,[0-9]+\)//' | sort` into a scratch file outside the repository, and `diff` it against the same list made from `origin/main` (a saved baseline, or a scratch worktree of `origin/main`; never `git stash`).
Expected: identical lists (93 errors).

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsInitializer/SettingsInitializer.tsx src/components/SettingsInitializer/SettingsInitializer.test.tsx src/providers/localInference/settings.ts
git commit -m "feat(local-inference): each speaking direction keeps its own Edge voice; the shared voice fields retire"
```

---

### Task 10: Local inference names each spoken leg's voice in the Speech block

**Files:**
- Create: `src/providers/localInference/LocalInferenceVoiceSummary.tsx`
- Create: `src/providers/localInference/LocalInferenceVoiceSummary.test.tsx`
- Modify: `src/lib/provider/types.ts:279-286`
- Modify: `src/providers/localInference/provider.ts`
- Modify: `src/components/Settings/sections/SpeechOutputSection.tsx:32-68`
- Test: `src/providers/localInference/provider.test.ts`, `src/components/Settings/sections/SpeechOutputSection.test.tsx`

**Interfaces:**
- Consumes: `directionVoice`, `speakerIdFor` (Task 1), `voiceNameFromShortName` (Task 1), `openTtsSlot` (Task 6).
- Produces: `LocalInferenceVoiceSummary: ComponentType<VoiceSummaryProps<LocalInferenceSettings>>`; `Provider.voicesInEngine?: true`.

- [ ] **Step 1: Write the failing tests**

`src/providers/localInference/LocalInferenceVoiceSummary.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }) }));

/** What `resolve(src, tgt)` answers for TTS, keyed `${src}>${tgt}`. */
let mockTts: Record<string, string | null> = {};
vi.mock('../../stores/modelStore', () => ({
  useModelStore: Object.assign(
    (select: (s: { modelStatuses: Record<string, string> }) => unknown) => select({ modelStatuses: {} }),
    { getState: () => ({ resolve: (src: string, tgt: string) => ({ asr: null, translation: null, tts: mockTts[`${src}>${tgt}`] ? { modelId: mockTts[`${src}>${tgt}`] } : null, notes: [], prunes: [] }) }) },
  ),
}));

import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { shortenModelName } from '../../lib/local-inference/modelName';
import { LocalInferenceVoiceSummary } from './LocalInferenceVoiceSummary';
import { LOCAL_INFERENCE_DEFAULTS, type LocalInferenceSettings } from './settings';

const PAIR = { source: 'ja', target: 'en' };
const named = (leg: 'speaker' | 'participant', voices: LocalInferenceSettings['voices'] = {}) =>
  render(<LocalInferenceVoiceSummary settings={{ ...LOCAL_INFERENCE_DEFAULTS, voices }} update={vi.fn()} pair={PAIR} leg={leg} />).container.textContent;
const short = (id: string) => { const e = getManifestEntry(id)!; return shortenModelName(e.name, e.shortName); };

beforeEach(() => { mockTts = {}; });

describe('LocalInferenceVoiceSummary', () => {
  it("names an Edge voice by its own name, from each leg's direction", () => {
    mockTts = { 'ja>en': 'edge-tts', 'en>ja': 'edge-tts' };
    expect(named('speaker', { 'ja→en': { edge: 'en-US-AvaMultilingualNeural' } })).toBe('Ava Multilingual');
    expect(named('participant', { 'en→ja': { edge: 'ja-JP-NanamiNeural' } })).toBe('Nanami');
  });

  it('names Edge by the model while the direction has no voice yet', () => {
    mockTts = { 'ja>en': 'edge-tts' };
    expect(named('speaker')).toBe(short('edge-tts'));
  });

  it("names a Supertonic preset, the model's default when none is set, and an imported voice as a custom voice", () => {
    mockTts = { 'ja>en': 'supertonic-3' };
    expect(named('speaker', { 'ja→en': { speaker: 1 } })).toBe('Lily');
    expect(named('speaker')).toBe('Robert');
    expect(named('speaker', { 'ja→en': { speaker: 12 } })).toBe('Custom voice');
  });

  it('names a multi-speaker model by its short name and speaker number, and a single-voice model by its short name', () => {
    mockTts = { 'ja>en': 'piper-cy-bu_tts-medium', 'en>ja': 'mimic3-af-google_nwu-low' };
    expect(named('speaker', { 'ja→en': { speaker: 3 } })).toBe(`${short('piper-cy-bu_tts-medium')} #3`);
    expect(named('participant')).toBe(short('mimic3-af-google_nwu-low'));
  });

  it('names nothing when no TTS model resolves for the leg', () => {
    mockTts = { 'ja>en': 'edge-tts' };
    expect(named('participant')).toBe('');
  });
});
```

In `src/providers/localInference/provider.test.ts`, add (import `LocalInferenceVoiceSummary` from `./LocalInferenceVoiceSummary`):

```ts
  it('names its voices in the Speech block, and picks them in its engine (#619)', () => {
    expect(localInferenceProvider.VoiceSummary).toBe(LocalInferenceVoiceSummary);
    expect(localInferenceProvider.voicesInEngine).toBe(true);
  });
```

In `SpeechOutputSection.test.tsx`, add to `describe('SpeechOutputSection — the voice each spoken row reads in')`:

```ts
  it("for a provider whose voices sit in its engine, the name opens that leg's TTS slot, without leaving Quick (#619)", () => {
    useProviderStore.setState({
      selected: 'local_inference',
      entries: { local_inference: { settings: { ...LOCAL_INFERENCE_DEFAULTS, voices: { 'ja→en': { edge: 'en-US-AvaNeural' } } }, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    } as never);
    useModelStore.setState({ resolve: () => ({ asr: null, translation: null, tts: { modelId: 'edge-tts', source: 'auto' }, notes: [], prunes: [] }) });
    useSettingsStore.setState({ uiMode: 'basic', settingsNavigationTarget: null, engineSlotTarget: null });
    mount();
    fireEvent.click(within(voiceLine('Translation the other side hears') as HTMLElement).getByRole('button', { name: 'Ava' }));
    expect(useSettingsStore.getState().uiMode).toBe('basic');
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'ja→en', stage: 'tts' });
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider');
  });
```

(imports: `LOCAL_INFERENCE_DEFAULTS` from `../../../providers/localInference/settings`, `useModelStore` from `../../../stores/modelStore`; restore `useModelStore`'s initial state in `beforeEach` the way `SettingsInitializer.test.tsx` does if other tests in the file read it.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/providers/localInference/LocalInferenceVoiceSummary.test.tsx src/providers/localInference/provider.test.ts src/components/Settings/sections/SpeechOutputSection.test.tsx`
Expected: FAIL — the component does not exist; the provider has no `VoiceSummary`.

- [ ] **Step 3: Implement**

`src/lib/provider/types.ts`, after `VoiceSummary`:

```ts
  /**
   * Its voices are picked in its engine's TTS slot, per direction (local
   * inference, #619): the Speech section's voice line then opens that leg's
   * TTS slot instead of the voice settings.
   */
  voicesInEngine?: true;
```

`src/providers/localInference/LocalInferenceVoiceSummary.tsx`:

```tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { VoiceSummaryProps } from '../../lib/provider/types';
import { voiceNameFromShortName } from '../../lib/edge-tts/voiceList';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { shortenModelName } from '../../lib/local-inference/modelName';
import { dbKeyFromImportedSid } from '../../lib/local-inference/sidMapping';
import { directionKey } from '../../lib/local-inference/selection/types';
import { useModelStore } from '../../stores/modelStore';
import { FALLBACK_PAIR } from './engineLegs';
import type { LocalInferenceSettings } from './settings';
import { directionVoice, speakerIdFor } from './voices';

/**
 * The voice a spoken leg reads in (#619), from its direction's resolved TTS
 * model and `voices` entry: an Edge voice by its own name; a Supertonic
 * preset by name, an imported one as a custom voice (its name lives in
 * IndexedDB); another multi-speaker model by its short name and speaker
 * number, as the Library edits it; a single-voice model by its short name.
 * Nothing when no TTS model resolves: the start warns about that leg instead.
 */
export function LocalInferenceVoiceSummary({ settings, pair = FALLBACK_PAIR, leg }: VoiceSummaryProps<LocalInferenceSettings>) {
  const { t } = useTranslation();
  const modelStatuses = useModelStore((s) => s.modelStatuses);
  const [src, tgt] = leg === 'speaker' ? [pair.source, pair.target] : [pair.target, pair.source];
  const ttsId = useMemo(
    () => useModelStore.getState().resolve(src, tgt, settings.selections).tts?.modelId,
    [src, tgt, settings.selections, modelStatuses],
  );
  if (!ttsId) return null;
  const entry = getManifestEntry(ttsId);
  const modelName = entry ? shortenModelName(entry.name, entry.shortName) : ttsId;
  const voice = directionVoice(settings.voices, directionKey(src, tgt));
  if (entry?.engine === 'edge-tts') return <>{voice.edge ? voiceNameFromShortName(voice.edge) : modelName}</>;
  const sid = speakerIdFor(voice, ttsId);
  if (entry?.engine === 'supertonic') {
    if (dbKeyFromImportedSid(sid) !== null) return <>{t('settings.voiceCustom', 'Custom voice')}</>;
    return <>{entry.ttsConfig?.presetVoices?.find((p) => p.sid === sid)?.name ?? modelName}</>;
  }
  return <>{(entry?.numSpeakers ?? 1) > 1 ? `${modelName} #${sid}` : modelName}</>;
}
```

`src/providers/localInference/provider.ts` — import it and add after `EngineSummary`:

```ts
  // Its voices sit with its TTS models, per direction (#619): the Speech section names them and opens the slot.
  VoiceSummary: LocalInferenceVoiceSummary,
  voicesInEngine: true,
```

`SpeechOutputSection.tsx` — import `import { openTtsSlot } from '../../providers/openTtsSlot';`; `VoiceLine`'s doc comment gains "A provider whose voices sit in its engine (`voicesInEngine`) opens that leg's TTS slot instead, in either layout."; `openVoices` becomes:

```ts
  const openVoices = () => {
    if (selection.provider.voicesInEngine) {
      openTtsSlot(leg);
      return;
    }
    if (uiMode === 'basic') {
      // The Settings panel's own mode toggle, analytics event included.
      setUIMode('advanced');
      trackEvent('settings_mode_switched', { from_mode: 'basic', to_mode: 'advanced', during_session: locked });
    }
    navigateToSettings('voice-settings');
  };
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/providers src/components/Settings src/lib/provider`
Expected: PASS (including `src/providers/registry.test.ts` and the consistency tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/localInference/LocalInferenceVoiceSummary.tsx src/providers/localInference/LocalInferenceVoiceSummary.test.tsx src/lib/provider/types.ts src/providers/localInference/provider.ts src/providers/localInference/provider.test.ts src/components/Settings/sections/SpeechOutputSection.tsx src/components/Settings/sections/SpeechOutputSection.test.tsx
git commit -m "feat(local-inference): the Speech block names each spoken leg's voice and opens its TTS slot"
```

---

### Task 11: Docs, render pass, full verification

**Files:**
- Modify: `CLAUDE.md` ("Adding a New AI Provider", step 1)
- Modify: `docs/superpowers/specs/2026-10-12-local-inference-participant-tts-design.md` (Status line only)

- [ ] **Step 1: CLAUDE.md**

In "Adding a New AI Provider", step 1, after the sentence listing the folder's files, add: "A provider that names its voices in the Speech block gives a `VoiceSummary`; one whose voices are picked in its engine's TTS slot also sets `voicesInEngine: true` (local inference), and its voice line opens that slot."

In the spec's Status line, write: "Status: implemented on `feat/local-inference-participant-tts` (plan `docs/superpowers/plans/2026-10-12-local-inference-participant-tts.md`)."

- [ ] **Step 2: Full suite, type check, builds**

Run: `npm run test -- --run`
Expected: every file passes.
Run the type check and compare to main's 93-error list (Task 9 Step 4).
Run: `npm run build` and `npm run extension:build`
Expected: both succeed.

- [ ] **Step 3: Render pass (renderer-only dev server)**

Start: `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5193 --strictPort` (a fake Electron dist path may be needed, as in earlier sessions). Seed local inference selected, pair ja→en, Both, Translation I hear on, and look at, in zh_CN and en, at 450px and the wide layout:
1. Simple settings: the Other group has a TTS chip, naming the model that speaks Japanese (the participant direction's target is my source language), or `None` in the warning colour when none does; the memory line changes when Translation I hear toggles.
2. The engine page from that chip: the participant direction shows a TTS slot; the Library pushed from it lists Japanese-capable TTS and, with Edge selected, a Japanese voice list.
3. The Speech block: a voice line under both spoken rows; clicking one opens the matching TTS slot.
4. A conversation with a `participant_tts_missing` notice (start with no Japanese TTS model downloaded and Edge unreachable, or inject the notice through `NoticesPreview`): the sentence, and its Settings action opening the slot.
Fix what looks wrong against the sibling markup, then stop the server by PID.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-12-local-inference-participant-tts-design.md
git commit -m "docs: local inference's voices sit in its engine (#619)"
```

- [ ] **Step 5: Report**

List the commits, the suite and build results, the render screenshots' findings, and the owner's live checks from the spec (TTS model for my language downloaded; none; Edge across a pair swap; over budget via `debug:device-memory` between the two memory totals). Ask before pushing `feat/local-inference-participant-tts` to `kizuna-ai-lab/sokuji` or opening a PR.
