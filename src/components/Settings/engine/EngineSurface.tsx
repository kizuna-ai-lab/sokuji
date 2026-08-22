import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Settings2 } from 'lucide-react';
import type { EngineAdapter, SlotId } from './EngineTypes';
import type { AudioMode } from '../../../stores/audioStore';
import { EnginePage, STAGE_LABEL_KEY } from './EnginePage';
import './Engine.scss';

type Pushed = null | { page: 'library'; slot: SlotId } | { page: 'storage' };

/**
 * Push host for the engine family. Back lives HERE, in the content area —
 * PanelBar already carries three tabs + the mode toggle + close in ~360px and
 * has no room for a fourth cluster (spec Part 4).
 */
export const EngineSurface: React.FC<{
  adapter: EngineAdapter;
  renderLibrary: (slot: SlotId) => React.ReactNode;
  renderStorage: () => React.ReactNode;
  initialSlot?: SlotId | null;
  /** Effective audio mode, handed through to EnginePage (see its doc). */
  effectiveMode: AudioMode;
}> = ({ adapter, renderLibrary, renderStorage, initialSlot = null, effectiveMode }) => {
  const { t } = useTranslation();
  const [pushed, setPushed] = useState<Pushed>(null);
  // The flash signal is a CONSUMED copy of initialSlot, not the prop itself:
  // pushing Library/Storage unmounts the slot rows, so a still-truthy prop
  // handed straight down would re-run SlotRow's flash effect on every pop —
  // the "coming back from the Library flashes the slot again" bug. Pushing a
  // page clears this copy; only a fresh deep-link object re-arms it.
  const [flashSlot, setFlashSlot] = useState<SlotId | null>(initialSlot);

  // Respond to a NEW deep-link target, not just the initial mount value — a
  // host that re-fires the same (dir, stage) slot (e.g. the same chip tapped
  // twice) must still re-expand it here, even though the slot STRING is
  // unchanged and a host keying a remount by that string would no-op. Hosts
  // instead hand this prop a freshly-allocated object on every deep-link, so
  // identity (not equality) is the trigger. Also pops any pushed Library/
  // Storage page — a chip tap always lands back on the Engine page.
  useEffect(() => {
    if (initialSlot) {
      setFlashSlot(initialSlot);
      setPushed(null);
    }
  }, [initialSlot]);

  const push = (page: Pushed) => {
    setFlashSlot(null);
    setPushed(page);
  };

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


  // Finding 2/3: EngineSurface is a section like any sibling — one
  // `.config-section` shell, one h3-height header row, for BOTH states. Not
  // pushed: the header is the surface's own title. Pushed: the back row
  // TAKES the h3 position (arrow + title) instead of sitting above a second,
  // separate frame — so browsing the Library/Storage feels like one page
  // swapping its content, not a nested mini-page.
  if (pushed) {
    const title = pushed.page === 'library'
      ? t('engineUi.titleLibrary', 'Library · {{stage}}', {
          stage: t(STAGE_LABEL_KEY[pushed.slot.stage][0], STAGE_LABEL_KEY[pushed.slot.stage][1]),
        })
      : t('engineUi.titleStorage', 'Storage');
    return (
      <div className="config-section engine-surface">
        <h3 className="engine-surface__heading">
          <button type="button" className="engine-back-row" aria-label={t('engineUi.back', 'Back')} onClick={() => setPushed(null)}>
            <ArrowLeft size={14} />
            {title}
          </button>
        </h3>
        {pushed.page === 'library' ? renderLibrary(pushed.slot) : renderStorage()}
      </div>
    );
  }
  return (
    <div className="config-section engine-surface">
      <h3>
        <Settings2 size={18} />
        <span>{t('models.management', 'Models')}</span>
      </h3>
      <EnginePage adapter={adapter}
        flashSlot={flashSlot} effectiveMode={effectiveMode}
        onBrowse={(slot) => push({ page: 'library', slot })}
        onStorage={() => push({ page: 'storage' })} />
    </div>
  );
};
