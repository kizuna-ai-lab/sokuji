import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import type { EngineAdapter, SlotId } from './EngineTypes';
import { EnginePage } from './EnginePage';

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

  const toggle = (slot: SlotId) =>
    setExpandedSlot((cur) =>
      cur && cur.dir === slot.dir && cur.stage === slot.stage ? null : slot);

  if (pushed) {
    return (
      <div className="engine-surface">
        <button type="button" className="engine-back-row" onClick={() => setPushed(null)}>
          <ArrowLeft size={14} />
          {t('engineUi.back', 'Back')} {pushed.page === 'library'
            ? t('engineUi.titleLibrary', 'Library · {{stage}}', { stage: pushed.slot.stage })
            : t('engineUi.titleStorage', 'Storage')}
        </button>
        {pushed.page === 'library' ? renderLibrary(pushed.slot) : renderStorage()}
      </div>
    );
  }
  return (
    <div className="engine-surface">
      <EnginePage adapter={adapter} expandedSlot={expandedSlot} onToggleSlot={toggle}
        onBrowse={(slot) => setPushed({ page: 'library', slot })}
        onStorage={() => setPushed({ page: 'storage' })} />
    </div>
  );
};
