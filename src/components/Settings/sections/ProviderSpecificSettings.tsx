import React, { useEffect, useMemo, useState } from 'react';
import {
  useProvider,
  useLocalNativeSettings,
  useUpdateLocalNative,
  useEngineSlotTarget,
  useSetEngineSlotTarget,
  useGetProcessedLocalPrompt,
} from '../../../stores/settingsStore';
import { Provider } from '../../../types/Provider';
import { useMode } from '../../../stores/audioStore';
import { NativeModelManagementSection } from './NativeModelManagementSection';
import { EngineSurface } from '../engine/EngineSurface';
import { useNativeEngineAdapter } from '../engine/useNativeEngineAdapter';
import { StoragePage } from '../engine/StoragePage';
import type { SlotId } from '../engine/EngineTypes';
import { useLockedMode } from '../../../stores/sessionStore';
import { TtsSpeedControl, SpeechModeControl, VadControl, TranslationPromptControl, type SpeechMode } from './LocalSettingsControls';
import { hasNativeTts, supportsCustomPrompt } from '../../../lib/local-inference/native/nativeCatalog';
import { useNativeCatalog, useNativeModelStore } from '../../../stores/nativeModelStore';
import { useAnalytics } from '../../../lib/analytics';

/**
 * The old settings panel's provider-specific part, reduced to Local Native:
 * its path is kept whole, working but unreachable, until kizuna-ai-lab/sokuji#578
 * ports it (Stage 2 deletion, ruling 1). Every other provider's settings are
 * its own view in `src/providers/<id>/`.
 */
interface ProviderSpecificSettingsProps {
  isSessionActive: boolean;
}

const ProviderSpecificSettings: React.FC<ProviderSpecificSettingsProps> = ({
  isSessionActive,
}) => {
  const provider = useProvider();
  const mode = useMode();
  const lockedMode = useLockedMode();
  const localNativeSettings = useLocalNativeSettings();
  const updateLocalNativeSettings = useUpdateLocalNative();
  const nativeCatalog = useNativeCatalog();
  const getProcessedLocalPrompt = useGetProcessedLocalPrompt();
  const { trackEvent } = useAnalytics();

  // LOCAL_NATIVE's resolved direction. The custom-prompt control needs to know
  // which translation model would actually run, because not all of them accept
  // one (#526).
  const nativeResolved = useMemo(() => useNativeModelStore.getState().resolve(
    localNativeSettings.sourceLanguage,
    localNativeSettings.targetLanguage,
    localNativeSettings.selections,
  ), [
    localNativeSettings.sourceLanguage,
    localNativeSettings.targetLanguage,
    localNativeSettings.selections,
    nativeCatalog,
  ]);

  // The old slice, handed to the native model UI as its host's settings,
  // writer and pair (#578).
  const nativePair = useMemo(
    () => ({ source: localNativeSettings.sourceLanguage, target: localNativeSettings.targetLanguage }),
    [localNativeSettings.sourceLanguage, localNativeSettings.targetLanguage],
  );
  const nativeOverride = useMemo(
    () => ({ settings: localNativeSettings, update: updateLocalNativeSettings, pair: nativePair }),
    [localNativeSettings, updateLocalNativeSettings, nativePair],
  );

  // LOCAL_NATIVE's EngineAdapter — hoisted above the return (hooks must run
  // unconditionally) even though it's only rendered in the branch below.
  const nativeAdapter = useNativeEngineAdapter(isSessionActive, nativeOverride);

  // One-shot deep-link into the engine surface, fired by an engine chip.
  // Consumed on the render where it's seen: Local Native opens that slot, and
  // the signal is cleared immediately so it can't be picked up again by a
  // later switch to it — mirrors SimpleSettings' consumption of the same
  // signal.
  const engineSlotTarget = useEngineSlotTarget();
  const setEngineSlotTarget = useSetEngineSlotTarget();
  const [engineInitialSlot, setEngineInitialSlot] = useState<SlotId | null>(null);
  useEffect(() => {
    if (!engineSlotTarget) return;
    if (provider === Provider.LOCAL_NATIVE) {
      setEngineInitialSlot(engineSlotTarget);
    }
    setEngineSlotTarget(null);
  }, [engineSlotTarget, provider, setEngineSlotTarget]);

  if (provider !== Provider.LOCAL_NATIVE) {
    return null;
  }
  // The speed slider is meaningful only when the target language has a native
  // voice (text-only is the common textOnly toggle, not a per-stage Off option).
  const ttsActive = hasNativeTts(localNativeSettings.targetLanguage, nativeCatalog);
  // Not every native translation model accepts a custom prompt: TranslateGemma's
  // own chat template assembles the whole instruction and refuses a system role,
  // so the sidecar discards one. Offering the box and dropping what the user
  // types is worse than not offering it (#526).
  const promptSupported = supportsCustomPrompt(nativeResolved.translation?.modelId ?? '');

  return (
    <>
      {/* EngineSurface renders the sidecar-bundle gate (spec S10) at the top of
          its Engine page via the adapter's `gate` — no standalone <EngineSection/>
          here, or it would render twice. */}
      <EngineSurface
        adapter={nativeAdapter}
        effectiveMode={lockedMode ?? mode}
        initialSlot={engineInitialSlot}
        onInitialSlotConsumed={() => setEngineInitialSlot(null)}
        renderLibrary={(slot) => (
          <NativeModelManagementSection isSessionActive={isSessionActive}
            stageFilter={slot.stage} direction={slot.dir}
            settings={localNativeSettings} update={updateLocalNativeSettings} pair={nativePair} />
        )}
        renderStorage={() => <StoragePage provider="native" isSessionActive={isSessionActive}
          settings={localNativeSettings} pair={nativePair} />}
      />

      {ttsActive && (
        <TtsSpeedControl
          value={localNativeSettings.ttsSpeed}
          onChange={(ttsSpeed) => updateLocalNativeSettings({ ttsSpeed })}
          disabled={isSessionActive}
        />
      )}

      <SpeechModeControl
        value={localNativeSettings.turnDetectionMode}
        onChange={(turnDetectionMode: SpeechMode) => {
          const fromMode = localNativeSettings.turnDetectionMode;
          trackEvent('speech_mode_changed', { provider, from_mode: fromMode, to_mode: turnDetectionMode });
          updateLocalNativeSettings({ turnDetectionMode });
        }}
        disabled={isSessionActive}
      />

      <TranslationPromptControl
        useTemplateMode={localNativeSettings.useTemplateMode}
        systemPrompt={localNativeSettings.systemPrompt}
        /* no participantSystemPrompt: native has no participant audio path */
        preview={getProcessedLocalPrompt(false)}
        supported={promptSupported}
        disabled={isSessionActive}
        previewId="local-native-prompt-preview-content"
        onChange={(patch) => updateLocalNativeSettings(patch)}
      />

      {localNativeSettings.turnDetectionMode === 'Auto' && (
        <VadControl
          values={{
            vadThreshold: localNativeSettings.vadThreshold,
            vadMinSilenceDuration: localNativeSettings.vadMinSilenceDuration,
            vadMinSpeechDuration: localNativeSettings.vadMinSpeechDuration,
          }}
          onChange={(patch) => updateLocalNativeSettings(patch)}
          disabled={isSessionActive}
        />
      )}
    </>
  );
};

export default ProviderSpecificSettings;
