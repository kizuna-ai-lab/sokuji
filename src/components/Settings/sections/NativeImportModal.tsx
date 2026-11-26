// src/components/Settings/sections/NativeImportModal.tsx
//
// Importing a native model by hand, for where the hub cannot be reached: the same window as the WASM/WebGPU engine's
// (ModelImportModal: get the files with a command, add them by dropping or choosing, see each file's state), over the
// native engine's own backend. The files it needs come from the engine (model_files); the picked files are handed to
// the engine by their paths on this computer, and the engine checks them (the file named, a GGUF with a readable
// header, the published bytes where the catalog lists them) before anything goes into the model cache. The card shows
// the progress and, if a file is refused, the reason.
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ModelImportModal, type ImportBackend } from './ModelImportModal';
import { ModelFileValidationError, validateModelFile } from '../../../lib/local-inference/modelFileValidation';
import { useNativeModelStore } from '../../../stores/nativeModelStore';

/** The path of a file the page was given (the preload's `nativeFiles`); File.path is gone from Electron. */
function pathOf(file: Blob): string {
  const files = (window as unknown as { nativeFiles?: { pathFor(f: Blob): string } }).nativeFiles;
  if (!files) throw new Error('importing a native model needs the desktop app');
  return files.pathFor(file);
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
  const backend = useMemo<ImportBackend>(() => ({
    targets: async () => {
      const files = await useNativeModelStore.getState().modelFiles(modelId, repo);
      return { repo: files[0]?.repo, files: files.map((f) => ({ filename: f.file, url: f.url, sizeBytes: f.size ?? 0 })) };
    },
    dropHint: t('models.importDropSubFile', 'Choose the downloaded file(s). Keep their names as they are.'),
    // What is already in the cache is the card's business (it reads "downloaded"); the window lists what to add.
    stored: async () => new Set<string>(),
    // As the WASM/WebGPU engine's window does: an HTML error page in place of the file, and — where the catalog lists the
    // file's size — one far off it, are told at once; the engine's own check (the published bytes) comes at import.
    validate: async (filename, blob, expectedSizeBytes) => {
      if (blob.size === 0) throw new ModelFileValidationError(`Invalid file ${filename}: it is empty`);
      await validateModelFile(filename, blob, expectedSizeBytes);
    },
    commit: async (files) => {
      const paths = files.map(pathOf);
      // A file the page could not give a location for (not from the system's file picker or a real drop): say so here
      // rather than let the engine answer "no files were chosen".
      if (paths.some((p) => !p)) throw new Error(t('models.importNoPath', 'The location of a chosen file could not be read. Choose the file again with the file picker.'));
      // The card shows the progress, and the reason if a file is refused.
      void useNativeModelStore.getState().importFiles(modelId, paths, repo);
    },
  }), [modelId, repo, t]);
  return <ModelImportModal isOpen={isOpen} onClose={onClose} modelId={modelId} modelName={modelName} backend={backend} />;
};
