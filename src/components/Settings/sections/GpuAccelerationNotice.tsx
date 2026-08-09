import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, X } from 'lucide-react';
import { useWebGPUAvailable, useWebGPUSoftwareOnly } from '../../../stores/modelStore';
import { isElectron, isLinux } from '../../../utils/environment';
import './GpuAccelerationNotice.scss';

const DISMISSED_KEY = 'sokuji:gpu-acceleration-notice-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    // Restricted storage: better to stay quiet than to nag on every render.
    return true;
  }
}

/**
 * Warns once when local inference is about to run without GPU acceleration.
 *
 * The common cause on Linux is a Wayland session: Chromium cannot enable Vulkan
 * there, which leaves Dawn without a hardware backend, so WebGPU silently falls
 * back to the SwiftShader CPU rasteriser (issue #389). That failure is invisible
 * -- models still load and still run, just far slower -- so it is worth saying
 * out loud, along with the one-line remedy.
 */
export const GpuAccelerationNotice: React.FC = () => {
  const { t } = useTranslation();
  const webgpuAvailable = useWebGPUAvailable();
  const softwareOnly = useWebGPUSoftwareOnly();
  const [dismissed, setDismissed] = useState(readDismissed);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch { /* not persisting is survivable; it reappears next launch */ }
  }, []);

  if (dismissed) return null;
  if (webgpuAvailable && !softwareOnly) return null;

  // Only Linux has the --ozone-platform=x11 remedy; elsewhere state the fact
  // without pretending there is a fix.
  const showRemedy = isElectron() && isLinux();

  return (
    <div className="gpu-acceleration-notice" role="status">
      <AlertTriangle className="gpu-acceleration-notice__icon" size={16} aria-hidden="true" />
      <div className="gpu-acceleration-notice__body">
        <p className="gpu-acceleration-notice__title">
          {softwareOnly
            ? t('models.gpuSoftwareOnly', 'GPU acceleration unavailable — running on the CPU')
            : t('models.gpuUnavailable', 'GPU acceleration unavailable')}
        </p>
        <p className="gpu-acceleration-notice__text">
          {t('models.gpuSlowWarning', 'Local models will still work, but transcription and translation will be noticeably slower.')}
        </p>
        {showRemedy && (
          <p className="gpu-acceleration-notice__text">
            {t(
              'models.gpuWaylandRemedy',
              'On a Wayland session, Chromium cannot use the GPU for this. Starting Sokuji with --ozone-platform=x11 restores acceleration.',
            )}
          </p>
        )}
      </div>
      <button
        type="button"
        className="gpu-acceleration-notice__dismiss"
        onClick={dismiss}
        aria-label={t('common.dismiss', 'Dismiss')}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
};

export default GpuAccelerationNotice;
