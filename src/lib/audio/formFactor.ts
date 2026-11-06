// What the system says an output device is (headphones or speakers) and how it
// is connected. The answer is diagnostic only: nothing changes behavior on it.

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
  // Same-named devices cannot be told apart by label, but the browser's default
  // entry is the system default, which settles it when the names agree.
  if (isBrowserDefault) {
    const d = onlyDefault(native);
    if (d && d.label.trim() === wanted) return answer(d);
  }
  const matches = native.filter((d) => d.label.trim() === wanted);
  return matches.length === 1 ? answer(matches[0]) : { ...UNKNOWN_FORM };
}
