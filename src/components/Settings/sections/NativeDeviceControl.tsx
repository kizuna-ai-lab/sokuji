import React from 'react';
import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';
import { useLocalNativeSettings, useUpdateLocalNative } from '../../../stores/settingsStore';
import { useNativeCatalog } from '../../../stores/nativeModelStore';
import { gpuTierAvailable } from '../../../lib/local-inference/native/nativeCatalog';
import type { Stage } from '../../../lib/local-inference/selection/types';
import './NativeDeviceControl.scss';

type DeviceMode = 'auto' | 'cpu' | 'gpu';

const TOOLTIP_KEY: Record<Stage, [string, string]> = {
  asr: ['models.computeDeviceTooltip', 'Which device runs the speech model. Auto picks the fastest available device (GPU when present); CPU works everywhere but is slower for large models; GPU uses Vulkan on Windows and Linux and Metal on Apple silicon.'],
  translation: ['models.computeDeviceTooltipTranslation', 'Which device runs the translation model. Auto picks the fastest available device (GPU when present); CPU works everywhere but is slower for large models; GPU uses Vulkan on Windows and Linux and Metal on Apple silicon.'],
  tts: ['models.computeDeviceTooltipTts', 'Which device runs the speech-synthesis model. Auto picks the fastest available device (GPU when present); CPU works everywhere but is slower for large models; GPU uses Vulkan on Windows and Linux and Metal on Apple silicon.'],
};

/**
 * Per-stage compute-device segmented control (Auto / CPU / GPU), reading and
 * writing asrDevice/translationDevice/ttsDevice on the localNative slice.
 *
 * Extracted (Task 8, Step 3b) from NativeModelManagementSection's group
 * headers so the Engine surface's native adapter can reuse the identical
 * control as a slot's `stageExtras` without the two copies drifting apart —
 * markup here is byte-identical to the inline block it replaced. NMMS keeps
 * rendering it in its group headers when used standalone as the Library.
 */
export const NativeDeviceControl: React.FC<{ stage: Stage; disabled?: boolean }> = ({ stage, disabled = false }) => {
  const { t } = useTranslation();
  const settings = useLocalNativeSettings();
  const update = useUpdateLocalNative();
  const catalog = useNativeCatalog();
  const gpuAvail = gpuTierAvailable(catalog);

  const rawValue = stage === 'asr' ? settings.asrDevice
    : stage === 'translation' ? settings.translationDevice
    : settings.ttsDevice;
  // Coerce a stale 'gpu' to 'auto' for display when no GPU tier is available.
  const deviceValue: DeviceMode = rawValue === 'gpu' && !gpuAvail ? 'auto' : rawValue;
  const opts: Array<[DeviceMode, string]> = [
    ['auto', t('models.deviceAuto', 'Auto')],
    ['cpu', t('models.deviceCpu', 'CPU')],
    ...(gpuAvail ? [['gpu', t('models.deviceGpu', 'GPU')] as [DeviceMode, string]] : []),
  ];
  const [ttKey, ttDefault] = TOOLTIP_KEY[stage];

  const setDevice = (mode: DeviceMode) => {
    if (stage === 'asr') update({ asrDevice: mode });
    else if (stage === 'translation') update({ translationDevice: mode });
    else update({ ttsDevice: mode });
  };

  return (
    <div className="model-group__device-control">
      <div className="model-group__device-label">
        {t('models.computeDevice', 'Compute device')}
        <Tooltip
          content={t(ttKey, ttDefault)}
          position="top"
        >
          <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
        </Tooltip>
      </div>
      <div className="segmented-control">
        {opts.map(([mode, label]) => (
          <button
            key={mode}
            className={`segmented-option ${deviceValue === mode ? 'active' : ''}`}
            onClick={() => { if (deviceValue !== mode) setDevice(mode); }}
            disabled={disabled}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default NativeDeviceControl;
