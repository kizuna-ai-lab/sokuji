# Qwen LiveTranslate Provider (BYOK) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A flagged own-key provider, `qwen_livetranslate`, that runs Alibaba's `qwen3.8-livetranslate-flash-realtime` on both legs (mine and the other party's), with preset or cloned voices and push-to-talk, on the desktop app and the browser extension.

**Architecture:** One folder, `src/providers/qwen_livetranslate/`, shaped like OpenAI Live's: a definition, settings, a key check that also finds the key's storefront (QwenCloud or 千问云), a builder, a pure wire module, a pure segments module, and an adapter that opens one WebSocket per leg through the existing header seam (`Authorization: Bearer`). The registry gains one line after Doubao AST 2.0; the extension manifest gains the two hosts.

**Tech Stack:** TypeScript (strict), React 18, Vitest + Testing Library, the client contract kit (`src/lib/contract/testing/`), i18next catalogs.

**Spec:** `docs/superpowers/specs/2026-10-13-qwen-livetranslate-provider-design.md` (approved 2026-10-13). Read it before starting; this plan argues from it.

## Global Constraints

- Model, one constant: `qwen3.8-livetranslate-flash-realtime`.
- Storefronts, exact: intl `wss://maas.qwencloudapi.com/api-ws/v1/realtime` + `https://maas.qwencloudapi.com/api/v1/tokens`; cn `wss://maas.qianwenaiapi.com/api-ws/v1/realtime` + `https://maas.qianwenaiapi.com/api/v1/tokens`. Detection order: intl, then cn.
- The key travels only in the `Authorization: Bearer` header: through the header seam on the socket, and on the token request. Never in a URL, a frame, an error, a notice or a log.
- Definition: id `qwen_livetranslate`, settings key `qwenLiveTranslate`, `kind: 'own-key'`, `platforms: ['electron', 'extension']`, `flagged: true`, `testerSwitch: 'debug:qwen-livetranslate'`, registry place right after `volcengine_ast2` and right before `openai`.
- Audio: PCM16 mono at 24 kHz both ways (`SAMPLE_RATE`), never resampled.
- Exactly one `session.update` per session, always carrying `translation.language`.
- Adapter rules (CLAUDE.md, "Inside an adapter session"): no store import, no `report()`, no `console.*`; every timer on the request's clock; failures only through `events.failed` / `events.degraded` / start rejections.
- Code, comments, test names and commit messages in English; comment density like the neighbouring OpenAI Live files. Conventional commits, each ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commit on `feat/qwen-livetranslate`. Do not push and do not open a PR: both need the owner's go, naming `kizuna-ai-lab/sokuji`.
- Commands: tests `npx vitest run <paths>`, types `npx tsc --noEmit`. There is no lint script.

## Review Focus

1. **A Qwen key with dots and underscores** (`sk-ws-X.XXXX.….…`, both real keys have this shape) reaching any frame or log line must come out `[REDACTED]`: today's bare `sk-` rule stops at the first dot. Pinned in Task 1, and by `noSecret` over a whole session in Task 7.
2. **A stored voice the list does not have** (a vendor rename, hand-edited storage) must run as the default, and the other party's preset must never equal mine — while "the speaker's own voice" may be chosen on both legs. Pinned in Task 2 and Task 4.
3. **A stale pair whose target only takes text** (`uk`, `yue`, …) on a leg that speaks must be refused by `build` in words, before any socket opens; the same target with speech off must build. Pinned in Task 4; the speaking offer itself (29 targets) in Task 2.
4. **Late or out-of-order frames**: deltas, a `.done` or audio for an item a cancel dropped; a translation created after its turn was cancelled; a translation that opens before its link to the heard item arrives; audio after the text's `.done`. Nothing may be emitted for a dropped item, no event may name an unopened ref, and the origin must still reach L1. Pinned in Task 6.
5. **Stop while the storefront is still being detected** (no check has succeeded yet, `endpoint: null`): the start rejects with the stop's reason, no rule is registered, no socket opens, no timer is left. Pinned in Task 7.

## File Map

| File | Task | Holds |
|---|---|---|
| `src/lib/diagnostics/redact.ts` (+ test) | 1 | the `sk-ws-` key rule |
| `src/providers/qwen_livetranslate/settings.ts` (+ test) | 2 | model, `QwenSettings`, defaults, 47 voices + clone, voice resolution, 60 languages, credentials |
| `…/endpoints.ts` | 3 | the two storefronts |
| `…/check.ts` (+ test) | 3 | `detectEndpoint`, `createQwenCheck`, `checkQwen` |
| `src/lib/provider/boundedFetch.ts` (comment) | 3 | names its new session-side caller |
| `…/config.ts` (+ test) | 4 | `QwenConfig`, `buildQwen`, `describeQwen` |
| `…/wire.ts` (+ test) | 5 | URL, header, `sessionUpdate`, client events, decoder, error words and codes |
| `…/segments.ts` (+ test) | 6 | `QwenSegments` |
| `…/adapter.ts`, `…/testing.ts`, `…/adapter.test.ts` | 7 | `createQwenAdapter`, fixtures, conformance, lifecycles |
| `…/recordings/*.json`, `…/segments.replay.test.ts` | 8 | the probe's two timelines, replayed through the adapter |
| `src/locales/*/translation.json` (30) | 9 | `providers.qwen_livetranslate.*` |
| `src/components/Icons/ProviderIcons.tsx`, `…/QwenSettings.tsx` (+ test) | 10 | `QwenIcon`, the voice field, the storefront line, `QwenVoiceSummary` |
| `…/provider.ts` (+ test), `src/providers/registry.ts`, `registry.test.ts`, `openai/provider.test.ts`, `sessionSide.consistency.test.ts` | 11 | the definition and its registration |
| `extension/manifest.json`, `extension/manifest.consistency.test.ts`, `CLAUDE.md`, `CONTEXT.md` | 12 | hosts and docs |
| — | 13 | full verification |

Four small, deliberate refinements of the spec, each named again in its task:
- **Segments open with their first words** (Task 6), so an empty turn shows nothing; the spec had them open and close empty.
- **A mid-session `error` words the close that follows it** within 10 s (Task 7), as OpenAI Translate does; the server closes after every error the probes saw, so the user sees the same failure, but a non-fatal error cannot end a session.
- **The spec's `speakerVoice` key becomes the four clone strings Doubao AST 2.0 already has** in all 30 catalogs (Task 9), so both pickers read alike and nothing needs a fresh translation.
- **A 403 counts like a 401** in detection (Task 3): either means "not this key here".

---

### Task 1: Redact Qwen keys

