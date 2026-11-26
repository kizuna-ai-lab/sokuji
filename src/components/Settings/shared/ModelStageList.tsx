// src/components/Settings/shared/ModelStageList.tsx
//
// One stage's list of model cards on Local models and storage, the same for both engines (the WASM/WebGPU list and the
// native one): the stage's title, what is on disk and what is recommended shown, the rest folded under "N more", and
// the models of other languages last under their caption. Each card sits in a `.models-card`, with its own Delete
// confirmation right under it. The cards themselves stay the engine's: they arrive as nodes.
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function ModelStageList({ title, id, header, shown, rest, others }: {
  title: string;
  /** The element id, where an engine slot's "Browse library…" lands (`<anchor>-section`). */
  id: string;
  /** Above the cards, inside the stage: the native engine's device control. */
  header?: ReactNode;
  shown: ReactNode[];
  rest: ReactNode[];
  others: ReactNode[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const hidden = rest.length + others.length;
  return (
    <div className="models-stage" role="group" aria-label={title} id={id}>
      <h4 className="models-stage__title">{title}</h4>
      {header}
      <div className="models-stage__shown">{shown}</div>
      {hidden > 0 && (
        <div className="models-group__fold">
          <button type="button" className="models-group__fold-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {t('models.page.more', '{{count}} more', { count: hidden })}
          </button>
          {open && (
            <>
              {rest}
              {others.length > 0 && (
                <p className="models-stage__caption">{t('models.page.otherLanguages', 'Models for other languages ({{count}})', { count: others.length })}</p>
              )}
              {others}
            </>
          )}
        </div>
      )}
    </div>
  );
}
