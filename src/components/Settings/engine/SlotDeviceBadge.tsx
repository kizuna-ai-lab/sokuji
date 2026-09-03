import React, { useLayoutEffect, useRef } from 'react';
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

/** The CSS custom property the badge writes its rendered width into, on the
 *  slot control that hosts it; Engine.scss pads the select by it so the
 *  model name never runs under the badge, in any locale. */
export const BADGE_WIDTH_VAR = '--slot-badge-w';

/**
 * Read-only per-slot compute-device badge, drawn inside the slot's select box
 * on the Engine page (B'2 decision, 2026-09-03, amended the same day: in-box
 * placement won over click-to-open, so the badge is purely informational and
 * clicks fall through to the select). Two words: the SETTING in bold (Auto /
 * CPU / GPU) plus the ACTUAL resolved device once known (Vulkan / Metal /
 * CPU); amber-outlined when the user pinned a device. The control itself
 * lives only in the model library.
 */
export const SlotDeviceBadge: React.FC<{ stage: Stage }> = ({ stage }) => {
  const { t } = useTranslation();
  const settings = useLocalNativeSettings();
  const catalog = useNativeCatalog();
  // Hook rules require all three selectors to be called unconditionally;
  // only the one matching `stage` is used below.
  const asrResolved = useNativeAsrResolved();
  const translationResolved = useNativeTranslationResolved();
  const ttsResolved = useNativeTtsResolved();
  const ref = useRef<HTMLSpanElement>(null);

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

  // Publish the badge's width to the host control (see BADGE_WIDTH_VAR).
  // Re-measured whenever the words change and, where the platform has a
  // ResizeObserver (not jsdom), whenever a font swap resizes the text.
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const apply = () => host.style.setProperty(BADGE_WIDTH_VAR, `${el.offsetWidth}px`);
    apply();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      host.style.removeProperty(BADGE_WIDTH_VAR);
    };
  }, [settingLabel, actualLabel]);

  return (
    <span ref={ref} className={`slot-device-badge${pinned ? ' slot-device-badge--pinned' : ''}`}>
      <b>{settingLabel}</b>
      {actualLabel && <span>{actualLabel}</span>}
    </span>
  );
};

export default SlotDeviceBadge;
