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
import { NOTES_MODELS } from '../../lib/notes/chat';
import type { HistoryStatus, HistoryUsage } from '../../lib/history/types';
import { useLineUpStore } from '../../stores/lineUpStore';
import useSettingsStore, {
  useLiveNotesExplained, useLiveNotesSetting, useNotesAfterSession, useNotesExplained, useNotesModel, useSetLiveNotes,
  useSetLiveNotesExplained, useSetNotesAfterSession, useSetNotesExplained, useSetNotesModel,
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

/** The value of the list's last entry, for a model name typed by hand. */
const OTHER_MODEL = 'other model';

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
  const liveOn = useLiveNotesSetting();
  const liveExplained = useLiveNotesExplained();
  const setLiveOn = useSetLiveNotes();
  const setLiveExplained = useSetLiveNotesExplained();
  /** Which switch's once-only explanation is shown. */
  const [explaining, setExplaining] = useState<'after' | 'live' | null>(null);
  // The list, or "Other" with the name typed by hand (a stored model not on the list shows there).
  const listed = (m: string) => (NOTES_MODELS as readonly string[]).includes(m);
  const [typing, setTyping] = useState(!listed(model));
  const [modelDraft, setModelDraft] = useState(listed(model) ? '' : model);
  useEffect(() => { if (!listed(model)) { setTyping(true); setModelDraft(model); } }, [model]);
  const notesName = t('history.notesAfterSession', 'Write notes after each session');
  const modelName = t('history.notesModel', 'Notes model');
  const liveName = t('history.liveNotes', 'Live notes during a session');
  const explainTitle = explaining === 'live'
    ? t('history.liveExplainTitle', 'Before live notes are written')
    : t('history.notesExplainTitle', 'Before notes are written');

  // The first time on, the explanation comes first; after that the switch switches.
  const flipNotes = () => {
    if (!notesOn && !explained) { setExplaining('after'); return; }
    void setNotesOn(!notesOn);
  };
  // Live notes take effect at the next session, or stop the running one's at once when turned off.
  const flipLive = () => {
    if (!liveOn && !liveExplained) { setExplaining('live'); return; }
    void setLiveOn(!liveOn);
  };
  const turnOn = async () => {
    const which = explaining;
    setExplaining(null);
    if (which === 'live') {
      await setLiveExplained(true);
      await setLiveOn(true);
    } else {
      await setExplained(true);
      await setNotesOn(true);
    }
  };
  const chooseModel = (value: string) => {
    if (value === OTHER_MODEL) { setTyping(true); setModelDraft(listed(model) ? '' : model); return; }
    setTyping(false);
    void setModel(value);
  };
  const saveModel = async () => {
    await setModel(modelDraft);
    // An emptied field goes back to the default, which is on the list.
    if (listed(useSettingsStore.getState().notesModel)) { setTyping(false); setModelDraft(''); return; }
    // A typed name shows as it was stored (trimmed).
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
        <p className="history-category__hint">
          {t('history.keptHere', 'History keeps each session’s transcript and recording on this computer only. During a session, your speech still goes to the services in your line-up.')}
          {notesOn && serviceName && <> {t('history.keptHereNotes', 'While notes are on, each session’s transcript text is also sent to {{service}} to write them.', { service: serviceName })}</>}
        </p>
        <Row name={notesName} line={serviceName
          ? t('history.notesLine', 'When a session ends, {{service}} writes its notes from the transcript.', { service: serviceName })
          : t('history.notesNoService', 'Choose a notes service in Languages and line-up first.')}>
          <ToggleSwitch checked={notesOn && Boolean(service)} onChange={flipNotes} disabled={!service} label="" ariaLabel={notesName} />
        </Row>
        <Row name={liveName} line={serviceName
          ? t('history.liveLine', 'During a session, {{service}} keeps short notes every 20 seconds beside the conversation. They are not kept.', { service: serviceName })
          : t('history.notesNoService', 'Choose a notes service in Languages and line-up first.')}>
          <ToggleSwitch checked={liveOn && Boolean(service)} onChange={flipLive} disabled={!service} label="" ariaLabel={liveName} />
        </Row>
        {explaining && serviceName && (
          <div className="history-category__explain" role="group" aria-label={explainTitle}>
            <strong>{explainTitle}</strong>
            <p>{explaining === 'live'
              ? t('history.liveExplain', 'During a session, every 20 seconds the new sentences (their text, numbers, and which side and speaker said them) and the notes so far are sent to {{service}} with your own key. Never the audio, the translation or your account.', { service: serviceName })
              : t('history.notesExplain', 'For each session, the text of its sentences, their numbers, and which side and speaker said them are sent to {{service}} with your own key. Never the audio, the translation or your account.', { service: serviceName })}</p>
            <div className="history-category__explain-actions">
              <button type="button" className="model-row__btn" onClick={() => setExplaining(null)}>{t('history.cancel', 'Cancel')}</button>
              <button type="button" className="model-row__btn model-row__btn--primary" onClick={() => void turnOn()}>{t('history.notesTurnOn', 'Turn on')}</button>
            </div>
          </div>
        )}
        <Row name={modelName} line={t('history.notesModelLine', 'The text model that writes the notes, by its name at the service.')}>
          <span className="history-category__model-pick">
            <select className="select-dropdown general-row__select" aria-label={modelName} value={typing ? OTHER_MODEL : model}
              onChange={(e) => chooseModel(e.target.value)}>
              {NOTES_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              <option value={OTHER_MODEL}>{t('history.notesModelOther', 'Other')}</option>
            </select>
            {typing && (
              <FormInput className="history-category__model" aria-label={t('history.notesModelName', 'Model name')} value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)} onBlur={() => void saveModel()} spellCheck={false} />
            )}
          </span>
        </Row>
      </div>
    </div>
  );
}

export default HistoryCategory;
