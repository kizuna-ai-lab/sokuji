import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, Download, X, RefreshCw, AlertTriangle } from 'lucide-react';
import { useNativeModelStore } from '../../../stores/nativeModelStore';
import './EngineSection.scss';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const fmtGB = (n: number | null | undefined) => (n == null ? null : `${(n / GB).toFixed(1)} GB`);
const fmtMB = (n: number) => `${Math.round(n / MB)} MB`;

/**
 * Engine (sidecar bundle) install/update card — the gate above the native
 * model list (distribution spec S10). Only appears for an ACTIONABLE state:
 * unsupported / absent / mismatch / paused / installing (phased) / error, or a
 * sidecar runtime failure needing retry. A healthy ready engine renders
 * nothing here — its identity/version live in the status line under the
 * provider picker, and its on-disk size + remove affordance live on the
 * Storage page.
 */
export const EngineSection: React.FC<{ isSessionActive?: boolean }> = ({ isSessionActive = false }) => {
  const { t } = useTranslation();
  const {
    bundleStatus, bundleSku, bundleVersion, bundleRequiredVersion, bundleProgress,
    bundlePhase, bundleError, bundleStagedBytes, bundleDevVenv,
    bundleSize, sidecarStatus,
    refreshBundle, installBundle, cancelBundle, fetchBundleEntry,
    retrySidecar,
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

  const sidecarUnavailable = sidecarStatus === 'unavailable';

  // A healthy, ready engine has nothing actionable to show here.
  if (bundleStatus === 'ready' && !sidecarUnavailable) return null;

  // Sidecar-RUNTIME failure is an engine concern, so its error lives inside this
  // card (not as a floating banner in the model area below). Only rendered in
  // states where the engine itself is fine (ready / dev venv) — in absent/
  // mismatch states the card's own CTA is the message.
  const sidecarError = sidecarUnavailable ? (
    <>
      <div className="engine-section__row engine-section__row--error">
        {t('settings.localNativeUnavailable', 'Native engine unavailable — retry in settings')}
      </div>
      <button className="engine-section__action" onClick={() => void retrySidecar()}>
        <RefreshCw size={14} /> {t('common.retry', 'Retry')}
      </button>
    </>
  ) : null;

  // Dev checkout with a venv: the venv launch path keeps working (spec S2
  // exemption) with nothing to show here beyond a runtime error, if any — the
  // status line under the provider picker already carries "dev venv" as the
  // engine's version segment. Checked BEFORE 'unsupported' so an ARM dev box
  // (sku=null, venv built) gets a working dev lane, not a dead end.
  if (bundleDevVenv && (bundleStatus === 'unsupported' || bundleStatus === 'absent' || bundleStatus === 'paused')) {
    if (!sidecarError) return null;
    return <div className="engine-section">{sidecarError}</div>;
  }

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

  const sizeLabel = fmtGB(bundleSize) ?? t('engine.sizeUnknown', 'size unavailable offline');
  const pct = bundleProgress.total > 0
    ? Math.min(100, Math.round((bundleProgress.downloaded / bundleProgress.total) * 100))
    : 0;

  return (
    <div className="engine-section">
      <div className="engine-section__header">
        <Cpu size={16} />
        <span className="engine-section__title">{t('engine.title', 'Inference Engine')}</span>
      </div>

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

      {bundleStatus === 'ready' && sidecarError}
    </div>
  );
};
