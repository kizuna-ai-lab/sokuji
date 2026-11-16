// src/components/SettingsPage/ModelsPage.tsx
//
// "Models and storage" as the mock draws it (v18; the owner chose the mock, 2026-11-15): every model the
// "This device" service can use for the current languages, downloaded or not, each with its own Download or
// Delete (the rest folded under "other languages"); the helper models (Smart Turn, the punctuation models, the
// Japanese readings dictionary); the imported voices; and a summary line with Import and Clear all.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  useModelDownloads, useModelStatuses, useDownloadErrors, useStorageUsedMb, useWebGPUAvailable, useDeviceFeatures, useModelStore,
} from '../../stores/modelStore';
import { useSmartTurnStore, SMART_TURN_TOTAL_BYTES } from '../../stores/smartTurnStore';
import { useSegmentationStore, PACK_MODELS, PACK_TOTAL_BYTES } from '../../stores/segmentationStore';
import { useProviderStore } from '../../stores/providerStore';
import { storedLocalStages, useStoredLocalStages } from '../../stores/lineUpStore';
import { MODEL_MANIFEST, deviceReady, getManifestEntry, getModelSizeMb, type ModelManifestEntry } from '../../lib/local-inference/modelManifest';
import { wasmCandidates } from '../../lib/local-inference/selection/candidates.wasm';
import { resolveWasmDirection } from '../../lib/local-inference/selection/resolveWithStages';
import { directionKey, splitDirection, type DirectionResult, type Stage } from '../../lib/local-inference/selection/types';
import { formatBytes } from '../../lib/local-inference/formatBytes';
import { DICTIONARY_BYTES, deleteDictionary, isDictionaryStored } from '../../lib/reading/ja/dictionary';
import * as voiceStorage from '../../lib/local-inference/voiceStorage';
import { importedSidFromDbKey } from '../../lib/local-inference/sidMapping';
import { voicesWithoutImported } from '../../providers/localInference/voices';
import { presentProviders } from '../../providers/registry';
import { SMART_TURN_MODEL_ID } from '../../lib/turn/smartTurn';
import { useLanguageLabel } from '../../lib/language/useLanguageLabel';
import { computeDeleteNotes } from '../Settings/engine/deleteNotes';
import { ModelImportModal } from '../Settings/sections/ModelImportModal';
import type { LocalInferenceSettings } from '../../providers/localInference/settings';
import type { LanguagePair } from '../../lib/provider/types';

const MB = 1_048_576;
const STAGES: Stage[] = ['asr', 'translation', 'tts'];
const SESSION_TYPES = new Set(['asr', 'asr-stream', 'translation', 'tts']);
const STAGE_OF: Record<string, Stage> = { asr: 'asr', 'asr-stream': 'asr', translation: 'translation', tts: 'tts' };
const TAGS: Record<Stage, [string, string]> = {
  asr: ['models.page.tag.asr', 'Recognition'],
  translation: ['models.page.tag.translation', 'Translation'],
  tts: ['models.page.tag.tts', 'Speech'],
};

/** One row of the list: a tag, the name and a line about it, then its state and its one action. */
function ModelRow({ tag, name, meta, state, children, confirm }: {
  tag: string; name: string; meta: ReactNode; state?: string; children?: ReactNode; confirm?: ReactNode;
}) {
  return (
    <div className="model-row">
      <div className="model-row__main">
        <div className="model-row__title"><span className="model-row__tag">{tag}</span><span className="model-row__name">{name}</span></div>
        <div className="model-row__meta">{meta}{state && <span className="model-row__state">{state}</span>}</div>
      </div>
      <div className="model-row__actions">{children}</div>
      {confirm}
    </div>
  );
}

/** The inline "Delete …?" with its notes, under a row. */
function Confirm({ question, notes = [], onYes, onNo, locked }: { question: string; notes?: string[]; onYes: () => void; onNo: () => void; locked: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="model-row__confirm" role="group" aria-label={question}>
      <p>{question}</p>
      {notes.map((n, i) => <p key={i} className="model-row__note">{n}</p>)}
      <button type="button" className="model-row__btn model-row__btn--danger" disabled={locked} onClick={onYes}>{t('models.confirmYes', 'Yes')}</button>
      <button type="button" className="model-row__btn" onClick={onNo}>{t('models.confirmNo', 'No')}</button>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="models-group" aria-label={title}>
      <h3 className="models-group__title">{title}</h3>
      <p className="models-group__hint">{hint}</p>
      <div className="models-group__list">{children}</div>
    </section>
  );
}

