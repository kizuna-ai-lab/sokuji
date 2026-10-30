// Where the sound goes and which microphones there are, from the audio
// library's device list. Categories are the platforms' own names (iOS port
// types, Android device types), matched by the words they contain.
export type Route = 'headphones' | 'bluetooth' | 'speaker' | 'other';

interface Device {
  id: string;
  name: string;
  category: string;
}

const has = (category: string, ...words: string[]) => {
  const c = category.toLowerCase();
  return words.some((w) => c.includes(w));
};

export function routeOf(info: { currentOutputs: readonly Device[] }): Route {
  const out = info.currentOutputs[0];
  if (!out) return 'speaker';
  if (has(out.category, 'bluetooth', 'a2dp', 'hfp', 'ble')) return 'bluetooth';
  if (has(out.category, 'headphone', 'headset', 'wired', 'lineout', 'usb')) return 'headphones';
  if (has(out.category, 'speaker', 'builtin')) return 'speaker';
  return 'other';
}

export type MicrophoneKind = 'builtin' | 'wired' | 'usb';

/** The inputs a user may pick: the phone's own first, then wired and USB; never a Bluetooth one (R14). */
export function microphoneChoices(info: { availableInputs: readonly Device[] }): Array<{ id: string; kind: MicrophoneKind; name: string }> {
  const kindOf = (d: Device): MicrophoneKind | null => {
    if (has(d.category, 'bluetooth', 'hfp', 'ble', 'a2dp')) return null;
    if (has(d.category, 'usb')) return 'usb';
    if (has(d.category, 'wired', 'headset', 'headphone', 'linein')) return 'wired';
    if (has(d.category, 'builtin', 'built-in', 'microphone', 'mic')) return 'builtin';
    return null;
  };
  const order: MicrophoneKind[] = ['builtin', 'wired', 'usb'];
  return info.availableInputs
    .map((d) => ({ id: d.id, kind: kindOf(d), name: d.name }))
    .filter((d): d is { id: string; kind: MicrophoneKind; name: string } => d.kind !== null)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
