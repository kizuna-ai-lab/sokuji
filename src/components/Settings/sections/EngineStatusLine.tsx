import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNativeModelStore, useNativeEngineInfo } from '../../../stores/nativeModelStore';

/** Proper-noun/acronym backend labels — kept out of i18n like the app's other
 *  technical tokens (framework names, GB/MB, tok/s — see nativeCatalog.ts's
 *  FRAMEWORK_LABELS and formatRtf/formatTps). */
const BACKEND_LABELS: Record<string, string> = { vulkan: 'Vulkan', metal: 'Metal', cpu: 'CPU' };
const backendLabel = (kind: string): string => BACKEND_LABELS[kind] ?? kind;

type DotKind = 'ready' | 'hollow' | 'warn' | 'error';

/**
 * One-line engine status shown under the provider picker for local_native:
 * the installed engine (sidecar bundle) version, the sokuji-native runtime
 * version, its backend and device once ready, or an actionable one-liner for
 * every other bundle/sidecar state.
 *
 * Reads the native store directly — the same shape as its sibling
 * EngineSection — so the caller only decides WHETHER to mount it
 * (`provider === Provider.LOCAL_NATIVE`); it takes no props.
 *
 * Display only, in both UI modes (decision 2026-09-03): the Engine page is
 * one tab away in Advanced mode and Simple mode has no reusable route to
 * it, so a click target on a status line bought nothing — the actionable
 * states name what to do, and the Engine page's own controls do it.
 */
export const EngineStatusLine: React.FC = () => {
  const { t } = useTranslation();
  const {
    bundleStatus, bundleVersion, bundleRequiredVersion, bundleDevVenv,
    bundleProgress, bundlePhase, sidecarStatus,
  } = useNativeModelStore();
  const engineInfo = useNativeEngineInfo();

  // 'unsupported' (no bundle SKU for this platform) still has an engine to
  // report when a dev venv runs the sidecar — that is exactly the
  // unsupported-SKU development path; without the venv there is nothing.
  if (bundleStatus === 'unknown' || (bundleStatus === 'unsupported' && !bundleDevVenv)) return null;

  const devVenvLabel = t('engine.status.devVenv', 'dev venv');
  const version = bundleVersion ?? (bundleDevVenv ? devVenvLabel : '');

  let dot: DotKind;
  let text: string;
  let device: string | null = null;

  if (sidecarStatus === 'ready') {
    dot = 'ready';
    const parts = [t('engine.ready', 'Engine {{version}}', { version })];
    if (engineInfo?.nativeVersion) {
      parts.push(t('engine.status.native', 'native {{version}}', { version: engineInfo.nativeVersion }));
    }
    const backend = engineInfo?.preferredDevice?.kind ? backendLabel(engineInfo.preferredDevice.kind) : null;
    if (backend) parts.push(backend);
    const rawDevice = engineInfo?.preferredDevice?.description ?? null;
    // Omit a device string that just repeats the backend label (e.g. a CPU
    // lane whose "device" is literally "CPU") — nothing new to say.
    device = rawDevice && rawDevice !== backend ? rawDevice : null;
    text = parts.join(' · ');
  } else if (sidecarStatus === 'starting' || (sidecarStatus === 'idle' && (bundleStatus === 'ready' || bundleDevVenv))) {
    dot = 'hollow';
    text = t('engine.status.starting', 'Engine {{version}} · starting…', { version });
  } else if (bundleStatus === 'absent') {
    dot = 'hollow';
    text = t('engine.status.notInstalled', 'Engine not installed');
  } else if (bundleStatus === 'mismatch') {
    dot = 'warn';
    text = t('engine.status.updateRequired', 'Engine update {{from}} → {{to}}',
      { from: bundleVersion, to: bundleRequiredVersion });
  } else if (bundleStatus === 'paused') {
    dot = 'warn';
    text = t('engine.status.downloadPaused', 'Download paused');
  } else if (bundleStatus === 'installing') {
    dot = 'warn';
    if (bundlePhase === 'verify') {
      text = t('engine.verifying', 'Verifying…');
    } else if (bundlePhase === 'extract') {
      text = t('engine.extracting', 'Extracting…');
    } else {
      const pct = bundleProgress.total > 0
        ? Math.min(100, Math.round((bundleProgress.downloaded / bundleProgress.total) * 100))
        : 0;
      text = t('engine.status.downloading', 'Downloading {{pct}}%', { pct });
    }
  } else if (bundleStatus === 'error') {
    dot = 'error';
    text = t('engine.status.error', 'Engine error');
  } else if (sidecarStatus === 'unavailable') {
    dot = 'error';
    text = t('engine.status.unavailable', 'Engine unavailable');
  } else {
    // No other combination is informative or actionable yet (e.g. bundle
    // 'ready' with a sidecarStatus this component doesn't otherwise handle).
    return null;
  }

  const fullText = device ? `${text} · ${device}` : text;
  // Hover-only addition (see the component doc comment) — the visible text
  // stays exactly `fullText`; this sentence only ever reaches the title
  // attribute's tooltip.
  const preferredHint = t('engine.status.preferredHint',
    'Preferred device for this machine; per-stage overrides live in the model library.');

  return (
    <div className="engine-status-line" title={`${fullText}\n${preferredHint}`}>
      <span className={`engine-status-line__dot engine-status-line__dot--${dot}`} />
      <span className="engine-status-line__text">
        {text}
        {device && <span className="engine-status-line__device"> · {device}</span>}
      </span>
    </div>
  );
};

export default EngineStatusLine;
