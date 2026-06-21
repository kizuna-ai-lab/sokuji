import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalNativeSettings } from '../../../stores/settingsStore';
import { requiredNativeModels } from '../../../lib/local-inference/native/nativeCatalog';
import {
  useNativeModelStore,
  useNativeModelStatuses,
  useNativeModelProgress,
} from '../../../stores/nativeModelStore';

/** A short display name for a (possibly long repo) native model id. */
function shortName(id: string): string {
  if (id === 'qwen') return 'Qwen LLM';
  return id.split('/').pop() || id;
}

/**
 * Model download/management for LOCAL_NATIVE — lists the models the current
 * stage selection requires, with cache status, a Download button, and per-file
 * progress. Models live in the sidecar's HF cache (server-side).
 */
export const NativeModelManagementSection: React.FC = () => {
  const { t } = useTranslation();
  const settings = useLocalNativeSettings();
  const statuses = useNativeModelStatuses();
  const progress = useNativeModelProgress();
  const refresh = useNativeModelStore((s) => s.refresh);
  const download = useNativeModelStore((s) => s.download);

  const models = requiredNativeModels(
    settings.asrModel, settings.translationModel, settings.ttsModel,
    settings.sourceLanguage, settings.targetLanguage,
  );
  const key = models.join('|');

  useEffect(() => { refresh(models); /* eslint-disable-next-line */ }, [key]);

  return (
    <div className="settings-section">
      <h2>{t('providers.local_native.models', 'Models')}</h2>
      {models.map((m) => {
        const status = statuses[m] || 'absent';
        const p = progress[m];
        return (
          <div className="setting-item" key={m}>
            <div className="setting-label" style={{ wordBreak: 'break-all' }}>{shortName(m)}</div>
            {status === 'ready' ? (
              <span className="setting-value" style={{ color: '#10a37f' }}>✓ {t('common.ready', 'Ready')}</span>
            ) : status === 'downloading' ? (
              <span className="setting-value">
                {p && p.total > 0 ? `${Math.round((p.downloaded / p.total) * 100)}% (${p.downloaded}/${p.total})` : t('common.downloading', 'Downloading…')}
              </span>
            ) : (
              <button type="button" className="select-dropdown" onClick={() => download(m)}>
                {t('common.download', 'Download')}
              </button>
            )}
          </div>
        );
      })}
      <div className="setting-item">
        <span className="setting-value" style={{ opacity: 0.7, fontSize: 12 }}>
          {t('providers.local_native.modelsHint', 'Models download into the local sidecar cache. The provider is usable once all are Ready.')}
        </span>
      </div>
    </div>
  );
};
