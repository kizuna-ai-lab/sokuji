# Local Provider Custom Translation Prompt

**Date:** 2026-04-19
**Status:** Design approved, ready for implementation plan

## Problem

Local-provider Qwen translation workers use a hardcoded English system prompt. Small Qwen models (e.g., Qwen3 0.6B) sometimes misinterpret speech transcripts as chat queries — user says "我想问一些问题" and the model responds "Sure, how can I help you?" instead of translating.

Users need the ability to customize the translation system prompt to:
1. Fix model-specific misbehavior (primary motivator — the bug above)
2. Add domain-specific terminology (medical, legal, game terms)
3. Control output style (formal/casual, preserve certain terms)
4. Inject few-shot examples for small-model consistency

Cloud providers (OpenAI, Gemini) already expose editable system instructions via AdvancedSettings. Local provider has no equivalent — the prompt is hardcoded in each translation worker.

## Goals & Non-Goals

**Goals**
- Mirror cloud's Simple/Advanced UX so users have one mental model for "custom prompt"
- Let users fully rewrite the translation system prompt in Advanced mode
- Preserve today's dynamic default (language-aware filler list, native language names, `/no_think` for Qwen3) for users who don't customize
- Honor speaker/participant direction split — each pairs with its own translation model and its own prompt
- Silently no-op (with visible explanation) for non-LLM translation models (Opus-MT, TranslateGemma)

**Non-Goals**
- Per-model prompt overrides (one prompt applies to whichever Qwen variant is active)
- Exposing template placeholders to users (`{{SOURCE_LANGUAGE}}` etc.) — Advanced mode is pure freeform
- Editing the Simple-mode template (Simple is read-only preview of dynamic default)
- Custom prompts for non-Qwen workers (Opus-MT has no chat template; TranslateGemma uses structured fields)
- Injecting `/no_think` as user-facing content — it stays a worker-internal Qwen3 switch

## Design Overview

Three layers:

1. **Store** — three new fields on `LocalInferenceSettings`; a new selector `getProcessedLocalPrompt(forParticipant)`.
2. **Prompt builder** — shared pure function `buildDefaultLocalPrompt(src, tgt)` that both the selector and the worker fallback path can call.
3. **Worker contract** — main thread sends a resolved `systemPrompt` and a `wrapTranscript` flag with each translate message. Worker stops building prompts itself.

UI mirrors cloud's `system-instructions-section` one-to-one: Simple (read-only preview) vs Advanced (two freeform textareas, speaker + participant).

## Data Model

### `LocalInferenceSettings` additions

```typescript
interface LocalInferenceSettings {
  // ... existing fields ...
  useTemplateMode: boolean;            // true = Simple (default), false = Advanced
  systemPrompt: string;                // Advanced-mode speaker prompt (default '')
  participantSystemPrompt: string;     // Advanced-mode participant prompt (default '', empty = fall back to speaker)
}
```

Defaults: `useTemplateMode: true`, `systemPrompt: ''`, `participantSystemPrompt: ''`.

Persistence: same localStorage path as other `localInference.*` fields.

### Why no `templateSystemPrompt` field

Cloud stores `templateSystemInstructions` because its template is a static string with `{{SOURCE_LANGUAGE}}` placeholders. Local's Simple-mode "template" is a dynamic function of `(srcLang, tgtLang, modelId-is-Qwen3)` that pulls from `LANG_FILLERS` / `NATIVE_NAMES` / `LANG_NAMES` tables. Storing a frozen string would diverge from actual worker behavior whenever we tweak those tables. Keep the Simple-mode prompt as pure code.

## Prompt Builder

**New file:** `src/lib/local-inference/prompts.ts`

Moves `LANG_NAMES`, `NATIVE_NAMES`, `LANG_FILLERS` out of the Qwen workers into this shared module.

```typescript
export function buildDefaultLocalPrompt(sourceLang: string, targetLang: string): string {
  const srcName = LANG_NAMES[sourceLang] || sourceLang;
  const tgtName = LANG_NAMES[targetLang] || targetLang;
  const nativeTgt = NATIVE_NAMES[targetLang];
  const tgtLabel = nativeTgt ? `${nativeTgt} (${tgtName})` : tgtName;

  const langs = new Set([sourceLang, targetLang]);
  const fillers = Array.from(langs).flatMap(l => LANG_FILLERS[l] || []);
  if (!fillers.length) fillers.push('um', 'uh');
  const fillerList = fillers.join(', ');

  return (
    `You are a translator. Translate the speech transcript inside <transcript> tags from ${srcName} to ${tgtLabel}.\n` +
    `Drop fillers (${fillerList}). Fix stuttering and repetitions.\n` +
    `Output ONLY the ${tgtLabel} translation. No explanation, no refusal.`
  );
}
```

Does **not** include `/no_think` — that is a runtime Qwen3 switch added by the worker based on `currentModelId`, independent of Simple/Advanced mode.

## Store Selector

**New selector** on `useSettingsStore`:

