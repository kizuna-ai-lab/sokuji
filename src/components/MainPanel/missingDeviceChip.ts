/**
 * "Which device is missing" — the chip's copy, as a pure function.
 *
 * The mode picker marks the offending segment with an amber inset ring
 * (`.mode-picker__segment--warn`). That ring is a COLOUR-ONLY signal: it names
 * nothing, and all three existing explanations need an interaction to reach —
 * the segment's native `title`, the blocked Start button's reason (both
 * `modePicker.missingDevice`, via sessionStartGate), and the device popover's
 * amber "Not selected" row. None of them appear on focus or on touch, so a
 * keyboard or touch user had no route to the ring's meaning at all.
 *
 * This module is the resting-state answer: what is missing, in words, beside
 * the ring that is already pointing at it.
 *
 * Kept dependency-free (no React, no i18n) so it can be unit-tested without a
 * rendering harness — the same rule splitDegraded.ts follows.
 */
import type { DeviceScope } from './sessionStartGate';

/** A key plus the English text that renders if i18n has not loaded. */
export interface LocalizedString {
  key: string;
  defaultValue: string;
}

/**
 * The one string this feature adds to all 32 catalogs.
 *
 * A template rather than three finished sentences: the device NAMES below
 * already ship everywhere, so interpolating them keeps the locale cost at one
 * key while still letting each language choose its own word order — "{{device}}
 * not selected" in English, "未选择{{device}}" in Chinese.
 */
export const MISSING_DEVICE_CHIP_LABEL: LocalizedString = {
  key: 'modePicker.missingDeviceChip',
  defaultValue: '{{device}} not selected',
};

/**
 * The remedy line, reused verbatim from the mode picker's own tooltip.
 *
 * "Click to configure devices" rather than `modePicker.missingDevice`
 * ("Configure devices for this mode to start."): the chip IS the click target
 * — it opens the same device popover the active segment does — so this is the
 * sentence that describes what actually happens.
 */
export const MISSING_DEVICE_CHIP_HINT: LocalizedString = {
  key: 'modePicker.configureDevices',
  defaultValue: 'Click to configure devices.',
};

const MIC: LocalizedString = { key: 'modePicker.deviceMic', defaultValue: 'Microphone' };
const PARTICIPANT_AUDIO: LocalizedString = {
  key: 'modePicker.deviceParticipantAudio',
  defaultValue: "Other's audio",
};

/**
 * The device(s) a scope is short of, named with the popover's own row labels
 * so the chip and the popover it opens use the same words.
 *
 * Only 'speaker' is reachable today: MainPanel's `missingDeviceForMode` sets
 * `hasParticipant = participantInScope`, which is unconditionally true, so its
 * 'participant' and 'both' branches cannot fire. They are covered anyway
 * because the scope type admits them — a chip that renders a blank where a
 * device name belongs is a worse failure than two unused entries.
 */
export const MISSING_DEVICE_NAMES: Record<DeviceScope, LocalizedString[]> = {
  speaker: [MIC],
  participant: [PARTICIPANT_AUDIO],
  both: [MIC, PARTICIPANT_AUDIO],
};

/** Just enough of i18next's `t` to resolve a key with an English fallback. */
export type TranslateWithDefault = (
  key: string,
  defaultValue: string,
  values?: Record<string, string>,
) => string;

export interface MissingDeviceChipText {
  /** Short text on the chip itself, naming what is missing. */
  label: string;
  /** Hover text: the label, a blank line, then the remedy. */
  title: string;
}

/**
 * Compose the chip's visible label and its hover explanation.
 *
 * Cause first, remedy second, separated by a blank line — the same shape
 * splitDegradedChipText uses, and for the same reason: a native `title` is one
 * unstyled blob, and the blank line is what lets it read as two thoughts.
 */
export function missingDeviceChipText(
  scope: DeviceScope,
  translate: TranslateWithDefault,
): MissingDeviceChipText {
  const device = MISSING_DEVICE_NAMES[scope]
    .map(name => translate(name.key, name.defaultValue))
    .join(' + ');
  const label = translate(MISSING_DEVICE_CHIP_LABEL.key, MISSING_DEVICE_CHIP_LABEL.defaultValue, { device });
  return {
    label,
    title: label + '\n\n' + translate(MISSING_DEVICE_CHIP_HINT.key, MISSING_DEVICE_CHIP_HINT.defaultValue),
  };
}
