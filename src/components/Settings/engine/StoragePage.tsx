import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive, Trash2, FolderInput } from 'lucide-react';
import {
  useModelStore, useModelStatuses, useStorageUsedMb, useWebGPUAvailable, useDeviceFeatures,
} from '../../../stores/modelStore';
import { useNativeModelStore, useNativeCatalog } from '../../../stores/nativeModelStore';
import { useLocalInferenceSettings, useLocalNativeSettings } from '../../../stores/settingsStore';
import { MODEL_MANIFEST, getManifestEntry, getModelSizeMb } from '../../../lib/local-inference/modelManifest';
import { wasmCandidates } from '../../../lib/local-inference/selection/candidates.wasm';
import { nativeCandidates } from '../../../lib/local-inference/selection/candidates.native';
import { resolveDirection } from '../../../lib/local-inference/selection/resolveStage';
import { directionKey, type DirectionResult, type Selections, type Stage } from '../../../lib/local-inference/selection/types';
import { ModelImportModal } from '../sections/ModelImportModal';
import type { NativeModelInfo } from '../../../lib/local-inference/native/nativeProtocol';
import './Engine.scss';

/** Stage nouns reuse the same chip vocabulary resolutionNotes.ts uses — the
 *  copy cannot drift between "why this note" and "what changes on delete". */
const STAGE_NOUN_KEY: Record<Stage, [string, string]> = {
  asr: ['notes.stageAsr', 'speech recognition'],
  translation: ['notes.stageTranslation', 'translation'],
  tts: ['notes.stageTts', 'speech output'],
};
const STAGES: Stage[] = ['asr', 'translation', 'tts'];

interface Row {
  id: string;
  name: string;
  sizeLabel?: string;
  inUse: boolean;
}

/** One row's delete-preview: which (direction, stage) resolutions the delete
 *  would change, already rendered to a sentence each. */
function computeDeleteNotes(
  id: string,
  displayName: (id: string) => string,
  directions: Array<{ dir: string }>,
  before: (dir: string) => DirectionResult,
  after: (dir: string) => DirectionResult,
  t: ReturnType<typeof useTranslation>['t'],
): string[] {
  const out: string[] = [];
  for (const { dir } of directions) {
    const beforeResult = before(dir);
    const afterResult = after(dir);
    for (const stage of STAGES) {
      const beforeId = beforeResult[stage]?.modelId ?? null;
      if (beforeId !== id) continue; // this delete doesn't touch this slot
      const afterId = afterResult[stage]?.modelId ?? null;
      const stageNoun = t(STAGE_NOUN_KEY[stage][0], STAGE_NOUN_KEY[stage][1]);
      if (afterId) {
        out.push(t('engineUi.deleteFallsBack', 'Deleting {{name}}: {{stage}} falls back to {{to}}.', {
          name: displayName(id), stage: stageNoun, to: displayName(afterId),
        }));
      } else if (stage !== 'tts') {
        // "sessions cannot start" is only true for the gate's mandatory
        // stages — a missing TTS degrades to subtitles and never blocks, so
        // claiming otherwise here would be false.
        out.push(t('engineUi.deleteNoModel', 'Deleting {{name}}: no {{stage}} model remains — sessions cannot start.', {
          name: displayName(id), stage: stageNoun,
        }));
      }
    }
  }
  return out;
}

/** Storage: a flat list of everything downloaded (wasm) / ready (native),
 *  in-use badges, per-model delete with a resolver-backed fallback preview,
 *  Clear all (relocated from ModelStorageFooter), and Import (WASM only,
 *  reusing ModelImportModal — StoragePage is the one place a user can import
 *  a model with no direction/compatibility context attached to it yet). */
