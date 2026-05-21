import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Plus, Upload } from 'lucide-react';
import { getManifestEntry } from '../../../lib/local-inference/modelManifest';
import { isElectron } from '../../../utils/environment';
import './VoiceLibrarySection.scss';

interface SupertonicVoice {
  sid: number;
  name: string;
  source: 'preset' | 'imported';
  gender?: 'M' | 'F';
}

interface VoiceLibrarySectionProps {
  /** All voices currently reported by the engine (presets + imported). */
  voices: SupertonicVoice[];
  /** Currently selected sid (from settings store). */
  selectedSid: number;
  /** Callback when the user picks a different voice. */
  onSelect: (sid: number) => void;
  /** Called after a valid voice file has been picked. Implementation
   *  in the parent: calls `voiceStorage.addVoice` and `engine.reloadVoices`.
   *  Should throw on validation errors so the UI can surface them via toast. */
  onImport: (file: File) => Promise<void>;
  /** True while a worker reload is in flight (disables interaction). */
  isReloading: boolean;
  /** Called when the user renames an imported voice. */
  onRename: (sid: number, newName: string) => Promise<void>;
  /** Called when the user confirms deletion of an imported voice. */
  onDelete: (sid: number) => Promise<void>;
}

const openExternalUrl = (url: string) => {
  if (isElectron() && (window as any).electron?.invoke) {
    (window as any).electron.invoke('open-external', url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

const VoiceLibrarySection: React.FC<VoiceLibrarySectionProps> = ({
  voices,
  selectedSid,
  onSelect,
  onImport,
  isReloading,
  onRename,
  onDelete,
}) => {
  const { t } = useTranslation();
  const entry = getManifestEntry('supertonic-3');

  const [isDragging, setIsDragging] = React.useState(false);
  const [editingSid, setEditingSid] = React.useState<number | null>(null);
  const [editName, setEditName] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const presets = useMemo(
    () => voices.filter((v) => v.source === 'preset').sort((a, b) => a.sid - b.sid),
    [voices],
  );
  const imported = useMemo(
    () => voices.filter((v) => v.source === 'imported').sort((a, b) => a.sid - b.sid),
    [voices],
  );

  const handleFiles = React.useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        await onImport(file);
      } catch (err) {
        // Parent component surfaces error via toast. Logging here keeps a
        // breadcrumb in the console for debugging without polluting UI.
        console.warn('Voice import failed:', err);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [onImport]);

  const onDrop: React.DragEventHandler = (e) => {
    e.preventDefault();
    setIsDragging(false);
    void handleFiles(e.dataTransfer.files);
  };

  const onDragOver: React.DragEventHandler = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave: React.DragEventHandler = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const startEdit = (sid: number, currentName: string) => {
    setEditingSid(sid);
    setEditName(currentName);
  };

  const commitEdit = React.useCallback(async (sid: number) => {
    const name = editName.trim();
    setEditingSid(null);
    const currentRow = imported.find((v) => v.sid === sid);
    if (name && currentRow && name !== currentRow.name) {
      try { await onRename(sid, name); }
      catch (err) { console.warn('Rename failed:', err); }
    }
  }, [editName, imported, onRename]);

  const confirmAndDelete = React.useCallback(async (sid: number, name: string) => {
    const prompt = t('voiceLibrary.deleteConfirm', `Delete voice "${name}"?`).replace('{name}', name);
    if (!window.confirm(prompt)) return;
    try { await onDelete(sid); }
    catch (err) { console.warn('Delete failed:', err); }
  }, [onDelete, t]);

  if (!entry) return null;

  return (
    <div className="voice-library-section">
      <div className="setting-item">
        <div className="setting-label">
          <span>{t('voiceLibrary.voice', 'Voice')}</span>
        </div>
        <select
          className="select-dropdown"
          value={selectedSid}
          onChange={(e) => onSelect(Number(e.target.value))}
          disabled={isReloading}
        >
          <optgroup label={t('voiceLibrary.presets', 'Presets')}>
            {presets.map((v) => (
              <option key={v.sid} value={v.sid}>
                {v.gender ? `${v.name} (${v.gender})` : v.name}
              </option>
            ))}
          </optgroup>
          {imported.length > 0 && (
            <optgroup label={t('voiceLibrary.myVoices', 'My Voices')}>
              {imported.map((v) => (
                <option key={v.sid} value={v.sid}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="voice-library-info">
        {t('voiceLibrary.customVoiceCta', 'Need a custom voice?')}{' '}
        <a
          href="https://supertonic.supertone.ai/voice-builder"
          onClick={(e) => {
            e.preventDefault();
            openExternalUrl('https://supertonic.supertone.ai/voice-builder');
          }}
        >
          {t('voiceLibrary.openVoiceBuilder', 'Create one at Voice Builder')}
          <ExternalLink size={14} />
        </a>
        <div className="voice-library-info-sub">
          {t(
            'voiceLibrary.voiceBuilderDisclaimer',
            'Paid Supertone service. Sokuji is not involved in that transaction.',
          )}
        </div>
      </div>

      <details className="voice-library-manage">
        <summary>
          {t('voiceLibrary.manageImported', 'Manage imported voices')}
          {imported.length > 0 && (
            <span className="voice-library-manage-count"> ({imported.length})</span>
          )}
        </summary>

        <div
          className={`voice-library-manage-body${isDragging ? ' dragging' : ''}`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          <div className="voice-library-manage-toolbar">
            <button
              type="button"
              className="voice-import-btn"
              disabled={isReloading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus size={14} />
              {t('voiceLibrary.importVoice', 'Import voice…')}
            </button>
            <span className="voice-library-drop-hint">
              <Upload size={12} />
              {t('voiceLibrary.dropHint', 'or drop a voice_style.json here')}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              multiple
              onChange={(e) => void handleFiles(e.target.files)}
            />
          </div>

          {imported.length === 0 ? (
            <div className="voice-library-empty">
              {t('voiceLibrary.emptyHint', 'No imported voices yet.')}
            </div>
          ) : (
            <ul className="voice-manage-list">
              {imported.map((v) => (
                <li key={v.sid} className="voice-manage-row">
                  {editingSid === v.sid ? (
                    <input
                      autoFocus
                      className="voice-name-edit"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => void commitEdit(v.sid)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitEdit(v.sid);
                        if (e.key === 'Escape') setEditingSid(null);
                      }}
                    />
                  ) : (
                    <span className="voice-name">{v.name}</span>
                  )}
                  <button
                    type="button"
                    className="voice-row-btn"
                    disabled={isReloading || editingSid === v.sid}
                    onClick={() => startEdit(v.sid, v.name)}
                  >
                    {t('voiceLibrary.rename', 'Rename')}
                  </button>
                  <button
                    type="button"
                    className="voice-row-btn voice-row-btn-danger"
                    disabled={isReloading}
                    onClick={() => void confirmAndDelete(v.sid, v.name)}
                  >
                    {t('voiceLibrary.delete', 'Delete')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
};

export default VoiceLibrarySection;
