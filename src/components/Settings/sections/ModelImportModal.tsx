import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ArrowDownToLine, X, AlertTriangle, Copy, FolderInput, Files, Loader } from 'lucide-react';
import { ModelManager, type ModelFileTarget } from '../../../lib/local-inference/ModelManager';
import { matchImportedFiles, filesToImportMap, buildDownloadCommand, ModelImportError, type NamedBlob, type CommandTab } from '../../../lib/local-inference/modelImport';
import { validateModelFile, ModelFileValidationError } from '../../../lib/local-inference/modelFileValidation';
import * as modelStorage from '../../../lib/local-inference/modelStorage';
import { useModelStore } from '../../../stores/modelStore';
import { formatBytes } from '../../../lib/local-inference/formatBytes';
import './ModelImportModal.scss';

interface ModelImportModalProps {
  modelId: string;
  modelName: string;
  isOpen: boolean;
  onClose: () => void;
}

type CmdTab = CommandTab;
type FileState = 'ok' | 'invalid' | 'stored' | 'missing';

/** Group expected files for display: config/tokenizer vs the heavy model files. */
function groupOf(filename: string): 'model' | 'config' {
  return filename.startsWith('onnx/') || /\.(onnx|onnx_data|bin|safetensors|gguf)(_\d+)?$/i.test(filename)
    ? 'model'
    : 'config';
}

