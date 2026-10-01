import React, { useMemo, useCallback } from 'react';
import { Languages, ArrowLeftRight, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import ToggleSwitch from '../shared/ToggleSwitch';
import {
  useProvider,
  useLocalNativeSettings,
  useUpdateLocalNative,
  useNavigateToSettings,
  useUIMode,
  useSetEngineSlotTarget,
  useValidateApiKey,
  useTextOnly,
  useSetTextOnly,
  useKeepReplayAudio,
  useSetKeepReplayAudio
} from '../../../stores/settingsStore';
import { Provider } from '../../../types/Provider';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { ProviderConfig } from '../../../services/providers/ProviderConfig';
import { useMode, speakerChannelInScope } from '../../../stores/audioStore';
import { useLockedMode } from '../../../stores/sessionStore';
import { effectiveTextOnly } from '../../../utils/effectiveTextOnly';
import { pairSentence } from '../../SetupWizard/languageSentence';
import { useAnalytics } from '../../../lib/analytics';
import { getTranslationTargetLanguages } from '../../../lib/local-inference/modelManifest';
import { shortenModelName } from '../../../lib/local-inference/modelName';
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
  const localNativeSettings = useLocalNativeSettings();

  // Mode scope for the Text Only lock below. `lockedMode ?? mode` — the same
  // "effective mode" every other mode-scoped lock in Settings reads, so an
  // in-session panel describes the session that is running rather than the
  // picker's current position.
  const mode = useMode();
  const lockedMode = useLockedMode();
  const speakerChannelInScopeForUi = speakerChannelInScope(lockedMode ?? mode);
  const navigateToSettings = useNavigateToSettings();
  const uiMode = useUIMode();
  const setEngineSlotTarget = useSetEngineSlotTarget();
  const validateApiKey = useValidateApiKey();

  const textOnly = useTextOnly();
  const setTextOnly = useSetTextOnly();

  const keepReplayAudio = useKeepReplayAudio();
  const setKeepReplayAudio = useSetKeepReplayAudio();

  const updateLocalNativeSettings = useUpdateLocalNative();

  // The old settings panel's language section, reduced to Local Native: its
  // path is kept whole, working but unreachable, until
  // kizuna-ai-lab/sokuji#578 ports it (Stage 2 deletion, ruling 1). The old
  // registry registers nothing else, so any other stored provider — or Local
  // Native where it is not registered — renders nothing (Stage 2 deletion,
  // choice 4).
  const providerConfig: ProviderConfig | null = useMemo(
    () => (provider === Provider.LOCAL_NATIVE && ProviderConfigFactory.isProviderSupported(provider)
      ? ProviderConfigFactory.getConfig(provider)
      : null),
    [provider],
  );
  const currentProviderSettings = localNativeSettings;

  // Update source language
  const updateSourceLanguage = (value: string) => {
    const availableTargets = getTranslationTargetLanguages(value);
    const currentTarget = localNativeSettings.targetLanguage;
    const updates: Record<string, string> = { sourceLanguage: value };
    if (!availableTargets.some(t => t.value === currentTarget)) {
      updates.targetLanguage = availableTargets[0]?.value || 'en';
    }
    // Model reconciliation (compatible ASR, directional translation, stale TTS)
    // is handled by NativeModelManagementSection's auto-select effect, which
    // also applies per-direction remembered history.
    updateLocalNativeSettings(updates);
    trackEvent('language_changed', {
      to_language: value,
      language_type: 'source'
    });
  };

  // Update target language
  const updateTargetLanguage = (value: string) => {
    // Stale-TTS reset + directional translation reconciliation is handled by
    // NativeModelManagementSection's auto-select effect.
    updateLocalNativeSettings({ targetLanguage: value });
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
    updateSourceLanguage(tgt);
    // Local Native declares no restricted target list, so the swapped source
    // is always a valid target.
    updateTargetLanguage(src);
  }, [currentProviderSettings, updateSourceLanguage, updateTargetLanguage]);

  // The target list follows the source language.
  const targetLanguages = useMemo(
    () => getTranslationTargetLanguages(currentProviderSettings.sourceLanguage || 'ja'),
    [currentProviderSettings.sourceLanguage],
  );

  // The ONE blocking warning (2026-08-23 warning-dedup decision): which
  // mandatory stages have NO candidate at all for the current speaker pair.
  // Reads the resolver - the single source of truth since the selection
  // redesign - instead of a parallel hand-rolled manifest scan, and follows
  // the session gate's own scope: speaker ASR + translation block a session,
  // TTS never does, so TTS is never "missing".
  const resolveNative = useNativeModelStore((state) => state.resolve);
  const nativeStatuses = useNativeModelStore((state) => state.statuses);
  const nativeCatalog = useNativeCatalog();
  const missingStages = useMemo(() => {
    if (provider !== Provider.LOCAL_NATIVE) return [];
    // No catalog yet = sidecar not up; EngineSection's gate narrates that
    // state, and "everything is missing" on top of it would be noise.
    if (Object.keys(nativeCatalog).length === 0) return [];
    const settings = localNativeSettings;
    const resolve = resolveNative;

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
    provider, resolveNative, nativeCatalog, t, localNativeSettings, lockedMode, mode,
    // resolve() reads candidate pools from its own store; this makes the memo
    // recompute when a download/delete changes what is resolvable.
    nativeStatuses,
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
  // Only 'optional' providers honour the global `textOnly` toggle, and they do
  // so through the same effectiveTextOnly() the Text Only switch below
  // renders.
  const textOnlyCapability = providerConfig?.capabilities.textOnlyCapability ?? 'optional';
  // The sentence itself is shared with the setup wizard, which prints it over
  // the same two fields on two of its steps. Only the resolution of `textOnly`
  // differs by surface, so it is resolved here and handed in.
  const sentence = pairSentence({
    mode: sentenceMode,
    textOnly: effectiveTextOnly({ speakerLegRuns: speakerChannelInScopeForUi, textOnly }),
    capability: textOnlyCapability,
    source: currentProviderSettings.sourceLanguage ?? null,
    target: currentProviderSettings.targetLanguage ?? null,
  });
  const myLanguageLabel = t(sentence.my.key, sentence.my.fallback);
  const theirLanguageLabel = t(sentence.their.key, sentence.their.fallback);

  // "Both" mode runs the speaker leg above plus a mirrored participant leg;
  // the mirror line states that second leg as plain text derived from the
  // same two fields — never a third pair of controls.
  const sourceLanguageName = providerConfig?.languages.find(l => l.value === currentProviderSettings.sourceLanguage)?.name
    ?? currentProviderSettings.sourceLanguage;
  const targetLanguageName = targetLanguages.find(l => l.value === currentProviderSettings.targetLanguage)?.name
    ?? currentProviderSettings.targetLanguage;

  // S0: surface the last resolution notes (auto-substitutions/fallbacks made
  // while picking models for this language pair) right where the pair itself
  // is edited.
  const notes = useNativeLastResolutionNotes();
  // no-candidate notes are the BLOCKING condition and belong to the
  // missing-models warning below; everything else is an automatic fallback
  // the session survives, summarized in one line (2026-08-23 dedup decision).
  // Scoped to the directions the current mode actually shows on the engine
  // page — a note about a hidden leg would deep-link to a slot that is not
  // rendered, and the leg becomes relevant exactly when the mode does.
  const visibleDirs = (() => {
    const st = localNativeSettings;
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
  const noteName = (id: string): string =>
    nativeCatalog[id] ? shortenModelName(nativeCatalog[id].name) : id;
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
    const next: Selections = { ...localNativeSettings.selections };
    for (const n of fallbackNotes) {
      next[n.direction] = { ...(next[n.direction] ?? emptyDirection()), [n.stage]: { modelId: '' } };
    }
    await updateLocalNativeSettings({ selections: next });
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

  if (!providerConfig) return null;

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
                  currentProviderSettings.sourceLanguage === 'zhen'
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

          {sentence.showMirror && (
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

          {/* Inherently text-only providers show a permanently-on,
              non-interactive switch so users can see at a glance that the
              provider produces text only and never synthesizes audio. No
              registered provider is currently 'always' — the last two that were
              (Zoom AI, Volcengine ST) were removed on 2026-09-20 — but
              textOnlyCapability is a three-valued descriptor contract, so this
              branch stays as the handling for the value. It is executed by
              LanguageSection.sentence.test.tsx's stubbed-capability case, which
              is the only thing reaching it while no provider declares it. */}
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