**Files:**
- Modify: `src/lib/diagnostics/redact.ts` (the `PATTERNS` list, before the bare-key rule)
- Test: `src/lib/diagnostics/redact.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `redact()` masks `sk-ws-…` keys whole. Later tasks rely on this through `framePayload` and the kit's `frame-secret` rule.

- [ ] **Step 0: Give the worktree its dependencies**

The worktree has no `node_modules`. Link the main checkout's (the name is gitignored, so the link is never committed):

```bash
ln -sfn ../../../node_modules node_modules
```

- [ ] **Step 1: Write the failing test**

Add to `src/lib/diagnostics/redact.test.ts`, inside `describe('redact', …)`, after the `'redacts OpenAI sk- keys'` case:

```ts
  // QwenCloud's and 千问云's keys: `sk-ws-` and dot-separated parts with
  // underscores and hyphens, which the bare `sk-` rule stops reading at the
  // first dot (Qwen LiveTranslate, spec 2026-10-13).
  it('redacts a Qwen key whole, dots and underscores included', () => {
    expect(redact('key sk-ws-H.ABCDEFGHIJ.klmno_pQ-rs.TUVWXyz0123456789 refused')).toBe('key [REDACTED] refused');
    expect(redact('{"apiKey":"sk-ws-T.ABCDEFGH.ijklmnop.QRSTUVWX0123456789"}')).toBe('{"apiKey":"[REDACTED]"}');
    expect(redact('sk-ws-short')).toBe('sk-ws-short');
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/diagnostics/redact.test.ts`
Expected: FAIL — the first expectation still shows `sk-ws-H.ABCDEFGHIJ…` after `[REDACTED]`-free text.

- [ ] **Step 3: Add the rule**

In `src/lib/diagnostics/redact.ts`, directly above the comment that starts `// Bare provider key shapes.`, insert:

```ts
  // A Qwen key (QwenCloud's and 千问云's): `sk-ws-` then dot-separated
  // parts with underscores and hyphens, which the bare `sk-` rule below
  // stops reading at the first dot. It rides only in the upgrade header
  // (`qwen_livetranslate/wire.ts` `qwenHeaders`) and the key check's
  // Authorization; this is the net, and what lets the kit's `frame-secret`
  // rule catch one that is framed.
  [/\bsk-ws-[A-Za-z0-9._-]{10,}/g, REDACTED],
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/diagnostics/redact.test.ts`
Expected: PASS, every case.

- [ ] **Step 5: Commit**

```bash
git add src/lib/diagnostics/redact.ts src/lib/diagnostics/redact.test.ts
git commit -m "fix(diagnostics): redact Qwen keys whole

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Settings, voices, languages, credentials

**Files:**
- Create: `src/providers/qwen_livetranslate/settings.ts`
- Test: `src/providers/qwen_livetranslate/settings.test.ts`

**Interfaces:**
- Consumes: `AUTO` (`src/lib/provider/languages`), `identityWire` (`src/lib/language/wire`), `distinctVoice` (`src/lib/provider/voices`), provider types.
- Produces:
  - `QWEN_MODEL: 'qwen3.8-livetranslate-flash-realtime'`
  - `SPEAKER_CLONE = 'clone'`
  - `interface QwenVoice { value: string; name: string; gender?: 'female' | 'male'; description: string }`, `QWEN_VOICES: readonly QwenVoice[]` (47)
  - `interface QwenSettings { voice: string; participantVoice: string }`, `QWEN_DEFAULT_VOICE = 'Tina'`, `QWEN_PARTICIPANT_DEFAULT_VOICE = 'Ethan'`, `QWEN_DEFAULTS`
  - `qwenSpeakerVoice(s: Pick<QwenSettings, 'voice'>): string`, `qwenParticipantVoice(s: Pick<QwenSettings, 'voice' | 'participantVoice'>): string`
  - `QWEN_SPOKEN: readonly LanguageOption[]` (29), `QWEN_LANGUAGES: readonly LanguageOption[]` (60, spoken first), `qwenLanguages`
  - `interface QwenCredentials { apiKey: string }`, `qwenCredentials`

- [ ] **Step 1: Write the failing test**

Create `src/providers/qwen_livetranslate/settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canonicalTag, parseCode } from '../../lib/language/code';
import { AUTO } from '../../lib/provider/languages';
import type { AuthContext } from '../../lib/provider/types';
import {
  QWEN_DEFAULTS, QWEN_LANGUAGES, QWEN_MODEL, QWEN_SPOKEN, QWEN_VOICES, qwenCredentials, qwenLanguages, qwenParticipantVoice, qwenSpeakerVoice, SPEAKER_CLONE,
} from './settings';

const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
const codes = (list: readonly { value: string }[]) => list.map((o) => o.value);

describe("Qwen LiveTranslate's settings", () => {
  it('runs one model, and starts from two different presets', () => {
    expect(QWEN_MODEL).toBe('qwen3.8-livetranslate-flash-realtime');
    expect(QWEN_DEFAULTS).toEqual({ voice: 'Tina', participantVoice: 'Ethan' });
  });

  it('lists the 47 presets in the vendor order, names sent verbatim, none named like the clone choice', () => {
    expect(QWEN_VOICES).toHaveLength(47);
    expect(new Set(QWEN_VOICES.map((v) => v.value)).size).toBe(47);
    expect(QWEN_VOICES.slice(0, 3).map((v) => v.value)).toEqual(['Tina', 'Cindy', 'Liora Mira']);
    expect(QWEN_VOICES[QWEN_VOICES.length - 1].value).toBe('Chloe');
    expect(QWEN_VOICES.map((v) => v.value)).toContain('Eliška');
    for (const v of QWEN_VOICES) {
      expect(v.name, v.value).toBe(v.value);
      expect(v.description, v.value).not.toBe('');
    }
    expect(QWEN_VOICES.map((v) => v.value)).not.toContain(SPEAKER_CLONE);
    expect(QWEN_VOICES.map((v) => v.value)).toContain(QWEN_DEFAULTS.voice);
    expect(QWEN_VOICES.map((v) => v.value)).toContain(QWEN_DEFAULTS.participantVoice);
  });

  it('runs my choice — a preset or the clone — and Tina for anything the list does not have', () => {
    expect(qwenSpeakerVoice({ voice: 'Serena' })).toBe('Serena');
    expect(qwenSpeakerVoice({ voice: SPEAKER_CLONE })).toBe(SPEAKER_CLONE);
    expect(qwenSpeakerVoice({ voice: 'Cherry' })).toBe('Tina');
    expect(qwenSpeakerVoice({ voice: '' })).toBe('Tina');
  });

  it("never gives the other party my preset, lets both legs clone, and runs Ethan for anything the list does not have", () => {
    expect(qwenParticipantVoice({ voice: 'Tina', participantVoice: 'Serena' })).toBe('Serena');
    expect(qwenParticipantVoice({ voice: 'Serena', participantVoice: 'Serena' })).toBe('Ethan');
    expect(qwenParticipantVoice({ voice: 'Ethan', participantVoice: 'Ethan' })).toBe('Tina');
    expect(qwenParticipantVoice({ voice: SPEAKER_CLONE, participantVoice: SPEAKER_CLONE })).toBe(SPEAKER_CLONE);
    expect(qwenParticipantVoice({ voice: SPEAKER_CLONE, participantVoice: 'Tina' })).toBe('Tina');
    expect(qwenParticipantVoice({ voice: 'Tina', participantVoice: 'Cherry' })).toBe('Ethan');
    // A stale choice of mine falls to Tina first, so the other party still differs from what I run.
    expect(qwenParticipantVoice({ voice: 'Cherry', participantVoice: 'Tina' })).toBe('Ethan');
  });

  it('offers 60 canonical app codes, 29 of them spoken, each once', () => {
    expect(QWEN_LANGUAGES).toHaveLength(60);
    expect(QWEN_SPOKEN).toHaveLength(29);
    expect(new Set(codes(QWEN_LANGUAGES)).size).toBe(60);
    expect(codes(QWEN_LANGUAGES).slice(0, 29)).toEqual(codes(QWEN_SPOKEN));
    for (const code of codes(QWEN_LANGUAGES)) {
      expect(canonicalTag(code), code).toBe(code);
      expect(parseCode(code), code).not.toBeNull();
    }
    expect(codes(QWEN_SPOKEN)).toEqual(expect.arrayContaining(['zh', 'en', 'ja', 'ko', 'nb', 'fil', 'fa']));
    expect(codes(QWEN_LANGUAGES)).toEqual(expect.arrayContaining(['yue', 'uk', 'ast', 'ceb']));
    expect(codes(QWEN_SPOKEN)).not.toContain('uk');
    expect(codes(QWEN_LANGUAGES)).not.toContain('zh-TW');
  });

  it('offers Auto-detect and the 60 as sources, the 29 spoken targets to a speaking run and all 60 otherwise, through the identity wire', () => {
    const s = QWEN_DEFAULTS;
    expect(codes(qwenLanguages.sources(s))).toEqual([AUTO, ...codes(QWEN_LANGUAGES)]);
    expect(codes(qwenLanguages.sources(s, { speech: true }))).toEqual([AUTO, ...codes(QWEN_LANGUAGES)]);
    expect(codes(qwenLanguages.targets('zh', s, { speech: true }))).toEqual(codes(QWEN_SPOKEN));
    expect(codes(qwenLanguages.targets('zh', s, { speech: false }))).toEqual(codes(QWEN_LANGUAGES));
    expect(codes(qwenLanguages.targets('zh', s))).toEqual(codes(QWEN_LANGUAGES));
    expect(qwenLanguages.initial).toBeUndefined();
    expect(qwenLanguages.wire.toWire('fil')).toBe('fil');
  });

  it('reads one trimmed key, and an empty one as missing', () => {
    expect(qwenCredentials.keys).toEqual(['apiKey']);
    expect(qwenCredentials.fields(QWEN_DEFAULTS)).toEqual([{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }]);
    expect(qwenCredentials.read({ apiKey: '  sk-ws-T.ABCDEFGH.ijklmnop\n' }, signedOut)).toEqual({ apiKey: 'sk-ws-T.ABCDEFGH.ijklmnop' });
    expect(qwenCredentials.read({ apiKey: ' ' }, signedOut)).toEqual({ missing: 'Enter your Qwen API key.' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/providers/qwen_livetranslate/settings.test.ts`
Expected: FAIL — `Failed to resolve import "./settings"`.

- [ ] **Step 3: Write `settings.ts`**

Create `src/providers/qwen_livetranslate/settings.ts`:

```ts
/**
 * Qwen LiveTranslate's `S`, voices, languages and credentials (spec
 * 2026-10-13, §3 and §4). New with this provider: no slice an older build
 * stored, so no `legacyKeys` and no `migrate`. A stored voice the list does
 * not have falls to the default where it is read, never rewritten.
 */
import { identityWire } from '../../lib/language/wire';
import { AUTO } from '../../lib/provider/languages';
import type { CredentialsMissing, LanguageContext, LanguageOption, Provider } from '../../lib/provider/types';
import { distinctVoice } from '../../lib/provider/voices';

/** The one model (D1): the check finds the storefront, nothing chooses a model. */
export const QWEN_MODEL = 'qwen3.8-livetranslate-flash-realtime';

/** The speaker's own voice, cloned in real time (D5): a choice beside the presets, sent as `enable_voice_clone`. */
export const SPEAKER_CLONE = 'clone';

export interface QwenVoice {
  /** The vendor's name, sent verbatim: spaces and diacritics included. */
  value: string;
  name: string;
  /** Only where the official list says so. */
  gender?: 'female' | 'male';
  /** The official list's line, in its own English. */
  description: string;
}

const voice = (name: string, description: string, gender?: 'female' | 'male'): QwenVoice =>
  (gender ? { value: name, name, gender, description } : { value: name, name, description });

/** The 47 presets in the vendor's order (the official omni voice list, 2026-10-13). Every one speaks every spoken target; `Cherry` is not among them (refused, probe 2026-10-13). */
export const QWEN_VOICES: readonly QwenVoice[] = [
  voice("Tina", "Sweet and warm — like a cup of milk tea — and unmistakably capable when it's time to solve problems."),
  voice("Cindy", "Soft, sweet young woman with a Taiwanese accent.", "female"),
  voice("Liora Mira", "Gentle and warm, with the everyday charm of a quiet evening."),
  voice("Sunnybobi", "Easygoing, slightly shy girl-next-door.", "female"),
  voice("Raymond", "Bright voice; the laid-back homebody type."),
  voice("Ethan", "Standard Mandarin with a hint of Northern Chinese accent; sunny, warm, and energetic."),
  voice("Theo Calm", "Calm and reassuring; speaks with quiet understanding."),
  voice("Serena", "Gentle young woman.", "female"),
  voice("Harvey", "Low, mellow voice with a hint of coffee-and-old-books warmth."),
  voice("Maia", "Where intellect meets gentleness."),
  voice("Evan", "Young, warm male voice with a youthful, playful tone.", "male"),
  voice("Qiao", "Cute on the surface, with plenty of personality underneath."),
  voice("Momo", "Playful and sweet; designed to lift the mood."),
  voice("Wil", "Young man with a Hong Kong/Taiwan-influenced accent — Shenzhen-raised.", "male"),
  voice("Angel", "Sweet voice with a slight Taiwanese accent."),
  voice("Li Cassian", "Subtle and observant; says little, conveys much."),
  voice("Mia", "Gentle and reflective; well-suited for lifestyle and wellness content."),
  voice("Joyner", "Comedic, expressive, and down-to-earth."),
  voice("Gold", "West Coast rapper style."),
  voice("Katerina", "Mature, expressive female voice with rhythmic depth.", "female"),
  voice("Ryan", "Dynamic and dramatic; high energy with strong emotional range."),
  voice("Jennifer", "Premium, cinematic American English female voice.", "female"),
  voice("Aiden", "American English male voice with a friendly, casual feel.", "male"),
  voice("Mione", "Mature, intellectual British English female voice.", "female"),
  voice("Sohee", "Warm, expressive Korean female voice.", "female"),
  voice("Lenn", "Rational with a subtle edge — a German voice that pairs business attire with post-punk taste."),
  voice("Ono Anna", "Playful and mischievous, like a childhood friend."),
  voice("Sonrisa", "Warm, outgoing Latin American female voice.", "female"),
  voice("Bodega", "Warm, friendly Spanish male voice.", "male"),
  voice("Emilien", "Romantic French male voice.", "male"),
  voice("Andre", "Magnetic, natural, and steady male voice.", "male"),
  voice("Radio Gol", "Sports commentator style — expressive Brazilian Portuguese."),
  voice("Alek", "Cool yet warm — classic Russian timbre."),
  voice("Rizky", "Young Indonesian male voice with character.", "male"),
  voice("Roya", "Active, free-spirited female voice.", "female"),
  voice("Arda", "Balanced and clean, with a warm undertone."),
  voice("Hana", "Mature Vietnamese female voice with a dog-loving older-sister feel.", "female"),
  voice("Dolce", "Relaxed, easygoing Italian male voice.", "male"),
  voice("Jakub", "Magnetic, artistic Polish male voice.", "male"),
  voice("Griet", "Mature, artistic Dutch female voice.", "female"),
  voice("Eliška", "Czech voice with crafted, warm articulation — every word carries Central European care."),
  voice("Marina", "Female voice raised in a multicultural urban environment.", "female"),
  voice("Siiri", "Reserved and gentle, paced like ripples on a quiet lake."),
  voice("Ingrid", "Norwegian countryside female voice.", "female"),
  voice("Sigga", "Intellectual Icelandic female voice.", "female"),
  voice("Bea", "Sweet Filipino female voice with a coffee-shop charm.", "female"),
  voice("Chloe", "Malaysian female voice with a professional, white-collar feel.", "female"),
];

export interface QwenSettings {
  /** My leg's voice: one of `QWEN_VOICES`, or `SPEAKER_CLONE`. */
  voice: string;
  /** The voice that reads the other person's words to me: the same choices. */
  participantVoice: string;
}

export const QWEN_DEFAULT_VOICE = 'Tina';
/** A male preset beside Tina, so the two people never sound alike by default. */
export const QWEN_PARTICIPANT_DEFAULT_VOICE = 'Ethan';
export const QWEN_DEFAULTS: QwenSettings = { voice: QWEN_DEFAULT_VOICE, participantVoice: QWEN_PARTICIPANT_DEFAULT_VOICE };

/** A choice the list offers: the list is the only check, since the server refuses an unknown voice only at the first speech (probe 2026-10-13). */
const listed = (v: string) => v === SPEAKER_CLONE || QWEN_VOICES.some((o) => o.value === v);

/** My voice for a run: the choice while the list has it, else Tina. */
export function qwenSpeakerVoice(s: Pick<QwenSettings, 'voice'>): string {
  return listed(s.voice) ? s.voice : QWEN_DEFAULT_VOICE;
}

/** The other party's voice for a run: never my preset (`distinctVoice`). The clone is exempt: each leg clones its own speaker. */
export function qwenParticipantVoice(s: Pick<QwenSettings, 'voice' | 'participantVoice'>): string {
  const chosen = listed(s.participantVoice) ? s.participantVoice : QWEN_PARTICIPANT_DEFAULT_VOICE;
  if (chosen === SPEAKER_CLONE) return chosen;
  return distinctVoice(chosen, qwenSpeakerVoice(s), { participant: QWEN_PARTICIPANT_DEFAULT_VOICE, speaker: QWEN_DEFAULT_VOICE });
}

/** The 29 targets Qwen speaks, in the official list's order. */
const SPOKEN = ['zh', 'en', 'ar', 'de', 'fr', 'es', 'pt', 'id', 'it', 'ko', 'ru', 'th', 'vi', 'ja', 'tr', 'hi', 'ms', 'nl', 'ur', 'nb', 'sv', 'da', 'he', 'fi', 'pl', 'is', 'cs', 'fil', 'fa'];
/** The 31 it only writes: a speaking session refuses them ("Target language 'uk' only supports text output"). */
const TEXT_ONLY = ['yue', 'el', 'af', 'ast', 'be', 'bg', 'bn', 'bs', 'ca', 'ceb', 'et', 'gl', 'gu', 'hr', 'hu', 'jv', 'kk', 'kn', 'ky', 'lv', 'mk', 'ml', 'mr', 'pa', 'ro', 'sk', 'sl', 'sw', 'tg', 'az', 'uk'];

export const QWEN_SPOKEN: readonly LanguageOption[] = SPOKEN.map((value) => ({ value }));
/** All 60, spoken first. Each is Qwen's own code and already a canonical app code, so the wire is the identity. */
export const QWEN_LANGUAGES: readonly LanguageOption[] = [...SPOKEN, ...TEXT_ONLY].map((value) => ({ value }));

/**
 * The model detects the source itself, so the sources are `AUTO` and the
 * 60: a concrete one exists so the participant leg can reverse the pair
 * (D20 refuses `AUTO` there). A speaking run is offered the 29 targets it
 * can speak, as Doubao AST 2.0 does; the text offer is all 60.
 */
export const qwenLanguages: Provider<QwenSettings, never, never>['languages'] = {
  sources: () => [{ value: AUTO }, ...QWEN_LANGUAGES],
  targets: (_source, _s, context?: LanguageContext) => (context?.speech === true ? QWEN_SPOKEN : QWEN_LANGUAGES),
  wire: identityWire(),
};

export interface QwenCredentials {
  apiKey: string;
}

export const qwenCredentials: Provider<QwenSettings, QwenCredentials, never>['credentials'] = {
  keys: ['apiKey'],
  fields: () => [{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }],
  read: (values): QwenCredentials | CredentialsMissing => {
    // Trimmed: the key rides in a header, where a pasted trailing newline or space is no valid token.
    const apiKey = (values.apiKey ?? '').trim();
    // No code: the runner words it `credentials_missing`.
    return apiKey ? { apiKey } : { missing: 'Enter your Qwen API key.' };
  },
};
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/providers/qwen_livetranslate/settings.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/providers/qwen_livetranslate/settings.ts src/providers/qwen_livetranslate/settings.test.ts
git commit -m "feat(qwen): settings, voices, languages and credentials

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Storefronts and the key check

**Files:**
- Create: `src/providers/qwen_livetranslate/endpoints.ts`, `src/providers/qwen_livetranslate/check.ts`
- Modify: `src/lib/provider/boundedFetch.ts` (its header comment's last sentence)
- Test: `src/providers/qwen_livetranslate/check.test.ts`

**Interfaces:**
- Consumes: `QwenCredentials`, `QwenSettings` (Task 2); `boundedFetch`; `realClock`, `Clock`.
- Produces:
  - `ENDPOINTS: { intl: { name: 'QwenCloud'; socket; tokens }; cn: { name: '千问云'; socket; tokens } }`, `type EndpointId = 'intl' | 'cn'`, `ENDPOINT_ORDER: readonly EndpointId[]`, `isEndpointId(v: unknown): v is EndpointId`
  - `DETECT_TIMEOUT_MS = 15_000`
  - `interface DetectDeps { fetch?: typeof fetch; clock?: Pick<Clock, 'setTimeout'>; signal?: AbortSignal }`
  - `type Detection = { endpoint: EndpointId } | { refused: string; code: 'auth' | 'rate_limit' }`
  - `type DetectEndpoint = (apiKey: string, o: DetectDeps) => Promise<Detection>`, `detectEndpoint: DetectEndpoint`
  - `createQwenCheck(deps?: Omit<DetectDeps, 'signal'>)`, `checkQwen(k, s, ctx): Promise<CheckResult>` answering `{ ok: true, models: [{ id: EndpointId }] }`

- [ ] **Step 1: Write the failing test**

Create `src/providers/qwen_livetranslate/check.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { CheckContext } from '../../lib/provider/types';
import { createQwenCheck, DETECT_TIMEOUT_MS, detectEndpoint } from './check';
import { ENDPOINTS, isEndpointId } from './endpoints';
import { QWEN_DEFAULTS } from './settings';

const K = { apiKey: 'sk-ws-T.ABCDEFGH.ijklmnop.QRSTUVWX0123456789' };
const ctx: CheckContext = { pair: { source: 'zh', target: 'en' }, legs: ['speaker'] };
const answer = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const refused = () => answer(401, { code: 'InvalidApiKey', message: 'Invalid API-key provided.' });
const check = (fetch: typeof globalThis.fetch, c: CheckContext = ctx) => createQwenCheck({ fetch, clock: createVirtualClock(0) })(K, QWEN_DEFAULTS, c);
const urls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.map((call) => (call as unknown as [string])[0]);

describe("Qwen LiveTranslate's storefronts", () => {
  it('are QwenCloud and 千问云, each a socket and a token endpoint on one host', () => {
    expect(ENDPOINTS).toEqual({
      intl: { name: 'QwenCloud', socket: 'wss://maas.qwencloudapi.com/api-ws/v1/realtime', tokens: 'https://maas.qwencloudapi.com/api/v1/tokens' },
      cn: { name: '千问云', socket: 'wss://maas.qianwenaiapi.com/api-ws/v1/realtime', tokens: 'https://maas.qianwenaiapi.com/api/v1/tokens' },
    });
    expect(isEndpointId('intl')).toBe(true);
    expect(isEndpointId('cn')).toBe(true);
    expect(isEndpointId('gpt-live-1')).toBe(false);
  });
});

describe("Qwen LiveTranslate's check (spec §2)", () => {
  it('a key QwenCloud mints a token for is international: one POST, the key in the header alone, the token never read', async () => {
    const fetch = vi.fn(async () => answer(200, { token: 'st-unread', expires_at: 1 }));
    await expect(check(fetch)).resolves.toEqual({ ok: true, models: [{ id: 'intl' }] });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://maas.qwencloudapi.com/api/v1/tokens?expire_in_seconds=60');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: `Bearer ${K.apiKey}` } });
  });

  it('a key QwenCloud refuses and 千问云 accepts is mainland', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(refused()).mockResolvedValueOnce(answer(200, { token: 'st-unread' }));
    await expect(check(fetch)).resolves.toEqual({ ok: true, models: [{ id: 'cn' }] });
    expect(urls(fetch)).toEqual(['https://maas.qwencloudapi.com/api/v1/tokens?expire_in_seconds=60', 'https://maas.qianwenaiapi.com/api/v1/tokens?expire_in_seconds=60']);
  });

  it('a key both refuse — 401 or 403 — is not ready, as auth', async () => {
    await expect(check(vi.fn(async () => refused()))).resolves.toEqual({ ok: false, code: 'auth', reason: 'Neither QwenCloud nor 千问云 accepted this key (HTTP 401).' });
    await expect(check(vi.fn().mockResolvedValueOnce(answer(403)).mockResolvedValueOnce(refused()))).resolves.toMatchObject({ ok: false, code: 'auth' });
  });

  it('a rate limit is not ready, as rate_limit, and the other storefront is not asked', async () => {
    const fetch = vi.fn(async () => answer(429));
    await expect(check(fetch)).resolves.toEqual({ ok: false, code: 'rate_limit', reason: 'QwenCloud is limiting requests (HTTP 429).' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a status the key does not explain, or a failed request, cannot tell: it throws', async () => {
    await expect(check(vi.fn(async () => answer(500)))).rejects.toThrow('Qwen answered the key check with HTTP 500.');
    await expect(check(vi.fn(async () => { throw new TypeError('Failed to fetch'); }))).rejects.toThrow('Failed to fetch');
  });

  it(`no answer within ${DETECT_TIMEOUT_MS / 1000} s throws in words, the request aborted`, async () => {
    const clock = createVirtualClock(0);
    let aborted = false;
    const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); });
    }));
    const pending = createQwenCheck({ fetch: fetch as unknown as typeof globalThis.fetch, clock })(K, QWEN_DEFAULTS, ctx);
    clock.advance(DETECT_TIMEOUT_MS);
    await expect(pending).rejects.toThrow(`Qwen did not answer the key check within ${DETECT_TIMEOUT_MS / 1000} s.`);
    expect(aborted).toBe(true);
  });

  it("a check its caller aborts throws the caller's reason", async () => {
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    await expect(check(vi.fn(async () => answer(200)), { ...ctx, signal: controller.signal })).rejects.toThrow('stopped');
  });

  it('detection alone answers the storefront or the refusal, for the adapter to use', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(refused()).mockResolvedValueOnce(answer(200));
    await expect(detectEndpoint(K.apiKey, { fetch, clock: createVirtualClock(0) })).resolves.toEqual({ endpoint: 'cn' });
    await expect(detectEndpoint(K.apiKey, { fetch: vi.fn(async () => refused()), clock: createVirtualClock(0) }))
      .resolves.toEqual({ refused: 'Neither QwenCloud nor 千问云 accepted this key (HTTP 401).', code: 'auth' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/providers/qwen_livetranslate/check.test.ts`
Expected: FAIL — `Failed to resolve import "./check"`.

- [ ] **Step 3: Write `endpoints.ts`**

Create `src/providers/qwen_livetranslate/endpoints.ts`:

```ts
/**
 * Qwen LiveTranslate's two storefronts (spec 2026-10-13, §2; D2): one
 * Alibaba realtime protocol behind each, and a key good on one only — the
 * other answers 401. The check finds which; nothing else chooses. Pure data,
 * read by the adapter, the check and the settings view.
 */
export const ENDPOINTS = {
  intl: { name: 'QwenCloud', socket: 'wss://maas.qwencloudapi.com/api-ws/v1/realtime', tokens: 'https://maas.qwencloudapi.com/api/v1/tokens' },
  cn: { name: '千问云', socket: 'wss://maas.qianwenaiapi.com/api-ws/v1/realtime', tokens: 'https://maas.qianwenaiapi.com/api/v1/tokens' },
} as const;

export type EndpointId = keyof typeof ENDPOINTS;

/** The order detection asks them in: international first. */
export const ENDPOINT_ORDER: readonly EndpointId[] = ['intl', 'cn'];

export function isEndpointId(v: unknown): v is EndpointId {
  return v === 'intl' || v === 'cn';
}
```

- [ ] **Step 4: Write `check.ts`**

Create `src/providers/qwen_livetranslate/check.ts`:

```ts
/**
 * Qwen LiveTranslate's readiness and storefront (spec 2026-10-13, §2): the
 * key is asked for a one-minute token at each storefront in turn. A 200
 * names the storefront — the token is never read: it expires on its own,
 * opens no session and costs nothing. A 401 or 403 moves on; refused by
 * both is `auth`, a 429 is `rate_limit`, and anything else throws: the check
 * could not tell. HTTPS, not the socket: a browser hides a refused upgrade's
 * status. CORS answers any origin, the extension's and `file://` included
 * (probe 2026-10-13). The settings side; the adapter runs `detectEndpoint`
 * only when its config names no storefront, handed in as a dependency, on
 * the request's clock and signal.
 */
import { realClock, type Clock } from '../../lib/contract/clock';
import { boundedFetch } from '../../lib/provider/boundedFetch';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { ENDPOINT_ORDER, ENDPOINTS, type EndpointId } from './endpoints';
import type { QwenCredentials, QwenSettings } from './settings';

/** As long as the other checks wait, per storefront. */
export const DETECT_TIMEOUT_MS = 15_000;

export interface DetectDeps {
  fetch?: typeof fetch;
  clock?: Pick<Clock, 'setTimeout'>;
  signal?: AbortSignal;
}

export type Detection = { endpoint: EndpointId } | { refused: string; code: 'auth' | 'rate_limit' };
export type DetectEndpoint = (apiKey: string, o: DetectDeps) => Promise<Detection>;

export const detectEndpoint: DetectEndpoint = async (apiKey, o) => {
  // Read at call time, so a test's stubbed global is seen.
  const doFetch = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const clock = o.clock ?? realClock;
  const late = `Qwen did not answer the key check within ${DETECT_TIMEOUT_MS / 1000} s.`;
  let status = 0;
  for (const id of ENDPOINT_ORDER) {
    status = await boundedFetch({ clock, ms: DETECT_TIMEOUT_MS, signal: o.signal, late }, async (signal) => {
      const response = await doFetch(`${ENDPOINTS[id].tokens}?expire_in_seconds=60`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, signal });
      return response.status;
    });
    if (status === 200) return { endpoint: id };
    if (status === 429) return { refused: `${ENDPOINTS[id].name} is limiting requests (HTTP 429).`, code: 'rate_limit' };
    if (status !== 401 && status !== 403) throw new Error(`Qwen answered the key check with HTTP ${status}.`);
  }
  return { refused: `Neither QwenCloud nor 千问云 accepted this key (HTTP ${status}).`, code: 'auth' };
};

export function createQwenCheck(deps: Omit<DetectDeps, 'signal'> = {}) {
  return async (k: QwenCredentials, _s: QwenSettings, ctx: CheckContext): Promise<CheckResult> => {
    const found = await detectEndpoint(k.apiKey, { ...deps, signal: ctx.signal });
    // The one model entry names the storefront: `build` reads it from `shared.models`, the settings view from `models`.
    return 'endpoint' in found ? { ok: true, models: [{ id: found.endpoint }] } : { ok: false, reason: found.refused, code: found.code };
  };
}

export const checkQwen = createQwenCheck();
```

- [ ] **Step 5: Name the new caller in `boundedFetch`'s comment**

In `src/lib/provider/boundedFetch.ts`, replace the header comment's last sentence

```
 * the caller's listener removed however `run` settles. The settings side
 * only; no session code runs it.
```

with

```
 * the caller's listener removed however `run` settles. The settings side,
 * and one session-side caller: Qwen LiveTranslate's adapter, finding its
 * storefront when no check has, on the request's clock and signal.
```

- [ ] **Step 6: Run it to see it pass**

Run: `npx vitest run src/providers/qwen_livetranslate/check.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add src/providers/qwen_livetranslate/endpoints.ts src/providers/qwen_livetranslate/check.ts src/providers/qwen_livetranslate/check.test.ts src/lib/provider/boundedFetch.ts
git commit -m "feat(qwen): find the key's storefront in the readiness check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The builder

**Files:**
- Create: `src/providers/qwen_livetranslate/config.ts`
- Test: `src/providers/qwen_livetranslate/config.test.ts`

**Interfaces:**
- Consumes: Task 2's `QWEN_MODEL`, `QWEN_LANGUAGES`, `QWEN_SPOKEN`, `SPEAKER_CLONE`, `qwenSpeakerVoice`, `qwenParticipantVoice`, `QwenSettings`; Task 3's `isEndpointId`, `EndpointId`.
- Produces:
  - `type QwenVoiceChoice = { kind: 'preset'; name: string } | { kind: 'clone' }`
  - `interface QwenConfig { model: typeof QWEN_MODEL; endpoint: EndpointId | null; target: string; speech: boolean; voice: QwenVoiceChoice; manual: boolean; person: boolean; transport: 'websocket' }`
  - `buildQwen(context: SessionContext, s: QwenSettings, shared: SharedSettings): QwenConfig | ProviderRefusal`
  - `describeQwen(c: QwenConfig): { translationModel: string }`

- [ ] **Step 1: Write the failing test**

Create `src/providers/qwen_livetranslate/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import { AUTO } from '../../lib/provider/languages';
import type { SharedSettings } from '../../lib/provider/types';
import { buildQwen, describeQwen } from './config';
import { QWEN_DEFAULTS, QWEN_MODEL, SPEAKER_CLONE } from './settings';

const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  reversed: (d) => d.source === 'en' && d.target === 'zh',
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'intl' }],
};
const ctx = (source: string, target: string, patch: Partial<SessionContext> = {}): SessionContext => ({ direction: { source, target }, speech: true, turns: 'auto', ...patch });

describe("Qwen LiveTranslate's builder (spec §5)", () => {
  it('builds my leg: the storefront the check found, the target, my preset, automatic turns, no person labels', () => {
    expect(buildQwen(ctx('zh', 'en'), QWEN_DEFAULTS, SHARED)).toEqual({
      model: QWEN_MODEL, endpoint: 'intl', target: 'en', speech: true, voice: { kind: 'preset', name: 'Tina' }, manual: false, person: false, transport: 'websocket',
    });
  });

  it("builds the other party's leg in its own voice, labelling who speaks (D7)", () => {
    expect(buildQwen(ctx('en', 'zh'), QWEN_DEFAULTS, SHARED)).toMatchObject({ target: 'zh', voice: { kind: 'preset', name: 'Ethan' }, person: true });
  });

  it('reads the storefront from the models the check found, and none from anything else', () => {
    expect(buildQwen(ctx('zh', 'en'), QWEN_DEFAULTS, { ...SHARED, models: [{ id: 'cn' }] })).toMatchObject({ endpoint: 'cn' });
    expect(buildQwen(ctx('zh', 'en'), QWEN_DEFAULTS, { ...SHARED, models: [] })).toMatchObject({ endpoint: null });
    expect(buildQwen(ctx('zh', 'en'), QWEN_DEFAULTS, { ...SHARED, models: [{ id: 'gpt-live-1' }] })).toMatchObject({ endpoint: null });
  });

  it('turns are manual under push-to-talk', () => {
    expect(buildQwen(ctx('zh', 'en', { turns: 'manual' }), QWEN_DEFAULTS, SHARED)).toMatchObject({ manual: true });
  });

  it("clones each leg's own speaker when chosen, on both legs at once", () => {
    const both = { voice: SPEAKER_CLONE, participantVoice: SPEAKER_CLONE };
    expect(buildQwen(ctx('zh', 'en'), both, SHARED)).toMatchObject({ voice: { kind: 'clone' } });
    expect(buildQwen(ctx('en', 'zh'), both, SHARED)).toMatchObject({ voice: { kind: 'clone' } });
  });

  it('runs the default for a stored voice the list does not have, and never gives the other party my preset', () => {
    expect(buildQwen(ctx('zh', 'en'), { voice: 'Cherry', participantVoice: 'Ethan' }, SHARED)).toMatchObject({ voice: { kind: 'preset', name: 'Tina' } });
    expect(buildQwen(ctx('en', 'zh'), { voice: 'Serena', participantVoice: 'Serena' }, SHARED)).toMatchObject({ voice: { kind: 'preset', name: 'Ethan' } });
  });

  it('refuses Auto-detect or an unknown target, and a text-only target on a leg that speaks — which builds with speech off', () => {
    expect(buildQwen(ctx('zh', AUTO), QWEN_DEFAULTS, SHARED)).toEqual({ refused: 'Qwen LiveTranslate does not translate into auto.' });
    expect(buildQwen(ctx('zh', 'zh-TW'), QWEN_DEFAULTS, SHARED)).toEqual({ refused: 'Qwen LiveTranslate does not translate into zh-TW.' });
    expect(buildQwen(ctx('zh', 'uk'), QWEN_DEFAULTS, SHARED)).toEqual({ refused: 'Qwen LiveTranslate writes uk but does not speak it: turn speech off for this leg.' });
    expect(buildQwen(ctx('zh', 'uk', { speech: false }), QWEN_DEFAULTS, SHARED)).toMatchObject({ target: 'uk', speech: false });
  });

  it('describes the one model', () => {
    const c = buildQwen(ctx('zh', 'en'), QWEN_DEFAULTS, SHARED);
    if ('refused' in c) throw new Error(c.refused);
    expect(describeQwen(c)).toEqual({ translationModel: QWEN_MODEL });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/providers/qwen_livetranslate/config.test.ts`
Expected: FAIL — `Failed to resolve import "./config"`.

- [ ] **Step 3: Write `config.ts`**

Create `src/providers/qwen_livetranslate/config.ts`:

```ts
/**
 * Qwen LiveTranslate's `C`, `build` and `describe` (spec 2026-10-13, §5).
 * One builder for both legs: the participant's is the reversed direction,
 * in its own voice and with person labels (D7). The storefront is the one
 * the check found, or null for the adapter to find (§2). A text-only target
 * on a leg that speaks is refused here, so the update the server would
 * refuse is never sent.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { isEndpointId, type EndpointId } from './endpoints';
import { QWEN_LANGUAGES, QWEN_MODEL, QWEN_SPOKEN, qwenParticipantVoice, qwenSpeakerVoice, SPEAKER_CLONE, type QwenSettings } from './settings';

export type QwenVoiceChoice = { kind: 'preset'; name: string } | { kind: 'clone' };

export interface QwenConfig {
  model: typeof QWEN_MODEL;
  /** The key's storefront as the check found it; null: the adapter finds it before it opens. */
  endpoint: EndpointId | null;
  /** A Qwen code, which is the app code. */
  target: string;
  /** `context.speech`: the update asks for audio only when the leg speaks. */
  speech: boolean;
  voice: QwenVoiceChoice;
  /** Push-to-talk: no server turn detection; a release commits. */
  manual: boolean;
  /** The participant leg: each turn carries its speaker as `person`. */
  person: boolean;
  /** WebSocket only. It reaches `info.transport`, which analytics reports. */
  transport: 'websocket';
}

export function buildQwen(context: SessionContext, s: QwenSettings, shared: SharedSettings): QwenConfig | ProviderRefusal {
  const { target } = context.direction;
  // A guard: the languages offer the 60 only (never `AUTO` as a target), so the runner never builds another.
  if (!QWEN_LANGUAGES.some((o) => o.value === target)) return { refused: `Qwen LiveTranslate does not translate into ${target}.` };
  // A stale pair can still name a text-only target on a leg that speaks: the server would refuse the update.
  if (context.speech && !QWEN_SPOKEN.some((o) => o.value === target)) return { refused: `Qwen LiveTranslate writes ${target} but does not speak it: turn speech off for this leg.` };
  const participant = shared.reversed(context.direction);
  const chosen = participant ? qwenParticipantVoice(s) : qwenSpeakerVoice(s);
  const storefront = shared.models[0]?.id;
  return {
    model: QWEN_MODEL,
    endpoint: isEndpointId(storefront) ? storefront : null,
    target,
    speech: context.speech,
    voice: chosen === SPEAKER_CLONE ? { kind: 'clone' } : { kind: 'preset', name: chosen },
    manual: context.turns === 'manual',
    person: participant,
    transport: 'websocket',
  };
}

export function describeQwen(c: QwenConfig): { translationModel: string } {
  return { translationModel: c.model };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/providers/qwen_livetranslate/config.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/providers/qwen_livetranslate/config.ts src/providers/qwen_livetranslate/config.test.ts
git commit -m "feat(qwen): build each leg's session config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The wire

**Files:**
- Create: `src/providers/qwen_livetranslate/wire.ts`
- Test: `src/providers/qwen_livetranslate/wire.test.ts`

**Interfaces:**
- Consumes: `SAMPLE_RATE` (`src/lib/contract/adapter`), `pcmToBase64` / `base64ToPcm` (`src/lib/contract/pcm64`), `UpgradeHeaders`; Task 3's `ENDPOINTS`, `EndpointId`; Task 4's `QwenConfig`; Task 2's `QwenCredentials`.
- Produces:
  - `socketUrl(endpoint: EndpointId, model: string): string`
  - `qwenHeaders(k: QwenCredentials): UpgradeHeaders`
  - `interface SessionUpdate`, `sessionUpdate(c: Pick<QwenConfig, 'target' | 'speech' | 'voice' | 'manual'>): SessionUpdate`
  - `appendFrame(pcm: Int16Array): string`; `COMMIT`, `CLEAR`, `FINISH` (each `{ type }`)
  - `interface ServerEvent { type: string; [field: string]: unknown }`, `decodeServerEvent(data: unknown): ServerEvent`, `str(v: unknown): string | null`
  - `interface QwenError { code: string | null; message: string | null }`, `errorOf(e: ServerEvent): QwenError`, `errorWords(e: QwenError): string`, `errorCode(e: QwenError): string`
  - re-export `base64ToPcm`

- [ ] **Step 1: Write the failing test**

Create `src/providers/qwen_livetranslate/wire.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  appendFrame, base64ToPcm, CLEAR, COMMIT, decodeServerEvent, errorCode, errorOf, errorWords, FINISH, qwenHeaders, sessionUpdate, socketUrl,
} from './wire';

const MODEL = 'qwen3.8-livetranslate-flash-realtime';
const preset = { target: 'en', speech: true, voice: { kind: 'preset' as const, name: 'Tina' }, manual: false };
const INPUT = { format: { type: 'pcm', sample_rate: 24000 } };

describe("Qwen LiveTranslate's wire (spec §6)", () => {
  it('dials each storefront with the model in the query and nothing else', () => {
    expect(socketUrl('intl', MODEL)).toBe('wss://maas.qwencloudapi.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime');
    expect(socketUrl('cn', MODEL)).toBe('wss://maas.qianwenaiapi.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime');
  });

  it('carries the key in the upgrade header alone (D3)', () => {
    expect(qwenHeaders({ apiKey: 'sk-ws-T.ABCDEFGH' })).toEqual({ set: { Authorization: 'Bearer sk-ws-T.ABCDEFGH' } });
  });

  it('asks a speaking leg for text and audio in its preset, at 24 kHz in, with server turns', () => {
    expect(sessionUpdate(preset)).toEqual({
      type: 'session.update',
      session: { output_modalities: ['text', 'audio'], translation: { language: 'en' }, audio: { input: INPUT, output: { voice: 'Tina' } } },
    });
  });

  it('turns server turn detection off under push-to-talk', () => {
    expect(sessionUpdate({ ...preset, manual: true }).session.audio.input).toEqual({ ...INPUT, turn_detection: null });
  });

  it('clones the speaker on every turn: the voice "default", cloning on, always', () => {
    expect(sessionUpdate({ ...preset, voice: { kind: 'clone' } }).session).toEqual({
      output_modalities: ['text', 'audio'],
      translation: { language: 'en' },
      audio: { input: INPUT, output: { voice: 'default' } },
      enable_voice_clone: true,
      voice_clone_options: { frequency: 'always' },
    });
  });

  it('asks a leg that does not speak for text alone: no output, no cloning, whatever voice is chosen', () => {
    for (const voice of [preset.voice, { kind: 'clone' as const }]) {
      expect(sessionUpdate({ ...preset, speech: false, voice }).session).toEqual({ output_modalities: ['text'], translation: { language: 'en' }, audio: { input: INPUT } });
    }
    expect(sessionUpdate({ ...preset, speech: false, manual: true }).session.audio).toEqual({ input: { ...INPUT, turn_detection: null } });
  });

  it('sends preset names verbatim, spaces and diacritics included', () => {
    expect(sessionUpdate({ ...preset, voice: { kind: 'preset', name: 'Liora Mira' } }).session.audio.output).toEqual({ voice: 'Liora Mira' });
    expect(sessionUpdate({ ...preset, voice: { kind: 'preset', name: 'Eliška' } }).session.audio.output).toEqual({ voice: 'Eliška' });
  });

  it('appends pcm as base64, as it came', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768]);
    const frame = JSON.parse(appendFrame(pcm)) as { type: string; audio: string };
    expect(frame.type).toBe('input_audio_buffer.append');
    expect(Array.from(base64ToPcm(frame.audio))).toEqual(Array.from(pcm));
    expect([COMMIT, CLEAR, FINISH]).toEqual([{ type: 'input_audio_buffer.commit' }, { type: 'input_audio_buffer.clear' }, { type: 'session.finish' }]);
  });

  it('reads a text frame with a type, and refuses anything else', () => {
    expect(decodeServerEvent('{"type":"session.created","session":{}}')).toEqual({ type: 'session.created', session: {} });
    expect(() => decodeServerEvent(new ArrayBuffer(2))).toThrow('Qwen sent a binary frame where JSON text was expected.');
    expect(() => decodeServerEvent('not json')).toThrow();
    expect(() => decodeServerEvent('{"event_id":"e"}')).toThrow('Qwen sent a frame with no type.');
    expect(() => decodeServerEvent('null')).toThrow('Qwen sent a frame with no type.');
  });

  it("words an error in Qwen's own words with its code, clipped", () => {
    const voice = errorOf(decodeServerEvent(JSON.stringify({ type: 'error', error: { code: 'COMMON_ERROR', message: "<400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported." } })));
    expect(voice).toEqual({ code: 'COMMON_ERROR', message: "<400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported." });
    expect(errorWords(voice)).toBe("[Qwen COMMON_ERROR] <400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported.");
    expect(errorWords({ code: null, message: null })).toBe('[Qwen] Qwen reported an error without words.');
    expect(errorWords({ code: null, message: 'x'.repeat(400) })).toBe(`[Qwen] ${'x'.repeat(300)}…`);
    expect(errorOf({ type: 'error' })).toEqual({ code: null, message: null });
  });

  it('files each error under the code the user can act on', () => {
    const code = (c: string | null, m: string) => errorCode({ code: c, message: m });
    expect(code('InvalidApiKey', 'Invalid API-key provided.')).toBe('auth');
    expect(code(null, 'API Token is expired.')).toBe('auth');
    expect(code('Throttling', 'Requests rate limit exceeded, please try again later.')).toBe('rate_limit');
    expect(code(null, 'Allocated quota exceeded, please increase your quota limit.')).toBe('rate_limit');
    expect(code('COMMON_ERROR', "<400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported.")).toBe('client');
    expect(code('invalid_value', 'Invalid translation parameter.')).toBe('client');
    // A close's reason carries the message without its code.
    expect(code(null, 'Invalid translation parameter.')).toBe('client');
    expect(code(null, 'Internal error')).toBe('server');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/providers/qwen_livetranslate/wire.test.ts`
Expected: FAIL — `Failed to resolve import "./wire"`.

- [ ] **Step 3: Write `wire.ts`**

Create `src/providers/qwen_livetranslate/wire.ts`:

```ts
/**
 * Qwen LiveTranslate's wire (spec 2026-10-13, §6; the owner's probe,
 * `scripts/dev/wire-probe/qwen.mts`): the socket URL and its one upgrade
 * header, the client events the adapter sends, the server's events read
 * defensively, and the words and codes of its errors. Pure: no socket, no
 * timer.
 */
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import type { UpgradeHeaders } from '../../lib/contract/headerSocket';
import { pcmToBase64 } from '../../lib/contract/pcm64';
import type { QwenConfig } from './config';
import { ENDPOINTS, type EndpointId } from './endpoints';
import type { QwenCredentials } from './settings';

export { base64ToPcm } from '../../lib/contract/pcm64';

/** The storefront's socket with the model in its query; the key is never there (D3). */
export function socketUrl(endpoint: EndpointId, model: string): string {
  return `${ENDPOINTS[endpoint].socket}?model=${encodeURIComponent(model)}`;
}

/**
 * The upgrade's one header (D3). The one function of the session side that
 * reads the key: what it returns goes to the header seam alone, never a
 * frame, a word or a log. `Origin` is never checked, so nothing is removed.
 */
export function qwenHeaders(k: QwenCredentials): UpgradeHeaders {
  return { set: { Authorization: `Bearer ${k.apiKey}` } };
}

/** The session's one update (a second is refused, close 1007): `translation.language` is required, the voice sits under `audio.output`. */
export interface SessionUpdate {
  type: 'session.update';
  session: {
    output_modalities: Array<'text' | 'audio'>;
    translation: { language: string };
    audio: {
      /** 24 kHz goes straight through; `turn_detection: null` is push-to-talk. */
      input: { format: { type: 'pcm'; sample_rate: number }; turn_detection?: null };
      /** Only on a leg that speaks; the clone speaks as `default`. */
      output?: { voice: string };
    };
    enable_voice_clone?: true;
    voice_clone_options?: { frequency: 'always' };
  };
}

export function sessionUpdate(c: Pick<QwenConfig, 'target' | 'speech' | 'voice' | 'manual'>): SessionUpdate {
  const format = { type: 'pcm' as const, sample_rate: SAMPLE_RATE };
  const clone = c.speech && c.voice.kind === 'clone';
  return {
    type: 'session.update',
    session: {
      output_modalities: c.speech ? ['text', 'audio'] : ['text'],
      translation: { language: c.target },
      audio: {
        input: c.manual ? { format, turn_detection: null } : { format },
        ...(c.speech ? { output: { voice: c.voice.kind === 'clone' ? 'default' : c.voice.name } } : {}),
      },
      // Every turn re-clones its speaker, so each voice follows whoever is speaking (probe 2026-10-13); no extra tokens.
      ...(clone ? { enable_voice_clone: true as const, voice_clone_options: { frequency: 'always' as const } } : {}),
    },
  };
}

/** One chunk as it goes up: base64 of little-endian Int16, as it came. */
export function appendFrame(pcm: Int16Array): string {
  return JSON.stringify({ type: 'input_audio_buffer.append', audio: pcmToBase64(pcm) });
}

/** A push-to-talk release: the turn closes and its translation finishes within about 90 ms. */
export const COMMIT = { type: 'input_audio_buffer.commit' } as const;
/** A push-to-talk cancel: the buffer empties, and the response in flight never sends its `done`. */
export const CLEAR = { type: 'input_audio_buffer.clear' } as const;
/** Stop: answered by `session.finished`, which nothing waits for. */
export const FINISH = { type: 'session.finish' } as const;

/** A server event: its type, and whatever else it carries, read field by field where used. */
export interface ServerEvent {
  type: string;
  [field: string]: unknown;
}

export function decodeServerEvent(data: unknown): ServerEvent {
  if (typeof data !== 'string') throw new Error('Qwen sent a binary frame where JSON text was expected.');
  const parsed: unknown = JSON.parse(data);
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { type?: unknown }).type !== 'string') throw new Error('Qwen sent a frame with no type.');
  return parsed as ServerEvent;
}

/** A field as a string, else null. */
export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** An `error` event's `{ code, message }`: `invalid_value` at the update, `COMMON_ERROR` at the first speech (an unknown voice). */
export interface QwenError {
  code: string | null;
  message: string | null;
}

export function errorOf(e: ServerEvent): QwenError {
  const error = (typeof e.error === 'object' && e.error !== null ? e.error : {}) as { code?: unknown; message?: unknown };
  return { code: str(error.code), message: str(error.message) };
}

/** Qwen's own words, clipped, naming its code. */
export function errorWords(e: QwenError): string {
  const said = (e.message ?? '').trim() || 'Qwen reported an error without words.';
  const clipped = said.length > 300 ? `${said.slice(0, 300)}…` : said;
  return `[Qwen${e.code ? ` ${e.code}` : ''}] ${clipped}`;
}

/** The notice code its words fall under (spec §6): the key, a limit, a request the model refuses, else the server's. */
export function errorCode(e: QwenError): string {
  const said = `${e.code ?? ''} ${e.message ?? ''}`;
  if (/InvalidApiKey|InvalidApiToken|API Token is expired/i.test(said)) return 'auth';
  if (/rate limit|throttl|quota exceeded|Allocated quota/i.test(said)) return 'rate_limit';
  if (/not supported|invalid_value|InvalidParameter|invalid .*parameter/i.test(said)) return 'client';
  return 'server';
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/providers/qwen_livetranslate/wire.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/providers/qwen_livetranslate/wire.ts src/providers/qwen_livetranslate/wire.test.ts
git commit -m "feat(qwen): the realtime wire, its update and its errors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Segments

**Refinement of the spec:** a segment opens with its first words or audio, so an empty turn emits nothing (the spec had it open and close empty). The translation links to its heard item through `conversation.item.created`'s `previous_item_id`, which in the recorded order arrives right after `response.output_item.added` and before any delta; when it arrives later, the origin rides on `segmentClosed`.

**Files:**
- Create: `src/providers/qwen_livetranslate/segments.ts`
- Test: `src/providers/qwen_livetranslate/segments.test.ts`

**Interfaces:**
- Consumes: `AdapterEvents`, `Ref`, `Side` (`src/lib/contract/adapter`).
- Produces: `class QwenSegments` with
  - `constructor(o: { sink: Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio'>; person: boolean })`
  - `heard(itemId: string, speaker?: number | null): void`
  - `answer(itemId: string, previous?: string | null): void`
  - `text(itemId: string, side: Side, delta: string): void`
  - `done(itemId: string, side: Side, final: string | null): void`
  - `audio(itemId: string, pcm: Int16Array): void`
  - `cancel(): void`, `stop(): void`

- [ ] **Step 1: Write the failing test**

Create `src/providers/qwen_livetranslate/segments.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { recordEvents } from '../../lib/contract/events';
import { QwenSegments } from './segments';

function segments(person = false) {
  const { events, log } = recordEvents();
  const s = new QwenSegments({ sink: events, person });
  /** The log as `[kind, payload]`, audio by its ref and sample count. */
  const seen = () => log.map((e) => (e.kind === 'audio' ? ['audio', { ref: e.payload.ref, samples: e.payload.pcm.length }] : [e.kind, e.payload]));
  return { s, log, seen };
}
const pcm = (n = 240) => new Int16Array(n).fill(900);

describe("Qwen LiveTranslate's segments (spec §6)", () => {
  it('opens each side with its first words, sends the whole text on every delta, and closes on the final text', () => {
    const { s, seen } = segments();
    s.heard('h1', 1);
    s.answer('t1');
    s.answer('t1', 'h1');
    s.text('h1', 'source', '欢迎使用实时翻译 ');
    s.text('t1', 'translation', 'Welcome');
    s.text('t1', 'translation', ' to');
    s.audio('t1', pcm());
    s.text('h1', 'source', '希望');
    s.done('h1', 'source', '欢迎使用实时翻译 希望这个声音 ');
    s.done('t1', 'translation', 'Welcome to it. ');
    expect(seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'h1' }],
      ['segmentText', { ref: 1, text: '欢迎使用实时翻译' }],
      ['segmentOpened', { ref: 2, side: 'translation', origin: 'h1' }],
      ['segmentText', { ref: 2, text: 'Welcome' }],
      ['segmentText', { ref: 2, text: 'Welcome to' }],
      ['audio', { ref: 2, samples: 240 }],
      ['segmentText', { ref: 1, text: '欢迎使用实时翻译 希望' }],
      ['segmentText', { ref: 1, text: '欢迎使用实时翻译 希望这个声音' }],
      ['segmentClosed', { ref: 1 }],
      ['segmentText', { ref: 2, text: 'Welcome to it.' }],
      ['segmentClosed', { ref: 2 }],
    ]);
  });

  it("labels both sides with the heard item's speaker on the participant leg, and never on mine", () => {
    const mine = segments(false);
    mine.s.heard('h1', 2);
    mine.s.answer('t1', 'h1');
    mine.s.text('h1', 'source', 'a');
    mine.s.text('t1', 'translation', 'b');
    expect(mine.log.some((e) => 'person' in e.payload)).toBe(false);

    const theirs = segments(true);
    theirs.s.heard('h1', 2);
    theirs.s.answer('t1', 'h1');
    theirs.s.text('h1', 'source', 'a');
    theirs.s.text('t1', 'translation', 'b');
    expect(theirs.seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'h1', person: '2' }],
      ['segmentText', { ref: 1, text: 'a', person: '2' }],
      ['segmentOpened', { ref: 2, side: 'translation', origin: 'h1', person: '2' }],
      ['segmentText', { ref: 2, text: 'b', person: '2' }],
    ]);
  });

  it('opens items it only meets in a delta (manual turns name no speech start), with no person', () => {
    const { s, seen } = segments(true);
    s.text('h1', 'source', 'hi');
    s.done('h1', 'source', 'hi');
    expect(seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'h1' }],
      ['segmentText', { ref: 1, text: 'hi' }],
      ['segmentClosed', { ref: 1 }],
    ]);
  });

  it('states the origin when the translation closes, when its link came after it opened', () => {
    const { s, seen } = segments();
    s.heard('h1');
    s.text('t1', 'translation', 'Hello');
    s.answer('t1', 'h1');
    s.done('t1', 'translation', 'Hello.');
    expect(seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'translation' }],
      ['segmentText', { ref: 1, text: 'Hello' }],
      ['segmentText', { ref: 1, text: 'Hello.' }],
      ['segmentClosed', { ref: 1, origin: 'h1' }],
    ]);
  });

  it('shows nothing for an empty turn or a blank delta, and keeps the words it has when the final text is empty', () => {
    const empty = segments();
    empty.s.heard('h1', 1);
    empty.s.answer('t1', 'h1');
    empty.s.text('h1', 'source', ' ');
    empty.s.done('h1', 'source', '');
    empty.s.done('t1', 'translation', '');
    empty.s.audio('t1', pcm());
    expect(empty.log).toEqual([]);

    const kept = segments();
    kept.s.text('t1', 'translation', 'Hello.');
    kept.s.done('t1', 'translation', '');
    expect(kept.seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'translation' }],
      ['segmentText', { ref: 1, text: 'Hello.' }],
      ['segmentClosed', { ref: 1 }],
    ]);
  });

  it("plays audio that comes after the text's done in the translation's segment", () => {
    const { s, seen } = segments();
    s.text('t1', 'translation', 'Hi.');
    s.done('t1', 'translation', 'Hi.');
    s.audio('t1', pcm(100));
    const all = seen();
    expect(all[all.length - 1]).toEqual(['audio', { ref: 1, samples: 100 }]);
  });

  it('a cancel closes what is open with what it holds, and nothing more of those items is heard — a translation created after it included', () => {
    const { s, seen } = segments();
    s.heard('h1');
    s.text('h1', 'source', 'half a');
    s.answer('t0');
    s.cancel();
    s.text('h1', 'source', ' sentence');
    s.done('h1', 'source', 'half a sentence');
    s.text('t0', 'translation', 'late');
    s.audio('t0', pcm());
    s.answer('t1', 'h1');
    s.text('t1', 'translation', 'Half a');
    s.audio('t1', pcm());
    s.done('t1', 'translation', 'Half a sentence.');
    expect(seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'h1' }],
      ['segmentText', { ref: 1, text: 'half a' }],
      ['segmentClosed', { ref: 1 }],
    ]);
    // A new turn after the cancel is heard as usual.
    s.text('h2', 'source', 'next');
    const all = seen();
    expect(all[all.length - 1]).toEqual(['segmentText', { ref: 2, text: 'next' }]);
  });

  it('ignores an id named for the other side, and anything after stop', () => {
    const { s, log } = segments();
    s.heard('h1');
    s.text('h1', 'translation', 'not a translation');
    s.audio('h1', pcm());
    expect(log).toEqual([]);
    s.stop();
    s.text('h2', 'source', 'after');
    s.done('h2', 'source', 'after');
    expect(log).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/providers/qwen_livetranslate/segments.test.ts`
Expected: FAIL — `Failed to resolve import "./segments"`.

- [ ] **Step 3: Write `segments.ts`**

Create `src/providers/qwen_livetranslate/segments.ts`:

```ts
/**
 * Qwen LiveTranslate's events → segments (spec 2026-10-13, §6). The server
 * cuts the turns (`boundaries: 'provider'`); this only names them. Each turn
 * is two items: the heard one (`speech_started` under automatic turns, its
 * `conversation.item.created` with input audio under push-to-talk) and the
 * translation, whose `conversation.item.created` names the heard item as
 * `previous_item_id`: the heard item's id is the origin both sides state.
 * Deltas append and each sends the whole text, trimmed; a `.completed` /
 * `.done` replaces it and closes. A segment opens with its first words or
 * audio, so an empty turn shows nothing. On the participant leg (D7) the
 * heard item's `speaker_id` labels both sides. A cancelled turn closes what
 * it holds and hears nothing more. Pure: no socket, no timer.
 */
import type { AdapterEvents, Ref, Side } from '../../lib/contract/adapter';

export interface QwenSegmentsOptions {
  sink: Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio'>;
  /** Label each turn with its speaker (D7): the participant leg only. */
  person: boolean;
}

interface Item {
  side: Side;
  /** A translation's heard item, once named. */
  source?: string;
  /** Set when the segment opens, with its first words or audio. */
  ref?: Ref;
  /** Everything heard so far, and the trimmed snapshot last sent. */
  text: string;
  shown: string;
  /** The translation opened stating its origin. */
  stated: boolean;
  closed: boolean;
  /** Cancelled: nothing more of it is heard, its audio included. */
  dropped: boolean;
}

export class QwenSegments {
  private nextRef = 1;
  private readonly items = new Map<string, Item>();
  /** `speaker_id` by heard item, from `speech_started` (automatic turns only). */
  private readonly speakers = new Map<string, string>();
  private stopped = false;

  constructor(private readonly o: QwenSegmentsOptions) {}

  /** A heard item begins, with its speaker when told. */
  heard(itemId: string, speaker: number | null = null): void {
    if (speaker !== null) this.speakers.set(itemId, String(speaker));
    this.item(itemId, 'source');
  }

  /** A translation item, with the heard item it follows when told. The answer to a cancelled turn is cancelled with it. */
  answer(itemId: string, previous: string | null = null): void {
    const it = this.item(itemId, 'translation');
    if (!it || previous === null || it.source !== undefined) return;
    const heard = this.items.get(previous);
    if (heard?.side !== 'source') return;
    it.source = previous;
    if (heard.dropped && !it.closed) this.drop(it);
  }

  text(itemId: string, side: Side, delta: string): void {
    const it = this.item(itemId, side);
    if (!it || it.closed) return;
    it.text += delta;
    this.show(itemId, it);
  }

  /** The final text replaces what the deltas built, unless it is empty; then the segment closes. */
  done(itemId: string, side: Side, final: string | null): void {
    const it = this.item(itemId, side);
    if (!it || it.closed) return;
    if (final !== null && final.trim() !== '') it.text = final;
    this.show(itemId, it);
    this.close(it);
  }

  /** Translated speech, in its translation's segment — after that segment's text closed too. */
  audio(itemId: string, pcm: Int16Array): void {
    const it = this.item(itemId, 'translation');
    if (!it || it.dropped) return;
    if (it.ref === undefined) {
      // A translation that closed empty has no segment to hold it.
      if (it.closed) return;
      this.open(itemId, it);
    }
    this.o.sink.audio({ pcm, ref: it.ref });
  }

  /** A push-to-talk cancel: the server never finishes that response, so what is open closes here. */
  cancel(): void {
    for (const it of this.items.values()) if (!it.closed) this.drop(it);
  }

  stop(): void {
    this.stopped = true;
  }

  /** The item by id, made at its first mention; null after stop, or for an id named for the other side (a malformed event). */
  private item(itemId: string, side: Side): Item | null {
    if (this.stopped) return null;
    let it = this.items.get(itemId);
    if (!it) {
      it = { side, text: '', shown: '', stated: false, closed: false, dropped: false };
      this.items.set(itemId, it);
    }
    return it.side === side ? it : null;
  }

  /** The snapshot, when it changed: a segment opens with its first words, so blank text opens nothing. */
  private show(itemId: string, it: Item): void {
    const text = it.text.trim();
    if (text === it.shown) return;
    if (it.ref === undefined) this.open(itemId, it);
    it.shown = text;
    const ref = it.ref as Ref;
    const person = this.person(itemId, it);
    this.o.sink.segmentText(person === undefined ? { ref, text } : { ref, text, person });
  }

  private open(itemId: string, it: Item): void {
    const ref = this.nextRef++;
    it.ref = ref;
    const origin = it.side === 'source' ? itemId : it.source;
    it.stated = origin !== undefined;
    const person = this.person(itemId, it);
    this.o.sink.segmentOpened({ ref, side: it.side, ...(origin === undefined ? {} : { origin }), ...(person === undefined ? {} : { person }) });
  }

  private close(it: Item): void {
    it.closed = true;
    if (it.ref === undefined) return;
    // A translation that opened before its heard item was named states its origin now.
    this.o.sink.segmentClosed(!it.stated && it.source !== undefined ? { ref: it.ref, origin: it.source } : { ref: it.ref });
  }

  private drop(it: Item): void {
    it.dropped = true;
    this.close(it);
  }

  private person(itemId: string, it: Item): string | undefined {
    if (!this.o.person) return undefined;
    const heard = it.side === 'source' ? itemId : it.source;
    return heard === undefined ? undefined : this.speakers.get(heard);
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/providers/qwen_livetranslate/segments.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/providers/qwen_livetranslate/segments.ts src/providers/qwen_livetranslate/segments.test.ts
git commit -m "feat(qwen): fold the server's items into segments

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The adapter

**Refinement of the spec:** a mid-session `error` is a Logs line kept for the close that follows; that close fails the leg in the error's words when it comes within `ERROR_WORDS_MS` (10 s), as OpenAI Translate does. Every error the probes saw was followed by a close (1007 or 1011), so the user sees the same failure; an error the server does not close on cannot end a session.

**Files:**
- Create: `src/providers/qwen_livetranslate/adapter.ts`, `src/providers/qwen_livetranslate/testing.ts`
- Test: `src/providers/qwen_livetranslate/adapter.test.ts`

**Interfaces:**
- Consumes: Task 3's `DetectEndpoint` (type), `EndpointId` (type); Task 4's `QwenConfig` (type), `buildQwen`; Task 5's wire; Task 6's `QwenSegments`; the contract (`AdapterStartError`, `framePayload`, `HeaderSocketError`, `ruleFor`, `OpenHeaderSocket`, `WS_OPEN`, `describeCause`).
- Produces:
  - `START_TIMEOUT_MS = 15_000`, `ERROR_WORDS_MS = 10_000`, `NEVER_OPENED`, `CONNECTION_LOST`
  - `interface QwenAdapterDeps { openHeaderSocket: OpenHeaderSocket; detect: DetectEndpoint }`
  - `createQwenAdapter(deps: QwenAdapterDeps): Adapter<QwenConfig, QwenCredentials>`
  - `testing.ts` (test-only): `KEY`, `SHARED`, `AUTO_CTX`, `MANUAL_CTX`, `TEXT_CTX`, `PARTICIPANT_CTX`, `configFor`, `b64`, `SERVER`, `turn`, `startQwen`, `openQwen`, `qwenSession`

- [ ] **Step 1: Write the fixtures**

Create `src/providers/qwen_livetranslate/testing.ts`:

```ts
/**
 * The Qwen LiveTranslate suites' fixtures: a key in the real shape, the
 * settings the suites build from, the server's events as the JSON text
 * frames the storefronts send (the shapes the owner's probe recorded,
 * 2026-10-13), one whole turn in the recorded order, and the harness that
 * starts a leg over the header seam's fake on a tracked virtual clock.
 * Test-only: nothing but a test imports it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { flush } from '../../lib/contract/testing/drive';
import { fakeHeaderSockets } from '../../lib/contract/testing/headerSocket';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import type { SharedSettings } from '../../lib/provider/types';
import { createQwenAdapter } from './adapter';
import type { DetectEndpoint } from './check';
import { buildQwen, type QwenConfig } from './config';
import { QWEN_DEFAULTS, QWEN_MODEL, type QwenCredentials, type QwenSettings } from './settings';
import { base64ToPcm } from './wire';

/** The real keys' shape (dots and underscores), which `redact()` masks: a frame that carried it fails the kit's `frame-secret` rule. */
export const KEY: QwenCredentials = { apiKey: 'sk-ws-T.ABCDEFGH.ijklmnop_Q-rs.TUVWX0123456789' };

export const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  // The participant's direction in these suites: English into Chinese.
  reversed: (d) => d.source === 'en' && d.target === 'zh',
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'intl' }],
};
export const AUTO_CTX: SessionContext = { direction: { source: 'zh', target: 'en' }, speech: true, turns: 'auto' };
export const MANUAL_CTX: SessionContext = { ...AUTO_CTX, turns: 'manual' };
export const TEXT_CTX: SessionContext = { ...AUTO_CTX, speech: false };
export const PARTICIPANT_CTX: SessionContext = { direction: { source: 'en', target: 'zh' }, speech: true, turns: 'auto' };

/** A leg's config: the defaults, patched. A refusal is a fixture bug: it throws. */
export function configFor(context: SessionContext = AUTO_CTX, patch: Partial<QwenSettings> = {}, shared: SharedSettings = SHARED): QwenConfig {
  const c = buildQwen(context, { ...QWEN_DEFAULTS, ...patch }, shared);
  if ('refused' in c) throw new Error(c.refused);
  return c;
}

/** `samples` of 24 kHz pcm16 as an audio delta carries it. */
export function b64(samples: number, fill = 900): string {
  let binary = '';
  for (const byte of new Uint8Array(new Int16Array(samples).fill(fill).buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const event = (e: Record<string, unknown>) => JSON.stringify({ event_id: 'event_1', ...e });

/** The server's events, by name, as the storefronts send them. */
export const SERVER = {
  created: (id = 'sess_1') => event({ type: 'session.created', session: { id, model: QWEN_MODEL, object: 'realtime.session' } }),
  updated: () => event({ type: 'session.updated', session: { id: 'sess_1', model: QWEN_MODEL } }),
  speechStarted: (itemId: string, speaker = 1) => event({ type: 'input_audio_buffer.speech_started', audio_start_ms: 360, item_id: itemId, speaker_id: speaker }),
  heardItem: (itemId: string, previous?: string) =>
    event({ type: 'conversation.item.created', ...(previous ? { previous_item_id: previous } : {}), item: { id: itemId, type: 'message', role: 'assistant', content: [{ type: 'input_audio' }] } }),
  answerItem: (itemId: string, previous: string) =>
    event({ type: 'conversation.item.created', previous_item_id: previous, item: { id: itemId, type: 'message', role: 'assistant', content: [] } }),
  outputItem: (itemId: string) => event({ type: 'response.output_item.added', response_id: 'resp_1', output_index: 0, item: { id: itemId, type: 'message', role: 'assistant', content: [] } }),
  sourceDelta: (itemId: string, delta: string) => event({ type: 'conversation.item.input_audio_transcription.delta', item_id: itemId, content_index: 0, delta }),
  sourceDone: (itemId: string, transcript: string) => event({ type: 'conversation.item.input_audio_transcription.completed', item_id: itemId, content_index: 0, transcript }),
  transcriptDelta: (itemId: string, delta: string) => event({ type: 'response.audio_transcript.delta', response_id: 'resp_1', item_id: itemId, delta }),
  transcriptDone: (itemId: string, transcript: string) => event({ type: 'response.audio_transcript.done', response_id: 'resp_1', item_id: itemId, transcript }),
  textDelta: (itemId: string, delta: string) => event({ type: 'response.text.delta', response_id: 'resp_1', item_id: itemId, delta }),
  textDone: (itemId: string, text: string) => event({ type: 'response.text.done', response_id: 'resp_1', item_id: itemId, text }),
  /** 100 ms of translated speech. */
  audio: (itemId: string, samples = 2_400) => event({ type: 'response.audio.delta', response_id: 'resp_1', item_id: itemId, delta: b64(samples) }),
  responseDone: () => event({ type: 'response.done', response: { status: 'completed', usage: { total_tokens: 197, input_tokens: 96, output_tokens: 101 } } }),
  error: (code = 'invalid_value', message = 'Invalid translation parameter.') => event({ type: 'error', error: { code, message } }),
  /** An event by its type alone. */
  bare: (type: string) => event({ type }),
};

/** One whole turn under automatic turns, in the order the probe recorded: heard item `item_h<n>`, translation `item_t<n>`. */
export function turn(n: number, o: { source: string; translation: string; speaker?: number; text?: boolean }): string[] {
  const heard = `item_h${n}`;
  const answer = `item_t${n}`;
  return [
    SERVER.speechStarted(heard, o.speaker ?? 1),
    SERVER.heardItem(heard),
    SERVER.bare('response.created'),
    SERVER.outputItem(answer),
    SERVER.answerItem(answer, heard),
    SERVER.sourceDelta(heard, o.source),
    o.text ? SERVER.textDelta(answer, o.translation) : SERVER.transcriptDelta(answer, o.translation),
    ...(o.text ? [] : [SERVER.audio(answer)]),
    SERVER.bare('input_audio_buffer.speech_stopped'),
    SERVER.sourceDone(heard, o.source),
    o.text ? SERVER.textDone(answer, o.translation) : SERVER.transcriptDone(answer, o.translation),
    ...(o.text ? [] : [SERVER.bare('response.audio.done')]),
    SERVER.responseDone(),
  ];
}

/** A leg started over the header seam's fake on a tracked virtual clock; its registration not yet answered, its socket not yet made. */
export function startQwen(o: { context?: SessionContext; patch?: Partial<QwenSettings>; credentials?: QwenCredentials; shared?: SharedSettings; detect?: DetectEndpoint } = {}) {
  const seam = fakeHeaderSockets();
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const controller = new AbortController();
  const context = o.context ?? AUTO_CTX;
  const config = configFor(context, o.patch, o.shared);
  const detected: string[] = [];
  const detect: DetectEndpoint = o.detect ?? (async (apiKey) => { detected.push(apiKey); return { endpoint: 'intl' }; });
  const starting = createQwenAdapter({ openHeaderSocket: seam.open, detect }).start({ context, config, credentials: o.credentials ?? KEY, clock, signal: controller.signal }, events);
  const socket = () => seam.sockets.last();
  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  /** The payloads of the frames of one type, in order. */
  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type).map((e) => e.payload.payload);
  /** What the client sent on the newest socket, parsed. */
  const sent = () => socket().sentJson<Record<string, unknown>>();
  /** The pcm of every append sent on the newest socket, in order. */
  const appended = () => sent().filter((m) => m.type === 'input_audio_buffer.append').map((m) => base64ToPcm(m.audio as string));
  /** The log without its frames: what L1 folds. */
  const content = () => log.filter((e) => e.kind !== 'frame');
  return { seam, clock, timers, log, controller, config, detected, starting, socket, of, frames, sent, appended, content };
}

/** The registration answered and the socket open: nothing sent yet, `session.created` awaited. */
export async function openQwen(o?: Parameters<typeof startQwen>[0]) {
  const h = startQwen(o);
  await flush();
  h.socket().open();
  await flush();
  return h;
}

/** Started: the update confirmed, the start resolved. */
export async function qwenSession(o?: Parameters<typeof startQwen>[0]) {
  const h = await openQwen(o);
  h.socket().receive(SERVER.created());
  h.socket().receive(SERVER.updated());
  const session = await h.starting;
  return { ...h, session };
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/providers/qwen_livetranslate/adapter.test.ts`:

```ts
/**
 * Qwen LiveTranslate's adapter: the conformance suite and the seeded
 * lifecycles, the start over the header seam and its refusals in words, the
 * storefront fallback, the audio going up, push-to-talk, the events to
 * segments and frames, the ends, stop. On the header seam's fake,
 * `FakeSocket`s and a virtual clock — no network, no fake timers.
 */
import { describe, it, expect } from 'vitest';
import { AdapterStartError } from '../../lib/contract/adapter';
import type { AdapterEvent } from '../../lib/contract/events';
import { HeaderSocketError } from '../../lib/contract/headerSocket';
import { flush, type ScenarioStep } from '../../lib/contract/testing/drive';
import { FakeSocket } from '../../lib/contract/testing/fakeSocket';
import { fakeHeaderSockets } from '../../lib/contract/testing/headerSocket';
import { runLifecycles, type LifecycleHarness } from '../../lib/contract/testing/lifecycle';
import { runScenario, scenarioNames, type AdapterHarness } from '../../lib/contract/testing/scenarios';
import { recordEvents } from '../../lib/contract/events';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import { CONNECTION_LOST, createQwenAdapter, ERROR_WORDS_MS, NEVER_OPENED, START_TIMEOUT_MS } from './adapter';
import type { DetectEndpoint } from './check';
import type { QwenConfig } from './config';
import type { QwenCredentials } from './settings';
import { AUTO_CTX, configFor, KEY, MANUAL_CTX, openQwen, PARTICIPANT_CTX, qwenSession, SERVER, SHARED, startQwen, TEXT_CTX, turn } from './testing';
import { sessionUpdate } from './wire';

/** What no event, failure or refusal may carry: the key, and the header it rides in. */
const SECRETS = [KEY.apiKey, 'Bearer'];
const noSecret = (value: unknown) => {
  const text = JSON.stringify(value, (_k, v: unknown) => (v instanceof Int16Array ? `pcm(${v.length})` : v instanceof Error ? v.message : v));
  for (const secret of SECRETS) expect(text).not.toContain(secret);
};
const chunk = (fill = 1_000) => new Int16Array(2_048).fill(fill);
/** What a socket has sent so far, by type, in order. */
const types = (s: FakeSocket) => s.sentJson<{ type: string }>().map((m) => m.type);
/** Content events as `[kind, payload]`, audio by its ref. */
const content = (log: readonly AdapterEvent[]) =>
  log.filter((e) => e.kind !== 'frame').map((e) => (e.kind === 'audio' ? ['audio', { ref: e.payload.ref, samples: e.payload.pcm.length }] : [e.kind, e.payload]));
const intl: DetectEndpoint = async () => ({ endpoint: 'intl' });

function harness(): AdapterHarness<QwenConfig, QwenCredentials> {
  let seam = fakeHeaderSockets();
  const last = () => seam.sockets.last();
  const reply = (frame: string): ScenarioStep => ({ run: () => last().receive(frame) });
  return {
    adapter: createQwenAdapter({ openHeaderSocket: (url, headers, o) => seam.open(url, headers, o), detect: intl }),
    config: (context) => { seam = fakeHeaderSockets(); return configFor(context); },
    credentials: KEY,
    // The registration answers first; the socket exists only then.
    opening: () => [{ flush: true }, { run: () => last().open() }, { flush: true }, reply(SERVER.created()), reply(SERVER.updated()), { flush: true }],
    exchange: turn(1, { source: '你好', translation: 'Hello.' }).map(reply),
    serverClose: [{ run: () => last().serverClose(1011, 'Internal error') }, { flush: true }],
    refuse: [{ flush: true }, { run: () => last().drop() }, { flush: true }],
  };
}

describe('the Qwen LiveTranslate adapter: conformance', () => {
  const h = harness();

  it('runs every scenario but typed text and reconnecting, which it has neither of (D8)', () => {
    expect(scenarioNames(h)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'server-close']);
  });

  it.each(scenarioNames(h))('%s', async (name) => {
    const report = await runScenario(h, name);
    expect(report.violations).toEqual([]);
    expect(report.problems).toEqual([]);
  });
});

describe('the Qwen LiveTranslate adapter: the seeded lifecycles', () => {
  const lifecycles: LifecycleHarness<QwenConfig, QwenCredentials> = {
    adapter: (run) => createQwenAdapter({ openHeaderSocket: fakeHeaderSockets(run.sockets).open, detect: intl }),
    config: (context) => configFor(context),
    credentials: KEY,
    secrets: SECRETS,
    textInput: false,
    startBoundMs: START_TIMEOUT_MS,
    opening: async (run) => {
      // The registration answers first: the socket exists only after it.
      await flush();
      const socket = run.sockets.all[run.sockets.all.length - 1];
      if (!socket) return;
      const r = run.rand();
      if (r < 0.04) { run.count('harness.drop'); return socket.drop(); }
      if (r < 0.07) { run.count('harness.silent'); return; }
      socket.open();
      await flush();
      if (r < 0.1) { run.count('harness.refused'); socket.receive(SERVER.created()); return socket.receive(SERVER.error()); }
      if (r < 0.13) { run.count('harness.close_1007'); return socket.serverClose(1007, 'Invalid translation parameter.'); }
      // Opened, and no answer yet: the kit may abort mid-handshake, else the start's bound runs out.
      if (r < 0.28) { run.count('harness.unanswered'); return; }
      socket.receive(SERVER.created());
      if (r < 0.33) { run.count('harness.created_only'); return; }
      socket.receive(SERVER.updated());
    },
    server: async (run) => {
      const socket = run.sockets.all[run.sockets.all.length - 1];
      if (!socket || socket.readyState !== FakeSocket.OPEN) return;
      const r = run.rand();
      const n = Math.floor(run.rand() * 4);
      const heard = `item_h${n}`;
      const answer = `item_t${n}`;
      if (r < 0.1) socket.receive(SERVER.speechStarted(heard, 1 + (n % 2)));
      else if (r < 0.18) socket.receive(SERVER.heardItem(heard));
      else if (r < 0.26) socket.receive(SERVER.answerItem(answer, heard));
      else if (r < 0.3) socket.receive(SERVER.outputItem(answer));
      else if (r < 0.4) socket.receive(SERVER.sourceDelta(heard, run.pick(['你好', '，', '老板'])));
      else if (r < 0.45) socket.receive(SERVER.sourceDone(heard, run.pick(['你好', ''])));
      else if (r < 0.55) socket.receive(run.pick([SERVER.transcriptDelta(answer, 'Hello'), SERVER.textDelta(answer, ' there.')]));
      else if (r < 0.6) socket.receive(run.pick([SERVER.transcriptDone(answer, 'Hello there.'), SERVER.textDone(answer, '')]));
      else if (r < 0.68) socket.receive(SERVER.audio(answer));
      else if (r < 0.71) socket.receive(SERVER.error(run.pick(['COMMON_ERROR', 'Throttling']), run.pick(["<400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported.", 'Requests rate limit exceeded.'])));
      else if (r < 0.73) socket.receive('not json');
      else if (r < 0.75) socket.receive(JSON.stringify({ type: 'response.audio.delta', item_id: answer, delta: 7 }));
      else if (r < 0.79) socket.receive(run.pick([SERVER.responseDone(), SERVER.bare('input_audio_buffer.committed'), SERVER.bare('input_audio_buffer.cleared'), SERVER.bare('session.finished'), SERVER.bare('something.new')]));
      else if (r < 0.84) socket.serverClose(run.pick([1000, 1007, 1011]), run.pick(['', 'Internal error', "Voice 'X' is not supported."]));
      else run.clock.advance(run.pick([200, 2_500, ERROR_WORDS_MS + 1_000]));
    },
  };

  // 300 lives, about a second alone: the bound is for a loaded machine.
  it('every life settles, ends clean, and leaves no timer, socket or send behind', async () => {
    const report = await runLifecycles(lifecycles, { seed: 20261013, runs: 300 });
    expect(report.failures).toEqual([]);
    // If one key stays at 0 with this seed, raise its draw's share rather than dropping the key.
    for (const key of [
      'refused', 'live', 'stopped', 'end.failed.connection_lost', 'end.failed.client', 'end.failed.server', 'opening.bound', 'opening.abort',
      'harness.drop', 'harness.silent', 'harness.refused', 'harness.close_1007', 'harness.unanswered', 'harness.created_only',
    ]) expect(report.stats[key] ?? 0, key).toBeGreaterThan(0);
  }, 20_000);
});

describe('the Qwen LiveTranslate adapter: the start (spec §6)', () => {
  it('registers a Bearer rule on the storefront the check found, then dials the model URL, framing header names alone', async () => {
    const h = startQwen();
    expect(h.seam.sockets.all).toEqual([]);
    await flush();
    expect(h.seam.registrations).toEqual([{ host: 'maas.qwencloudapi.com', path: '/api-ws/v1/', set: { Authorization: `Bearer ${KEY.apiKey}` }, remove: [], cleared: false }]);
    expect(h.socket().url).toBe('wss://maas.qwencloudapi.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime');
    expect(h.frames('session.headers')).toEqual([{ endpoint: 'intl', host: 'maas.qwencloudapi.com', path: '/api-ws/v1/', set: ['Authorization'] }]);
    expect(h.detected).toEqual([]);
    noSecret(h.log);
  });

  it('dials 千问云 for a mainland key', async () => {
    const h = startQwen({ shared: { ...SHARED, models: [{ id: 'cn' }] } });
    await flush();
    expect(h.socket().url).toBe('wss://maas.qianwenaiapi.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime');
  });

  it('sends nothing until session.created, then its one update; resolves on session.updated with nothing but frames and no timer', async () => {
    const h = await openQwen();
    expect(h.sent()).toEqual([]);
    h.socket().receive(SERVER.created());
    expect(h.sent()).toEqual([sessionUpdate(h.config)]);
    let resolved = false;
    void h.starting.then(() => { resolved = true; });
    await flush();
    expect(resolved).toBe(false);
    h.socket().receive(SERVER.updated());
    const session = await h.starting;
    expect(session.info).toEqual({ transport: 'websocket' });
    expect(h.frames('session.update')).toEqual([sessionUpdate(h.config).session]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it("refuses in Qwen's words an error before the update is confirmed, closing the socket", async () => {
    const h = await openQwen();
    h.socket().receive(SERVER.created());
    h.socket().receive(SERVER.error('invalid_value', 'Invalid translation parameter.'));
    await expect(h.starting).rejects.toEqual(new AdapterStartError('[Qwen invalid_value] Invalid translation parameter.', 'client'));
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a close before the update is confirmed refuses the start, in the words the close gave', async () => {
    const h = await openQwen();
    h.socket().receive(SERVER.created());
    h.socket().serverClose(1007, 'Invalid translation parameter.');
    await expect(h.starting).rejects.toEqual(new AdapterStartError('Qwen closed the connection before the session started (1007 Invalid translation parameter.).', 'client'));
  });

  it(`no answer within ${START_TIMEOUT_MS / 1000} s refuses — the server's fault once the socket opened — and closes the socket`, async () => {
    const h = await openQwen();
    h.clock.advance(START_TIMEOUT_MS);
    await expect(h.starting).rejects.toEqual(new AdapterStartError(`Qwen did not start the session within ${START_TIMEOUT_MS / 1000} s.`, 'server'));
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    expect(h.timers()).toBe(0);
  });

  it('a socket that fails before it opens reads as the network, the rule cleared', async () => {
    const h = startQwen();
    await flush();
    h.socket().drop();
    await expect(h.starting).rejects.toMatchObject({ code: 'network', message: NEVER_OPENED });
    expect(h.seam.registrations[0].cleared).toBe(true);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a build that cannot set headers — the web — refuses in fixed words', async () => {
    const { clock } = trackedClock();
    const { events } = recordEvents();
    const unsupported = () => Promise.reject(new HeaderSocketError('unsupported', 'no platform'));
    const starting = createQwenAdapter({ openHeaderSocket: unsupported, detect: intl }).start({ context: AUTO_CTX, config: configFor(), credentials: KEY, clock, signal: new AbortController().signal }, events);
    await expect(starting).rejects.toEqual(new AdapterStartError('Qwen LiveTranslate needs the desktop app or the browser extension.', 'client'));
  });

  it('with no storefront from a check, finds it first — with the key, the clock and the signal — and dials it', async () => {
    let seen: Parameters<DetectEndpoint> | null = null;
    const h = startQwen({ shared: { ...SHARED, models: [] }, detect: async (...args) => { seen = args; return { endpoint: 'cn' }; } });
    await flush();
    expect(seen).not.toBeNull();
    const [apiKey, o] = seen as unknown as Parameters<DetectEndpoint>;
    expect(apiKey).toBe(KEY.apiKey);
    expect(o.signal).toBe(h.controller.signal);
    expect(o.clock).toBe(h.clock);
    expect(h.frames('session.detected')).toEqual([{ endpoint: 'cn' }]);
    expect(h.socket().url).toBe('wss://maas.qianwenaiapi.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime');
    noSecret(h.log);
  });

  it("a key neither storefront takes refuses the start in the check's words; a check that cannot tell refuses as the network", async () => {
    const refused = startQwen({ shared: { ...SHARED, models: [] }, detect: async () => ({ refused: 'Neither QwenCloud nor 千问云 accepted this key (HTTP 401).', code: 'auth' }) });
    await expect(refused.starting).rejects.toEqual(new AdapterStartError('Neither QwenCloud nor 千问云 accepted this key (HTTP 401).', 'auth'));
    expect(refused.seam.registrations).toEqual([]);
    const offline = startQwen({ shared: { ...SHARED, models: [] }, detect: async () => { throw new TypeError('Failed to fetch'); } });
    await expect(offline.starting).rejects.toMatchObject({ code: 'network', message: 'Qwen did not answer the key check (check the network).' });
    expect(offline.seam.registrations).toEqual([]);
  });

  it('a stop while the storefront is still being found rejects with its reason: no rule, no socket, no timer', async () => {
    const h = startQwen({
      shared: { ...SHARED, models: [] },
      detect: (_apiKey, o) => new Promise((_resolve, reject) => { o.signal?.addEventListener('abort', () => reject(o.signal?.reason)); }),
    });
    await flush();
    h.controller.abort(new Error('stopped'));
    await expect(h.starting).rejects.toThrow('stopped');
    await flush();
    expect(h.seam.registrations).toEqual([]);
    expect(h.seam.sockets.all).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a found storefront that lands after a stop opens nothing', async () => {
    let land!: () => void;
    const h = startQwen({ shared: { ...SHARED, models: [] }, detect: () => new Promise((resolve) => { land = () => resolve({ endpoint: 'intl' }); }) });
    await flush();
    h.controller.abort(new Error('stopped'));
    land();
    await expect(h.starting).rejects.toThrow('stopped');
    await flush();
    expect(h.seam.registrations).toEqual([]);
    expect(h.seam.sockets.all).toEqual([]);
  });
});

describe('the Qwen LiveTranslate adapter: the session (spec §6)', () => {
  it('sends audio up as it came, with no frame per chunk', async () => {
    const h = await qwenSession();
    const before = h.of('frame').length;
    h.session.appendAudio(chunk(1_000));
    h.session.appendAudio(chunk(-3));
    expect(h.appended().map((p) => p[0])).toEqual([1_000, -3]);
    expect(h.of('frame').length).toBe(before);
  });

  it('turns one recorded turn into a source and its translation, stating their origin, the speech on the translation; no person on my leg', async () => {
    const h = await qwenSession();
    for (const frame of turn(1, { source: '你好 ', translation: 'Hello. ' })) h.socket().receive(frame);
    expect(content(h.log)).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'item_h1' }],
      ['segmentText', { ref: 1, text: '你好' }],
      ['segmentOpened', { ref: 2, side: 'translation', origin: 'item_h1' }],
      ['segmentText', { ref: 2, text: 'Hello.' }],
      ['audio', { ref: 2, samples: 2_400 }],
      ['segmentClosed', { ref: 1 }],
      ['segmentClosed', { ref: 2 }],
    ]);
    expect(h.frames('response.done')).toEqual([{ status: 'completed', usage: { total_tokens: 197, input_tokens: 96, output_tokens: 101 } }]);
  });

  it('labels both sides with the speaker on the participant leg (D7)', async () => {
    const h = await qwenSession({ context: PARTICIPANT_CTX });
    for (const frame of turn(1, { source: 'Hello', translation: '你好', speaker: 2 })) h.socket().receive(frame);
    const persons = h.content().filter((e) => e.kind === 'segmentOpened').map((e) => (e.payload as { person?: string }).person);
    expect(persons).toEqual(['2', '2']);
  });

  it('a leg that does not speak takes the text events and plays nothing', async () => {
    const h = await qwenSession({ context: TEXT_CTX });
    for (const frame of turn(1, { source: '你好', translation: 'Hello.', text: true })) h.socket().receive(frame);
    h.socket().receive(SERVER.audio('item_t1'));
    expect(h.of('audio')).toEqual([]);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['你好', 'Hello.']);
  });

  it('push-to-talk: a release commits, a cancel clears and closes what is open, later frames of that turn are dropped; automatic turns send neither', async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.endTurn();
    expect(types(h.socket()).slice(-1)).toEqual(['input_audio_buffer.commit']);
    h.socket().receive(SERVER.heardItem('item_h1'));
    h.socket().receive(SERVER.sourceDelta('item_h1', 'half'));
    h.session.cancelTurn();
    expect(types(h.socket()).slice(-1)).toEqual(['input_audio_buffer.clear']);
    h.socket().receive(SERVER.sourceDelta('item_h1', ' more'));
    h.socket().receive(SERVER.answerItem('item_t1', 'item_h1'));
    h.socket().receive(SERVER.transcriptDelta('item_t1', 'Half'));
    h.socket().receive(SERVER.audio('item_t1'));
    expect(content(h.log)).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'item_h1' }],
      ['segmentText', { ref: 1, text: 'half' }],
      ['segmentClosed', { ref: 1 }],
    ]);
    expect(h.frames('input_audio_buffer.commit')).toHaveLength(1);
    expect(h.frames('input_audio_buffer.clear')).toHaveLength(1);

    const auto = await qwenSession();
    auto.session.endTurn();
    auto.session.cancelTurn();
    expect(types(auto.socket())).toEqual(['session.update']);
  });

  it("a mid-session error words the close that follows it, once; the leg fails and says nothing after", async () => {
    const h = await qwenSession();
    h.socket().receive(SERVER.error('COMMON_ERROR', "<400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported."));
    expect(h.of('failed')).toEqual([]);
    h.socket().serverClose(1007, "<400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported.");
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'client', message: "[Qwen COMMON_ERROR] <400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported." }]);
    expect(h.timers()).toBe(0);
    noSecret(h.log);
  });

  it('a close with words and no error fails in its words; a close with none is the lost connection (D8); an old error words neither', async () => {
    const worded = await qwenSession();
    worded.socket().serverClose(1011, 'Internal error');
    expect(worded.of('failed').map((e) => e.payload)).toEqual([{ code: 'server', message: '[Qwen] Internal error' }]);

    const bare = await qwenSession();
    bare.socket().serverClose(1000);
    expect(bare.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: CONNECTION_LOST }]);

    const stale = await qwenSession();
    stale.socket().receive(SERVER.error('Throttling', 'Requests rate limit exceeded.'));
    stale.clock.advance(ERROR_WORDS_MS + 1);
    stale.socket().serverClose(1000);
    expect(stale.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: CONNECTION_LOST }]);
  });

  it('a frame that will not read is degraded once until one reads again; an audio delta with no base64 is its own episode', async () => {
    const h = await qwenSession();
    h.socket().receive('not json');
    h.socket().receive('still not json');
    h.socket().receive(SERVER.bare('response.created'));
    h.socket().receive('not json again');
    h.socket().receive(JSON.stringify({ type: 'response.audio.delta', item_id: 'item_t1', delta: 7 }));
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['parse_error', 'parse_error', 'parse_error']);
    expect(h.of('failed')).toEqual([]);
  });

  it('stop sends session.finish and closes before it awaits anything; nothing follows, and a second stop is harmless', async () => {
    const h = await qwenSession();
    const stopping = h.session.stop();
    expect(types(h.socket())).toEqual(['session.update', 'session.finish']);
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    await stopping;
    await h.session.stop();
    expect(types(h.socket())).toEqual(['session.update', 'session.finish']);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/providers/qwen_livetranslate/adapter.test.ts`
Expected: FAIL — `Failed to resolve import "./adapter"`.

- [ ] **Step 4: Write `adapter.ts`**

Create `src/providers/qwen_livetranslate/adapter.ts`:

```ts
/**
 * Qwen LiveTranslate on the client contract (spec 2026-10-13, §6): one leg,
 * one session at the storefront the check found — or, when none did, the
 * one `detect` finds before the socket opens (§2). The socket opens through
 * the header seam with a Bearer header (D3); the start resolves on
 * `session.updated`, the one `session.update` confirmed, within a bound.
 * Events become segments (`segments.ts`); a push-to-talk release commits
 * the turn and a cancel clears it (D6). An error words the close that
 * follows it, and any end the leg did not ask for fails it: there is no
 * reconnect (D8). Stop sends `session.finish` and closes at once. Every
 * timer reads the request's clock, and nothing is said but through events
 * (CLAUDE.md, "Inside an adapter session").
 */
import {
  AdapterStartError,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type StartRequest,
} from '../../lib/contract/adapter';
import { framePayload } from '../../lib/contract/framePayload';
import { HeaderSocketError, ruleFor, type OpenHeaderSocket } from '../../lib/contract/headerSocket';
import { WS_OPEN } from '../../lib/contract/socket';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { DetectEndpoint, Detection } from './check';
import type { QwenConfig } from './config';
import type { EndpointId } from './endpoints';
import { QwenSegments } from './segments';
import type { QwenCredentials } from './settings';
import {
  appendFrame,
  base64ToPcm,
  CLEAR,
  COMMIT,
  decodeServerEvent,
  errorCode,
  errorOf,
  errorWords,
  FINISH,
  qwenHeaders,
  sessionUpdate,
  socketUrl,
  str,
  type ServerEvent,
} from './wire';

/** The handshake's bound — the seam's registration and upgrade, `session.created`, the update's answer — on the request's clock (spec §6). */
export const START_TIMEOUT_MS = 15_000;
/** How long a mid-session `error` words the close that follows it (OpenAI Translate's rule). */
export const ERROR_WORDS_MS = 10_000;
/** A socket that failed before it opened: a browser cannot read why. */
export const NEVER_OPENED = "Qwen's socket did not open (check the network, and that the API key is still valid).";
/** Why the leg fails when the connection closed with no words (D8): worded by the `connection_lost` alias. */
export const CONNECTION_LOST = 'The connection to Qwen was lost.';

export interface QwenAdapterDeps {
  /** The header seam (D3): the platform's in the app, `fakeHeaderSockets().open` in tests. */
  openHeaderSocket: OpenHeaderSocket;
  /** Finds the key's storefront when no check has (`check.ts`): a stub in tests. */
  detect: DetectEndpoint;
}

type Phase = 'opening' | 'configuring' | 'live' | 'ended';

/** Hears nothing more from a socket the leg has moved on from. */
function detach(ws: WebSocket): void {
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
}

const closeWords = (e: CloseEvent) => `${e.code}${e.reason ? ` ${e.reason}` : ''}`;

/** The seam's refusal in the start's words: fixed, quoting nothing; an abort is passed on as it came. */
function seamRefusal(error: unknown): unknown {
  if (!(error instanceof HeaderSocketError)) {
    return error instanceof Error && error.message.startsWith('The browser would not open the socket')
      ? new AdapterStartError(error.message, 'network')
      : error;
  }
  switch (error.reason) {
    case 'never_opened':
      return new AdapterStartError(NEVER_OPENED, 'network');
    case 'timeout':
      return new AdapterStartError('Qwen did not open the connection in time (check the network).', 'network');
    case 'unsupported':
      return new AdapterStartError('Qwen LiveTranslate needs the desktop app or the browser extension.', 'client');
    default:
      return new AdapterStartError('The app could not prepare the connection to Qwen: restart it and try again.', 'client', undefined, { cause: error.cause });
  }
}

class QwenLeg implements AdapterSession {
  readonly info = { transport: 'websocket' };
  private phase: Phase = 'opening';
  /** The connection in use once live. */
  private socket: WebSocket | null = null;
  private readonly segments: QwenSegments;
  /** The last mid-session `error`, and when: the words of a close that follows it closely. */
  private lastError: { code: string; message: string; at: number } | null = null;
  /** `session.unreadable` on the ok → failing transition only, a frame's and an audio delta's each. */
  private readable = true;
  private audioReadable = true;

  constructor(
    private readonly request: StartRequest<QwenConfig, QwenCredentials>,
    private readonly events: AdapterEvents,
    private readonly deps: QwenAdapterDeps,
  ) {
    this.segments = new QwenSegments({ sink: events, person: request.config.person });
  }

  async open(): Promise<AdapterSession> {
    try {
      const endpoint = this.request.config.endpoint ?? await this.detect();
      await this.connect(endpoint);
      return this;
    } catch (error) {
      this.shutDown();
      throw error;
    }
  }

  /** One chunk as it came, while live — no frame per chunk (the hot-path rule). */
  appendAudio(pcm: Int16Array): void {
    this.live()?.send(appendFrame(pcm));
  }

  /** Qwen LiveTranslate takes no typed text (`textInput: () => false`). */
  appendText(): void {}

  /** Nothing to send: audio appended under push-to-talk is the turn already. */
  beginTurn(): void {}

  /** A release: the turn closes, its translation finishing (D6). */
  endTurn(): void {
    const ws = this.manual();
    if (!ws) return;
    ws.send(JSON.stringify(COMMIT));
    this.frame('out', COMMIT.type);
  }

  /** A cancel: the buffer empties; the server never finishes that response, so the segments close here (D6). */
  cancelTurn(): void {
    const ws = this.manual();
    if (!ws) return;
    ws.send(JSON.stringify(CLEAR));
    this.frame('out', CLEAR.type);
    this.segments.cancel();
  }

  /** `session.finish`, framed, then the close before its first `await`: nothing waits for `session.finished`. */
  stop(): Promise<void> {
    const ws = this.live();
    if (ws) {
      ws.send(JSON.stringify(FINISH));
      this.frame('out', FINISH.type);
    }
    this.shutDown();
    return Promise.resolve();
  }

  /** The connection, while live under push-to-talk. */
  private manual(): WebSocket | null {
    return this.request.config.manual ? this.live() : null;
  }

  private live(): WebSocket | null {
    const ws = this.socket;
    return this.phase === 'live' && ws !== null && ws.readyState === WS_OPEN ? ws : null;
  }

  /** The key's storefront, when no check has found it (§2): a refusal in the check's words, anything else the network's. */
  private async detect(): Promise<EndpointId> {
    const { credentials, clock, signal } = this.request;
    this.frame('out', 'session.detect');
    let found: Detection;
    try {
      found = await this.deps.detect(credentials.apiKey, { clock, signal });
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      throw new AdapterStartError('Qwen did not answer the key check (check the network).', 'network', undefined, { cause: error });
    }
    if ('refused' in found) throw new AdapterStartError(found.refused, found.code);
    this.frame('in', 'session.detected', { endpoint: found.endpoint });
    return found.endpoint;
  }

  /**
   * One connection: the seam, `session.created`, the update, its answer.
   * Resolves once `session.updated` is heard, the leg live; rejects, leaving
   * nothing open, when the seam refuses, the server refuses or closes,
   * `START_TIMEOUT_MS` passes, or the request's signal aborts.
   */
  private connect(endpoint: EndpointId): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const { clock, config, credentials, signal } = this.request;
      // A stop while the storefront was being found: nothing opens.
      if (signal.aborted) {
        reject(signal.reason ?? new Error('aborted'));
        return;
      }
      const seam = new AbortController();
      let ws: WebSocket | null = null;
      let settled = false;
      const settle = (error?: unknown) => {
        if (settled) return;
        settled = true;
        cancelBound();
        signal.removeEventListener('abort', onAbort);
        if (error === undefined) {
          resolve();
          return;
        }
        seam.abort(error);
        if (ws) {
          detach(ws);
          if (ws.readyState <= WS_OPEN) ws.close(1000);
        }
        reject(error);
      };
      const onAbort = () => settle(signal.reason ?? new Error('aborted'));
      const cancelBound = clock.setTimeout(() => settle(ws
        ? new AdapterStartError(`Qwen did not start the session within ${START_TIMEOUT_MS / 1000} s.`, 'server')
        : new AdapterStartError(`Qwen did not open the connection within ${START_TIMEOUT_MS / 1000} s.`, 'network')), START_TIMEOUT_MS);
      signal.addEventListener('abort', onAbort, { once: true });

      const url = socketUrl(endpoint, config.model);
      const headers = qwenHeaders(credentials);
      const rule = ruleFor(url, { set: {} });
      // The storefront, the rule's place and the header's name, never a value.
      this.frame('out', 'session.headers', { endpoint, host: rule.host, path: rule.path, set: Object.keys(headers.set) });
      this.deps.openHeaderSocket(url, headers, { signal: seam.signal, clock }).then((socket) => {
        if (settled) {
          detach(socket);
          socket.close(1000);
          return;
        }
        ws = socket;
        socket.binaryType = 'arraybuffer';
        socket.onmessage = (e: MessageEvent) => {
          if (!settled) this.handshake(socket, e.data, settle);
          else if (socket === this.socket) this.onMessage(e.data);
        };
        // A Logs line: the close that follows says what it did to the session.
        socket.onerror = () => this.frame('in', 'session.socket_error');
        socket.onclose = (e: CloseEvent) => {
          if (!settled) {
            this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
            settle(new AdapterStartError(`Qwen closed the connection before the session started (${closeWords(e)}).`, e.reason ? errorCode({ code: null, message: e.reason }) : 'server'));
          } else if (socket === this.socket) this.closed(e);
        };
      }, (error: unknown) => settle(seamRefusal(error)));
    });
  }

  /** A frame before the leg is live: `session.created` sends the update, `session.updated` settles the start, an `error` refuses it. */
  private handshake(ws: WebSocket, data: unknown, settle: (error?: unknown) => void): void {
    let e: ServerEvent;
    try {
      e = decodeServerEvent(data);
    } catch (error) {
      this.frame('in', 'session.unreadable', { message: describeCause(error) });
      return;
    }
    if (e.type === 'session.created') {
      const s = (typeof e.session === 'object' && e.session !== null ? e.session : {}) as { id?: unknown; model?: unknown };
      this.frame('in', 'session.created', { id: str(s.id), model: str(s.model) });
      if (this.phase !== 'opening') return;
      const update = sessionUpdate(this.request.config);
      ws.send(JSON.stringify(update));
      this.frame('out', 'session.update', update.session);
      this.phase = 'configuring';
    } else if (e.type === 'session.updated') {
      this.frame('in', 'session.updated');
      if (this.phase !== 'configuring') return;
      this.socket = ws;
      this.phase = 'live';
      settle();
    } else if (e.type === 'error') {
      const error = errorOf(e);
      this.frame('in', 'session.error', error);
      settle(new AdapterStartError(errorWords(error), errorCode(error)));
    } else this.frame('in', 'session.unknown', { type: e.type });
  }

  private onMessage(data: unknown): void {
    if (this.phase !== 'live') return;
    let e: ServerEvent;
    try {
      e = decodeServerEvent(data);
    } catch (error) {
      this.unreadable('frame', error);
      return;
    }
    this.readable = true;
    const itemId = str(e.item_id);
    switch (e.type) {
      case 'input_audio_buffer.speech_started': {
        const speaker = typeof e.speaker_id === 'number' ? e.speaker_id : null;
        this.frame('in', e.type, { itemId, speaker });
        if (itemId) this.segments.heard(itemId, speaker);
        return;
      }
      case 'conversation.item.created': {
        const item = (typeof e.item === 'object' && e.item !== null ? e.item : {}) as { id?: unknown; content?: unknown };
        const id = str(item.id);
        // The heard item carries input audio; the translation's content is empty, and names the heard item before it.
        const heard = Array.isArray(item.content) && item.content.some((c) => (c as { type?: unknown } | null)?.type === 'input_audio');
        const previous = str(e.previous_item_id);
        this.frame('in', e.type, { itemId: id, previous, heard });
        if (!id) return;
        if (heard) this.segments.heard(id);
        else this.segments.answer(id, previous);
        return;
      }
      case 'response.output_item.added': {
        const item = (typeof e.item === 'object' && e.item !== null ? e.item : {}) as { id?: unknown };
        const id = str(item.id);
        this.frame('in', e.type, { itemId: id });
        if (id) this.segments.answer(id);
        return;
      }
      case 'conversation.item.input_audio_transcription.delta':
      case 'response.audio_transcript.delta':
      case 'response.text.delta': {
        const delta = str(e.delta);
        this.frame('in', e.type, { itemId, delta });
        if (itemId && delta) this.segments.text(itemId, e.type.startsWith('conversation.') ? 'source' : 'translation', delta);
        return;
      }
      case 'conversation.item.input_audio_transcription.completed':
      case 'response.audio_transcript.done':
      case 'response.text.done': {
        const final = str(e.transcript) ?? str(e.text);
        this.frame('in', e.type, { itemId, text: final });
        if (itemId) this.segments.done(itemId, e.type.startsWith('conversation.') ? 'source' : 'translation', final);
        return;
      }
      case 'response.audio.delta':
        this.audio(itemId, e.delta);
        return;
      case 'response.done': {
        const r = (typeof e.response === 'object' && e.response !== null ? e.response : {}) as { status?: unknown; usage?: unknown };
        // The session's running totals: what the live test reads the bill from.
        this.frame('in', e.type, { status: str(r.status), usage: r.usage ?? null });
        return;
      }
      case 'error':
        this.serverError(e);
        return;
      case 'input_audio_buffer.speech_stopped':
      case 'input_audio_buffer.committed':
      case 'input_audio_buffer.cleared':
      case 'response.created':
      case 'response.content_part.added':
      case 'response.content_part.done':
      case 'response.audio.done':
      case 'response.output_item.done':
      case 'session.finished':
        this.frame('in', e.type);
        return;
      default:
        this.frame('in', 'session.unknown', { type: e.type });
    }
  }

  /** Translated speech, framed by its size; played only on a leg that speaks — the update asked for none otherwise. */
  private audio(itemId: string | null, delta: unknown): void {
    if (typeof delta !== 'string') {
      this.unreadable('audio', new Error('an audio delta with no base64 string'));
      return;
    }
    let pcm: Int16Array;
    try {
      pcm = base64ToPcm(delta);
    } catch (error) {
      this.unreadable('audio', error);
      return;
    }
    this.audioReadable = true;
    this.frame('in', 'response.audio.delta', { itemId, samples: pcm.length });
    if (!this.request.context.speech || !itemId || pcm.length === 0) return;
    this.segments.audio(itemId, pcm);
  }

  /** Mid-session, a Logs line kept for the close that follows: every error the probes saw was followed by one (1007, 1011). */
  private serverError(e: ServerEvent): void {
    const error = errorOf(e);
    this.frame('in', 'session.error', error);
    this.lastError = { code: errorCode(error), message: errorWords(error), at: this.request.clock.now() };
  }

  /** The last mid-session error when it came within `ERROR_WORDS_MS`, and not from a clock stepped back. */
  private recentError(): { code: string; message: string } | null {
    const last = this.lastError;
    if (!last) return null;
    const age = this.request.clock.now() - last.at;
    return age < 0 || age > ERROR_WORDS_MS ? null : { code: last.code, message: last.message };
  }

  /** The socket closed while live: nothing asked for it (D8). In a recent error's words, else the close's, else the lost connection. */
  private closed(e: CloseEvent): void {
    this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
    const reason = e.reason ? { code: null, message: e.reason } : null;
    this.end(this.recentError()
      ?? (reason ? { code: errorCode(reason), message: errorWords(reason) } : { code: 'connection_lost', message: CONNECTION_LOST }));
  }

  /** A frame, or an audio delta, that will not read: a Logs line and `parse_error` on each latch's ok → failing transition only. */
  private unreadable(latch: 'frame' | 'audio', error: unknown): void {
    if (latch === 'frame' ? !this.readable : !this.audioReadable) return;
    if (latch === 'frame') this.readable = false;
    else this.audioReadable = false;
    this.frame('in', 'session.unreadable', { message: describeCause(error) });
    this.events.degraded({ code: 'parse_error', message: `A message from Qwen could not be read: ${describeCause(error)}`, cause: error });
  }

  /** A session that ends by itself: said once, then nothing (the kit's `ended-silence`). */
  private end(failed: { code: string; message: string }): void {
    if (this.phase !== 'live') return;
    this.shutDown();
    this.events.failed(failed);
  }

  /** Every way a leg ends: the segments silent, the socket closed and no longer heard. */
  private shutDown(): void {
    this.phase = 'ended';
    this.segments.stop();
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      detach(ws);
      if (ws.readyState <= WS_OPEN) ws.close(1000);
    }
  }

  private frame(direction: 'in' | 'out', type: string, payload?: unknown): void {
    if (this.phase === 'ended') return;
    this.events.frame(payload === undefined ? { direction, type } : { direction, type, payload: framePayload(payload) });
  }
}

