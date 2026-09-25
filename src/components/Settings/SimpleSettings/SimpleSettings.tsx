import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSessionLocked } from '../../../app/useRun';
import type { EngineSlot } from '../../../lib/provider/types';
import { getProvider } from '../../../providers/registry';
import { useMode } from '../../../stores/audioStore';
import { useProviderStore } from '../../../stores/providerStore';
import useSettingsStore, {
  useNavigateToSettings,
  useSettingsNavigationTarget,
  useEngineSlotTarget,
  useSetEngineSlotTarget,
} from '../../../stores/settingsStore';
import {
  AudioDeviceSection,
  SystemAudioSection,
  HelpSection
} from '../sections';
import { SessionEnginePage, SessionSettingsGeneral } from '../ProviderArea';
import './SimpleSettings.scss';

interface SimpleSettingsProps {
  /** Callback to highlight a specific section */
  highlightSection?: string | null;
}

const SimpleSettings: React.FC<SimpleSettingsProps> = ({ highlightSection }) => {
  const { t } = useTranslation();
  const locked = useSessionLocked();
  const mode = useMode();
  const settingsNavigationTarget = useSettingsNavigationTarget();
  const navigateToSettings = useNavigateToSettings();
  // Model management is the one provider-specific thing Simple mode shows (spec, D18): a provider with an `Engine`.
  const hasEngine = useProviderStore((s) => !!(s.selected && getProvider(s.selected)?.Engine));

  // One-shot deep-link into the engine page, fired by an engine chip.
  // Consumed on the render where it's seen: a provider with an `Engine` opens
  // that slot, any provider clears the signal so it can't be picked up later
  // by a subsequent switch to a provider with one.
  const engineSlotTarget = useEngineSlotTarget();
  const setEngineSlotTarget = useSetEngineSlotTarget();
  const [engineOpen, setEngineOpen] = useState<EngineSlot | null>(null);
  useEffect(() => {
    if (!engineSlotTarget) return;
    if (hasEngine) setEngineOpen(engineSlotTarget);
    setEngineSlotTarget(null);
  }, [engineSlotTarget, hasEngine, setEngineSlotTarget]);

  // Per-channel lock derivation. A section is locked (greyed/disabled) when
  // its channel is out of the mode's scope, so the mode picker is the master
  // control. The mode picker is locked while a run is not idle, so the audio
  // mode is the run's (spec: "State"). The monitor <-> participant mutual
  // exclusivity is enforced by mode scope: monitor is in scope ONLY in pure
  // speaker mode, so it is locked in Both/Participant, before and during a
  // run, where it would violate the mutex.
  const lockMic = locked && mode === 'participant';
  const lockMonitor = mode !== 'speaker';
  const lockParticipant = mode === 'speaker';

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
      } else if (useSettingsStore.getState().settingsNavigationTarget === targetSection) {
        // Nothing to highlight (e.g. a pushed page's section, never rendered
        // here) — clear anyway, or the same code's next Fix is a no-op: the
        // store value never changes, so nothing reopens Settings (review Minor 2).
        navigateToSettings(null);
      }
    }, 100);
    return () => {
      clearTimeout(scrollTimer);
      if (highlightTimer) clearTimeout(highlightTimer);
      // The DOM persists across panel hides, so a highlight interrupted
      // mid-animation must be removed here, not just its timer. Capture
      // whether THIS effect actually applied a highlight before nulling it
      // out via the optional chain below — the store-clear guard needs it.
      const wasHighlighted = highlightedEl !== null;
      highlightedEl?.classList.remove('highlight');
      // The store has no other writer that clears settingsNavigationTarget:
      // an early exit here (panel hidden via <Activity>, or component
      // unmount) would otherwise leave it still pointing at this section, so
      // the NEXT time settings opens it immediately re-scrolls/re-highlights
      // a step that already finished. Only clear it if it still holds THIS
      // exact target — a cleanup firing because the target already moved on
      // to something newer (the normal retarget path above) must not
      // clobber that newer value. AND only if this effect actually applied
      // the highlight: React StrictMode's dev-only simulated remount runs
      // this cleanup before the 100ms scrollTimer ever fires (highlightedEl
      // still null), and since highlightSection IS settingsNavigationTarget
      // in production (MainLayout.tsx:248 -> Settings.tsx:171), clearing
      // the store here would make the re-created effect's own targetSection
      // read null and bail immediately — silently dropping the highlight in
      // dev. Production is unaffected (no double-invoke there).
      if (wasHighlighted && useSettingsStore.getState().settingsNavigationTarget === targetSection) {
        navigateToSettings(null);
      }
    };
  }, [highlightSection, settingsNavigationTarget, navigateToSettings]);

  const banner = locked && (
    <div className="session-warning">
      <AlertCircle size={16} />
      <span>{t('settings.sessionActiveNotice')}</span>
    </div>
  );

  // A provider with an `Engine` and an opened slot: host its engine page
  // INSTEAD of the section list. The session banner still renders above it
  // (pushed pages inherit it, same as the rest of the panel) followed by a
  // back row that clears `engineOpen` to return to the normal list.
  if (hasEngine && engineOpen) {
    return (
      <div className="simple-settings">
        <div className="settings-content">
          {banner}

          {/* Names the PARENT the click lands on (iOS-style, the same rule as
              EngineSurface's own back chip); the Models title is the surface's. */}
          <button type="button" className="engine-back-row" aria-label={t('engineUi.back', 'Back')} onClick={() => setEngineOpen(null)}>
            <ArrowLeft size={14} />
            {t('settings.title', 'Settings')}
          </button>

          <SessionEnginePage locked={locked} slot={engineOpen} />
        </div>
      </div>
    );
  }

  return (
    <div className="simple-settings">
      <div className="settings-content">
        {banner}

        {/* The pair, the turn mode, the output toggles, segmentation, the provider with its chips */}
        <SessionSettingsGeneral locked={locked} onOpenSlot={setEngineSlotTarget} />

        {/* Microphone */}
        <AudioDeviceSection
          isSessionActive={locked}
          isLocked={lockMic}
          showMicrophone={true}
          showSpeaker={false}
        />

        {/* Speaker monitor */}
        <AudioDeviceSection
          isSessionActive={locked}
          isLocked={lockMonitor}
          lockedReason={lockMonitor ? monitorLockedReason : undefined}
          showMicrophone={false}
          showSpeaker={true}
        />

        {/* Participant audio (system audio capture) */}
        <SystemAudioSection
          isSessionActive={locked}
          isLocked={lockParticipant}
        />

        {/* Help & Updates */}
        <HelpSection isSessionActive={locked} />
      </div>
    </div>
  );
};

export default SimpleSettings;
