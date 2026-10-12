# Local inference: the other side's speech (#619)

Status: design approved section by section (2026-10-12); this file is for the owner's review.
Issue: kizuna-ai-lab/sokuji#619.

## Goal

With local inference, Translation I hear (我听到的翻译) works as it does for the other providers: the other side's translation is read to me in my language, with a TTS model and a voice I can see and change, and when it cannot be, I am told why. My own direction behaves as today.

## Rulings (the owner, 2026-10-12)

| # | Question | Ruling |
|---|---|---|
| R1 | Over the memory budget | Start, with the other side's leg text only and a warning, when the other side's TTS model alone tips the budget. When ASR and translation alone are over, refuse as today. |
| R2 | Voice storage | One voice per direction, in a table keyed by direction. The two shared fields retire; each user's voice resets once to the default (no one-time migration code). |
| R3 | Saying "no speech model" | A warning in the conversation at Start, one per leg that should speak but cannot, for both legs (mine was silent too) and both reasons (no model, over budget). Clicking it opens that direction's TTS slot. Start is never blocked. |
| R4 | Voice lines in the Speech block (#618) | Local inference joins; its line opens that direction's TTS slot. |
| R5 | How the budget lets a run start without the other side's TTS | `admit` gains a third answer: start with these adjusted per-leg configs. |

## Today (2026-10-12, main at fc97e26f6)

- The participant leg speaks when Translation I hear is on (`shape.ts` `legSpeaks`; local inference sets no `participantSpeech` flag). Its TTS model is auto-resolved for the reversed direction (`config.ts:71`); its stored slot (`selections[target→source].tts`) can only stay on auto because the engine page hides it (`useWasmEngineAdapter.ts:103`, the 2026-08-22 engine-model-selection ruling "the UI does not render it", never revisited by #570 or #615).
- `edgeTtsVoice` and `ttsSpeakerId` are one pair of fields for both directions (`config.ts:118-125`). `SettingsInitializer` keeps `edgeTtsVoice` valid for my target only; the Library shows voice editing only for my direction (`ownsVoiceSettings`, `ModelManagementSection.tsx:666`), the guard against the 2026-08-23 freeze.
- No TTS resolving leaves a leg text only, silently (`adapter.ts:154`, `:671-674`); TTS never gates readiness (`check.ts:18-28`).
- `admitLocalInference` counts the participant's TTS when it speaks and a refusal stops the whole run (`run.ts:180-188`); the pre-#570 code only dropped the participant leg.

## Design

### 1. Storage: one voice per direction

- `LocalInferenceSettings` gains `voices: Record<string, { edge?: string; speaker?: number }>`, keyed by direction (`directionKey(src, tgt)`, e.g. `zh→ja`). `edge` is an Edge TTS voice ShortName; `speaker` is a speaker id for Supertonic and the multi-speaker local models.
- Local inference has no `settings.migrate`: stored values load as stored (`providerStore.ts:247`), and `selections` is read defensively by the resolver. `voices` follows the same pattern: one accessor, `directionVoice(s, dir)`, reads an entry and ignores a field of the wrong kind (`edge` not a non-empty string, `speaker` not a finite number). Nothing is converted or written back.
- `edgeTtsVoice` and `ttsSpeakerId` leave `LOCAL_INFERENCE_DEFAULTS`, so the provider store no longer reads them (it reads the keys of the defaults). **Stated departure:** each user's local-inference voice choice resets once to the default.
- `ttsSpeed` stays one value for both directions.
- What a leg's run uses: Edge, `voices[dir].edge`; any other engine, `voices[dir].speaker`, else the model's default (`ttsConfig.defaultSid`, else 0).
- Edge voices are tied to a language (each voice belongs to one locale; the list comes from Microsoft online). `SettingsInitializer` keeps each direction that will speak and resolves to Edge valid for its own target language, writing `voices[dir].edge` with the first voice of that language when the stored one is absent or invalid. The participant direction is checked only while its leg speaks. Each direction writes only its own entry, so two writers can no longer contend for one field (the 2026-08-23 freeze).
- Not changed: a speaker id belongs to a model. When a direction's model changes and the stored id is not in the new one, today's `voice_fallback` notice and the model default apply, as they do for my direction now.

### 2. Engine page, Library, Settings chips

- The participant direction's TTS slot shows while that leg speaks (Both or Other, Translation I hear on and offered), and only then. `stagesFor` takes that condition; the host passes it to the provider's `Engine` and `EngineSummary`, as #618 passed `participantSpeaks` to `Settings`.
- The slot works as mine does: Auto naming its pick, the downloaded candidates that speak my language, Browse library. A pick writes `selections[target→source].tts`, the slot that already exists.
- Settings chips: in the same condition, the Other group gains a TTS chip, `None` in the warning colour when nothing resolves; the memory estimate counts that TTS model (not Edge, a cloud model), matching what `admit` counts.
- Library TTS card: the voice picker shows for the selected TTS model of whichever direction the Library was opened for, lists the voices of that direction's target language, and writes `voices[direction]` only. The `ownsVoiceSettings` guard is removed: it existed because both directions wrote one field.
- My direction's slot and chip are unchanged.

### 3. A run: build, admit, warnings

- **build**: a leg whose context says speak gets `tts` from its direction's resolved model and its `voices` entry. When no TTS model resolves, its config records `ttsUnavailable: 'no-model'` instead.
- **admit (R5)**: `SessionHooks.admit` may answer `true`, a refusal, or `{ configs }`, the per-leg configs to run instead; the runner then uses those (the legs stay as built). `admitLocalInference` returns adjusted configs only when the participant's TTS model alone tips the budget: that leg's `tts` is removed and `ttsUnavailable: 'over-budget'` recorded. Over budget without it, it refuses as today (`memory_exceeded`).
- **Warnings (R3)**: when a leg's session starts, an adapter whose config records `ttsUnavailable` while its context says speak emits one `degraded`, as Soniox does for a leg issued no TTS key (`soniox/adapter.ts:310`). Three codes in `CLIENT_DIAGNOSTICS`, severity warning, each with its sentence in all 30 catalogs (`notices.<code>`, `NOTICE_WORDS`):
  - `speaker_tts_missing`: "Translation the other side hears is text only: no speech model speaks {{target}}." (zh_CN 「对方听到的翻译只显示文字：没有能说{{target}}的语音模型。」)
  - `participant_tts_missing`: "Translation I hear is text only: no speech model speaks {{target}}." (zh_CN 「我听到的翻译只显示文字：没有能说{{target}}的语音模型。」)
  - `participant_tts_over_budget`: "Translation I hear is text only: not enough memory to load the other side's speech model too." (zh_CN 「我听到的翻译只显示文字：内存不够同时加载对方的语音模型。」)
- `degraded` gains optional `params` (the contract's `AdapterEvents`), which L1 passes into the notice; `target` is the leg's target language, localized by `noticeText` as other notices' `source`/`target` are.
- **Stated departure:** like every `degraded`, these reach the `api_error` analytics event (`run.ts` ruling 8), although they are not API errors.
- **Clicking a warning**: a new notice action, `{ kind: 'engine-slot', leg, stage: 'tts' }`, for the three codes. MainPanel's handler works out the direction from the leg and the current pair, opens Settings on the Provider tab (Advanced) or the engine page (Simple), and sets `engineSlotTarget`, the path the model chips already use.
- When the participant's TTS is dropped, routing and replay change nothing: that leg simply sends no audio.

### 4. Voice lines (R4)

- Local inference gives a `VoiceSummary` naming each spoken leg's voice from its direction's resolved TTS model and `voices` entry:
  - Edge: a short name from the ShortName (`zh-CN-XiaoxiaoNeural` → "Xiaoxiao"); no lookup in the online voice list.
  - Supertonic: the preset's name (`ttsConfig.presetVoices`); an imported voice (`dbKeyFromImportedSid` in `sidMapping.ts` answers non-null) reads `settings.voiceCustom` ("Custom voice", added by #618), since its name lives in IndexedDB.
  - Other multi-speaker models: the model's short name and the speaker number ("VITS 中文 #3"), as the Library edits a numeric speaker id.
  - Single-voice models: the model's short name.
  - No TTS model resolved: nothing, and the line is hidden; the warning of section 3 covers it.
- The provider definition gains an optional member, `voicesInEngine?: true`: its voices are picked in the engine's TTS slot. `VoiceLine` then opens that leg's direction's TTS slot, through the same action as the warnings, instead of `voice-settings`. Every other provider is unchanged.

## Testing

Test first, then the code:

- Settings: `voices` read field by field; the retired fields not read.
- Engine page and chips: the participant TTS slot and chip only while that leg speaks; the memory estimate counting its model.
- Library: the TTS card writes only its own direction's voice and lists that direction's target-language voices.
- `SettingsInitializer`: only directions that will speak, each against its own target.
- build: each leg's voice; the `no-model` record.
- admit: fits / drop the participant's TTS / refuse; the runner running the adjusted configs.
- Adapter: one warning per leg at Start with the code and `target`, reaching the notice through L1.
- The warning's click: the leg's TTS slot.
- `VoiceSummary`: each engine kind; `VoiceLine` opening the engine slot when `voicesInEngine`.
- Locale consistency tests.

Rendering on the renderer-only dev server: the engine page and Settings chips with the participant TTS slot (Both, Translation I hear on), the voice lines, and a warning in the conversation.

Owner's live checks:

- With a TTS model for my language downloaded: the other side is read to me in it; a voice change takes effect.
- Without one: the warning; its click opens the slot.
- Edge: each direction keeps its own voice across a pair swap.
- Over budget: set `debug:device-memory` (GB; the budget is 75% of it) between the two totals the Settings memory estimate shows with Translation I hear off and on, then start in Both: the run starts with the over-budget warning.

## Out of scope

- Per-direction TTS speed.
- A speaker id kept per model (today's `voice_fallback` when a direction's model changes stays).
- Local Native, still on the old path until #578.