export function createQwenAdapter(deps: QwenAdapterDeps): Adapter<QwenConfig, QwenCredentials> {
  return {
    start(request, events) {
      // An aborted start opens nothing.
      if (request.signal.aborted) return Promise.reject(request.signal.reason ?? new Error('aborted'));
      return new QwenLeg(request, events, deps).open();
    },
  };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/providers/qwen_livetranslate/adapter.test.ts`
Expected: PASS — the 7 scenarios, the lifecycles, 12 start tests and 9 session tests. If the lifecycle run reports a stat key at 0, raise that draw's share in `server` or `opening` (the comment above the key list says so); do not drop the key.

- [ ] **Step 6: Typecheck the folder so far**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/providers/qwen_livetranslate/adapter.ts src/providers/qwen_livetranslate/testing.ts src/providers/qwen_livetranslate/adapter.test.ts
git commit -m "feat(qwen): the adapter, one session per leg over the header seam

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The recorded timelines, replayed

**Files:**
- Create: `src/providers/qwen_livetranslate/recordings/two-speakers.json`, `src/providers/qwen_livetranslate/recordings/abab.json` (generated, then committed)
- Test: `src/providers/qwen_livetranslate/segments.replay.test.ts`

**Interfaces:**
- Consumes: Task 7's `qwenSession`, `b64`, `PARTICIPANT_CTX`.
- Produces: nothing new.

- [ ] **Step 1: Scrub the probe's two recordings into fixtures**

The sources are outside the repo, in `~/Desktop/kizunaai/qwen-livetranslate-probe-2026-10-13/` (`ws-timeline-two-speakers.jsonl`, `ws-speakers-abab.jsonl`). Write this script to a scratch directory outside the repo (not committed), e.g. `/home/jiangzhuo/.claude/jobs/30e1aeff/tmp/qwen-recordings.cjs` (this job's scratch directory; any directory outside the repo works):

```js
// Scrubs the owner's Qwen probe recordings (2026-10-13) into replay fixtures: the
// server's events after session.updated, without event ids or obfuscation padding,
// each audio delta as its sample count (the probe kept no audio).
// usage: node qwen-recordings.cjs <probe-dir> <out-dir>
const fs = require('fs');
const path = require('path');
const [src, out] = process.argv.slice(2);
for (const [from, to] of [['ws-timeline-two-speakers.jsonl', 'two-speakers.json'], ['ws-speakers-abab.jsonl', 'abab.json']]) {
  const inbound = fs.readFileSync(path.join(src, from), 'utf8').split('\n').filter(Boolean)
    .map((line) => JSON.parse(line)).filter((l) => l.dir === 'in').map((l) => l.d);
  const start = inbound.findIndex((e) => e.type === 'session.updated');
  if (start < 0) throw new Error(`${from}: no session.updated`);
  const events = inbound.slice(start + 1).map(({ event_id, obfuscation, ...e }) =>
    (e.type === 'response.audio.delta' ? { type: e.type, item_id: e.item_id, samples: e.samples } : e));
  if (/sk-|Bearer|api_key/i.test(JSON.stringify(events))) throw new Error(`${from}: a secret's shape in the recording`);
  fs.writeFileSync(path.join(out, to), `${JSON.stringify(events, null, 1)}\n`);
  console.log(to, events.length, 'events');
}
```

Run:

```bash
mkdir -p src/providers/qwen_livetranslate/recordings
node /home/jiangzhuo/.claude/jobs/30e1aeff/tmp/qwen-recordings.cjs ~/Desktop/kizunaai/qwen-livetranslate-probe-2026-10-13 src/providers/qwen_livetranslate/recordings
```

Expected: `two-speakers.json 163 events` and `abab.json 145 events` (the counts after `session.updated`; any count is fine as long as the script does not throw).

- [ ] **Step 2: Write the replay test**

Create `src/providers/qwen_livetranslate/segments.replay.test.ts`:

```ts
/**
 * The owner's two recorded timelines (probe 2026-10-13), replayed through
 * the adapter on the participant leg: four speakers in a row, then two in
 * turn. Every heard item becomes a source and its translation, paired by
 * origin, closed, labelled with the same person on both sides, the speech
 * on the translation.
 */
import { describe, it, expect } from 'vitest';
import type { AdapterEvent } from '../../lib/contract/events';
import abab from './recordings/abab.json';
import twoSpeakers from './recordings/two-speakers.json';
import { b64, PARTICIPANT_CTX, qwenSession } from './testing';

type Recorded = { type: string; samples?: number; [field: string]: unknown };
const TWO_SPEAKERS = twoSpeakers as unknown as Recorded[];
const ABAB = abab as unknown as Recorded[];

/** Each recorded event as the frame the server sent: an audio delta gets audio of its recorded length. */
const frames = (recording: readonly Recorded[]) =>
  recording.map(({ samples, ...e }) => JSON.stringify(e.type === 'response.audio.delta' ? { ...e, delta: b64(samples ?? 0) } : e));

interface Seen { side: string; origin?: string; text: string; person?: string; closed: boolean; audio: number }

/** Each source with its translation, by origin, as L1 would fold them. */
function pairs(log: readonly AdapterEvent[]) {
  const segments = new Map<number, Seen>();
  for (const e of log) {
    if (e.kind === 'segmentOpened') segments.set(e.payload.ref, { side: e.payload.side, origin: e.payload.origin, text: '', person: e.payload.person, closed: false, audio: 0 });
    else if (e.kind === 'segmentText') {
      const s = segments.get(e.payload.ref)!;
      s.text = e.payload.text;
      if (e.payload.person !== undefined) s.person = e.payload.person;
    } else if (e.kind === 'segmentClosed') {
      const s = segments.get(e.payload.ref)!;
      s.closed = true;
      if (e.payload.origin !== undefined) s.origin = e.payload.origin;
    } else if (e.kind === 'audio' && e.payload.ref !== undefined) segments.get(e.payload.ref)!.audio += 1;
  }
  const all = [...segments.values()];
  return all.filter((s) => s.side === 'source').map((source) => {
    const translation = all.find((t) => t.side === 'translation' && t.origin === source.origin);
    return {
      person: source.person, source: source.text, translation: translation?.text, translationPerson: translation?.person,
      closed: source.closed && translation?.closed === true, audio: translation?.audio ?? 0,
    };
  });
}

async function replay(recording: readonly Recorded[]) {
  const h = await qwenSession({ context: PARTICIPANT_CTX });
  for (const frame of frames(recording)) h.socket().receive(frame);
  return { result: pairs(h.log), audio: h.of('audio').length, failed: h.of('failed'), degraded: h.of('degraded') };
}

describe("Qwen LiveTranslate's recorded timelines (spec §12)", () => {
  it('four speakers in a row: four pairs, persons 1 to 4, every audio delta played on its translation', async () => {
    const { result, audio, failed, degraded } = await replay(TWO_SPEAKERS);
    expect(result.map(({ person, source, translation }) => [person, source, translation])).toEqual([
      ['1', '欢迎使用实时翻译 希望这个声音能让交流变得轻松自然', 'Welcome to real-time translation. We hope this voice will make communication easier and more natural.'],
      ['2', '明日の会議は午後三時に始まります 電車が十分遅れています', "Tomorrow's meeting will start at 3:00 p.m. The train is very late."],
      ['3', 'リアルタイム翻訳へようこそ自然な会話をお手伝いします', 'Welcome to real-time translation. We are here to help you have natural conversations.'],
      ['4', '駅の近くに新しいカフェができました', 'A new cafe has opened near the station.'],
    ]);
    for (const pair of result) {
      expect(pair.translationPerson).toBe(pair.person);
      expect(pair.closed).toBe(true);
      expect(pair.audio).toBeGreaterThan(0);
    }
    expect(audio).toBe(TWO_SPEAKERS.filter((e) => e.type === 'response.audio.delta').length);
    expect(failed).toEqual([]);
    expect(degraded).toEqual([]);
  });

  it('two speakers in turn: persons 1, 2, 1, 2', async () => {
    const { result } = await replay(ABAB);
    expect(result.map(({ person, source, translation }) => [person, source, translation])).toEqual([
      ['1', '欢迎使用实时翻译 希望这个声音能让交流变得轻松自然', 'Welcome to real-time translation. We hope this voice will make communication easier and more natural.'],
      ['2', '明日の会議は午後三時に始まります', "Tomorrow's meeting will start at 3:00 p.m."],
      ['1', '欢迎使用实时翻译希望这个声音能让交流变得轻松自然', 'Welcome to real-time translation. We hope this voice will make communication easier and more natural.'],
      ['2', '明日の会議は午後三時に始まります', "Tomorrow's meeting will start at 3:00 p.m."],
    ]);
    expect(result.every((pair) => pair.closed && pair.translationPerson === pair.person)).toBe(true);
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run src/providers/qwen_livetranslate/segments.replay.test.ts`
Expected: PASS, 2 tests. A failure here means the segments or the adapter's dispatch disagree with the real event order: fix the code, not the expectations (they are the recording's own transcripts).

- [ ] **Step 4: Commit**

```bash
git add src/providers/qwen_livetranslate/recordings src/providers/qwen_livetranslate/segments.replay.test.ts
git commit -m "test(qwen): replay the probe's recorded timelines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Locale strings

**Files:**
- Modify: `src/locales/*/translation.json` (all 30)

**Interfaces:**
- Produces `providers.qwen_livetranslate.{name, description, voiceClone, voiceGroupClone, voiceSummaryCloneMine, voiceSummaryCloneTheirs, storefrontIntl, storefrontCn}` in every catalog, the object placed right after `providers.volcengine_ast2`. Tasks 10 and 11 read these keys.

The four clone strings are copied from each catalog's own `providers.volcengine_ast2` (Doubao AST 2.0 has the same picker row), so both pickers read alike. Every catalog round-trips byte-identical through `JSON.parse` → `JSON.stringify(…, null, 2) + '\n'` (checked 2026-10-13), so a script rewrites them safely.

- [ ] **Step 1: Write the script**

Write this to a scratch directory outside the repo (not committed), e.g. `/home/jiangzhuo/.claude/jobs/30e1aeff/tmp/qwen-locales.cjs` (this job's scratch directory; any directory outside the repo works):

```js
// Adds providers.qwen_livetranslate to every locale catalog, right after volcengine_ast2.
// usage: node qwen-locales.cjs <src/locales>
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
// [description, storefrontIntl, storefrontCn]
const T = {
  ar: ['ترجمة فورية Qwen3.8، 60 لغة (29 منطوقة)', 'مفتاح من QwenCloud (دولي)', 'مفتاح من 千问云 (البر الرئيسي للصين)'],
  bn: ['Qwen3.8 সিমালটেনিয়াস ইন্টারপ্রিটেশন, 60টি ভাষা (29টিতে কণ্ঠ)', 'QwenCloud (আন্তর্জাতিক)-এর কী', '千问云 (মূল ভূখণ্ড চীন)-এর কী'],
  de: ['Qwen3.8 Simultandolmetschen, 60 Sprachen (29 gesprochen)', 'Schlüssel von QwenCloud (international)', 'Schlüssel von 千问云 (Festlandchina)'],
  en: ['Qwen3.8 simultaneous interpretation, 60 languages (29 spoken)', 'Key from QwenCloud (international)', 'Key from 千问云 (mainland China)'],
  es: ['Interpretación simultánea Qwen3.8, 60 idiomas (29 con voz)', 'Clave de QwenCloud (internacional)', 'Clave de 千问云 (China continental)'],
  fa: ['ترجمه همزمان Qwen3.8، 60 زبان (29 با صدا)', 'کلید از QwenCloud (بین‌المللی)', 'کلید از 千问云 (سرزمین اصلی چین)'],
  fi: ['Qwen3.8-simultaanitulkkaus, 60 kieltä (29 puhuttuna)', 'Avain palvelusta QwenCloud (kansainvälinen)', 'Avain palvelusta 千问云 (Manner-Kiina)'],
  fil: ['Qwen3.8 sabay-sabay na pagsasalin, 60 wika (29 may boses)', 'Key mula sa QwenCloud (internasyonal)', 'Key mula sa 千问云 (mainland China)'],
  fr: ['Interprétation simultanée Qwen3.8, 60 langues (29 parlées)', 'Clé de QwenCloud (international)', 'Clé de 千问云 (Chine continentale)'],
  he: ['תרגום סימולטני Qwen3.8, 60 שפות (29 בקול)', 'מפתח מ-QwenCloud (בינלאומי)', 'מפתח מ-千问云 (סין היבשתית)'],
  hi: ['Qwen3.8 सिमल्टेनियस इंटरप्रिटेशन, 60 भाषाएँ (29 में आवाज़)', 'QwenCloud (अंतरराष्ट्रीय) की कुंजी', '千问云 (मुख्यभूमि चीन) की कुंजी'],
  id: ['Penerjemahan simultan Qwen3.8, 60 bahasa (29 dengan suara)', 'Kunci dari QwenCloud (internasional)', 'Kunci dari 千问云 (Tiongkok daratan)'],
  it: ['Interpretariato simultaneo Qwen3.8, 60 lingue (29 parlate)', 'Chiave di QwenCloud (internazionale)', 'Chiave di 千问云 (Cina continentale)'],
  ja: ['Qwen3.8 同時通訳、60 言語（音声は 29 言語）', 'QwenCloud（国際版）のキー', '千问云（中国本土版）のキー'],
  ko: ['Qwen3.8 동시 통역, 60개 언어(음성 29개)', 'QwenCloud(국제) 키', '千问云(중국 본토) 키'],
  ms: ['Tafsiran serentak Qwen3.8, 60 bahasa (29 dengan suara)', 'Kunci daripada QwenCloud (antarabangsa)', 'Kunci daripada 千问云 (tanah besar China)'],
  nl: ['Qwen3.8-simultaantolken, 60 talen (29 gesproken)', 'Sleutel van QwenCloud (internationaal)', 'Sleutel van 千问云 (Chinees vasteland)'],
  pl: ['Tłumaczenie symultaniczne Qwen3.8, 60 języków (29 z głosem)', 'Klucz z QwenCloud (międzynarodowy)', 'Klucz z 千问云 (Chiny kontynentalne)'],
  pt_BR: ['Interpretação simultânea Qwen3.8, 60 idiomas (29 com voz)', 'Chave do QwenCloud (internacional)', 'Chave do 千问云 (China continental)'],
  pt_PT: ['Interpretação simultânea Qwen3.8, 60 línguas (29 com voz)', 'Chave do QwenCloud (internacional)', 'Chave do 千问云 (China continental)'],
  ru: ['Синхронный перевод Qwen3.8, 60 языков (29 с озвучкой)', 'Ключ QwenCloud (международный)', 'Ключ 千问云 (материковый Китай)'],
  sv: ['Qwen3.8 simultantolkning, 60 språk (29 med röst)', 'Nyckel från QwenCloud (internationell)', 'Nyckel från 千问云 (Fastlandskina)'],
  ta: ['Qwen3.8 ஒரே நேர மொழிபெயர்ப்பு, 60 மொழிகள் (29 குரலுடன்)', 'QwenCloud (சர்வதேச) விசை', '千问云 (சீனப் பெருநிலம்) விசை'],
  te: ['Qwen3.8 సైమల్టేనియస్ ఇంటర్‌ప్రిటేషన్, 60 భాషలు (29 గొంతుతో)', 'QwenCloud (అంతర్జాతీయ) కీ', '千问云 (చైనా ప్రధాన భూభాగం) కీ'],
  th: ['ล่ามแปลพร้อมกัน Qwen3.8 60 ภาษา (มีเสียง 29 ภาษา)', 'คีย์จาก QwenCloud (นานาชาติ)', 'คีย์จาก 千问云 (จีนแผ่นดินใหญ่)'],
  tr: ["Qwen3.8 eşzamanlı çeviri, 60 dil (29'u sesli)", 'QwenCloud (uluslararası) anahtarı', '千问云 (Çin anakarası) anahtarı'],
  uk: ['Синхронний переклад Qwen3.8, 60 мов (29 з озвученням)', 'Ключ QwenCloud (міжнародний)', 'Ключ 千问云 (материковий Китай)'],
  vi: ['Phiên dịch đồng thời Qwen3.8, 60 ngôn ngữ (29 có giọng nói)', 'Khóa từ QwenCloud (quốc tế)', 'Khóa từ 千问云 (Trung Quốc đại lục)'],
  zh_CN: ['千问 Qwen3.8 同声传译，60 种语言（29 种可配音）', '来自 QwenCloud（国际版）的密钥', '来自千问云（中国内地）的密钥'],
  zh_TW: ['千問 Qwen3.8 同聲傳譯，60 種語言（29 種可配音）', '來自 QwenCloud（國際版）的金鑰', '來自千問雲（中國內地）的金鑰'],
};
const COPIED = ['voiceClone', 'voiceGroupClone', 'voiceSummaryCloneMine', 'voiceSummaryCloneTheirs'];
const locales = fs.readdirSync(dir).filter((l) => fs.existsSync(path.join(dir, l, 'translation.json'))).sort();
const unknown = locales.filter((l) => !T[l]);
if (locales.length !== 30 || unknown.length > 0) throw new Error(`expected the 30 known catalogs; unknown: ${unknown.join(',')}`);
for (const locale of locales) {
  const file = path.join(dir, locale, 'translation.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ast2 = json.providers.volcengine_ast2;
  const [description, storefrontIntl, storefrontCn] = T[locale];
  const qwen = { name: 'Qwen LiveTranslate', description };
  for (const key of COPIED) {
    if (typeof ast2[key] !== 'string' || ast2[key] === '') throw new Error(`${locale}: providers.volcengine_ast2.${key} is missing`);
    qwen[key] = ast2[key];
  }
  Object.assign(qwen, { storefrontIntl, storefrontCn });
  const providers = {};
  for (const [key, value] of Object.entries(json.providers)) {
    if (key === 'qwen_livetranslate') continue;
    providers[key] = value;
    if (key === 'volcengine_ast2') providers.qwen_livetranslate = qwen;
  }
  json.providers = providers;
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
console.log('updated', locales.length, 'catalogs');
```

- [ ] **Step 2: Run it**

```bash
node /home/jiangzhuo/.claude/jobs/30e1aeff/tmp/qwen-locales.cjs src/locales
git diff --stat src/locales
```

Expected: `updated 30 catalogs`; 30 files changed, each with exactly 10 lines added (the object's braces and its 8 keys) and none removed.

- [ ] **Step 3: Check the catalogs stay in lockstep**

Run: `npx vitest run src/locales`
Expected: PASS (`locale catalogs stay in lockstep with en` included).

- [ ] **Step 4: Commit**

```bash
git add src/locales
git commit -m "feat(qwen): name the provider and its voice strings in 30 languages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The icon and the settings view

**Files:**
- Modify: `src/components/Icons/ProviderIcons.tsx` (add `QwenIcon` at the end)
- Create: `src/providers/qwen_livetranslate/QwenSettings.tsx`
- Test: `src/providers/qwen_livetranslate/QwenSettings.test.tsx`

**Interfaces:**
- Consumes: `PresetVoiceField`, `presetVoice` (`src/components/providers/fields/PresetVoiceField`), `VoiceEntry`; Task 2's voices and voice functions; Task 3's `isEndpointId`; Task 9's keys.
- Produces: `QwenIcon: React.FC<IconProps>`, `QwenSettingsView(props: SettingsProps<QwenSettings>)`, `QwenVoiceSummary(props: VoiceSummaryProps<QwenSettings>)`.

There is no voice preview: the official LiveTranslate voice list publishes no sample audio (checked 2026-10-13), so the field gets no `onPreview` and renders no ▶, and the manifest gains no CDN.

- [ ] **Step 1: Write the failing test**

Create `src/providers/qwen_livetranslate/QwenSettings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const text = typeof fallback === 'string' ? fallback : key;
      return options ? text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name])) : text;
    },
  }),
}));
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: () => null }));
import type { VoiceLibrarySectionProps } from '../../components/Settings/sections/VoiceLibrarySection';
const { library } = vi.hoisted(() => ({ library: [] as VoiceLibrarySectionProps[] }));
vi.mock('../../components/Settings/sections/VoiceLibrarySection', () => ({
  default: function Library(props: VoiceLibrarySectionProps) {
    library.push(props);
    return null;
  },
}));

