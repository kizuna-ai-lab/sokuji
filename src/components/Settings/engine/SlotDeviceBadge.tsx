import React, { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
 *  proper name (Vulkan/Metal/CPU); an unknown short token reads as an
 *  acronym (cuda → CUDA), a longer one is capitalised, so a future backend
 *  never renders blank or as "Cuda". */
const actualDeviceLabel = (kind: string): string =>
  ACTUAL_DEVICE_LABEL[kind] ?? (kind.length <= 4 ? kind.toUpperCase() : kind[0].toUpperCase() + kind.slice(1));

/** The CSS custom property the badge writes its rendered width into, on the
 *  slot control that hosts it; Engine.scss pads the select by it so the
 *  model name never runs under the badge, in any locale. */
export const BADGE_WIDTH_VAR = '--slot-badge-w';

/**
 * Read-only per-slot compute-device badge, drawn inside the slot's select box
 * on the Engine page (B'2 decision, 2026-09-03, amended the same day: in-box
 * placement won over click-to-open, so the badge is purely informational and
 * clicks fall through to the select). The control itself lives only in the
 * model library.
 *
 * It shows only what tells something (the owner's pick of 2026-10-02, after
 * a device "Auto" beside the model's "Auto ·" read as the model pick not
 * taking): a pinned SETTING (CPU / GPU), amber-outlined; on Auto, the ACTUAL
 * device a run used (Vulkan / Metal / CPU). On Auto with no run it is not
 * drawn: the room the select reserves for it collapses to zero (no width is
 * published) and the description the select points at is absent.
 *
 * The store's resolved report is one app-global value per stage, written at
 * session start for whichever model loaded and never cleared — so the actual
 * device shows only when that report is about THIS slot's model (`modelId`,
 * the same gate the library card applies).
 *
 * `id` is what the select's aria-describedby points at: sighted users read
 * the badge as part of the control, so assistive tech gets it as the
 * control's description, prefixed with what it is.
 *
 * The setting comes from the host's settings (#578).
 */
export const SlotDeviceBadge: React.FC<{ stage: Stage; modelId: string | null; id: string; setting: DeviceSetting }> = ({ stage, modelId, id, setting: rawSetting }) => {
  const { t } = useTranslation();
  const catalog = useNativeCatalog();
  // Hook rules require all three selectors to be called unconditionally;
  // only the one matching `stage` is used below.
  const asrResolved = useNativeAsrResolved();
  const translationResolved = useNativeTranslationResolved();
  const ttsResolved = useNativeTtsResolved();
  const ref = useRef<HTMLSpanElement>(null);

  // A stale 'gpu' pin on a box with no GPU tier reads as Auto, exactly as
  // NativeDeviceControl shows it in the library.
  const setting: DeviceSetting = rawSetting === 'gpu' && !gpuTierAvailable(catalog) ? 'auto' : rawSetting;
  const resolved = stage === 'asr' ? asrResolved
    : stage === 'translation' ? translationResolved
    : ttsResolved;

  const [settingKey, settingDefault] = SETTING_LABEL_KEY[setting];
  const settingLabel = t(settingKey, settingDefault);
  const pinned = setting !== 'auto';
  const actualLabel = !pinned && resolved && modelId !== null && resolved.model === modelId
    ? actualDeviceLabel(resolved.device)
    : null;

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

  if (!pinned && actualLabel === null) return null;
  return (
    <span ref={ref} id={id} className={`slot-device-badge${pinned ? ' slot-device-badge--pinned' : ''}`}>
      <span className="slot-device-badge__sr">{t('models.computeDevice', 'Compute device')}: </span>
      {pinned
        ? <b className="slot-device-badge__setting">{settingLabel}</b>
        : <span className="slot-device-badge__actual">{actualLabel}</span>}
    </span>
  );
};

export default SlotDeviceBadge;
