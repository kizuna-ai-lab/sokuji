import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalNativeSettings } from '../../../stores/settingsStore';
import { useNativeAsrResolved, useNativeCatalog, useNativeTranslationResolved, useNativeTtsResolved } from '../../../stores/nativeModelStore';
import { gpuTierAvailable } from '../../../lib/local-inference/native/nativeCatalog';
import type { Stage } from '../../../lib/local-inference/selection/types';
import './Engine.scss';

type DeviceSetting = 'auto' | 'cpu' | 'gpu';

const SETTING_LABEL_KEY: Record<DeviceSetting, [string, string]> = {
  auto: ['models.deviceAuto', 'Auto'],
  cpu: ['models.deviceCpu', 'CPU'],
  gpu: ['models.deviceGpu', 'GPU'],
};

const ACTUAL_DEVICE_LABEL: Record<string, string> = {
  vulkan: 'Vulkan',
  metal: 'Metal',
  cpu: 'CPU',
};

/** Maps a resolved device kind to its display label — known kinds get their
 *  proper name (Vulkan/Metal/CPU), anything else is capitalised as-is so a
 *  future backend never renders blank. */
const actualDeviceLabel = (kind: string): string =>
  ACTUAL_DEVICE_LABEL[kind] ?? (kind.length ? kind[0].toUpperCase() + kind.slice(1) : kind);

/**
 * Read-only per-slot compute-device badge on the Engine page (B'2 decision,
 * 2026-09-03): the SETTING in bold (Auto / CPU / GPU) plus the ACTUAL
 * resolved device once known (Vulkan / Metal / CPU), amber-outlined when the
 * user pinned a device. The control itself lives only in the model library —
 * clicking this badge opens that slot's library page via `onOpen`.
 */
export const SlotDeviceBadge: React.FC<{ stage: Stage; onOpen: () => void }> = ({ stage, onOpen }) => {
  const { t } = useTranslation();
  const settings = useLocalNativeSettings();
  const catalog = useNativeCatalog();
  // Hook rules require all three selectors to be called unconditionally;
  // only the one matching `stage` is used below.
  const asrResolved = useNativeAsrResolved();
  const translationResolved = useNativeTranslationResolved();
  const ttsResolved = useNativeTtsResolved();

  const rawSetting: DeviceSetting = stage === 'asr' ? settings.asrDevice
    : stage === 'translation' ? settings.translationDevice
    : settings.ttsDevice;
  // A stale 'gpu' pin on a box with no GPU tier reads as Auto, exactly as
  // NativeDeviceControl shows it in the library.
  const setting: DeviceSetting = rawSetting === 'gpu' && !gpuTierAvailable(catalog) ? 'auto' : rawSetting;
  const resolved = stage === 'asr' ? asrResolved
    : stage === 'translation' ? translationResolved
    : ttsResolved;

  const [settingKey, settingDefault] = SETTING_LABEL_KEY[setting];
  const settingLabel = t(settingKey, settingDefault);
  const actualLabel = resolved ? actualDeviceLabel(resolved.device) : null;
  const pinned = setting !== 'auto';

  const title = t('engineUi.deviceBadgeHint',
    'Compute device: {{setting}}{{actual}} — change it in the library',
    { setting: settingLabel, actual: actualLabel ? ` → ${actualLabel}` : '' });

  return (
    <button
      type="button"
      className={`slot-device-badge${pinned ? ' slot-device-badge--pinned' : ''}`}
      title={title}
      onClick={onOpen}
    >
      <b>{settingLabel}</b>
      {actualLabel && <span>{actualLabel}</span>}
    </button>
  );
};

export default SlotDeviceBadge;
