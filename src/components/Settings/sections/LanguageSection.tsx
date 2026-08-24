import React, { useMemo, useCallback } from 'react';
import { Languages, ArrowLeftRight, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import ToggleSwitch from '../shared/ToggleSwitch';
import {
  useProvider,
  useSettingsStore,
  useKizunaVolcengineAst2Settings,
  useLocalInferenceSettings,
  useLocalNativeSettings,
  useVolcengineAST2Settings,
  useZoomAISettings,
  useUpdateOpenAI,
  useUpdateGemini,
  useUpdateOpenAICompatible,
  useUpdatePalabraAI,
  useUpdateOpenAITranslate,
  useUpdateKizunaOpenaiTranslate,
  useUpdateKizunaVolcengineAst2,
  useUpdateKizunaSoniox,
  useUpdateLocalInference,
  useUpdateLocalNative,
  useUpdateVolcengineST,
  useUpdateVolcengineAST2,
  useUpdateZoomAI,
  useUpdateSoniox,
  useNavigateToSettings,
  useUIMode,
  useSetEngineSlotTarget,
  useValidateApiKey,
  useTextOnly,
  useSetTextOnly,
  useKeepReplayAudio,
  useSetKeepReplayAudio
} from '../../../stores/settingsStore';
import type { SettingsStore } from '../../../stores/settingsStore';
import { Provider, kizunaBaseProvider } from '../../../types/Provider';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { ProviderConfig } from '../../../services/providers/ProviderConfig';
import { resolveAST2LanguagePair } from '../../../services/providers/volcengineAST2LanguageSync';
import { useIsParticipantChannelInScope, useMode, speakerChannelInScope } from '../../../stores/audioStore';
import { useLockedMode } from '../../../stores/sessionStore';
import { effectiveTextOnly } from '../../../utils/effectiveTextOnly';
import { useAnalytics } from '../../../lib/analytics';
import { getTranslationTargetLanguages, getManifestEntry } from '../../../lib/local-inference/modelManifest';
import { shortenModelName } from '../../../lib/local-inference/modelName';
import { useModelStatuses, useModelInitialized, useLastResolutionNotes, useModelStore } from '../../../stores/modelStore';
import { useNativeLastResolutionNotes, useNativeCatalog, useNativeModelStore } from '../../../stores/nativeModelStore';
import { directionKey, emptyDirection, type Stage, type Selections, type ResolutionNote } from '../../../lib/local-inference/selection/types';

interface LanguageSectionProps {
  isSessionActive: boolean;
  /** Show translation languages selector */
  showTranslationLanguages?: boolean;
  /** Additional class name */
  className?: string;
}

const LanguageSection: React.FC<LanguageSectionProps> = ({
  isSessionActive,
  showTranslationLanguages = true,
  className = ''
}) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();

  // Settings store
  const provider = useProvider();
  const kizunaVolcengineAst2Settings = useKizunaVolcengineAst2Settings();
  const localInferenceSettings = useLocalInferenceSettings();
  const localNativeSettings = useLocalNativeSettings();
  const volcengineAST2Settings = useVolcengineAST2Settings();
  const zoomAISettings = useZoomAISettings();

  const isParticipantChannelInScope = useIsParticipantChannelInScope();
  // Mode scope for the Text Only lock below. `lockedMode ?? mode` — the same
  // "effective mode" every other mode-scoped lock in Settings reads, so an
  // in-session panel describes the session that is running rather than the
  // picker's current position.
  const mode = useMode();
  const lockedMode = useLockedMode();
  const speakerChannelInScopeForUi = speakerChannelInScope(lockedMode ?? mode);
  const modelStatuses = useModelStatuses();
  const modelInitialized = useModelInitialized();
  const navigateToSettings = useNavigateToSettings();
  const uiMode = useUIMode();
  const setEngineSlotTarget = useSetEngineSlotTarget();
  const validateApiKey = useValidateApiKey();

  const textOnly = useTextOnly();
  const setTextOnly = useSetTextOnly();

  const keepReplayAudio = useKeepReplayAudio();
  const setKeepReplayAudio = useSetKeepReplayAudio();

  const updateOpenAISettings = useUpdateOpenAI();
  const updateGeminiSettings = useUpdateGemini();
  const updateOpenAICompatibleSettings = useUpdateOpenAICompatible();
  const updatePalabraAISettings = useUpdatePalabraAI();
  const updateOpenAITranslateSettings = useUpdateOpenAITranslate();
  const updateKizunaOpenaiTranslateSettings = useUpdateKizunaOpenaiTranslate();
  const updateKizunaVolcengineAst2Settings = useUpdateKizunaVolcengineAst2();
  const updateKizunaSonioxSettings = useUpdateKizunaSoniox();
  const updateVolcengineSTSettings = useUpdateVolcengineST();
  const updateVolcengineAST2Settings = useUpdateVolcengineAST2();
  const updateLocalInferenceSettings = useUpdateLocalInference();
  const updateLocalNativeSettings = useUpdateLocalNative();
  const updateZoomAISettings = useUpdateZoomAI();
  const updateSonioxSettings = useUpdateSoniox();

  // Kizuna-managed relay twins reuse their base provider's language controls but
  // read/write the kizuna slices. `effectiveProvider` drives base-keyed logic
  // (e.g. AST2's bidirectional language sync); the active slice/updater pairs
  // resolve to the kizuna slice when managed and the user-managed slice otherwise.
  const effectiveProvider = kizunaBaseProvider(provider) ?? provider;
  const activeVolcengineAST2Settings =
    provider === Provider.KIZUNA_AI_VOLCENGINE_AST2
      ? kizunaVolcengineAst2Settings
      : volcengineAST2Settings;
  const updateActiveVolcengineAST2Settings =
    provider === Provider.KIZUNA_AI_VOLCENGINE_AST2
      ? updateKizunaVolcengineAst2Settings
      : updateVolcengineAST2Settings;

  // Get provider configuration with fallback
  const providerConfig: ProviderConfig = useMemo(() => {
    try {
      return ProviderConfigFactory.getConfig(provider);
    } catch {
      return ProviderConfigFactory.getConfig(Provider.OPENAI);
    }
  }, [provider]);

  // Get current provider settings via the active descriptor's slice key. The
  // selector returns the slice object itself — reference-stable under zustand,
  // so this re-renders only when the slice or the provider changes.
  const currentProviderSettings = useSettingsStore(
    (s) => s[ProviderConfigFactory.getDescriptor(s.provider).settingsSliceKey as keyof SettingsStore]
  ) as Record<string, any>;

  // Update source language
  const updateSourceLanguage = (value: string) => {
    switch (provider) {
      case Provider.OPENAI:
        updateOpenAISettings({ sourceLanguage: value });
        break;
      case Provider.GEMINI:
        updateGeminiSettings({ sourceLanguage: value });
        break;
      case Provider.OPENAI_COMPATIBLE:
        updateOpenAICompatibleSettings({ sourceLanguage: value });
        break;
      case Provider.PALABRA_AI:
        updatePalabraAISettings({ sourceLanguage: value });
        break;
      case Provider.OPENAI_TRANSLATE:
        // Source language is UI-only for translate (auto-detected by API).
        updateOpenAITranslateSettings({ sourceLanguage: value });
        break;
      case Provider.KIZUNA_AI_OPENAI_TRANSLATE:
        // Relay twin of OPENAI_TRANSLATE — writes the kizuna slice.
        updateKizunaOpenaiTranslateSettings({ sourceLanguage: value });
        break;
      case Provider.VOLCENGINE_ST:
        updateVolcengineSTSettings({ sourceLanguage: value });
        break;
      case Provider.VOLCENGINE_AST2:
      case Provider.KIZUNA_AI_VOLCENGINE_AST2: {
        // Both the user-managed AST2 provider and its kizuna twin use the same
        // bidirectional language sync; the active slice/updater resolve which
        // store slice is read/written.
        const prev = activeVolcengineAST2Settings;
        const next = resolveAST2LanguagePair(
          { sourceLanguage: prev.sourceLanguage, targetLanguage: prev.targetLanguage },
          { side: 'source', value },
        );
        updateActiveVolcengineAST2Settings({
          sourceLanguage: next.sourceLanguage,
          targetLanguage: next.targetLanguage,
        });
        // Spec §5: emit source event first (the user-touched side), then a
        // secondary target event when bidirectional sync also changed the
        // other side. Both fire from inside this branch so the ordering is
        // source-then-target — the function returns to skip the trailing
        // emit below this switch.
        trackEvent('language_changed', {
          to_language: next.sourceLanguage,
          language_type: 'source',
        });
        if (next.targetLanguage !== prev.targetLanguage) {
          trackEvent('language_changed', {
            to_language: next.targetLanguage,
            language_type: 'target',
          });
        }
        return;
      }
      case Provider.LOCAL_INFERENCE: {
        const availableTargets = getTranslationTargetLanguages(value);
        const currentTarget = localInferenceSettings.targetLanguage;
        const updates: Record<string, string> = { sourceLanguage: value };
        if (!availableTargets.some(t => t.value === currentTarget)) {
          updates.targetLanguage = availableTargets[0]?.value || 'en';
        }
        updateLocalInferenceSettings(updates);
        break;
      }
      case Provider.LOCAL_NATIVE: {
        const availableTargets = getTranslationTargetLanguages(value);
        const currentTarget = localNativeSettings.targetLanguage;
        const updates: Record<string, string> = { sourceLanguage: value };
        if (!availableTargets.some(t => t.value === currentTarget)) {
          updates.targetLanguage = availableTargets[0]?.value || 'en';
        }
        // Model reconciliation (compatible ASR, directional translation, stale TTS)
        // is handled by NativeModelManagementSection's auto-select effect, which
        // also applies per-direction remembered history — mirroring LOCAL_INFERENCE.
        updateLocalNativeSettings(updates);
        break;
      }
      case Provider.ZOOM_AI: {
        updateZoomAISettings({
          sourceLanguage: value,
          targetLanguage: ProviderConfigFactory.getDescriptor(provider).reconcileTarget(value, zoomAISettings.targetLanguage),
        });
        break;
      }
      case Provider.SONIOX:
        updateSonioxSettings({ sourceLanguage: value });
        break;
      case Provider.KIZUNA_AI_SONIOX:
        // Relay-managed twin of SONIOX — writes the kizuna slice.
        updateKizunaSonioxSettings({ sourceLanguage: value });
        break;
    }
    trackEvent('language_changed', {
      to_language: value,
      language_type: 'source'
    });
  };

  // Update target language
  const updateTargetLanguage = (value: string) => {
    switch (provider) {
      case Provider.OPENAI:
        updateOpenAISettings({ targetLanguage: value });
        break;
      case Provider.GEMINI:
        updateGeminiSettings({ targetLanguage: value });
        break;
      case Provider.OPENAI_COMPATIBLE:
        updateOpenAICompatibleSettings({ targetLanguage: value });
        break;
      case Provider.PALABRA_AI:
        updatePalabraAISettings({ targetLanguage: value });
        break;
      case Provider.OPENAI_TRANSLATE:
        updateOpenAITranslateSettings({ targetLanguage: value as any });
        break;
      case Provider.KIZUNA_AI_OPENAI_TRANSLATE:
        // Relay twin of OPENAI_TRANSLATE — writes the kizuna slice.
        updateKizunaOpenaiTranslateSettings({ targetLanguage: value as any });
        break;
      case Provider.VOLCENGINE_ST:
        updateVolcengineSTSettings({ targetLanguage: value });
        break;
      case Provider.VOLCENGINE_AST2:
      case Provider.KIZUNA_AI_VOLCENGINE_AST2: {
        const prev = activeVolcengineAST2Settings;
        const next = resolveAST2LanguagePair(
          { sourceLanguage: prev.sourceLanguage, targetLanguage: prev.targetLanguage },
          { side: 'target', value },
        );
        updateActiveVolcengineAST2Settings({
          sourceLanguage: next.sourceLanguage,
          targetLanguage: next.targetLanguage,
        });
        // Spec §5: emit secondary source event FIRST when the synced side
        // changed, then the user-touched target event — matches the
        // source-then-target ordering used for the source-side handler. Both
        // fire from inside this branch; return to skip the trailing emit.
        if (next.sourceLanguage !== prev.sourceLanguage) {
          trackEvent('language_changed', {
            to_language: next.sourceLanguage,
            language_type: 'source',
          });
        }
        trackEvent('language_changed', {
          to_language: next.targetLanguage,
          language_type: 'target',
        });
        return;
      }
      case Provider.LOCAL_INFERENCE:
        updateLocalInferenceSettings({ targetLanguage: value });
        break;
      case Provider.LOCAL_NATIVE:
        // Stale-TTS reset + directional translation reconciliation is handled by
        // NativeModelManagementSection's auto-select effect (parity with LOCAL_INFERENCE).
        updateLocalNativeSettings({ targetLanguage: value });
        break;
      case Provider.ZOOM_AI:
        updateZoomAISettings({ targetLanguage: value });
        break;
      case Provider.SONIOX:
        updateSonioxSettings({ targetLanguage: value });
        break;
      case Provider.KIZUNA_AI_SONIOX:
        // Relay-managed twin of SONIOX — writes the kizuna slice.
        updateKizunaSonioxSettings({ targetLanguage: value });
        break;
    }
    trackEvent('language_changed', {
      to_language: value,
      language_type: 'target'
    });
  };

  // Swap source and target languages
  const handleSwapLanguages = useCallback(() => {
    const src = currentProviderSettings?.sourceLanguage;
    const tgt = currentProviderSettings?.targetLanguage;
    if (!src || !tgt || src === 'auto' || src === 'zhen') return;

    if (provider === Provider.LOCAL_INFERENCE) {
      const availableTargets = getTranslationTargetLanguages(tgt);
      const newTarget = availableTargets.some(l => l.value === src) ? src : availableTargets[0]?.value || 'en';
      updateLocalInferenceSettings({ sourceLanguage: tgt, targetLanguage: newTarget });
    } else if (effectiveProvider === Provider.VOLCENGINE_AST2) {
      // AST2's updateSource/Target paths each write BOTH fields through the
      // helper, reading prev from this closure. A two-step swap would invoke
      // the second write with a stale prev — overwriting the first write with
      // the original source value and producing src/src. Apply both new values
      // in one update here instead. src === 'zhen' is already excluded above,
      // so no resolveAST2LanguagePair invocation is needed. The active updater
      // resolves to the kizuna slice for the relay twin.
      updateActiveVolcengineAST2Settings({ sourceLanguage: tgt, targetLanguage: src });
      trackEvent('language_changed', { to_language: tgt, language_type: 'source' });
      trackEvent('language_changed', { to_language: src, language_type: 'target' });
    } else if (provider === Provider.ZOOM_AI) {
      const descriptor = ProviderConfigFactory.getDescriptor(provider);
      const sources = descriptor.resolveSourceLanguages().map(l => l.value);
      if (!sources.includes(tgt)) return; // target isn't a Scribe source; cannot become the new source
      const allowed = descriptor.resolveTargetLanguages(tgt).map(l => l.value);
      const newTarget = allowed.includes(src) ? src : (allowed[0] || 'en-US');
      updateZoomAISettings({ sourceLanguage: tgt, targetLanguage: newTarget });
      trackEvent('language_changed', { to_language: tgt, language_type: 'source' });
      trackEvent('language_changed', { to_language: newTarget, language_type: 'target' });
    } else {
      updateSourceLanguage(tgt);
      // For providers with a restricted target list (currently only OPENAI_TRANSLATE),
      // the swapped source may not be a valid target — fall back to the first valid
      // target so we never produce settings the API will reject. For providers
      // without a restricted list, the source value always exists in `languages`,
      // so the fallback never fires and behavior is preserved.
      const targetList = providerConfig.targetLanguages ?? providerConfig.languages;
      const newTarget = targetList.some(l => l.value === src)
        ? src
        : (targetList[0]?.value ?? src);
      updateTargetLanguage(newTarget);
    }
  }, [provider, effectiveProvider, currentProviderSettings, providerConfig, updateLocalInferenceSettings, updateSourceLanguage, updateTargetLanguage, updateActiveVolcengineAST2Settings, updateZoomAISettings, trackEvent]);

  // Dynamic target languages for LOCAL_INFERENCE; restricted list for providers
  // that explicitly declare `targetLanguages` (e.g. OpenAI Translate has 13);
  // shared `languages` list otherwise.
  const targetLanguages = useMemo(() => {
    if (provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE) {
      return getTranslationTargetLanguages(currentProviderSettings.sourceLanguage || 'ja');
    }
    if (provider === Provider.ZOOM_AI) {
      return ProviderConfigFactory.getDescriptor(provider).resolveTargetLanguages(currentProviderSettings.sourceLanguage || 'ja-JP');
    }
    return providerConfig.targetLanguages ?? providerConfig.languages;
  }, [provider, providerConfig.languages, providerConfig.targetLanguages, currentProviderSettings.sourceLanguage]);

  // Show a warning beneath the source dropdown when OpenAI Translate is
  // selected, participant capture is enabled, and the chosen source language
  // isn't in the 13 supported target languages — because the participant
  // client's translate target = our source language, and an unsupported
  // target would fail the API call. Informational only (no auto-toggle).
  const showTranslateParticipantWarning = useMemo(() => {
    if (effectiveProvider !== Provider.OPENAI_TRANSLATE) return false;
    if (!isParticipantChannelInScope) return false;
    const supportedTargets = ProviderConfigFactory.getDescriptor(Provider.OPENAI_TRANSLATE).resolveTargetLanguages(currentProviderSettings.sourceLanguage);
    return !supportedTargets.some(t => t.value === currentProviderSettings.sourceLanguage);
  }, [effectiveProvider, isParticipantChannelInScope, currentProviderSettings.sourceLanguage]);

  // Soniox carries direction in source/target and reverses them for the
  // participant client (Others / Both-unshared). 'auto' source can't be
  // reversed — it would make the participant's translate target 'auto', which
  // Soniox one_way rejects — so require a concrete source language whenever a
  // participant channel is in scope.
  const showAutoSourceParticipantWarning = useMemo(() => {
    return ProviderConfigFactory.getDescriptor(effectiveProvider).reversesDirectionViaSourceLanguage(currentProviderSettings.model)
      && isParticipantChannelInScope
      && currentProviderSettings.sourceLanguage === 'auto';
  }, [effectiveProvider, isParticipantChannelInScope, currentProviderSettings.sourceLanguage, currentProviderSettings.model]);

  // Simplified interface language list (12 most common languages)

  // The ONE blocking warning (2026-08-23 warning-dedup decision): which
  // mandatory stages have NO candidate at all for the current speaker pair.
  // Reads the resolver - the single source of truth since the selection
  // redesign - instead of a parallel hand-rolled manifest scan, and follows
  // the session gate's own scope: speaker ASR + translation block a session,
  // TTS never does (subtitles/Edge TTS cover it), so TTS is never "missing".
  const resolveWasm = useModelStore.getState().resolve;
  const resolveNative = useNativeModelStore((state) => state.resolve);
  const nativeStatuses = useNativeModelStore((state) => state.statuses);
  const nativeCatalog = useNativeCatalog();
  const missingStages = useMemo(() => {
    if (provider === Provider.LOCAL_INFERENCE) {
      if (!modelInitialized) return [];
    } else if (provider === Provider.LOCAL_NATIVE) {
      // No catalog yet = sidecar not up; EngineSection's gate narrates that
      // state, and "everything is missing" on top of it would be noise.
      if (Object.keys(nativeCatalog).length === 0) return [];
    } else {
      return [];
    }
    const settings = provider === Provider.LOCAL_INFERENCE ? localInferenceSettings : localNativeSettings;
    const resolve = provider === Provider.LOCAL_INFERENCE ? resolveWasm : resolveNative;
    // Mode-scoped legs (2026-08-23): speaker checks the forward leg,
    // participant the reverse, both checks both — the same table the
    // mode-aware session gate implements (ensureSelectionReady), so this
    // warning can never disagree with what Start will do.
    const effectiveMode = lockedMode ?? mode;
    const fwd = { src: settings.sourceLanguage, tgt: settings.targetLanguage };
    const rev = { src: settings.targetLanguage, tgt: settings.sourceLanguage };
    const legs = effectiveMode === 'both' ? [fwd, rev] : effectiveMode === 'participant' ? [rev] : [fwd];
    const missing: { stage: Stage; dir: string; label: string }[] = [];
    for (const leg of legs) {
      const result = resolve(leg.src, leg.tgt, settings.selections);
      const dir = directionKey(leg.src, leg.tgt);
      // Dedupe by stage across legs (both mode): one link per stage, aimed
      // at the FIRST leg missing it.
      if (!result.asr && !missing.some((m) => m.stage === 'asr')) {
        missing.push({ stage: 'asr', dir, label: t('settings.modelTypeAsr', 'ASR') });
      }
      if (!result.translation && !missing.some((m) => m.stage === 'translation')) {
        missing.push({ stage: 'translation', dir, label: t('settings.modelTypeTranslation', 'Translation') });
      }
    }
    return missing;
  }, [
    provider, modelInitialized, resolveWasm, resolveNative, nativeCatalog, t,
    localInferenceSettings, localNativeSettings, lockedMode, mode,
    // resolve() reads candidate pools from its own store; these two make the
    // memo recompute when a download/delete changes what is resolvable.
    modelStatuses, nativeStatuses,
  ]);

  // S0: the language pair narrates as a sentence whose verbs follow the
  // current audio mode — "I speak → they hear" (speaker/both) or "I read ←
  // they speak" (participant). The two selectors underneath never change
  // meaning: first is always my language (sourceLanguage), second is always
  // their language (targetLanguage) — only the verbs naming them do.
  //
  // Provider-wide since 2026-08-24. It first shipped for LOCAL_INFERENCE and
  // LOCAL_NATIVE only, on the premise that other providers' mode semantics
  // differ. They do not: `mode` lives in audioStore and is global, and every
  // descriptor's buildParticipantSessionConfig forces textOnly (a
  // registry-wide invariant pinned by descriptorRegistry.test.ts), so the
  // participant reading holds for every provider.
  //
  // Effective mode — same `lockedMode ?? mode` idiom as speakerChannelInScopeForUi
  // above: in-session, the sentence must describe the mode the session actually
  // locked in, not wherever the (still-interactive but inert) picker sits.
  const sentenceMode = lockedMode ?? mode;
  // Does the forward leg actually SPEAK? That decides "they hear" vs "they
  // read", and the provider's capability decides it — NOT the raw toggle.
  // `textOnly` is one global preference shared across providers, so a user who
  // turned it on under Gemini and switched to Palabra ('never') still gets
  // speech; reading the toggle here would print the opposite of what the
  // session does. Only 'optional' providers honour it, and they do so through
  // the same effectiveTextOnly() the Text Only switch below renders.
  const textOnlyCapability = providerConfig.capabilities.textOnlyCapability;
  const speakerLegTextOnly =
    textOnlyCapability === 'always' ? true
    : textOnlyCapability === 'never' ? false
    : effectiveTextOnly({ speakerLegRuns: speakerChannelInScopeForUi, textOnly });
  const myLanguageLabel = sentenceMode === 'participant'
    ? t('settings.langSentence.iRead', 'I read')
    : t('settings.langSentence.iSpeak', 'I speak');
  const theirLanguageLabel = sentenceMode === 'participant'
    ? t('settings.langSentence.theySpeak', 'they speak')
    : speakerLegTextOnly
      ? t('settings.langSentence.theyRead', 'they read')
      : t('settings.langSentence.theyHear', 'they hear');

  // "Both" mode runs the speaker leg above plus a mirrored participant leg;
  // the mirror line states that second leg as plain text derived from the
  // same two fields — never a third pair of controls.
  const sourceLanguageName = providerConfig.languages.find(l => l.value === currentProviderSettings.sourceLanguage)?.name
    ?? currentProviderSettings.sourceLanguage;
  const targetLanguageName = targetLanguages.find(l => l.value === currentProviderSettings.targetLanguage)?.name
    ?? currentProviderSettings.targetLanguage;
  // ...but only once the source language is pinned. 'auto' is a hand-written
  // extra <option> on the source select, absent from every provider's
  // `languages`, so the lookup above falls through to the raw token — and
  // localizing it would not help, because the mirror's whole job is to name
  // the language I read on the reverse leg and auto-detect names none. For
  // the providers that reverse direction THROUGH sourceLanguage (Soniox,
  // Gemini's translate models) the pair cannot even start — see
  // sessionStartGate's autoSourceParticipantBlocked, whose warning renders
  // just below — so the line would describe a session the app refuses to run.
  // Unreachable before the sentence went provider-wide: the two local
  // providers never offer 'auto'.
  const mirrorLanguagesResolved = currentProviderSettings.sourceLanguage !== 'auto';

  // S0: surface the last resolution notes (auto-substitutions/fallbacks made
  // while picking models for this language pair) right where the pair itself
  // is edited. WASM and native track their own resolvers/catalogs, so both
  // notes and the id→display-name lookup are selected per provider.
  const wasmNotes = useLastResolutionNotes();
  const nativeNotes = useNativeLastResolutionNotes();
  const notes =
    provider === Provider.LOCAL_INFERENCE ? wasmNotes
    : provider === Provider.LOCAL_NATIVE ? nativeNotes
    : [];
  // no-candidate notes are the BLOCKING condition and belong to the
  // missing-models warning below; everything else is an automatic fallback
  // the session survives, summarized in one line (2026-08-23 dedup decision).
  // Scoped to the directions the current mode actually shows on the engine
  // page — a note about a hidden leg would deep-link to a slot that is not
  // rendered, and the leg becomes relevant exactly when the mode does.
  const visibleDirs = (() => {
    const st = provider === Provider.LOCAL_NATIVE ? localNativeSettings : localInferenceSettings;
    const effectiveMode = lockedMode ?? mode;
    const fwdKey = directionKey(st.sourceLanguage, st.targetLanguage);
    const revKey = directionKey(st.targetLanguage, st.sourceLanguage);
    return new Set(effectiveMode === 'both' ? [fwdKey, revKey] : effectiveMode === 'participant' ? [revKey] : [fwdKey]);
  })();
  const fallbackNotes = notes.filter(
    (n: ResolutionNote) => n.reason !== 'no-candidate' && visibleDirs.has(n.direction));

  // Name the picks that failed (deduped: the same deleted model noted in two
  // directions is one name) — a summary that will not say WHICH models it
  // means cannot be acted on.
  const noteName = (id: string): string => {
    if (provider === Provider.LOCAL_NATIVE) {
      return nativeCatalog[id] ? shortenModelName(nativeCatalog[id].name) : id;
    }
    const entry = getManifestEntry(id);
    return entry ? shortenModelName(entry.name, entry.shortName) : id;
  };
  const staleIds: string[] = [];
  for (const n of fallbackNotes) {
    if (n.from && !staleIds.includes(n.from)) staleIds.push(n.from);
  }
  const staleNames = staleIds.map(noteName);

  // "Switch to Auto": accept the current fallbacks by writing an EXPLICIT
  // auto ('') into every noted slot — a user-initiated write, so it does not
  // violate the never-write-back-auto rule; the cost is honest too (the old
  // pick will not return on re-download, which is what this click means).
  // ensureSelectionReady() then re-resolves so the summary clears at once.
  const switchNotesToAuto = async () => {
    const settings = provider === Provider.LOCAL_NATIVE ? localNativeSettings : localInferenceSettings;
    const next: Selections = { ...settings.selections };
    for (const n of fallbackNotes) {
      next[n.direction] = { ...(next[n.direction] ?? emptyDirection()), [n.stage]: { modelId: '' } };
    }
    if (provider === Provider.LOCAL_NATIVE) {
      await updateLocalNativeSettings({ selections: next });
    } else {
      await updateLocalInferenceSettings({ selections: next });
    }
    // Re-runs ensureSelectionReady through the provider's own validation
    // wrapper (native's read-thunk included) so lastResolutionNotes — and
    // with it this summary — refreshes immediately.
    await validateApiKey();
  };

  // Deep-link into the engine surface, same contract as ProviderSection's
  // chips: a FRESH slot object arms the one-shot signal; simple mode's host
  // reacts to the signal itself, advanced mode also switches to the tab.
  const openEngineSlot = (dir: string, stage: Stage) => {
    setEngineSlotTarget({ dir, stage });
    if (uiMode !== 'basic') navigateToSettings('provider');
  };

  return (
    <>
      {/* Interface language now lives in HelpSection, at the weight of a link:
          it is set once and never revisited, and does not affect what can be
          translated. This section is about translation languages only. */}

      {/* Translation Languages Section */}
      {showTranslationLanguages && (
        <div className={`config-section ${className}`} id="languages-section">
          <h3>
            <Languages size={18} />
            <span>{t('simpleConfig.translationLanguages')}</span>
            <Tooltip
              content={t('simpleConfig.translationLanguagesDesc')}
              position="top"
              icon="help"
            />
          </h3>

          <div className="language-pair-row">
            <div className="language-select-group">
              <label>{myLanguageLabel}</label>
              <select
                value={currentProviderSettings.sourceLanguage || 'auto'}
                onChange={(e) => updateSourceLanguage(e.target.value)}
                disabled={isSessionActive}
                className="language-select"
              >
                {provider !== Provider.LOCAL_INFERENCE && provider !== Provider.LOCAL_NATIVE && provider !== Provider.ZOOM_AI && effectiveProvider !== Provider.OPENAI_TRANSLATE && (
                  <option value="auto">{t('common.autoDetect')}</option>
                )}
                {providerConfig.languages.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="language-arrow">
              <button
                className="language-swap-btn"
                onClick={handleSwapLanguages}
                disabled={
                  isSessionActive ||
                  currentProviderSettings.sourceLanguage === 'auto' ||
                  currentProviderSettings.sourceLanguage === 'zhen' ||
                  (provider === Provider.ZOOM_AI &&
                    !ProviderConfigFactory.getDescriptor(provider).resolveSourceLanguages().some(l => l.value === currentProviderSettings.targetLanguage))
                }
                title={t('simpleConfig.swapLanguages', 'Swap languages')}
                type="button"
              >
                <ArrowLeftRight size={18} />
              </button>
            </div>

            <div className="language-select-group">
              <label>{theirLanguageLabel}</label>
              <select
                value={currentProviderSettings.targetLanguage || 'en'}
                onChange={(e) => updateTargetLanguage(e.target.value)}
                disabled={isSessionActive}
                className="language-select"
              >
                {targetLanguages.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {sentenceMode === 'both' && mirrorLanguagesResolved && (
            <div className="language-mirror-line" data-testid="language-mirror-line">
              {t('settings.langSentence.mirror', 'They speak {{their}} → I read {{mine}}', {
                their: targetLanguageName,
                mine: sourceLanguageName,
              })}
            </div>
          )}

          {fallbackNotes.length > 0 && (
            <div className="language-resolution-notes" data-testid="language-resolution-notes">
              <div className="language-warning">
                <AlertTriangle size={12} />
                <span>
                  {staleNames.length === 0
                    ? t('settings.resolutionNotesSummary', '{{count}} of your selected models are unavailable — automatic fallbacks are in use.', { count: fallbackNotes.length })
                    : staleNames.length > 2
                      ? t('settings.resolutionNotesNamedMore', '{{names}} and {{count}} more unavailable — automatic fallbacks are in use.', { names: staleNames.slice(0, 2).join(', '), count: staleNames.length - 2 })
                      : t('settings.resolutionNotesNamed', '{{names}} unavailable — automatic fallbacks are in use.', { names: staleNames.join(', ') })}
                  {' '}
                  <button
                    type="button"
                    className="language-model-warning__link"
                    data-testid="resolution-notes-review"
                    onClick={() => openEngineSlot(fallbackNotes[0].direction, fallbackNotes[0].stage)}
                  >
                    {t('settings.resolutionNotesReview', 'Review')}
                  </button>
                  {' · '}
                  <button
                    type="button"
                    className="language-model-warning__link"
                    data-testid="resolution-notes-use-auto"
                    onClick={switchNotesToAuto}
                  >
                    {t('settings.resolutionNotesUseAuto', 'Switch to Auto')}
                  </button>
                </span>
              </div>
            </div>
          )}

          {showTranslateParticipantWarning && (
            <div className="language-warning">
              <AlertTriangle size={12} />
              <span>{t('settings.translateSourceParticipantWarning')}</span>
            </div>
          )}

          {showAutoSourceParticipantWarning && (
            <div className="language-warning">
              <AlertTriangle size={12} />
              <span>{t('settings.sonioxAutoParticipantWarning')}</span>
            </div>
          )}

          {/* Interactive only while a speaker leg is in scope. A participant-only
              mode is text-only whatever the setting says — the participant channel
              never synthesizes — so the switch shows the truth (on, locked) with a
              tooltip naming the mode, matching the inherently-text-only case below
              and the mode-scoped locks in AdvancedSettings. The persisted setting
              is left alone: it is one global preference, and rewriting it here
              would discard the user's choice for You/Both. */}
          {providerConfig.capabilities.textOnlyCapability === 'optional' && (
            <ToggleSwitch
              checked={effectiveTextOnly({ speakerLegRuns: speakerChannelInScopeForUi, textOnly })}
              onChange={() => setTextOnly(!textOnly)}
              label={t('simpleConfig.textOnly', 'Text Only')}
              disabled={isSessionActive || !speakerChannelInScopeForUi}
              tooltip={
                speakerChannelInScopeForUi
                  ? t('simpleConfig.textOnlyDesc', 'Show translation as text only, without generating an audio response')
                  // Name the mode through modePicker's own key so this reason and
                  // the picker segment cannot drift apart in a locale.
                  : t('simpleConfig.textOnlyForcedByMode', {
                      mode: t('modePicker.modeParticipants', 'Others'),
                      defaultValue: '"{{mode}}" mode turns what participants say into text for you and never generates audio, so Text Only stays on. Switch the translation mode to translate your own voice with speech.',
                    })
              }
            />
          )}

          {/* Inherently text-only providers (e.g. Zoom AI, Volcengine ST) show a
              permanently-on, non-interactive switch so users can see at a glance
              that the provider produces text only and never synthesizes audio. */}
          {providerConfig.capabilities.textOnlyCapability === 'always' && (
            <ToggleSwitch
              checked={true}
              onChange={() => {}}
              label={t('simpleConfig.textOnly', 'Text Only')}
              disabled
              tooltip={t('simpleConfig.textOnlyDesc', 'Show translation as text only, without generating an audio response')}
            />
          )}

          <ToggleSwitch
            checked={keepReplayAudio}
            onChange={() => setKeepReplayAudio(!keepReplayAudio)}
            label={t('simpleConfig.keepReplayAudio', 'Keep audio for replay')}
            disabled={isSessionActive}
            tooltip={t('simpleConfig.keepReplayAudioDesc', 'Store translated audio in memory so you can replay it later from each message. Off by default to reduce memory use during long sessions.')}
          />

          {missingStages.length > 0 && (
            <div className="language-model-warning">
              <AlertTriangle size={14} />
              <span>
                {t('settings.missingModelsWarning', 'Missing {{types}} model(s) for this language pair.', { types: missingStages.map(m => m.label).join(', ') })}
                {' '}
                {missingStages.map((m, i) => (
                  <span key={m.stage}>
                    {i > 0 && ', '}
                    <button
                      type="button"
                      className="language-model-warning__link"
                      onClick={() => openEngineSlot(m.dir, m.stage)}
                    >
                      {t('settings.downloadModelType', 'Download {{type}}', { type: m.label })}
                    </button>
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default LanguageSection;
