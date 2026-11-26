// src/components/SettingsPage/NativeModelsGroup.tsx
//
// The native engine's model library, on Models and storage (#578 ruling 27): the engine's own card when it needs an
// action, then each stage's models under the anchors an engine slot's "Browse library…" goes to. It is the body of the
// page's first tab; the page decides whether Local Native is offered at all.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appVoicePreview } from '../../app/voicePreview';
import { VoicePreviewContext } from '../providers/VoicePreviewContext';
import { EngineSection } from '../Settings/sections/EngineSection';
import { NativeModelManagementSection } from '../Settings/sections/NativeModelManagementSection';
import type { NativeEngineSettings } from '../Settings/engine/useNativeEngineAdapter';
import { presentProviders } from '../../providers/registry';
import { useProviderStore } from '../../stores/providerStore';
import { useNativeModelStatuses, useNativeModelStore } from '../../stores/nativeModelStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { LOCAL_NATIVE_DEFAULTS, type LocalNativeSettings } from '../../providers/local_native/settings';
import type { Stage } from '../../lib/local-inference/selection/types';

const STAGES: readonly Stage[] = ['asr', 'translation', 'tts'];
/** The anchor of a stage's native models: `categories.ts` knows it as a navigation target. */
export const nativeAnchor = (stage: Stage) => `native-models-${stage}`;

export function NativeModelsGroup({ locked }: { locked: boolean }) {
  const { t } = useTranslation();
  const native = useMemo(() => presentProviders().find((p) => p.id === 'local_native'), []);
  const entry = useProviderStore((s) => s.entries.local_native);
  useEffect(() => {
    if (native && !entry) void useProviderStore.getState().load(native);
  }, [native, entry]);
  // The library lists what the engine reports, so the engine is started here: nothing else does it for a person who
  // has not chosen the native engine in the line-up (its readiness check starts it only then). Again when the engine
  // finishes installing, which is when its first start can succeed. Both are no-ops while it is running or starting.
  const bundleStatus = useNativeModelStore((s) => s.bundleStatus);
  useEffect(() => {
    if (native) void useNativeModelStore.getState().ensureCatalog();
  }, [native, bundleStatus]);
  // A download finishing only installs the model: using it is the user's choice, made in the line-up, so the page says
  // where, rather than changing a session's configuration for them.
  const statuses = useNativeModelStatuses();
  const before = useRef(statuses);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    const was = before.current;
    before.current = statuses;
    if (Object.keys(statuses).some((id) => was[id] === 'downloading' && statuses[id] === 'ready')) setFinished(true);
  }, [statuses]);
  if (!native) return null;
  const settings = (entry?.settings as LocalNativeSettings | undefined) ?? LOCAL_NATIVE_DEFAULTS;
  const pair = entry?.pair ?? { source: 'en', target: 'ja' };
  const update = (patch: Partial<NativeEngineSettings>) => useProviderStore.getState().updateSettings(native, patch as Partial<LocalNativeSettings>);
  return (
    <VoicePreviewContext.Provider value={appVoicePreview}>
      <EngineSection isSessionActive={locked} />
      {finished && (
        <div className="models-page__notice" role="status">
          <span>{t('models.page.downloadedChoose', 'Downloaded. Choose it in “Languages and line-up” to use it in a session.')}</span>
          <button type="button" className="models-page__link" onClick={() => useSettingsStore.getState().navigateToSettings('lineup')}>
            {t('models.page.goChoose', 'Choose')}
          </button>
          <button type="button" className="models-page__link" onClick={() => setFinished(false)}>{t('models.page.dismiss', 'Dismiss')}</button>
        </div>
      )}
      {STAGES.map((stage) => (
        <NativeModelManagementSection key={stage} stageFilter={stage} anchorId={`${nativeAnchor(stage)}-section`}
          settings={settings} update={update} pair={pair} isSessionActive={locked} />
      ))}
    </VoicePreviewContext.Provider>
  );
}
