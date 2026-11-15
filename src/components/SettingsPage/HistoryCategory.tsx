// src/components/SettingsPage/HistoryCategory.tsx
//
// "History and notes" (desktop only), as the settings mock draws it: the History folder with the space it takes and
// a button that opens it, and a line saying records stay on this computer. The desktop has no session-end auto-save:
// History keeps every session (owner 2026-11-16). Then the notes after the session: the switch, which needs a notes
// service chosen in the line-up and explains once, the first time, what is sent where (ruling 37), and the model.
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';
import { historyPort } from '../../lib/history/port';
import type { HistoryStatus, HistoryUsage } from '../../lib/history/types';
import { useLineUpStore } from '../../stores/lineUpStore';
import useSettingsStore, {
  useNotesAfterSession, useNotesExplained, useNotesModel, useSetNotesAfterSession, useSetNotesExplained, useSetNotesModel,
} from '../../stores/settingsStore';
import { isElectron } from '../../utils/environment';
import FormInput from '../Settings/shared/FormInput';
import ToggleSwitch from '../Settings/shared/ToggleSwitch';
import { formatBytes } from '../History/format';
import type { CategoryBodyProps } from './SettingsPage';

function Row({ name, line, children }: { name: string; line?: ReactNode; children: ReactNode }) {
  return (
    <div className="general-row">
      <div className="general-row__text">
        <span className="general-row__name">{name}</span>
        {line && <small className="general-row__line">{line}</small>}
      </div>
      <div className="general-row__control">{children}</div>
    </div>
  );
}

/** The notes services the line-up offers, by name. */
export const NOTES_SERVICE_NAMES: Readonly<Record<string, string>> = { openai: 'OpenAI' };

// The category changes nothing a running session uses, so it stays usable during one.
export function HistoryCategory(_props: CategoryBodyProps) {
  const { t } = useTranslation();
  const service = useLineUpStore((s) => s.lineUp?.summarisation ?? null);
  const serviceName = service ? NOTES_SERVICE_NAMES[service] ?? service : null;
  const notesOn = useNotesAfterSession();
  const explained = useNotesExplained();
  const model = useNotesModel();
  const setNotesOn = useSetNotesAfterSession();
  const setExplained = useSetNotesExplained();
  const setModel = useSetNotesModel();
  const [explaining, setExplaining] = useState(false);
  const [modelDraft, setModelDraft] = useState(model);
  useEffect(() => { setModelDraft(model); }, [model]);
  const notesName = t('history.notesAfterSession', 'Write notes after each session');
  const modelName = t('history.notesModel', 'Notes model');
  const explainTitle = t('history.notesExplainTitle', 'Before notes are written');

  // The first time on, the explanation comes first; after that the switch switches.
  const flipNotes = () => {
    if (!notesOn && !explained) { setExplaining(true); return; }
    void setNotesOn(!notesOn);
  };
  const turnOn = async () => {
    setExplaining(false);
    await setExplained(true);
    await setNotesOn(true);
  };
  const saveModel = async () => {
    await setModel(modelDraft);
    // An emptied field shows the default the store put back.
    setModelDraft(useSettingsStore.getState().notesModel);
  };
  const [status, setStatus] = useState<HistoryStatus | null>(null);
  const [usage, setUsage] = useState<HistoryUsage | null>(null);

  useEffect(() => {
    let live = true;
    const port = historyPort();
    void (async () => {
      try {
        const s = await port.status();
        if (!live) return;
        setStatus(s);
        if (s.available) {
          const u = await port.usage();
          if (live) setUsage(u);
        }
      } catch {
        if (live) setStatus({ available: false, reason: 'error', dir: '' });
      }
    })();
    return () => { live = false; };
  }, []);

  const openFolder = () => { if (status?.dir && isElectron()) void window.electron.invoke('open-directory', status.dir); };

  let folderLine: ReactNode = null;
  if (status && !status.available) {
    folderLine = status.reason === 'newer'
      ? t('history.unavailableNewer', 'This History was written by a newer version of Sokuji. Update Sokuji to open it.')
      : t('history.unavailable', 'History could not be opened.');
  } else if (status) {
    folderLine = (
      <>
        {usage && <span>{t('history.space', '{{size}} in {{count}} records', { size: formatBytes(usage.dbBytes + usage.audioBytes), count: usage.records })}</span>}
        {usage && ' · '}
        <span className="history-category__dir">{status.dir}</span>
      </>
    );
  }

  return (
    <div className="general-category history-category">
      <div className="general-list">
        <Row name={t('history.folder', 'History folder')} line={folderLine}>
          <button type="button" className="model-row__btn" disabled={!status?.available} onClick={openFolder}>
            <FolderOpen size={14} />
            {t('history.openFolder', 'Open folder')}
          </button>
        </Row>
        <p className="history-category__hint">{t('history.keptHere', 'History keeps each session’s transcript and recording on this computer only. During a session, your speech still goes to the services in your line-up.')}</p>
        <Row name={notesName} line={serviceName
          ? t('history.notesLine', 'When a session ends, {{service}} writes its notes from the transcript.', { service: serviceName })
          : t('history.notesNoService', 'Choose a notes service in Languages and line-up first.')}>
          <ToggleSwitch checked={notesOn && Boolean(service)} onChange={flipNotes} disabled={!service} label="" ariaLabel={notesName} />
        </Row>
        {explaining && serviceName && (
          <div className="history-category__explain" role="group" aria-label={explainTitle}>
            <strong>{explainTitle}</strong>
            <p>{t('history.notesExplain', 'For each session, the text of its sentences, their numbers, and which side and speaker said them are sent to {{service}} with your own key. Never the audio, the translation or your account.', { service: serviceName })}</p>
            <div className="history-category__explain-actions">
              <button type="button" className="model-row__btn" onClick={() => setExplaining(false)}>{t('history.cancel', 'Cancel')}</button>
              <button type="button" className="model-row__btn model-row__btn--primary" onClick={() => void turnOn()}>{t('history.notesTurnOn', 'Turn on')}</button>
            </div>
          </div>
        )}
        <Row name={modelName} line={t('history.notesModelLine', 'The text model that writes the notes, by its name at the service.')}>
          <FormInput className="history-category__model" aria-label={modelName} value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)} onBlur={() => void saveModel()} spellCheck={false} />
        </Row>
      </div>
    </div>
  );
}

export default HistoryCategory;