export function ModelImportModal({ modelId, modelName, isOpen, onClose }: ModelImportModalProps) {
  const { t } = useTranslation();
  const importModel = useModelStore((s) => s.importModel);

  const [targets, setTargets] = useState<ModelFileTarget[]>([]);
  const [repo, setRepo] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<CmdTab>('hf');
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Accumulated user selection (dedup by provided key) + derived per-file state.
  const [selected, setSelected] = useState<Map<string, NamedBlob>>(new Map());
  const [stored, setStored] = useState<Set<string>>(new Set());
  const [validation, setValidation] = useState<Record<string, { ok: boolean; reason?: string }>>({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  // Authoritative mirror of `selected`, read/written synchronously so two picks
  // in the same tick accumulate instead of clobbering via a stale closure.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Close on Escape (other app dialogs do; PanelBar defers to an open dialog).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // ── Load the expected file list + already-stored files when opened ──
  const refreshStored = useCallback(async (filenames: string[]) => {
    const present = new Set<string>();
    await Promise.all(
      filenames.map(async (fn) => {
        if (await modelStorage.hasFile(modelId, fn)) present.add(fn);
      }),
    );
    setStored(present);
  }, [modelId]);

  useEffect(() => {
    if (!isOpen) return;
    setSelected(new Map());
    setValidation({});
    setError(null);
    setCopied(false);
    try {
      const info = ModelManager.getInstance().getModelFileTargets(modelId);
      setTargets(info.files);
      setRepo(info.repo);
      setTab(info.repo ? 'hf' : 'curl');
      void refreshStored(info.files.map((f) => f.filename));
    } catch (err) {
      setTargets([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isOpen, modelId, refreshStored]);

  const expectedNames = useMemo(() => targets.map((f) => f.filename), [targets]);
  const sizeByName = useMemo(
    () => Object.fromEntries(targets.map((f) => [f.filename, f.sizeBytes])),
    [targets],
  );

  // ── Merge newly-picked files, then match + validate for the preview ──
  const addFiles = useCallback(async (incoming: ArrayLike<NamedBlob>) => {
    setError(null);
    // Read/write the ref (not the render closure) so successive same-tick picks
    // accumulate rather than the later one clobbering the earlier.
    const merged = new Map(selectedRef.current);
    const asMap = filesToImportMap(incoming);
    for (const [k, v] of asMap) merged.set(k, v);
    selectedRef.current = merged;
    setSelected(merged);

    const match = matchImportedFiles(expectedNames, [...merged.keys()]);
    const results: Record<string, { ok: boolean; reason?: string }> = {};
    await Promise.all(
      Object.entries(match.matched).map(async ([filename, key]) => {
        const blob = merged.get(key)!;
        try {
          await validateModelFile(filename, blob, sizeByName[filename] ?? 0);
          results[filename] = { ok: true };
        } catch (err) {
          const reason = err instanceof ModelFileValidationError
            ? err.message.replace(/^Invalid file .*?: /, '').replace(/^Size mismatch.*?: /, 'size mismatch: ')
            : 'invalid';
          results[filename] = { ok: false, reason };
        }
      }),
    );
    // Merge (not overwrite) so results from an earlier, slower validation batch
    // that resolves out of order aren't dropped.
    setValidation((prev) => ({ ...prev, ...results }));
  }, [expectedNames, sizeByName]);

  // ── Per-file display state ──
  const stateOf = useCallback((filename: string): FileState => {
    const v = validation[filename];
    if (v) return v.ok ? 'ok' : 'invalid';
    if (stored.has(filename)) return 'stored';
    return 'missing';
  }, [validation, stored]);

  const counts = useMemo(() => {
    let ready = 0, invalid = 0, pickedOk = 0;
    for (const name of expectedNames) {
      const st = stateOf(name);
      if (st === 'ok') { ready++; pickedOk++; }
      else if (st === 'stored') ready++;
      else if (st === 'invalid') invalid++;
    }
    return { ready, invalid, pickedOk, total: expectedNames.length };
  }, [expectedNames, stateOf]);

  const canImport = !importing && counts.invalid === 0 && counts.pickedOk > 0;

  const handleImport = useCallback(async () => {
    setImporting(true);
    setError(null);
    try {
      await importModel(modelId, [...selected.values()]);
      onClose();
    } catch (err) {
      if (err instanceof ModelImportError) {
        setError(t('models.importIncomplete', 'Still missing {{count}} file(s). Add them and import again.', { count: err.missing.length }));
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      // Some files may have been written; reflect the new stored set.
      await refreshStored(expectedNames);
    } finally {
      setImporting(false);
    }
  }, [importModel, modelId, selected, onClose, t, refreshStored, expectedNames]);

  const command = useMemo(
    () => buildDownloadCommand(tab, repo, modelId, targets),
    [tab, repo, modelId, targets],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard blocked — user can select manually */ }
  }, [command]);

  if (!isOpen) return null;

  const grouped = {
    config: targets.filter((f) => groupOf(f.filename) === 'config'),
    model: targets.filter((f) => groupOf(f.filename) === 'model'),
  };
  const tabs: CmdTab[] = repo ? ['hf', 'curl', 'wget'] : ['curl', 'wget'];

  return (
    <div className="import-modal-overlay" onClick={onClose}>
      <div
        className="import-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('models.importTitle', 'Import model')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="import-modal__head">
          <FolderInput size={17} className="import-modal__head-icon" />
          <h3>
            {t('models.importTitle', 'Import model')}
            <span className="import-modal__sub"> · {modelName}</span>
          </h3>
          <button className="import-modal__x" onClick={onClose} aria-label={t('common.close', 'Close')}>
            <X size={17} />
          </button>
        </div>

        <div className="import-modal__body">
          {/* Step 1 — get the files */}
          <section className="import-step">
            <div className="import-step__head">
              <span className="import-step__n">1</span>
              <span className="import-step__title">{t('models.importStep1', 'Get the files')}</span>
            </div>
            <p className="import-step__hint">
              {t('models.importStep1Hint', 'Download these on any machine or network that works — curl/wget and the Hugging Face CLI often succeed where the in-app download is blocked.')}
            </p>
            <div className="import-cmd">
              {repo && (
                <div className="import-cmd__repo">
                  {t('models.importRepo', 'Repository')} <code>{repo}</code>
                </div>
              )}
              <div className="import-cmd__tabs" role="tablist">
                {tabs.map((tb) => (
                  <button
                    key={tb}
                    role="tab"
                    aria-selected={tab === tb}
                    className={`import-cmd__tab ${tab === tb ? 'is-active' : ''}`}
                    onClick={() => setTab(tb)}
                  >
                    {tb === 'hf' ? 'hf CLI' : tb}
                  </button>
                ))}
              </div>
              <div className="import-cmd__term">
                <button className="import-cmd__copy" onClick={handleCopy}>
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? t('models.importCopied', 'Copied') : t('models.importCopy', 'Copy')}
                </button>
                <pre>{command}</pre>
              </div>
            </div>
          </section>

          {/* Step 2 — add files */}
          <section className="import-step">
            <div className="import-step__head">
              <span className="import-step__n">2</span>
              <span className="import-step__title">{t('models.importStep2', 'Add your files')}</span>
            </div>
            <div
              className={`import-drop ${dragOver ? 'is-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files as unknown as ArrayLike<NamedBlob>); }}
            >
              <ArrowDownToLine size={24} className="import-drop__icon" />
              <div className="import-drop__lead">{t('models.importDropHint', 'Drag the folder or files here')}</div>
              <div className="import-drop__sub">{t('models.importDropSub', 'Pick the whole download folder — its onnx/ subfolder is matched automatically')}</div>
              <div className="import-drop__btns">
                <button className="import-btn import-btn--sm" onClick={() => folderInputRef.current?.click()}>
                  <FolderInput size={13} /> {t('models.importChooseFolder', 'Choose folder')}
                </button>
                <button className="import-btn import-btn--sm" onClick={() => filesInputRef.current?.click()}>
                  <Files size={13} /> {t('models.importChooseFiles', 'Choose files')}
                </button>
              </div>
              <input ref={folderInputRef} type="file" multiple hidden
                {...({ webkitdirectory: '' } as Record<string, string>)}
                onChange={(e) => { if (e.target.files) void addFiles(e.target.files as unknown as ArrayLike<NamedBlob>); }} />
              <input ref={filesInputRef} type="file" multiple hidden
                onChange={(e) => { if (e.target.files) void addFiles(e.target.files as unknown as ArrayLike<NamedBlob>); }} />
            </div>
          </section>

          {/* Step 3 — file status */}
          <section className="import-step">
            <div className="import-step__head">
              <span className="import-step__n">3</span>
              <span className="import-step__title">{t('models.importStep3', 'Files')}</span>
              <span className="import-step__count">{counts.ready} / {counts.total}</span>
            </div>
            <div className="import-meter">
              <div
                className="import-meter__fill"
                style={{
                  width: `${counts.total ? (counts.ready / counts.total) * 100 : 0}%`,
                  background: counts.invalid ? 'var(--import-danger)' : 'var(--import-accent)',
                }}
              />
            </div>
            {(['config', 'model'] as const).map((g) => grouped[g].length > 0 && (
              <div key={g} className="import-files__group">
                <div className="import-files__grouphdr">
                  {g === 'config'
                    ? t('models.importGroupConfig', 'Config & tokenizer')
                    : t('models.importGroupModel', 'Model files')}
                </div>
                <ul className="import-files">
                  {grouped[g].map((f) => {
                    const st = stateOf(f.filename);
                    return (
                      <li key={f.filename} className={`import-file import-file--${st}`}>
                        <span className="import-file__st">
                          {st === 'ok' && <Check size={14} />}
                          {st === 'stored' && <Check size={14} />}
                          {st === 'missing' && <ArrowDownToLine size={13} />}
                          {st === 'invalid' && <X size={14} />}
                        </span>
                        <span className="import-file__name" title={f.filename}>{f.filename}</span>
                        {st === 'invalid' && validation[f.filename]?.reason && (
                          <span className="import-file__why">{validation[f.filename].reason}</span>
                        )}
                        {st === 'stored' && (
                          <span className="import-file__tag">{t('models.importAlready', 'already imported')}</span>
                        )}
                        <span className="import-file__size">{formatBytes(f.sizeBytes)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        </div>

        <div className="import-modal__foot">
          <span className="import-modal__msg">
            {error
              ? <span className="import-modal__msg--err"><AlertTriangle size={13} /> {error}</span>
              : counts.invalid > 0
                ? t('models.importHasInvalid', 'Replace the invalid file(s) and re-add.')
                : counts.ready === counts.total && counts.total > 0
                  ? t('models.importAllPresent', 'All files present.')
                  : counts.pickedOk > 0
                    ? t('models.importSomeReady', '{{count}} still missing — import now and add the rest later.', { count: counts.total - counts.ready })
                    : t('models.importAddToBegin', 'Add the files above to begin.')}
          </span>
          <button className="import-btn" onClick={onClose} disabled={importing}>
            {t('common.cancel', 'Cancel')}
          </button>
          <button className="import-btn import-btn--primary" onClick={handleImport} disabled={!canImport}>
            {importing && <Loader size={13} className="import-spin" />}
            {counts.ready === counts.total && counts.total > 0
              ? t('models.importFinish', 'Import & finish')
              : counts.pickedOk > 0
                ? t('models.importNow', 'Import {{count}} now', { count: counts.pickedOk })
                : t('models.import', 'Import')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModelImportModal;
