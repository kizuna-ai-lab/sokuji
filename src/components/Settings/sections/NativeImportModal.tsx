// src/components/Settings/sections/NativeImportModal.tsx
//
// Importing a native model by hand, for where the hub cannot be reached: the window names the file(s) the model is
// made of and where each is published, the person downloads them however they can, then chooses them here. The engine
// checks what was chosen (the right file, a whole GGUF, the published bytes where the catalog lists them) before
// anything goes into the model cache; the card shows the progress and, if a file is refused, the reason.
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, FolderInput } from 'lucide-react';
import Modal from '../../Modal/Modal';
import { useNativeModelStore } from '../../../stores/nativeModelStore';
import type { ModelFileInfo } from '../../../lib/local-inference/native/nativeProtocol';
import { openExternalUrl } from '../../../utils/openExternalUrl';

interface ElectronInvoke { invoke(channel: string, data?: unknown): Promise<any>; }

/** The files the person picks in the system's Open dialog (paths on this computer); [] when they cancel. */
async function pickFiles(title: string): Promise<string[]> {
  const e = (window as unknown as { electron?: ElectronInvoke }).electron;
  if (!e) return [];
  const r = await e.invoke('native-models:pick-files', { title });
  return r?.ok && Array.isArray(r.paths) ? r.paths : [];
}

export const NativeImportModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** The id the engine knows the model by. */
  modelId: string;
  modelName: string;
  /** The chosen variant's artifact, as a download takes it. */
  repo?: string;
}> = ({ isOpen, onClose, modelId, modelName, repo }) => {
  const { t } = useTranslation();
  const [files, setFiles] = useState<ModelFileInfo[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    setFiles(null);
    setProblem(null);
    useNativeModelStore.getState().modelFiles(modelId, repo).then(
      (f) => { if (live) setFiles(f); },
      (e: unknown) => { if (live) setProblem(e instanceof Error ? e.message : String(e)); },
    );
    return () => { live = false; };
  }, [isOpen, modelId, repo]);

  const choose = async () => {
    const paths = await pickFiles(t('models.nativeImport.pickTitle', 'Choose the downloaded files'));
    if (paths.length === 0) return;
    onClose();
    // The card shows the progress, and the reason if a file is refused.
    void useNativeModelStore.getState().importFiles(modelId, paths, repo);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('models.nativeImport.title', 'Import {{name}}', { name: modelName })}>
      <div className="native-import-modal">
        <p>{t('models.nativeImport.intro', 'Download the file(s) below yourself, then choose them here. The file names must stay as they are.')}</p>
        {problem && <p role="alert">{problem}</p>}
        {files === null && !problem && <p>{t('models.nativeImport.loading', 'Looking up the files…')}</p>}
        {files && (
          <ul className="native-import-modal__files">
            {files.map((f) => (
              <li key={`${f.repo}/${f.file}`}>
                <strong>{f.file.split('/').pop()}</strong>
                <span className="native-import-modal__repo"> {f.repo}</span>
                {' '}
                <button type="button" className="native-import-modal__link" onClick={() => openExternalUrl(f.url)}>
                  <ExternalLink size={12} aria-hidden="true" />
                  {t('models.nativeImport.openPage', 'Open the download page')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="model-card__btn model-card__btn--import" onClick={() => void choose()} disabled={!files || files.length === 0}>
          <FolderInput size={14} />
          <span>{t('models.nativeImport.choose', 'Choose files…')}</span>
        </button>
      </div>
    </Modal>
  );
};