import type { SettingsProps } from '../../lib/provider/types';
import { QwenSettingsView, QwenVoiceSummary } from './QwenSettings';
import { QWEN_DEFAULTS, QWEN_VOICES, SPEAKER_CLONE, type QwenSettings } from './settings';

const props = (patch: Partial<SettingsProps<QwenSettings>> = {}): SettingsProps<QwenSettings> => ({ settings: QWEN_DEFAULTS, update: vi.fn(), ...patch });
beforeEach(() => {
  library.length = 0;
});

describe('QwenSettingsView (spec §4, §7)', () => {
  it("lists the speaker's own voice first under its own heading, then the 47 presets under Presets, with no preview", () => {
    render(<QwenSettingsView {...props()} />);
    expect(library).toHaveLength(1);
    const [mine] = library;
    expect(mine.voices[0]).toEqual({ id: SPEAKER_CLONE, label: "Clone the speaker's voice", group: 'builtin', removable: false, section: 'Voice cloning' });
    expect(mine.voices.slice(1).map((v) => v.id)).toEqual(QWEN_VOICES.map((v) => v.value));
    expect(mine.voices.slice(1).every((v) => v.section === undefined)).toBe(true);
    expect(mine.onPreview).toBeUndefined();
    expect(mine.selectedId).toBe('Tina');
  });

  it('writes my choice, the clone included', () => {
    const update = vi.fn();
    render(<QwenSettingsView {...props({ update })} />);
    library[0].onSelect(SPEAKER_CLONE);
    expect(update).toHaveBeenCalledWith({ voice: SPEAKER_CLONE });
  });

  it("adds the other party's row only while the participant speaks, writing its own field", () => {
    const update = vi.fn();
    render(<QwenSettingsView {...props({ update, participantSpeaks: true })} />);
    expect(library).toHaveLength(2);
    expect(library[1].selectedId).toBe('Ethan');
    library[1].onSelect('Serena');
    expect(update).toHaveBeenCalledWith({ participantVoice: 'Serena' });
  });

  it('names the storefront the check found under the key, and nothing before a check', () => {
    const { rerender } = render(<QwenSettingsView {...props({ models: [{ id: 'cn' }] })} />);
    expect(screen.getByText('Key from 千问云 (mainland China)')).toBeTruthy();
    rerender(<QwenSettingsView {...props({ models: [{ id: 'intl' }] })} />);
    expect(screen.getByText('Key from QwenCloud (international)')).toBeTruthy();
    rerender(<QwenSettingsView {...props({ models: [] })} />);
    expect(screen.queryByText(/^Key from/)).toBeNull();
  });
});

