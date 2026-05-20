import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Plus, Upload } from 'lucide-react';
import { getManifestEntry } from '../../../lib/local-inference/modelManifest';
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
}

const VoiceLibrarySection: React.FC<VoiceLibrarySectionProps> = ({
  voices,
  selectedSid,
  onSelect,
  onImport,
  isReloading,
}) => {
  const { t } = useTranslation();
  const entry = getManifestEntry('supertonic-3');

  const [isDragging, setIsDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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

  const presets = useMemo(
    () => voices.filter((v) => v.source === 'preset').sort((a, b) => a.sid - b.sid),
    [voices],
  );
  const imported = useMemo(
    () => voices.filter((v) => v.source === 'imported').sort((a, b) => a.sid - b.sid),
    [voices],
  );

  if (!entry) return null;

  return (
    <div className="voice-library-section">
      <div className="voice-library-info">
        {t('voiceLibrary.customVoiceCta', 'Need a custom voice?')}{' '}
        <a
          href="https://supertonic.supertone.ai/voice-builder"
          target="_blank"
          rel="noopener noreferrer"
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

      <h4>{t('voiceLibrary.presets', 'Presets')}</h4>
      <ul className="voice-list">
        {presets.map((v) => (
          <li
            key={v.sid}
            className={v.sid === selectedSid ? 'voice-row selected' : 'voice-row'}
            onClick={() => onSelect(v.sid)}
          >
            <span className="voice-name">{v.name}</span>
            {v.gender && <span className="voice-meta">({v.gender})</span>}
          </li>
        ))}
      </ul>

      <div className="voice-library-my-header">
        <h4>{t('voiceLibrary.myVoices', 'My Voices')}</h4>
        <button
          type="button"
          className="voice-import-btn"
          disabled={isReloading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus size={14} />
          {t('voiceLibrary.importVoice', 'Import voice…')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          multiple
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      <div
        className={`voice-dropzone${isDragging ? ' dragging' : ''}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        {imported.length === 0 ? (
          <div className="voice-library-empty">
            <Upload size={16} />{' '}
            {t('voiceLibrary.emptyHint', 'Drop a voice_style.json here, or click Import.')}
          </div>
        ) : (
          <ul className="voice-list">
            {imported.map((v) => (
              <li
                key={v.sid}
                className={v.sid === selectedSid ? 'voice-row selected' : 'voice-row'}
                onClick={() => onSelect(v.sid)}
              >
                <span className="voice-name">{v.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default VoiceLibrarySection;
