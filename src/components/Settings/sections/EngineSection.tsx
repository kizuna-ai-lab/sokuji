import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, Download, X, RefreshCw, Trash2, CheckCircle, AlertTriangle } from 'lucide-react';
import { useNativeModelStore } from '../../../stores/nativeModelStore';
import './EngineSection.scss';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const fmtGB = (n: number | null | undefined) => (n == null ? null : `${(n / GB).toFixed(1)} GB`);
const fmtMB = (n: number) => `${Math.round(n / MB)} MB`;

/**
 * Engine (sidecar bundle) install/update card — the gate above the native
 * model list (distribution spec S10). One surface for every engine state:
 * unsupported / absent / mismatch / paused / installing (phased) / error / ready.
 */
export const EngineSection: React.FC<{ isSessionActive?: boolean }> = ({ isSessionActive = false }) => {
  const { t } = useTranslation();
  const {
    bundleStatus, bundleSku, bundleVersion, bundleRequiredVersion, bundleProgress,
    bundlePhase, bundleError, bundleStagedBytes, bundleGpuName, bundleDevVenv,
    bundleSize, bundleInstalledSize,
    refreshBundle, installBundle, cancelBundle, removeBundle, fetchBundleEntry,
  } = useNativeModelStore();

  useEffect(() => { void refreshBundle(); }, [refreshBundle]);
  // Peek the manifest for exact sizes once the card knows it must offer a download.
  useEffect(() => {
    if ((bundleStatus === 'absent' || bundleStatus === 'mismatch' || bundleStatus === 'paused')
        && bundleSize == null) {
      void fetchBundleEntry();
    }
  }, [bundleStatus, bundleSize, fetchBundleEntry]);

  if (bundleStatus === 'unknown') return null;

  if (bundleStatus === 'unsupported') {
    return (
      <div className="engine-section">
        <div className="engine-section__row engine-section__row--muted">
          <AlertTriangle size={14} />
          <span>{t('engine.unsupported', 'Local inference is not supported on this device')}</span>
        </div>
      </div>
    );
  }

  // Dev checkout with a venv and no bundle: quiet note, no download nag —
  // the venv launch path keeps working (spec S2 exemption).
  if (bundleDevVenv && (bundleStatus === 'absent' || bundleStatus === 'paused')) {
    return (
      <div className="engine-section">
        <div className="engine-section__row engine-section__row--muted">
          <Cpu size={14} />
          <span>{t('engine.devMode', 'Development mode · local venv')}</span>
        </div>
      </div>
    );
  }

  const sizeLabel = fmtGB(bundleSize) ?? t('engine.sizeUnknown', 'size unavailable offline');
  const pct = bundleProgress.total > 0
    ? Math.min(100, Math.round((bundleProgress.downloaded / bundleProgress.total) * 100))
    : 0;

  return (
    <div className="engine-section">
      <div className="engine-section__header">
        <Cpu size={16} />
        <span className="engine-section__title">{t('engine.title', 'Inference Engine')}</span>
        {bundleStatus === 'ready' && (
          <span className="engine-section__version">
            <CheckCircle size={14} /> {t('engine.ready', 'Engine {{version}}', { version: bundleVersion })}
          </span>
        )}
      </div>

      {bundleGpuName && (
        <div className="engine-section__row">
          {t('engine.detected', 'Detected: {{gpu}}', { gpu: bundleGpuName })}
        </div>
      )}

      {bundleStatus === 'absent' && (
        <>
          <div className="engine-section__row">
            {t('engine.package', 'Engine package: {{sku}} · {{size}}', { sku: bundleSku, size: sizeLabel })}
          </div>
          <button className="engine-section__action" disabled={isSessionActive}
                  onClick={() => void installBundle()}>
            <Download size={14} /> {t('engine.download', 'Download engine')}
          </button>
        </>
      )}

      {bundleStatus === 'mismatch' && (
        <>
          <div className="engine-section__row engine-section__row--warn">
            <AlertTriangle size={14} />
            {t('engine.updateRequired', 'Engine update required ({{from}} → {{to}})',
              { from: bundleVersion, to: bundleRequiredVersion })}
          </div>
          <button className="engine-section__action" disabled={isSessionActive}
                  onClick={() => void installBundle()}>
            <RefreshCw size={14} /> {t('engine.update', 'Update engine')}
            {bundleSize != null ? ` · ${fmtGB(bundleSize)}` : ''}
          </button>
        </>
      )}

      {bundleStatus === 'paused' && (
        <>
          <div className="engine-section__row">
            {t('engine.paused', 'Paused · {{done}} downloaded', { done: fmtMB(bundleStagedBytes) })}
          </div>
          <button className="engine-section__action" onClick={() => void installBundle()}>
            <Download size={14} /> {t('engine.resume', 'Resume download')}
          </button>
        </>
      )}

      {bundleStatus === 'installing' && (
        <>
          <div className="engine-section__row">
            {bundlePhase === 'verify' ? t('engine.verifying', 'Verifying…')
              : bundlePhase === 'extract' ? t('engine.extracting', 'Extracting…')
              : t('engine.downloading', '{{done}} / {{total}} · {{pct}}%', {
                  done: fmtMB(bundleProgress.downloaded),
                  total: fmtGB(bundleProgress.total) ?? '…',
                  pct,
                })}
          </div>
          <div className="engine-section__bar">
            <div
              className={`engine-section__bar-fill${bundlePhase !== 'download' ? ' engine-section__bar-fill--busy' : ''}`}
              style={bundlePhase === 'download' ? { width: `${pct}%` } : undefined}
            />
          </div>
          {bundlePhase === 'download' && (
            <button className="engine-section__action engine-section__action--secondary"
                    onClick={() => void cancelBundle()}>
              <X size={14} /> {t('engine.cancel', 'Cancel')}
            </button>
          )}
        </>
      )}

      {bundleStatus === 'error' && (
        <>
          <div className="engine-section__row engine-section__row--error">{bundleError}</div>
          <button className="engine-section__action" onClick={() => void installBundle()}>
            <RefreshCw size={14} /> {t('engine.retry', 'Retry')}
          </button>
        </>
      )}

      {bundleStatus === 'ready' && (
        <div className="engine-section__row engine-section__row--muted">
          {bundleInstalledSize != null && (
            <span>{t('engine.onDisk', '{{size}} on disk', { size: fmtGB(bundleInstalledSize) })}</span>
          )}
          <button
            className="engine-section__link" disabled={isSessionActive}
            onClick={() => {
              if (window.confirm(t('engine.removeConfirm', 'Remove the engine and free disk space?'))) {
                void removeBundle();
              }
            }}
          >
            <Trash2 size={13} /> {t('engine.remove', 'Remove engine')}
          </button>
        </div>
      )}
    </div>
  );
};
