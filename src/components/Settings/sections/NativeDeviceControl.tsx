import React from 'react';
import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';
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
 * Per-stage compute-device segmented control (Auto / CPU / GPU) over the
 * value its host hands it (#578). Its only mount is the model library,
 * NMMS's group headers (B'2 decision, 2026-09-03).
 */
export const NativeDeviceControl: React.FC<{ stage: Stage; value: DeviceMode; onChange(device: DeviceMode): void; disabled?: boolean }> = ({ stage, value: rawValue, onChange, disabled = false }) => {
  const { t } = useTranslation();
  const catalog = useNativeCatalog();
  const gpuAvail = gpuTierAvailable(catalog);
  // Coerce a stale 'gpu' to 'auto' for display when no GPU tier is available.
  const deviceValue: DeviceMode = rawValue === 'gpu' && !gpuAvail ? 'auto' : rawValue;
  const opts: Array<[DeviceMode, string]> = [
    ['auto', t('models.deviceAuto', 'Auto')],
    ['cpu', t('models.deviceCpu', 'CPU')],
    ...(gpuAvail ? [['gpu', t('models.deviceGpu', 'GPU')] as [DeviceMode, string]] : []),
  ];
  const [ttKey, ttDefault] = TOOLTIP_KEY[stage];

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
            onClick={() => { if (deviceValue !== mode) onChange(mode); }}
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
