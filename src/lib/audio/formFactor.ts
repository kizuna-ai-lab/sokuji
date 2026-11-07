// What the system says an output device is (headphones or speakers) and how it
// is connected. The answer is diagnostic only: nothing changes behavior on it.
import { useMemo } from 'react';
// A cycle (the store lists devices through devices.ts, which matches here): safe
// because neither module reads the other at load, only inside functions.
import useAudioStore, { type AudioDevice } from '../../stores/audioStore';

export type FormFactor = 'headphones' | 'speakers' | 'unknown';
export type Transport = 'builtin' | 'usb' | 'bluetooth' | 'hdmi' | 'virtual' | 'unknown';

export interface OutputDeviceInfo {
  label: string;
  isDefault: boolean;
  formFactor: FormFactor;
  transport: Transport;
  raw: Record<string, string | number | boolean>;
}

export type NativeOutputsResult =
  | { ok: true; devices: OutputDeviceInfo[] }
  | { ok: false; reason: string };

export interface OutputForm {
  formFactor: FormFactor;
  transport: Transport;
}

export const UNKNOWN_FORM: OutputForm = { formFactor: 'unknown', transport: 'unknown' };

const LABEL_PREFIX = /^(?:Default|Communications) - /;

/** Chromium prefixes the default and communications entries; the system's own label has none. */
export function cleanOutputLabel(label: string): string {
  return label.trim().replace(LABEL_PREFIX, '');
}

// Copies, so a caller can never mutate the cached native list through an answer.
const answer = (d: OutputDeviceInfo): OutputForm => ({ formFactor: d.formFactor, transport: d.transport });

function onlyDefault(native: readonly OutputDeviceInfo[]): OutputDeviceInfo | undefined {
  const defaults = native.filter((d) => d.isDefault);
  return defaults.length === 1 ? defaults[0] : undefined;
}

/**
 * Match a browser output device to the system's list. Only an exact cleaned label
 * counts, and only when exactly one native device carries it: two identical
 * headsets stay unknown rather than being picked by order.
 */
export function matchOutputForm(
  sinkDeviceId: string | undefined,
  browserLabel: string | undefined,
  native: readonly OutputDeviceInfo[] | null,
  labelsKnown: boolean,
  isBrowserDefault = false,
): OutputForm {
  if (!native) return { ...UNKNOWN_FORM };

  // The default sink needs no label: it is whatever the system says is default.
  if (sinkDeviceId === undefined || sinkDeviceId === '' || sinkDeviceId === 'default') {
    const d = onlyDefault(native);
    return d ? answer(d) : { ...UNKNOWN_FORM };
  }
  if (sinkDeviceId === 'communications') return { ...UNKNOWN_FORM };
  if (!labelsKnown || browserLabel === undefined) return { ...UNKNOWN_FORM };

  const wanted = cleanOutputLabel(browserLabel);
  // A blank label names no device, though it equals any native one left empty.
  if (wanted === '') return { ...UNKNOWN_FORM };
  // Same-named devices cannot be told apart by label, but the browser's default
  // entry is the system default, which settles it when the names agree.
  if (isBrowserDefault) {
    const d = onlyDefault(native);
    if (d && d.label.trim() === wanted) return answer(d);
  }
  const matches = native.filter((d) => d.label.trim() === wanted);
  return matches.length === 1 ? answer(matches[0]) : { ...UNKNOWN_FORM };
}

/**
 * The browser's output labels that equal no system device's label: the sign that
 * Chromium names outputs differently than the helpers build them (a suffix, a
 * rewrite), which reads as `unknown` everywhere. Cleaned like `matchOutputForm`,
 * each named once. A label two system devices share is not counted: it matched,
 * only not uniquely. Nothing without the system list or the browser's labels.
 */
export function unmatchedOutputLabels(
  browserLabels: readonly string[],
  native: readonly OutputDeviceInfo[] | null,
  labelsKnown: boolean,
): string[] {
  if (!native || !labelsKnown) return [];
  const known = new Set(native.map((d) => d.label.trim()));
  const out: string[] = [];
  for (const raw of browserLabels) {
    const wanted = cleanOutputLabel(raw);
    if (wanted !== '' && !known.has(wanted) && !out.includes(wanted)) out.push(wanted);
  }
  return out;
}

type FormSource = { nativeFormsCurrent: boolean; defaultOutputForm: OutputForm; audioMonitorDevices: readonly AudioDevice[] };

function formIn(state: FormSource, sinkDevice: string | undefined): OutputForm {
  // Stale is unknown (spec 2026-11-05 §6): the lists keep the last join until a
  // listing lands, and a failed one changes nothing, so they can predate the last event.
  if (!state.nativeFormsCurrent) return UNKNOWN_FORM;
  // The browser default never reaches the device list (devices.ts drops it): its answer is kept on its own.
  if (sinkDevice === undefined || sinkDevice === '' || sinkDevice === 'default') return state.defaultOutputForm;
  if (sinkDevice === 'communications') return UNKNOWN_FORM;
  const device = state.audioMonitorDevices.find((d) => d.deviceId === sinkDevice);
  return device?.formFactor && device.transport ? { formFactor: device.formFactor, transport: device.transport } : UNKNOWN_FORM;
}

/** An outlet's resolved sink, looked up in the device list: unknown while nothing is known, and while the system's answer is stale. */
export function getOutputFormFactor(sinkDevice?: string): OutputForm {
  const { formFactor, transport } = formIn(useAudioStore.getState(), sinkDevice);
  return { formFactor, transport };
}

/** `getOutputFormFactor`, following the store; the same object while the answer holds. */
export function useOutputFormFactor(sinkDevice?: string): OutputForm {
  // Two plain selections: a selector returning a fresh object never equals its last result.
  const formFactor = useAudioStore((s) => formIn(s, sinkDevice).formFactor);
  const transport = useAudioStore((s) => formIn(s, sinkDevice).transport);
  return useMemo(() => ({ formFactor, transport }), [formFactor, transport]);
}