export function ModelsPage({ locked, settings, pair }: { locked: boolean; settings: LocalInferenceSettings; pair: LanguagePair }) {
  const { t } = useTranslation();
  const languageName = useLanguageLabel();
  const statuses = useModelStatuses();
  const downloads = useModelDownloads();
  const errors = useDownloadErrors();
  const storageMb = useStorageUsedMb();
  const webgpu = useWebGPUAvailable();
  const features = useDeviceFeatures();
  const turnPhase = useSmartTurnStore((s) => s.phase);
  const packPhase = useSegmentationStore((s) => s.phase);
  const packBytes = useSegmentationStore((s) => s.downloadedBytes);
  const stages = useStoredLocalStages();

  const [asking, setAsking] = useState<string | null>(null);
  const [open, setOpen] = useState<Partial<Record<Stage, boolean>>>({});
  const [importing, setImporting] = useState(false);
  const [importTarget, setImportTarget] = useState<ModelManifestEntry | null>(null);
  const [dictStored, setDictStored] = useState<boolean | null>(null);
  const [imported, setImported] = useState<voiceStorage.StoredVoice[]>([]);
  const [looks, setLooks] = useState(0);

  // What is on disk outside the model store: the dictionary and the imported voices; looked at again after a change.
  useEffect(() => {
    let live = true;
    isDictionaryStored().then((v) => { if (live) setDictStored(v); }, () => { if (live) setDictStored(null); });
    voiceStorage.listVoices('supertonic-3').then((v) => { if (live) setImported(v); }, () => { if (live) setImported([]); });
    return () => { live = false; };
  }, [looks]);
  useEffect(() => { void useSmartTurnStore.getState().refresh(); void useSegmentationStore.getState().refresh(); }, []);

  // The models this pair can use, both ways, on every stage — and every one already on disk.
  const directions = useMemo(() => [directionKey(pair.source, pair.target), directionKey(pair.target, pair.source)], [pair.source, pair.target]);
  const stageGroups = useMemo(() => {
    const source = wasmCandidates({ modelStatuses: statuses as never, webgpuAvailable: webgpu, deviceFeatures: features, withCloud: false });
    const usable = new Set<string>();
    for (const dir of directions) {
      const [src, tgt] = splitDirection(dir);
      for (const stage of STAGES) for (const c of source.pool(stage, src, tgt)) usable.add(c.id);
    }
    // By stage; within one, what is on disk, then what this computer can run (the recommended first), then the rest.
    const rank = (m: ModelManifestEntry) => (statuses[m.id] === 'downloaded' ? 0 : deviceReady(m, webgpu) ? 1 : 2);
    const order = (a: ModelManifestEntry, b: ModelManifestEntry) =>
      STAGES.indexOf(STAGE_OF[a.type]) - STAGES.indexOf(STAGE_OF[b.type])
      || rank(a) - rank(b)
      || Number(Boolean(b.recommended)) - Number(Boolean(a.recommended))
      || (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    const all = MODEL_MANIFEST.filter((m) => !m.isCloudModel && SESSION_TYPES.has(m.type)).sort(order);
    const onDisk = (m: ModelManifestEntry) => statuses[m.id] === 'downloaded' || Boolean(downloads[m.id]);
    const isMine = (m: ModelManifestEntry) => usable.has(m.id) || onDisk(m);
    // One small group per stage (owner, 2026-11-15): what is on disk and the recommended ones this computer can
    // run; when that is nothing, the best one it can run stands in. The rest, other languages' last, wait in a fold.
    return STAGES.map((stage) => {
      const mine = all.filter((m) => STAGE_OF[m.type] === stage && isMine(m));
      let shown = mine.filter((m) => onDisk(m) || (m.recommended && deviceReady(m, webgpu)));
      if (shown.length === 0) shown = mine.filter((m) => deviceReady(m, webgpu)).slice(0, 1);
      return {
        stage,
        shown,
        rest: mine.filter((m) => !shown.includes(m)),
        others: all.filter((m) => STAGE_OF[m.type] === stage && !isMine(m)),
      };
    });
  }, [statuses, downloads, webgpu, features, directions]);

  const resolveWith = useCallback((st: Record<string, string>) => (dir: string): DirectionResult =>
    resolveWasmDirection(...(splitDirection(dir) as [string, string]), settings.selections, {
      modelStatuses: st as never, webgpuAvailable: webgpu, deviceFeatures: features,
    }, stages), [settings.selections, webgpu, features, stages]);

  const meta = (m: ModelManifestEntry): string => {
    const langs = m.multilingual
      ? t('models.page.manyLanguages', 'Many languages')
      : m.languages.length > 3 ? t('models.page.languages', '{{count}} languages', { count: m.languages.length }) : m.languages.map(languageName).join(' · ');
    return m.astLanguages ? `${langs} · ${t('models.page.direct', 'can also give the translation directly')}` : langs;
  };

  const sessionRow = (m: ModelManifestEntry) => {
    const stage = STAGE_OF[m.type];
    const dl = downloads[m.id];
    const runnable = deviceReady(m, webgpu);
    const size = formatBytes(getModelSizeMb(m, features) * MB);
    const state = dl ? t('models.page.downloading', 'Downloading {{percent}}%', { percent: Math.round(dl.percent ?? 0) })
      : statuses[m.id] === 'downloaded' ? t('models.downloaded', 'Downloaded')
        : errors[m.id] ? t('models.page.failed', 'Download failed')
          : !runnable ? t('models.page.cannotRun', "This computer can't run it")
            : t('models.page.notDownloaded', 'Not downloaded');
    const notes = () => computeDeleteNotes(m.id, (id) => getManifestEntry(id)?.name ?? id, directions.map((dir) => ({ dir })),
      resolveWith(statuses), resolveWith({ ...statuses, [m.id]: 'not_downloaded' }), t);
    return (
      <ModelRow key={m.id} tag={t(TAGS[stage][0], TAGS[stage][1])} name={m.name} meta={<><span>{meta(m)}</span><span>{size}</span></>} state={state}
        confirm={asking === m.id && (
          <Confirm question={t('engineUi.deleteConfirm', 'Delete {{name}}?', { name: m.name })} notes={notes()} locked={locked}
            onNo={() => setAsking(null)} onYes={() => { setAsking(null); void useModelStore.getState().deleteModel(m.id); }} />
        )}>
        {dl ? (
          <button type="button" className="model-row__btn" aria-label={`${t('models.cancel', 'Cancel')}: ${m.name}`} onClick={() => useModelStore.getState().cancelDownload(m.id)}>{t('models.cancel', 'Cancel')}</button>
        ) : statuses[m.id] === 'downloaded' ? (
          <button type="button" className="model-row__btn" disabled={locked} aria-label={`${t('models.delete', 'Delete')}: ${m.name}`} onClick={() => setAsking(m.id)}>{t('models.delete', 'Delete')}</button>
        ) : runnable && (
          <button type="button" className="model-row__btn model-row__btn--primary" disabled={locked} aria-label={`${t('models.page.download', 'Download')}: ${m.name}`} onClick={() => void useModelStore.getState().downloadModel(m.id)}>{t('models.page.download', 'Download')}</button>
        )}
      </ModelRow>
    );
  };

  // The helper models: each managed through its own store, as their settings do.
  const turnEntry = getManifestEntry(SMART_TURN_MODEL_ID);
  const deleteButton = (key: string, name: string) => (
    <button type="button" className="model-row__btn" disabled={locked} aria-label={`${t('models.delete', 'Delete')}: ${name}`} onClick={() => setAsking(key)}>{t('models.delete', 'Delete')}</button>
  );
  const helperState = (phase: string, done: number, total: number) =>
    phase === 'ready' ? t('models.downloaded', 'Downloaded')
      : phase === 'downloading' ? t('models.page.downloading', 'Downloading {{percent}}%', { percent: total > 0 ? Math.round((done / total) * 100) : 0 })
        : phase === 'error' ? t('models.page.failed', 'Download failed') : t('models.page.notDownloaded', 'Not downloaded');
  const turnBytes = useSmartTurnStore((s) => s.downloadedBytes);
  const packName = PACK_MODELS.map((m) => m.name.replace(/\s*\(.*\)$/, '')).join(t('models.page.listJoin', ', '));
  const dictName = t('models.readingsDictionary', 'Readings dictionary (Japanese)');

  const sessionDownloaded = MODEL_MANIFEST.filter((m) => SESSION_TYPES.has(m.type) && !m.isCloudModel && statuses[m.id] === 'downloaded').length;
  const count = sessionDownloaded + Number(turnPhase === 'ready') + Number(packPhase === 'ready') + Number(dictStored === true) + imported.length;
  const anything = count > 0;

  const local = useMemo(() => presentProviders().find((p) => p.id === 'local_inference'), []);
  const deleteVoice = async (v: voiceStorage.StoredVoice) => {
    await voiceStorage.deleteVoice(v.id);
    // Every direction that spoke in it goes back to Supertonic's default speaker (#619), as the voice library does.
    const next = voicesWithoutImported(settings.voices, importedSidFromDbKey(v.id), (dir) => {
      const [src, tgt] = splitDirection(dir);
      return useModelStore.getState().resolve(src, tgt, settings.selections, storedLocalStages()).tts?.modelId;
    });
    if (next && local) useProviderStore.getState().updateSettings(local, { voices: next });
    setLooks((n) => n + 1);
  };

  const clearAll = async () => {
    setAsking(null);
    await useModelStore.getState().deleteAllModels();
    // The clear wipes the whole model storage, the helper models' included: their own stores are told.
    await useSegmentationStore.getState().refresh();
    await useSmartTurnStore.getState().refresh();
    setLooks((n) => n + 1);
  };

  return (
    <div className="models-page">
      <div className="models-page__summary">
        <span>{anything
          ? t('models.page.summary', '{{count}} downloaded, {{size}} in all', { count, size: formatBytes(storageMb * MB) })
          : t('models.storageEmpty', 'No models downloaded yet.')}</span>
        <span className="models-page__links">
          <button type="button" className="models-page__link" disabled={locked} onClick={() => setImporting((v) => !v)}>
            {t('models.page.import', 'Import a model from files')}
          </button>
          {anything && (
            <button type="button" className="models-page__link" disabled={locked} onClick={() => setAsking('clear-all')}>{t('models.clearAll', 'Clear all')}</button>
          )}
        </span>
      </div>
      {asking === 'clear-all' && (
        <div className="models-page__confirm">
          <Confirm question={t('models.confirmClearAll', 'Delete all models?')} locked={locked}
            notes={[t('engineUi.clearAllKeepsPicks', 'Your selections are remembered and return when models are downloaded again.')]}
            onNo={() => setAsking(null)} onYes={() => void clearAll()} />
        </div>
      )}
      {importing && (
        <select className="select-dropdown models-page__import" defaultValue="" aria-label={t('engineUi.importChooseModel', 'Choose a model to import')}
          onChange={(e) => setImportTarget(getManifestEntry(e.target.value) ?? null)}>
          <option value="" disabled>{t('engineUi.importChooseModel', 'Choose a model to import')}</option>
          {MODEL_MANIFEST.filter((m) => !m.isCloudModel && SESSION_TYPES.has(m.type)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      )}

      <Group title={t('models.page.sessionTitle', 'Models for the session (the “This device” service)')}
        hint={t('models.page.sessionHint', 'Stages set to “This device” in “Languages and line-up” use the models downloaded here.')}>
        {stageGroups.map(({ stage, shown, rest, others }) => {
          const title = t(TAGS[stage][0], TAGS[stage][1]);
          const hidden = rest.length + others.length;
          return (
            <div key={stage} className="models-stage" role="group" aria-label={title}>
              <h4 className="models-stage__title">{title}</h4>
              <div className="models-stage__shown">{shown.map(sessionRow)}</div>
              {hidden > 0 && (
                <div className="models-group__fold">
                  <button type="button" className="models-group__fold-btn" aria-expanded={Boolean(open[stage])}
                    onClick={() => setOpen((o) => ({ ...o, [stage]: !o[stage] }))}>
                    {open[stage] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {t('models.page.more', '{{count}} more', { count: hidden })}
                  </button>
                  {open[stage] && (
                    <>
                      {rest.map(sessionRow)}
                      {others.length > 0 && (
                        <p className="models-stage__caption">{t('models.page.otherLanguages', 'Models for other languages ({{count}})', { count: others.length })}</p>
                      )}
                      {others.map(sessionRow)}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Group>

      <Group title={t('models.page.helpersTitle', 'Helper models')} hint={t('models.page.helpersHint', 'Small models that belong to no one stage.')}>
        {turnEntry && (
          <ModelRow tag={t('models.page.tag.turn', 'Turn end')} name={turnEntry.name}
            meta={<><span>{t('models.page.turnMeta', 'Tells when you have finished speaking; turned on in the speech mode options')}</span><span>{formatBytes(SMART_TURN_TOTAL_BYTES)}</span></>}
            state={helperState(turnPhase, turnBytes, SMART_TURN_TOTAL_BYTES)}
            confirm={asking === 'turn' && (
              <Confirm question={t('engineUi.deleteConfirm', 'Delete {{name}}?', { name: turnEntry.name })} locked={locked}
                onNo={() => setAsking(null)} onYes={() => { setAsking(null); void useSmartTurnStore.getState().remove(); }} />
            )}>
            {turnPhase === 'ready' ? deleteButton('turn', turnEntry.name) : turnPhase !== 'downloading' && (
              <button type="button" className="model-row__btn model-row__btn--primary" disabled={locked} aria-label={`${t('models.page.download', 'Download')}: ${turnEntry.name}`} onClick={() => void useSmartTurnStore.getState().download()}>{t('models.page.download', 'Download')}</button>
            )}
          </ModelRow>
        )}
        <ModelRow tag={t('models.page.tag.punctuation', 'Sentences and punctuation')} name={packName}
          meta={<><span>{t('models.page.packMeta', 'Splits the text into sentences; the three download together')}</span><span>{formatBytes(PACK_TOTAL_BYTES)}</span></>}
          state={helperState(packPhase, packBytes, PACK_TOTAL_BYTES)}
          confirm={asking === 'pack' && (
            <Confirm question={t('engineUi.deleteConfirm', 'Delete {{name}}?', { name: packName })} locked={locked}
              onNo={() => setAsking(null)} onYes={() => { setAsking(null); void useSegmentationStore.getState().deleteModels(); }} />
          )}>
          {packPhase === 'ready' ? deleteButton('pack', packName)
            : packPhase === 'downloading' ? <button type="button" className="model-row__btn" aria-label={`${t('models.cancel', 'Cancel')}: ${packName}`} onClick={() => useSegmentationStore.getState().cancel()}>{t('models.cancel', 'Cancel')}</button>
              : <button type="button" className="model-row__btn model-row__btn--primary" disabled={locked} aria-label={`${t('models.page.download', 'Download')}: ${packName}`} onClick={() => void useSegmentationStore.getState().download()}>{t('models.page.download', 'Download')}</button>}
        </ModelRow>
        <ModelRow tag={t('models.page.tag.readings', 'Readings')} name={dictName}
          meta={dictStored === false
            ? <span>{t('models.readingsDictionaryNotStored', 'Downloaded when Japanese readings are turned on in Display.')}</span>
            : <><span>{t('models.page.dictMeta', 'Shows Japanese readings; turned on in Display')}</span><span>{formatBytes(DICTIONARY_BYTES)}</span></>}
          state={dictStored === true ? t('models.downloaded', 'Downloaded') : undefined}
          confirm={asking === 'dict' && (
            <Confirm question={t('engineUi.deleteConfirm', 'Delete {{name}}?', { name: dictName })} locked={locked}
              onNo={() => setAsking(null)} onYes={() => { setAsking(null); deleteDictionary().then(() => setLooks((n) => n + 1), () => setLooks((n) => n + 1)); }} />
          )}>
          {dictStored === true && deleteButton('dict', dictName)}
        </ModelRow>
      </Group>

      {imported.length > 0 && (
        <Group title={t('models.page.voicesTitle', 'Imported voices')} hint={t('models.page.voicesHint', 'Supertonic voice files you imported.')}>
          {imported.map((v) => (
            <ModelRow key={v.id} tag={t('models.page.tag.voice', 'Voice')} name={v.name}
              meta={<><span>{t('models.page.importedOn', 'Imported {{date}}', { date: new Date(v.importedAt).toLocaleDateString() })}</span><span>{formatBytes(v.jsonData.size)}</span></>}
              confirm={asking === `voice-${v.id}` && (
                <Confirm question={t('engineUi.deleteConfirm', 'Delete {{name}}?', { name: v.name })} locked={locked}
                  onNo={() => setAsking(null)} onYes={() => { setAsking(null); void deleteVoice(v); }} />
              )}>
              {deleteButton(`voice-${v.id}`, v.name)}
            </ModelRow>
          ))}
        </Group>
      )}

      {importTarget && (
        <ModelImportModal isOpen modelId={importTarget.id} modelName={importTarget.name}
          onClose={() => { setImportTarget(null); setImporting(false); }} />
      )}
    </div>
  );
}
