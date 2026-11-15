// src/components/SettingsPage/HistoryCategory.tsx
//
// "History and notes" (desktop only), as the settings mock draws it: the History folder with the space it takes and
// a button that opens it, a line saying records stay on this computer, and the switch that exports the conversation as
// a text file when a session ends (today's auto-save, renamed so it is not taken for History itself; it left the export
// menu when export moved into History).
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';
import { historyPort } from '../../lib/history/port';
import type { HistoryStatus, HistoryUsage } from '../../lib/history/types';
import { useAutoSaveOnStop, useSetAutoSaveOnStop } from '../../stores/settingsStore';
import { isElectron } from '../../utils/environment';
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

// The category changes nothing a running session uses: the switch is read when a session ends, so it stays usable.
export function HistoryCategory(_props: CategoryBodyProps) {
  const { t } = useTranslation();
  const autoSave = useAutoSaveOnStop();
  const setAutoSave = useSetAutoSaveOnStop();
  const [status, setStatus] = useState<HistoryStatus | null>(null);
  const [usage, setUsage] = useState<HistoryUsage | null>(null);
  const autoSaveName = t('mainPanel.export.autoSave.label', 'Export TXT when a session ends');

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
        <p className="history-category__hint">{t('history.keptHere', 'Each session’s transcript is kept on this computer. Nothing is uploaded.')}</p>
        <Row name={autoSaveName} line={t('history.autoExportLine', 'Saves an extra .txt copy of the whole conversation to your Downloads folder. History keeps the record on this computer either way.')}>
          <ToggleSwitch checked={autoSave} onChange={() => void setAutoSave(!autoSave)} label="" ariaLabel={autoSaveName} />
        </Row>
      </div>
    </div>
  );
}

export default HistoryCategory;