describe('QwenVoiceSummary', () => {
  it("names each leg's voice as its run speaks it, and the clone by whose voice it is", () => {
    const summary = (settings: QwenSettings, leg: 'speaker' | 'participant') => render(<QwenVoiceSummary {...props({ settings })} leg={leg} />).container.textContent;
    expect(summary({ voice: SPEAKER_CLONE, participantVoice: 'Liora Mira' }, 'speaker')).toBe('Your own voice (cloned)');
    expect(summary({ voice: SPEAKER_CLONE, participantVoice: SPEAKER_CLONE }, 'participant')).toBe('Their own voice (cloned)');
    expect(summary({ voice: SPEAKER_CLONE, participantVoice: 'Liora Mira' }, 'participant')).toBe('Liora Mira');
    expect(summary({ voice: 'Ethan', participantVoice: 'Ethan' }, 'participant')).toBe('Tina');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/providers/qwen_livetranslate/QwenSettings.test.tsx`
Expected: FAIL — `Failed to resolve import "./QwenSettings"`.

- [ ] **Step 3: Add the icon**

Append to `src/components/Icons/ProviderIcons.tsx`:

```tsx
/** Qwen's mark (@lobehub/icons-static-svg 1.70.0, `qwen-color.svg`, MIT), its gradient id made unique per instance. */
export const QwenIcon: React.FC<IconProps> = ({ size = 24, className, style }) => {
  const uid = React.useId?.() || Math.random().toString(36).slice(2);
  const fill = `qwen-fill-${uid}`;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" className={className} style={style}>
      <path
        d="M12.604 1.34c.393.69.784 1.382 1.174 2.075a.18.18 0 00.157.091h5.552c.174 0 .322.11.446.327l1.454 2.57c.19.337.24.478.024.837-.26.43-.513.864-.76 1.3l-.367.658c-.106.196-.223.28-.04.512l2.652 4.637c.172.301.111.494-.043.77-.437.785-.882 1.564-1.335 2.34-.159.272-.352.375-.68.37-.777-.016-1.552-.01-2.327.016a.099.099 0 00-.081.05 575.097 575.097 0 01-2.705 4.74c-.169.293-.38.363-.725.364-.997.003-2.002.004-3.017.002a.537.537 0 01-.465-.271l-1.335-2.323a.09.09 0 00-.083-.049H4.982c-.285.03-.553-.001-.805-.092l-1.603-2.77a.543.543 0 01-.002-.54l1.207-2.12a.198.198 0 000-.197 550.951 550.951 0 01-1.875-3.272l-.79-1.395c-.16-.31-.173-.496.095-.965.465-.813.927-1.625 1.387-2.436.132-.234.304-.334.584-.335a338.3 338.3 0 012.589-.001.124.124 0 00.107-.063l2.806-4.895a.488.488 0 01.422-.246c.524-.001 1.053 0 1.583-.006L11.704 1c.341-.003.724.032.9.34zm-3.432.403a.06.06 0 00-.052.03L6.254 6.788a.157.157 0 01-.135.078H3.253c-.056 0-.07.025-.041.074l5.81 10.156c.025.042.013.062-.034.063l-2.795.015a.218.218 0 00-.2.116l-1.32 2.31c-.044.078-.021.118.068.118l5.716.008c.046 0 .08.02.104.061l1.403 2.454c.046.081.092.082.139 0l5.006-8.76.783-1.382a.055.055 0 01.096 0l1.424 2.53a.122.122 0 00.107.062l2.763-.02a.04.04 0 00.035-.02.041.041 0 000-.04l-2.9-5.086a.108.108 0 010-.113l.293-.507 1.12-1.977c.024-.041.012-.062-.035-.062H9.2c-.059 0-.073-.026-.043-.077l1.434-2.505a.107.107 0 000-.114L9.225 1.774a.06.06 0 00-.053-.031zm6.29 8.02c.046 0 .058.02.034.06l-.832 1.465-2.613 4.585a.056.056 0 01-.05.029.058.058 0 01-.05-.029L8.498 9.841c-.02-.034-.01-.052.028-.054l.216-.012 6.722-.012z"
        fill={`url(#${fill})`}
        fillRule="nonzero"
      />
      <defs>
        <linearGradient id={fill} x1="0%" x2="100%" y1="0%" y2="0%">
          <stop offset="0%" stopColor="#6336E7" stopOpacity=".84" />
          <stop offset="100%" stopColor="#6F69F7" stopOpacity=".84" />
        </linearGradient>
      </defs>
    </svg>
  );
};
```

- [ ] **Step 4: Write `QwenSettings.tsx`**

Create `src/providers/qwen_livetranslate/QwenSettings.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { PresetVoiceField, presetVoice } from '../../components/providers/fields/PresetVoiceField';
import type { VoiceEntry } from '../../components/Settings/sections/VoiceLibrarySection';
import type { SettingsProps, VoiceSummaryProps } from '../../lib/provider/types';
import { isEndpointId } from './endpoints';
import { QWEN_VOICES, qwenParticipantVoice, qwenSpeakerVoice, SPEAKER_CLONE, type QwenSettings as S } from './settings';

/** The voice a spoken leg reads in, for the Speech rows, as its run resolves it: a preset's name, or whose own voice is cloned. */
export function QwenVoiceSummary({ settings, leg }: VoiceSummaryProps<S>) {
  const { t } = useTranslation();
  const id = leg === 'participant' ? qwenParticipantVoice(settings) : qwenSpeakerVoice(settings);
  if (id === SPEAKER_CLONE) {
    return <>{leg === 'participant'
      ? t('providers.qwen_livetranslate.voiceSummaryCloneTheirs', 'Their own voice (cloned)')
      : t('providers.qwen_livetranslate.voiceSummaryCloneMine', 'Your own voice (cloned)')}</>;
  }
  return <>{QWEN_VOICES.find((v) => v.value === id)?.name ?? id}</>;
}

/**
 * Qwen LiveTranslate's own settings (spec §7): the storefront the check
 * found, as a line under the key, and the voice — cloning the speaker under
 * a heading of its own, then the 47 presets, as Doubao AST 2.0 lists them.
 * No preview: the official voice list publishes no samples. No model,
 * region or instructions: the endpoint has none.
 */
export function QwenSettingsView({ settings, update, disabled = false, participantSpeaks = false, models = [], preview }: SettingsProps<S>) {
  const { t } = useTranslation();
  const voices: VoiceEntry[] = [
    {
      id: SPEAKER_CLONE, label: t('providers.qwen_livetranslate.voiceClone', "Clone the speaker's voice"), group: 'builtin', removable: false,
      section: t('providers.qwen_livetranslate.voiceGroupClone', 'Voice cloning'),
    },
    ...QWEN_VOICES.map((v) => presetVoice(v)),
  ];
  const storefront = models[0]?.id;
  return (
    <>
      {isEndpointId(storefront) && (
        <div className="settings-section">
          <div className="models-info">
            {storefront === 'intl'
              ? t('providers.qwen_livetranslate.storefrontIntl', 'Key from QwenCloud (international)')
              : t('providers.qwen_livetranslate.storefrontCn', 'Key from 千问云 (mainland China)')}
          </div>
        </div>
      )}
      <PresetVoiceField
        voices={voices} value={settings.voice} onChange={(voice) => update({ voice })} preview={preview} disabled={disabled}
        participant={participantSpeaks ? { value: settings.participantVoice, effective: qwenParticipantVoice(settings), onChange: (participantVoice) => update({ participantVoice }) } : undefined}
      />
    </>
  );
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run src/providers/qwen_livetranslate/QwenSettings.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/Icons/ProviderIcons.tsx src/providers/qwen_livetranslate/QwenSettings.tsx src/providers/qwen_livetranslate/QwenSettings.test.tsx
git commit -m "feat(qwen): the voice picker, the storefront line and the icon

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The definition and its registration

**Files:**
- Create: `src/providers/qwen_livetranslate/provider.ts`
- Test: `src/providers/qwen_livetranslate/provider.test.ts`
- Modify: `src/providers/registry.ts`, `src/providers/registry.test.ts`, `src/providers/openai/provider.test.ts:76-81`, `src/providers/sessionSide.consistency.test.ts` (after OpenAI Live's block, ~line 275)

**Interfaces:**
- Consumes: everything above; `platformHeaderSocket`.
- Produces: `qwenLiveTranslateProvider: Provider<QwenSettings, QwenCredentials, QwenConfig> & { id: 'qwen_livetranslate' }` in `PROVIDERS`, right after `volcengineAst2Provider`.

`participantSpeech` is left unset, which means `true` (OpenAI Live leaves it unset the same way).

- [ ] **Step 1: Write the failing test**

Create `src/providers/qwen_livetranslate/provider.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { QwenIcon } from '../../components/Icons/ProviderIcons';
import type { PresenceEnv } from '../../lib/provider/presence';
import { presentProviders, PROVIDERS } from '../registry';
import { checkQwen } from './check';
import { buildQwen, describeQwen } from './config';
import { qwenLiveTranslateProvider } from './provider';
import { QwenSettingsView, QwenVoiceSummary } from './QwenSettings';
import { QWEN_DEFAULTS, qwenCredentials, qwenLanguages } from './settings';

const release = (platform: PresenceEnv['platform'], patch: Partial<PresenceEnv> = {}): PresenceEnv =>
  ({ platform, dev: false, enabled: new Set<string>(), kizuna: true, switchOn: () => false, ...patch });
const offered = (env: PresenceEnv) => presentProviders(env).map((p) => p.id);

describe('the Qwen LiveTranslate definition (spec §1)', () => {
  it('is Qwen LiveTranslate with your own key, flagged behind its tester switch, on the desktop app and the extension only', () => {
    expect(qwenLiveTranslateProvider).toMatchObject({
      id: 'qwen_livetranslate',
      kind: 'own-key',
      platforms: ['electron', 'extension'],
      flagged: true,
      testerSwitch: 'debug:qwen-livetranslate',
      icon: QwenIcon,
      settings: { key: 'qwenLiveTranslate', defaults: QWEN_DEFAULTS },
      Settings: QwenSettingsView,
      VoiceSummary: QwenVoiceSummary,
      credentials: qwenCredentials,
      check: checkQwen,
      checkReads: [],
      languages: qwenLanguages,
      build: buildQwen,
      describe: describeQwen,
    });
    expect(qwenLiveTranslateProvider.settings).not.toHaveProperty('legacyKeys');
    expect(qwenLiveTranslateProvider.settings).not.toHaveProperty('migrate');
    for (const absent of ['guideUrl', 'TurnDetection', 'session', 'participantSpeech', 'faceToFace'] as const) {
      expect(qwenLiveTranslateProvider, absent).not.toHaveProperty(absent);
    }
  });

  it("speaks when asked, takes no typed text, keeps the server's turns, and offers both turn modes", () => {
    expect(qwenLiveTranslateProvider.speech).toBe('optional');
    expect(qwenLiveTranslateProvider.textInput(QWEN_DEFAULTS)).toBe(false);
    expect(qwenLiveTranslateProvider.boundaries(QWEN_DEFAULTS)).toBe('provider');
    expect(qwenLiveTranslateProvider.turns(QWEN_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it("a release offers it only on its tester's switch or when the release lists it; development builds offer it; the web never does", () => {
    for (const platform of ['electron', 'extension'] as const) {
      expect(offered(release(platform)), platform).not.toContain('qwen_livetranslate');
      expect(offered(release(platform, { switchOn: (key) => key === 'debug:qwen-livetranslate' })), platform).toContain('qwen_livetranslate');
      expect(offered(release(platform, { enabled: new Set(['qwen_livetranslate']) })), platform).toContain('qwen_livetranslate');
      expect(offered(release(platform, { dev: true })), platform).toContain('qwen_livetranslate');
    }
    expect(offered(release('web', { dev: true, enabled: new Set(['qwen_livetranslate']), switchOn: () => true }))).not.toContain('qwen_livetranslate');
  });

  it('sits right after Doubao AST 2.0 and right before OpenAI Realtime', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids.indexOf('qwen_livetranslate')).toBe(ids.indexOf('volcengine_ast2') + 1);
    expect(ids.indexOf('openai')).toBe(ids.indexOf('qwen_livetranslate') + 1);
  });
});
```

If importing the registry needs the settings service in this file (an error naming `ServiceFactory`), add the same `vi.mock('../../services/ServiceFactory', …)` block `src/providers/openai_live/provider.test.ts:3-15` uses, at the top.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/providers/qwen_livetranslate/provider.test.ts`
Expected: FAIL — `Failed to resolve import "./provider"`.

- [ ] **Step 3: Write `provider.ts`**

Create `src/providers/qwen_livetranslate/provider.ts`:

```ts
import { QwenIcon } from '../../components/Icons/ProviderIcons';
import { platformHeaderSocket } from '../../lib/contract/headerSocket';
import type { Provider } from '../../lib/provider/types';
import { createQwenAdapter } from './adapter';
import { checkQwen, detectEndpoint } from './check';
import { buildQwen, describeQwen, type QwenConfig } from './config';
import { QwenSettingsView, QwenVoiceSummary } from './QwenSettings';
import { QWEN_DEFAULTS, qwenCredentials, qwenLanguages, type QwenCredentials, type QwenSettings } from './settings';

const adapter = createQwenAdapter({ openHeaderSocket: platformHeaderSocket, detect: detectEndpoint });

/**
 * Qwen LiveTranslate with the user's own key (spec 2026-10-13; issue
 * #620): `qwen3.8-livetranslate-flash-realtime`, one session per leg, at the
 * storefront the key belongs to — QwenCloud or 千问云, which the check finds.
 * Its socket needs an `Authorization` header, which only the desktop app and
 * the extension can set (the header seam), so it has no web build (D3).
 * Flagged until the owner's live test passes (D9).
 */
export const qwenLiveTranslateProvider: Provider<QwenSettings, QwenCredentials, QwenConfig> & { id: 'qwen_livetranslate' } = {
  id: 'qwen_livetranslate',
  kind: 'own-key',
  platforms: ['electron', 'extension'],
  flagged: true,
  testerSwitch: 'debug:qwen-livetranslate',
  icon: QwenIcon,

  settings: { key: 'qwenLiveTranslate', defaults: QWEN_DEFAULTS },
  Settings: QwenSettingsView,
  // Each spoken leg's voice, or whose own voice is cloned, under its Speech row.
  VoiceSummary: QwenVoiceSummary,

  credentials: qwenCredentials,
  check: checkQwen,
  // The storefront depends on the key alone: a voice edit keeps Start on.
  checkReads: [],

  languages: qwenLanguages,

  // Text only is offered: a leg that does not speak asks for text alone.
  speech: 'optional',
  // An interpreter takes no typed text.
  textInput: () => false,
  // The server cuts each turn: on a change of speaker or 2.5 s of silence, or at a push-to-talk release.
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: buildQwen,
  describe: describeQwen,
  start: adapter.start,
};
```

- [ ] **Step 4: Register it**

In `src/providers/registry.ts`, add the import beside the others (alphabetical by path):

```ts
import { qwenLiveTranslateProvider } from './qwen_livetranslate/provider';
```

and change the `RELEASED` line and its comment to:

```ts
/** Shipped providers, in UI order (Stage 2 Kizuna Soniox, ruling 6; Stage 2 Gemini, ruling 6; Stage 2 Volcengine AST2, ruling 5; Stage 2 OpenAI Translate, ruling 11; Stage 2 OpenAI Realtime, ruling 18; Stage 2 Palabra, ruling 14; Stage 2 OpenAI Live, ruling 9; Qwen LiveTranslate, spec 2026-10-13 §8): the managed Kizuna Soniox, the free LocalInference, then Gemini, Doubao AST 2.0, Qwen LiveTranslate (flagged), OpenAI Realtime, OpenAI Translate, OpenAI Live, Soniox and Palabra AI with your own key. */
const RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, qwenLiveTranslateProvider, openaiProvider, openaiTranslateProvider, openaiLiveProvider, sonioxProvider, palabraProvider] as const;
```

- [ ] **Step 5: Update the pins**

In `src/providers/registry.test.ts`:

(a) In `'declares the settings each own-key check reads…'`, add `qwen_livetranslate: [],` right after `volcengine_ast2: ['authMode'],`.

(b) Replace the two tests

```ts
  it("every released id is the old Provider enum's spelling (controller ruling 2)", () => {
    for (const p of released) expect(Object.keys(LEGACY_SLICE_KEYS), p.id).toContain(p.id);
  });

  it('a provider that existed before keeps its storage prefix', () => {
    for (const p of released) expect(p.settings.key, p.id).toBe(LEGACY_SLICE_KEYS[p.id]);
  });
```

with

```ts
  // The providers the old path had: a provider new since (Qwen LiveTranslate) has no old spelling and no stored slice.
  const PORTED = ['kizunaai_soniox', 'local_inference', 'gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'openai_live', 'soniox', 'palabraai'];
  const ported = released.filter((p) => PORTED.includes(p.id));

  it("every ported id is the old Provider enum's spelling (controller ruling 2)", () => {
    expect(ported.map((p) => p.id)).toEqual(PORTED);
    for (const p of ported) expect(Object.keys(LEGACY_SLICE_KEYS), p.id).toContain(p.id);
  });

  it('a provider that existed before keeps its storage prefix', () => {
    for (const p of ported) expect(p.settings.key, p.id).toBe(LEGACY_SLICE_KEYS[p.id]);
  });
```

(c) In `"the release offers its providers in the owner's order"`, add `Qwen LiveTranslate (spec 2026-10-13 §8, flagged)` after `Doubao AST 2.0 (Stage 2 Volcengine AST2, ruling 5)` in the comment, and change the expectation to:

```ts
    expect(releaseBuild.PROVIDERS.map((p) => p.id)).toEqual(['kizunaai_soniox', 'local_inference', 'gemini', 'volcengine_ast2', 'qwen_livetranslate', 'openai', 'openai_translate', 'openai_live', 'soniox', 'palabraai']);
```

In `src/providers/openai/provider.test.ts`, change the order test (lines 76-81) to:

```ts
  it('sits after Qwen LiveTranslate and before OpenAI Translate, and OpenAI Compatible is registered nowhere (rulings 18, 1)', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids.indexOf('openai')).toBe(ids.indexOf('qwen_livetranslate') + 1);
    expect(ids.indexOf('openai')).toBe(ids.indexOf('openai_translate') - 1);
    expect(ids).not.toContain('openai_compatible');
  });
```

In `src/providers/sessionSide.consistency.test.ts`, right after OpenAI Live's `expect(live).toEqual([…]);` block, add:

```ts

    // Qwen LiveTranslate's sockets come from the header seam too. Its storefront detection reaches the adapter as a dependency, so the check stays on the settings side; the builder, the settings, the view, the definition and the fixtures are not the session's.
    const qwen = sessionSide(REPO_ROOT, 'src/providers/qwen_livetranslate');
    expect(qwen).toEqual([
      'src/providers/qwen_livetranslate/adapter.ts',
      'src/providers/qwen_livetranslate/endpoints.ts',
      'src/providers/qwen_livetranslate/segments.ts',
      'src/providers/qwen_livetranslate/wire.ts',
    ]);
```

- [ ] **Step 6: Run the provider, registry and consistency suites**

Run: `npx vitest run src/providers/qwen_livetranslate src/providers/registry.test.ts src/providers/openai/provider.test.ts src/providers/volcengine_ast2/provider.test.ts src/providers/sessionSide.consistency.test.ts src/providers/oldPath.consistency.test.ts src/lib/diagnostics/consoleLedger.consistency.test.ts src/lib/provider`
Expected: PASS. In particular `registry.test.ts`'s invariants (unique keys, credential fields, language offers in each context, wire round trips, en name and description) all hold for the new provider.

- [ ] **Step 7: Commit**

```bash
git add src/providers/qwen_livetranslate/provider.ts src/providers/qwen_livetranslate/provider.test.ts src/providers/registry.ts src/providers/registry.test.ts src/providers/openai/provider.test.ts src/providers/sessionSide.consistency.test.ts
git commit -m "feat(qwen): register Qwen LiveTranslate, flagged, after Doubao AST 2.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Extension manifest and documentation

**Files:**
- Modify: `extension/manifest.json` (`host_permissions`, `content_security_policy.extension_pages`)
- Test: `extension/manifest.consistency.test.ts`
- Modify: `CLAUDE.md` (Project Overview; API Key Types; Security Policy), `CONTEXT.md:7`

**Interfaces:** none.

- [ ] **Step 1: Write the failing test**

Add to `extension/manifest.consistency.test.ts`, inside the `describe`, after the `'allows every Soniox regional origin'` case:

```ts
  // Qwen LiveTranslate (spec 2026-10-13 §10): the socket on both storefronts, which
  // the header rule only reaches on a declared host, and the key check's token
  // endpoint over HTTPS — a wss:// entry does not cover https://.
  it("lets Qwen LiveTranslate reach both storefronts: the socket, its header rule and the key check", () => {
    const origins = manifest.content_security_policy.extension_pages.split(/[ ;]+/);
    for (const origin of ['wss://maas.qwencloudapi.com', 'wss://maas.qianwenaiapi.com', 'https://maas.qwencloudapi.com', 'https://maas.qianwenaiapi.com']) {
      expect(origins, origin).toContain(origin);
    }
    expect(manifest.host_permissions).toEqual(expect.arrayContaining(['wss://maas.qwencloudapi.com/*', 'wss://maas.qianwenaiapi.com/*']));
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run extension/manifest.consistency.test.ts`
Expected: FAIL on `wss://maas.qwencloudapi.com`.

- [ ] **Step 3: Edit the manifest**

In `extension/manifest.json`:
- In `host_permissions`, after `"wss://api.openai.com/*",` add the two lines `"wss://maas.qwencloudapi.com/*",` and `"wss://maas.qianwenaiapi.com/*",`.
- In `content_security_policy.extension_pages`, the `connect-src` list ends with `https://tts-rt.jp.soniox.com"`. Replace that ending with `https://tts-rt.jp.soniox.com wss://maas.qwencloudapi.com wss://maas.qianwenaiapi.com https://maas.qwencloudapi.com https://maas.qianwenaiapi.com"`.

Check the file still parses: `node -e "require('./extension/manifest.json')"` prints nothing and exits 0.

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run extension/manifest.consistency.test.ts`
Expected: PASS, every case.

- [ ] **Step 5: Update the docs**

`CLAUDE.md`:
- Project Overview: replace `Google Gemini, Doubao AST 2.0, OpenAI Realtime,` with `Google Gemini, Doubao AST 2.0, Qwen LiveTranslate (flagged until its live test passes), OpenAI Realtime,`.
- "API Key Types", item 1: replace `Gemini, Doubao AST 2.0, Soniox, Palabra AI - users input their own keys` with `Gemini, Doubao AST 2.0, Qwen LiveTranslate, Soniox, Palabra AI - users input their own keys`.
- "Security Policy": replace `(OpenAI, Google, Doubao, Soniox, Palabra, Kizuna AI)` with `(OpenAI, Google, Doubao, Qwen, Soniox, Palabra, Kizuna AI)`.

`CONTEXT.md` line 7: replace `The registry lists nine, in the picker's order: Kizuna AI (the managed Soniox), Local Inference, Gemini, Doubao AST 2.0 (Volcengine AST2), OpenAI Realtime,` with `The registry lists ten, in the picker's order: Kizuna AI (the managed Soniox), Local Inference, Gemini, Doubao AST 2.0 (Volcengine AST2), Qwen LiveTranslate, OpenAI Realtime,`, and `a platform (OpenAI Live: Electron and the extension)` with `a platform (OpenAI Live and Qwen LiveTranslate: Electron and the extension)`.

- [ ] **Step 6: Commit**

```bash
git add extension/manifest.json extension/manifest.consistency.test.ts CLAUDE.md CONTEXT.md
git commit -m "feat(qwen): allow both storefronts in the extension; document the provider

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Full verification

**Files:** none changed unless something fails.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: The whole test suite**

Run: `npx vitest run`
Expected: every file passes. Compare against a run on `origin/main` only if something fails that the branch did not touch, to tell a pre-existing failure from a new one; report either honestly.

- [ ] **Step 3: Secrets**

Run: `git log -p origin/main..HEAD | grep -nE "sk-ws-[A-Za-z0-9]{1}\.[A-Za-z0-9]{6,}" | grep -v "ABCDEFG\|ABCDEFGH\|ABCDEFGHIJ"`
Expected: no output — only the suites' made-up keys appear in the branch, never a real one.

- [ ] **Step 4: The checklist for the owner's live test**

Nothing to commit. The live test is the owner's (spec §12, "Owner's live test"), on a development build or a packaged one with `localStorage.setItem('debug:qwen-livetranslate', '1')` and a restart; `localStorage.removeItem('debug:qwen-livetranslate')` hides it again. List those eight checks in the hand-off.
