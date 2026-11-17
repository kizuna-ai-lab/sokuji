import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings2 } from 'lucide-react';
import type { EngineAdapter, SlotId } from './EngineTypes';
import type { AudioMode } from '../../../stores/audioStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { EnginePage } from './EnginePage';
import './Engine.scss';

/**
 * Where a slot's "Browse library…" goes (B-20; the owner, 2026-11-17): its stage's models in Models and storage,
 * which are the model library now — no library page inside the engine any more.
 */
export const LIBRARY_TARGET: Readonly<Record<SlotId['stage'], string>> = {
  asr: 'models-asr', translation: 'models-translation', tts: 'models-tts',
};

/** The engine's page: its slots, a deep-linked one flashed. */
export const EngineSurface: React.FC<{
  adapter: EngineAdapter;
  initialSlot?: SlotId | null;
  /** Called once per consumed initialSlot, so the HOST can drop its stored
   *  copy — a stale prop would re-arm the flash on a later remount
   *  (switching between the two local providers remounts this surface). */
  onInitialSlotConsumed?: () => void;
  /** Effective audio mode, handed through to EnginePage (see its doc). */
  effectiveMode: AudioMode;
}> = ({ adapter, initialSlot = null, onInitialSlotConsumed, effectiveMode }) => {
  const { t } = useTranslation();
  // The flash signal is a CONSUMED copy of initialSlot, not the prop itself: only a fresh deep-link object re-arms it.
  const [flashSlot, setFlashSlot] = useState<SlotId | null>(initialSlot);

  // Respond to a NEW deep-link target, not just the initial mount value — a
  // host that re-fires the same (dir, stage) slot (e.g. the same chip tapped
  // twice) must still flash it again, even though the slot STRING is
  // unchanged. Hosts hand this prop a freshly-allocated object on every
  // deep-link, so identity (not equality) is the trigger.
  useEffect(() => {
    if (initialSlot) {
      setFlashSlot(initialSlot);
      onInitialSlotConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSlot]);

  // A pending flash dies with the mode that armed it (guarded by a ref so
  // the mount run doesn't kill a legitimate initial deep-link): direction
  // rows MOUNT when the mode reveals them, and a stale signal would flash a
  // row the user never deep-linked in this mode — switching speaker →
  // participant/both flashed the participant ASR slot armed long ago. The
  // signal also simply expires just after the flash animation window, so no
  // later remount can ever replay it.
  const prevMode = useRef(effectiveMode);
  useEffect(() => {
    if (prevMode.current !== effectiveMode) {
      prevMode.current = effectiveMode;
      setFlashSlot(null);
    }
  }, [effectiveMode]);
  useEffect(() => {
    if (!flashSlot) return;
    const timer = setTimeout(() => setFlashSlot(null), 3500);
    return () => clearTimeout(timer);
  }, [flashSlot]);

  return (
    // The tour's models step points here: the engine's slots, the way into each model.
    <div className="config-section engine-surface" data-tour="engine-chips">
      <div className="engine-surface__page">
        <h3>
          <Settings2 size={18} />
          <span>{t('models.management', 'Models')}</span>
        </h3>
        <EnginePage adapter={adapter}
          flashSlot={flashSlot} effectiveMode={effectiveMode}
          onBrowse={(slot) => useSettingsStore.getState().navigateToSettings(LIBRARY_TARGET[slot.stage])} />
      </div>
    </div>
  );
};