```typescript
getProcessedLocalPrompt: (forParticipant = false) => {
  const s = get().localInference;
  const [srcLang, tgtLang] = forParticipant
    ? [s.targetLanguage, s.sourceLanguage]   // participant direction reversed
    : [s.sourceLanguage, s.targetLanguage];

  if (s.useTemplateMode) {
    return buildDefaultLocalPrompt(srcLang, tgtLang);
  }
  // Advanced mode
  const base = s.systemPrompt.trim() || buildDefaultLocalPrompt(srcLang, tgtLang);
  if (!forParticipant) return base;
  const participant = s.participantSystemPrompt.trim();
  return participant || base;
}
```

**Fallback semantics** (prevents footguns):
- Advanced speaker empty → default built prompt (not an empty string sent to the model)
- Advanced participant empty → falls back to resolved speaker prompt (mirrors cloud's `participantSystemInstructions` empty-fallback behavior)

`getProcessedSystemInstructions` (the existing cloud-facing selector) is not modified. Local provider uses `getProcessedLocalPrompt`; cloud providers keep using `getProcessedSystemInstructions`. The switch happens at the call site (MainPanel translate pipeline).

## Worker Contract

### Message shape change

**`qwen-translation.worker.ts` + `qwen35-translation.worker.ts`** — `TranslateMessage`:

```typescript
interface TranslateMessage {
  type: 'translate';
  id: string;
  text: string;
  sourceLang: string;
  targetLang: string;
  systemPrompt: string;    // NEW: fully resolved prompt from main thread
  wrapTranscript: boolean; // NEW: true = wrap user message in <transcript>
}
```

### Worker behavior

```typescript
async function handleTranslate(msg: TranslateMessage) {
  const isQwen3 = currentModelId.toLowerCase().includes('qwen3');
  const finalSystemPrompt = isQwen3 ? `${msg.systemPrompt} /no_think` : msg.systemPrompt;

  const userContent = msg.wrapTranscript
    ? `<transcript>${msg.text}</transcript>`
    : msg.text;

  const messages = [
    { role: 'system', content: finalSystemPrompt },
    { role: 'user', content: userContent },
  ];

  // ... rest unchanged (generator call, <think> stripping, postMessage) ...
}
```

Workers lose their own copies of `LANG_NAMES` / `NATIVE_NAMES` / `LANG_FILLERS` and the inline prompt-building block. `/no_think` logic stays in the worker (it needs `currentModelId` which the worker already owns).

### Opus-MT / TranslateGemma workers

No changes. These workers don't consume `systemPrompt` / `wrapTranscript`. `TranslationEngine` still passes the fields in the message envelope; workers ignore unknown fields.

## Engine & Call Chain

### `TranslationEngine.translate()`

Add two parameters:

```typescript
async translate(text: string, systemPrompt: string, wrapTranscript: boolean): Promise<TranslationResult>
```

The engine passes them into the worker message verbatim.

### Call sites (MainPanel speaker/participant translate pipelines)

```typescript
const isAdvanced = !localInference.useTemplateMode;
const speakerPrompt = getProcessedLocalPrompt(false);
const participantPrompt = getProcessedLocalPrompt(true);

speakerEngine.translate(text, speakerPrompt, !isAdvanced);
participantEngine.translate(text, participantPrompt, !isAdvanced);
```

- `wrapTranscript = !isAdvanced`: Simple mode wraps (its default prompt refers to `<transcript>` tags); Advanced mode sends bare text (user's prompt may or may not mention the tag — don't assume).
- Speaker and participant each use their own `TranslationEngine` instance (existing participant architecture from `createParticipantLocalInferenceConfig`). Each receives its own prompt.

## UI

### Location

`ProviderSpecificSettings.tsx` → `renderLocalInferenceSettings()` → new section rendered between Turn Detection and VAD (high-frequency user tweak near the top).

### Visibility

- Only rendered when `provider === Provider.LOCAL_INFERENCE`.
- When the resolved translation worker type is **not** `qwen` or `qwen35`:
  - Section has `.disabled` class (opacity 0.5, pointer-events: none)
  - Displays info text: `settings.localPromptUnsupported` = "Current translation model does not support custom prompts. Switch to a Qwen-family model in Model Management to enable."
- When session is active: all controls `disabled` (matches cloud behavior).

### Structure (mirrors cloud `system-instructions-section`)

```
┌─ Translation Prompt  [?] ──────────────────────────────┐
│                                                         │
│  [ Simple ][ Advanced ]                                 │
│                                                         │
│  // Simple mode:                                        │
│  Preview  [▼]                                           │
│  ┌────────────────────────────────────────────┐        │
│  │ (read-only resolved speaker prompt)        │        │
│  └────────────────────────────────────────────┘        │
│                                                         │
│  // Advanced mode:                                      │
│  <textarea systemPrompt>                                │
│                                                         │
│  Participant Instructions  [?]                          │
│  <textarea participantSystemPrompt>                     │
│  (placeholder: "Leave empty to use main instructions")  │
│                                                         │
│  For Qwen3 models, ` /no_think` is appended            │
│  automatically.                                         │
└─────────────────────────────────────────────────────────┘
```

Preview shows the **speaker** direction only. Participant prompt is implicitly the swapped-language default in Simple mode, or the participant textarea content in Advanced mode. Two previews would add noise without proportionate value.

### New i18n keys

| Key | English |
|---|---|
| `settings.localTranslationPrompt` | "Translation Prompt" |
| `settings.localTranslationPromptTooltip` | "Customize how the local translation model is instructed. Only applies to Qwen-family models." |
| `settings.localPromptUnsupported` | "Current translation model does not support custom prompts. Switch to a Qwen-family model in Model Management to enable." |
| `settings.localPromptNoThinkHint` | "For Qwen3 models, ` /no_think` will be automatically appended." |

Existing reusable keys: `settings.simple`, `settings.advanced`, `settings.preview`, `settings.participantInstructions`, `settings.participantInstructionsTooltip`.

Ship `en` + `zh_CN` at minimum; other locales fall back to English until follow-up i18n PR.

### Resolved-worker-type detection

Helper (new, near `createLocalInferenceSessionConfig`):

```typescript
function resolveTranslationWorkerType(settings: LocalInferenceSettings): string {
  const modelId = settings.translationModel || getTranslationModel(settings.sourceLanguage, settings.targetLanguage)?.id;
  const entry = modelId ? getManifestEntry(modelId) : undefined;
  return entry?.translationWorkerType || (entry?.multilingual ? 'qwen' : 'opus-mt');
}
```

Gate the section on `['qwen', 'qwen35'].includes(resolveTranslationWorkerType(localInference))`.

## Edge Cases

**Mode toggling**
Switching Simple ↔ Advanced preserves `systemPrompt` / `participantSystemPrompt` in the store. No clearing.

**Model switching to unsupported worker**
Section grays out; stored Advanced text is preserved. Switching back to a Qwen model restores editability with the same text intact.

**Empty Advanced speaker field**
Falls back to `buildDefaultLocalPrompt(...)`. Prevents accidental-clear footgun.

**Empty Advanced participant field**
Falls back to resolved speaker prompt (which itself may be empty-fallback to default). Chain: `participant.trim() || speaker.trim() || default`.

**Language change during editing**
Simple preview recomputes immediately via selector. Advanced text is independent of current language (user wrote concrete language names — they're responsible for updating if they swap direction).

**Session-active edit lock**
All toggle buttons, textareas, preview toggle remain `disabled` while session is active, matching cloud conventions.

**`/no_think` visibility**
Always appended by worker for Qwen3, including in Advanced mode. Note text under Advanced textareas warns users. No silent magic — the hint is visible.

**Oversized user prompt**
No proactive truncation. Generator's `max_new_tokens: 256` caps output. If user prompt + input exceeds model context, the worker's existing try/catch surfaces an error to LogsPanel.

## Testing

### Unit tests

**`src/lib/local-inference/prompts.test.ts`** (new)
- `buildDefaultLocalPrompt('ja', 'en')` contains `Japanese`, `English`, `日本語`, filler words from both languages
- Unknown language codes (`'xx'`, `'yy'`) use fallback fillers (`um, uh`) and raw codes
- Same-language pair (`'en', 'en'`) doesn't crash; fillers deduplicated

**`src/stores/settingsStore.test.ts`** (extend)
- Simple mode: `getProcessedLocalPrompt()` equals `buildDefaultLocalPrompt(src, tgt)`
- Simple mode, `forParticipant=true`: languages swapped
- Advanced mode, speaker filled: returns user text
- Advanced mode, speaker empty: falls back to default
- Advanced mode, participant empty: falls back to resolved speaker
- Advanced mode, participant filled: returns participant text

### Component tests

If Settings components have existing React Testing Library coverage, add:
- Toggle Simple → preview shown, textareas hidden
- Toggle Advanced → textareas shown, preview hidden
- Session active → all controls disabled
- Switch translation model to Opus-MT → section has `.disabled` class and shows unsupported hint

### Manual smoke test (required before merge)

1. Provider = Local, Qwen3 0.6B, zh→en, Simple mode: say "我想问一些问题" → output is English translation, not a chat reply. (Regression test for the motivating bug.)
2. Switch to Advanced, clear speaker textarea → behavior matches Simple (default fallback verified).
3. Fill Advanced speaker with a short custom prompt → output reflects the new prompt.
4. Switch translation model to Opus-MT → section grays out with unsupported hint.
5. Swap source/target languages in Simple mode → preview updates live.

### Out of scope for automated tests

- Qwen model inference quality (flaky, environment-sensitive)
- Exact `/no_think` placement in system prompt (implementation detail, covered by manual smoke)

## Migration

No migration needed. New fields default to Simple mode (`useTemplateMode: true`) with empty Advanced strings, which reproduces current behavior verbatim (worker uses `buildDefaultLocalPrompt` = exact same text it had hardcoded).

Users with existing local inference configs see no change in behavior until they toggle to Advanced and edit the textareas.

## Open Questions

None. All design decisions resolved during brainstorming (2026-04-19 session).
