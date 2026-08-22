import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Settings2 } from 'lucide-react';
import type { EngineAdapter, SlotId } from './EngineTypes';
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
}> = ({ adapter, renderLibrary, renderStorage, initialSlot = null }) => {
  const { t } = useTranslation();
  const [expandedSlot, setExpandedSlot] = useState<SlotId | null>(initialSlot);
  const [pushed, setPushed] = useState<Pushed>(null);

  // Respond to a NEW deep-link target, not just the initial mount value — a
  // host that re-fires the same (dir, stage) slot (e.g. the same chip tapped
  // twice) must still re-expand it here, even though the slot STRING is
  // unchanged and a host keying a remount by that string would no-op. Hosts
  // instead hand this prop a freshly-allocated object on every deep-link, so
  // identity (not equality) is the trigger. Also pops any pushed Library/
  // Storage page — a chip tap always lands back on the Engine page.
  useEffect(() => {
    if (initialSlot) {
      setExpandedSlot(initialSlot);
      setPushed(null);
    }
  }, [initialSlot]);

  const toggle = (slot: SlotId) =>
    setExpandedSlot((cur) =>
      cur && cur.dir === slot.dir && cur.stage === slot.stage ? null : slot);

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
        <span>{t('engineUi.titleEngine', 'Translation engine')}</span>
      </h3>
      <EnginePage adapter={adapter} expandedSlot={expandedSlot} onToggleSlot={toggle}
        flashSlot={initialSlot}
        onBrowse={(slot) => setPushed({ page: 'library', slot })}
        onStorage={() => setPushed({ page: 'storage' })} />
    </div>
  );
};
