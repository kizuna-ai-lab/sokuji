import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIsSessionActive, useLockedMode } from '../../../stores/sessionStore';
import { useMode } from '../../../stores/audioStore';
import {
  useNavigateToSettings,
  useSettingsNavigationTarget,
  useProvider,
  useEngineSlotTarget,
  useSetEngineSlotTarget,
} from '../../../stores/settingsStore';
import { Provider } from '../../../types/Provider';
import {
  ProviderSection,
  LanguageSection,
  AudioDeviceSection,
  SystemAudioSection,
  HelpSection
} from '../sections';
import { ModelManagementSection } from '../sections/ModelManagementSection';
import { NativeModelManagementSection } from '../sections/NativeModelManagementSection';
import { EngineSurface } from '../engine/EngineSurface';
import { useWasmEngineAdapter } from '../engine/useWasmEngineAdapter';
import { useNativeEngineAdapter } from '../engine/useNativeEngineAdapter';
import { StoragePage } from '../engine/StoragePage';
import type { SlotId } from '../engine/EngineTypes';
import './SimpleSettings.scss';

interface SimpleSettingsProps {
  /** Callback to highlight a specific section */
  highlightSection?: string | null;
}

const SimpleSettings: React.FC<SimpleSettingsProps> = ({ highlightSection }) => {
  const { t } = useTranslation();
  const isSessionActive = useIsSessionActive();
  const lockedMode = useLockedMode();
  const mode = useMode();
  const settingsNavigationTarget = useSettingsNavigationTarget();
  const navigateToSettings = useNavigateToSettings();
  const provider = useProvider();
  const isLocalProvider = provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE;

  // One-shot deep-link into the engine surface, fired by an engine chip
  // (Task 10). Consumed on the render where it's seen: a local provider
  // opens that slot, any provider clears the signal so it can't be picked
  // up later by a subsequent switch to a local provider.
  const engineSlotTarget = useEngineSlotTarget();
  const setEngineSlotTarget = useSetEngineSlotTarget();
  const [engineOpen, setEngineOpen] = useState<SlotId | null>(null);
  useEffect(() => {
    if (!engineSlotTarget) return;
    if (isLocalProvider) {
      setEngineOpen(engineSlotTarget);
    }
    setEngineSlotTarget(null);
  }, [engineSlotTarget, isLocalProvider, setEngineSlotTarget]);

  // Both adapters are hoisted unconditionally (hooks rules) even though only
  // one is used below, mirroring ProviderSpecificSettings' wasmAdapter/
  // nativeAdapter split for the same two local providers.
  const wasmAdapter = useWasmEngineAdapter(isSessionActive);
  const nativeAdapter = useNativeEngineAdapter(isSessionActive);

  // Per-channel lock derivation. A section is locked (greyed/disabled) when
  // its channel is out of the mode's scope, so the mode picker is the master
  // control. The monitor <-> participant mutual exclusivity is enforced by
  // mode scope: monitor is in scope ONLY in pure speaker mode, and its
  // playback is mode-gated at session init and on every mode switch (see
  // audioStore setMode / initializeAudioService) — locking the section here
  // keeps the UI from offering a toggle that can't take effect.
  const lockMic = isSessionActive && lockedMode !== 'speaker' && lockedMode !== 'both';
  // Participant toggle is disabled whenever participant is out of the effective
  // mode scope, so the mode picker is the master control. Pre-session this means
  // Speaker mode disables it; in-session the locked mode governs.
  const effectiveMode = lockedMode ?? mode;
  // Monitor is in scope ONLY in pure speaker mode (mutex with participant) —
  // locked in Both/Participant pre- and in-session so it can't be enabled
  // where it would violate the mutex.
  const lockMonitor = effectiveMode !== 'speaker';
  const lockParticipant = effectiveMode !== 'participant' && effectiveMode !== 'both';

  // The monitor lock survives restarts (mode is persisted), so without a stated
  // reason the greyed section reads as broken rather than locked. Name the mode
  // through modePicker's own key so the reason and the picker segment can't
  // drift apart in a locale.
  const monitorLockedReason = t('audioPanel.monitorLockedByMode', { mode: t('modePicker.modeYou') });

  // Handle scrolling and highlighting when highlightSection or
  // settingsNavigationTarget changes. Mirrors Settings.tsx:101-121 (advanced
  // mode's own scroll/highlight effect): keep the outer/inner timer handles
  // and the highlighted element in local variables so cleanup can cancel a
  // pending highlight and strip the ring from whichever element it was
  // applied to. Without this, retargeting within the 3s window (e.g. the
  // tour stepping from the microphone card to the participant card) left the
  // OLD element wearing `.highlight` until its own timer eventually fired —
  // and that stale timer then called navigateToSettings(null) on top of the
  // new target's state.
  useEffect(() => {
    const targetSection = highlightSection || settingsNavigationTarget;
    if (!targetSection) return;
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;
    let highlightedEl: HTMLElement | null = null;
    const scrollTimer = setTimeout(() => {
      const sectionId = `${targetSection}-section`;
      const element = document.getElementById(sectionId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('highlight');
        highlightedEl = element;
        highlightTimer = setTimeout(() => {
          element.classList.remove('highlight');
          highlightedEl = null;
          navigateToSettings(null);
        }, 3000);
      }
    }, 100);
    return () => {
      clearTimeout(scrollTimer);
      if (highlightTimer) clearTimeout(highlightTimer);
      // The DOM persists across panel hides, so a highlight interrupted
      // mid-animation must be removed here, not just its timer.
      highlightedEl?.classList.remove('highlight');
    };
  }, [highlightSection, settingsNavigationTarget, navigateToSettings]);

  // Local provider + an expanded slot: host the engine surface INSTEAD of
  // the section list. The session banner still renders above it (pushed
  // pages inherit it, same as the rest of the panel) followed by a back row
  // that clears `engineOpen` to return to the normal list.
  if (isLocalProvider && engineOpen) {
    const isNative = provider === Provider.LOCAL_NATIVE;
    return (
      <div className="simple-settings">
        <div className="settings-content">
          {isSessionActive && (
            <div className="session-warning">
              <AlertCircle size={16} />
              <span>{t('settings.sessionActiveNotice')}</span>
            </div>
          )}

          <button type="button" className="engine-back-row" onClick={() => setEngineOpen(null)}>
            <ArrowLeft size={14} />
            {t('models.management', 'Models')}
          </button>

          {isNative ? (
            <EngineSurface
              adapter={nativeAdapter}
              effectiveMode={lockedMode ?? mode}
              initialSlot={engineOpen}
              renderLibrary={(slot) => (
                <NativeModelManagementSection isSessionActive={isSessionActive}
                  stageFilter={slot.stage} direction={slot.dir} />
              )}
              renderStorage={() => <StoragePage provider="native" isSessionActive={isSessionActive} />}
            />
          ) : (
            <EngineSurface
              adapter={wasmAdapter}
              effectiveMode={lockedMode ?? mode}
              initialSlot={engineOpen}
              renderLibrary={(slot) => (
                <ModelManagementSection isSessionActive={isSessionActive}
                  stageFilter={slot.stage} direction={slot.dir} />
              )}
              renderStorage={() => <StoragePage provider="wasm" isSessionActive={isSessionActive} />}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="simple-settings">
      <div className="settings-content">
        {isSessionActive && (
          <div className="session-warning">
            <AlertCircle size={16} />
            <span>{t('settings.sessionActiveNotice')}</span>
          </div>
        )}

        {/* Translation Languages */}
        <LanguageSection
          isSessionActive={isSessionActive}
          showTranslationLanguages={true}
        />

        {/* Provider and API Key */}
        <ProviderSection
          isSessionActive={isSessionActive}
        />

        {/* Microphone */}
        <AudioDeviceSection
          isSessionActive={isSessionActive}
          isLocked={lockMic}
          showMicrophone={true}
          showSpeaker={false}
        />

        {/* Speaker monitor */}
        <AudioDeviceSection
          isSessionActive={isSessionActive}
          isLocked={lockMonitor}
          lockedReason={lockMonitor ? monitorLockedReason : undefined}
          showMicrophone={false}
          showSpeaker={true}
        />

        {/* Participant audio (system audio capture) */}
        <SystemAudioSection
          isSessionActive={isSessionActive}
          isLocked={lockParticipant}
        />

        {/* Help & Updates */}
        <HelpSection isSessionActive={isSessionActive} />
      </div>
    </div>
  );
};

export default SimpleSettings;