export const StoragePage: React.FC<{ provider: 'wasm' | 'native'; isSessionActive?: boolean }> = ({
  provider, isSessionActive = false,
}) => {
  const { t } = useTranslation();

  // ── WASM data (always subscribed — hooks must run unconditionally) ──────
  const wasmStatuses = useModelStatuses();
  const wasmStorageMb = useStorageUsedMb();
  const webgpuAvailable = useWebGPUAvailable();
  const deviceFeatures = useDeviceFeatures();
  const wasmSettings = useLocalInferenceSettings();

  // ── Native data ───────────────────────────────────────────────────────
  const nativeStatuses = useNativeModelStore((s) => s.statuses);
  const nativeCatalog = useNativeCatalog();
  const nativeSettings = useLocalNativeSettings();

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [clearAllPending, setClearAllPending] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importTarget, setImportTarget] = useState<{ id: string; name: string } | null>(null);

  const isWasm = provider === 'wasm';

  const sourceLanguage = isWasm ? wasmSettings.sourceLanguage : nativeSettings.sourceLanguage;
  const targetLanguage = isWasm ? wasmSettings.targetLanguage : nativeSettings.targetLanguage;
  const selections: Selections = isWasm ? wasmSettings.selections : nativeSettings.selections;
  const speakerDir = directionKey(sourceLanguage, targetLanguage);
  const participantDir = directionKey(targetLanguage, sourceLanguage);
  const directions = [{ dir: speakerDir }, { dir: participantDir }];

  const displayName = (id: string): string =>
    isWasm ? (getManifestEntry(id)?.name ?? id) : (nativeCatalog[id]?.name ?? id);

  const resolveWith = (statuses: Record<string, string>) => (dir: string): DirectionResult =>
    isWasm
      ? resolveDirection(dir, selections, wasmCandidates({
          modelStatuses: statuses as Record<string, any>, webgpuAvailable, deviceFeatures,
        }))
      : resolveDirection(dir, selections, nativeCandidates({
          catalog: nativeCatalog, statuses: statuses as Record<string, any>,
        }));

  const currentStatuses = isWasm ? wasmStatuses : nativeStatuses;
  const resolveNow = resolveWith(currentStatuses);

  // Every id that resolves in either live direction, for the in-use badge.
  const inUseIds = new Set<string>();
  for (const { dir } of directions) {
    const r = resolveNow(dir);
    for (const stage of STAGES) {
      const id = r[stage]?.modelId;
      if (id) inUseIds.add(id);
    }
  }

  const rows: Row[] = Object.entries(currentStatuses)
    .filter(([, status]) => (isWasm ? status === 'downloaded' : status === 'ready'))
    .map(([id]) => {
      const sizeLabel = isWasm
        ? (() => {
            const entry = getManifestEntry(id);
            return entry && !entry.isCloudModel ? `${getModelSizeMb(entry, deviceFeatures)} MB` : undefined;
          })()
        : (() => {
            const info: NativeModelInfo | undefined = nativeCatalog[id];
            return info?.sizeBytes ? `${Math.round(info.sizeBytes / (1024 * 1024))} MB` : undefined;
          })();
      return { id, name: displayName(id), sizeLabel, inUse: inUseIds.has(id) };
    });

  const hasModels = rows.length > 0;
  const storageMb = isWasm
    ? wasmStorageMb
    : Math.round(rows.reduce((sum, r) => sum + (nativeCatalog[r.id]?.sizeBytes ?? 0), 0) / (1024 * 1024));

  const doDelete = async (id: string) => {
    setDeleteTarget(null);
    if (isWasm) {
      await useModelStore.getState().deleteModel(id);
    } else {
      await useNativeModelStore.getState().deleteModel(id);
    }
  };

  const doClearAll = async () => {
    setClearAllPending(false);
    if (isWasm) {
      await useModelStore.getState().deleteAllModels();
    } else {
      // Native has no bulk clear — best-effort per-model delete.
      await Promise.all(rows.map((r) => useNativeModelStore.getState().deleteModel(r.id)));
    }
  };

  const deleteNotesFor = (id: string): string[] => {
    const maskedStatuses = { ...currentStatuses, [id]: isWasm ? 'not_downloaded' : 'absent' };
    return computeDeleteNotes(id, displayName, directions, resolveNow, resolveWith(maskedStatuses), t);
  };

  return (
    <div className="engine-storage-page">
      <div className="engine-storage-page__summary">
        <HardDrive size={14} />
        <span>{t('models.storageUsed', 'Storage: {{size}} MB used', { size: storageMb })}</span>
      </div>

      {rows.length === 0 && (
        <div className="engine-storage-page__empty">{t('models.storageEmpty', 'No models downloaded yet.')}</div>
      )}

      {rows.map((row) => (
        <div key={row.id} className="engine-storage-row" data-testid={`storage-row-${row.id}`}>
          <div className="engine-storage-row__info">
            <span className="engine-storage-row__name">{row.name}</span>
            {row.sizeLabel && <span className="engine-storage-row__meta">{row.sizeLabel}</span>}
            {row.inUse && <span className="engine-storage-row__badge">{t('engineUi.inUse', 'In use')}</span>}
          </div>
          <button
            type="button"
            className="engine-storage-row__delete"
            data-testid={`storage-delete-${row.id}`}
            onClick={() => setDeleteTarget(row.id)}
            disabled={isSessionActive}
          >
            <Trash2 size={12} />
          </button>
          {deleteTarget === row.id && (
            <div className="engine-storage-confirm" data-testid="storage-confirm">
              <p>{t('engineUi.deleteConfirm', 'Delete {{name}}?', { name: row.name })}</p>
              {deleteNotesFor(row.id).map((note, i) => <p key={i}>{note}</p>)}
              <button type="button" className="model-management__clear-btn model-management__clear-btn--yes"
                onClick={() => doDelete(row.id)} disabled={isSessionActive}>{t('models.confirmYes', 'Yes')}</button>
              <button type="button" className="model-management__clear-btn model-management__clear-btn--no"
                onClick={() => setDeleteTarget(null)}>{t('models.confirmNo', 'No')}</button>
            </div>
          )}
        </div>
      ))}

      <div className="engine-storage-page__actions">
        {hasModels && (
          clearAllPending ? (
            <div className="engine-storage-confirm" data-testid="storage-confirm">
              <p>{t('models.confirmClearAll', 'Delete all models?')}</p>
              <p>{t('engineUi.clearAllKeepsPicks', 'Your selections are remembered and return when models are downloaded again.')}</p>
              <button type="button" className="model-management__clear-btn model-management__clear-btn--yes"
                onClick={doClearAll} disabled={isSessionActive}>{t('models.confirmYes', 'Yes')}</button>
              <button type="button" className="model-management__clear-btn model-management__clear-btn--no"
                onClick={() => setClearAllPending(false)}>{t('models.confirmNo', 'No')}</button>
            </div>
          ) : (
            <button type="button" className="engine-storage-page__action-btn engine-storage-page__action-btn--danger"
              onClick={() => setClearAllPending(true)} disabled={isSessionActive}>
              <Trash2 size={12} />
              {t('models.clearAll', 'Clear all')}
            </button>
          )
        )}

        {isWasm && (
          <button type="button" className="engine-storage-page__action-btn"
            onClick={() => setImportOpen((v) => !v)} disabled={isSessionActive}>
            <FolderInput size={14} />
            {t('models.import', 'Import')}
          </button>
        )}
        {isWasm && importOpen && (
          <div className="engine-storage-import-picker">
            <select
              defaultValue=""
              onChange={(e) => {
                const entry = getManifestEntry(e.target.value);
                if (entry) setImportTarget({ id: entry.id, name: entry.name });
              }}
            >
              <option value="" disabled>{t('engineUi.importChooseModel', 'Choose a model to import')}</option>
              {MODEL_MANIFEST.filter((m) => !m.isCloudModel).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {importTarget && (
        <ModelImportModal
          isOpen
          modelId={importTarget.id}
          modelName={importTarget.name}
          onClose={() => { setImportTarget(null); setImportOpen(false); }}
        />
      )}
    </div>
  );
};

export default StoragePage;
