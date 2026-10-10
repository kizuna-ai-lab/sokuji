/**
 * The entries of an outlet's device select and the value it shows (spec
 * 2026-10-10 §1.3): follow-default three ways, then every device three
 * ways — the whole device, its left channel, its right channel. A mono
 * device still gets the channel entries: nothing knows an output's channel
 * count, and a panned clip on a mono device plays quieter, never silent.
 */
import { isChannelChoice, resolveChannel, type ChannelChoice, type OutletChoice, type OutletName } from './outlets';

export interface OutletEntry {
  device: string | null;
  channel: ChannelChoice;
  /** The device's label; absent on the follow-default entries. */
  label?: string;
}

export function outletEntries(devices: readonly { deviceId: string; label: string }[]): OutletEntry[] {
  const entries: OutletEntry[] = [
    { device: null, channel: 'auto' },
    { device: null, channel: 'left' },
    { device: null, channel: 'right' },
  ];
  for (const d of devices) {
    // Before the microphone permission a browser lists devices with an empty id: nothing to target, and its values would collide with follow-default's.
    if (d.deviceId === '') continue;
    for (const channel of ['both', 'left', 'right'] as const) entries.push({ device: d.deviceId, channel, label: d.label });
  }
  return entries;
}

/** `<device id>#<channel>`; the follow-default entries have an empty id. */
export function entryValue(entry: Pick<OutletEntry, 'device' | 'channel'>): string {
  return `${entry.device ?? ''}#${entry.channel}`;
}

export function parseEntryValue(value: string): { device: string | null; channel: ChannelChoice } {
  const at = value.lastIndexOf('#');
  if (at < 0) return { device: null, channel: 'auto' };
  const device = value.slice(0, at);
  const channel = value.slice(at + 1);
  return { device: device === '' ? null : device, channel: isChannelChoice(channel) ? channel : 'auto' };
}

/**
 * Which entry shows for a stored choice. An auto channel shows as the plain
 * follow-default entry in a meeting (where auto is centred) and as the ear it
 * resolves to face-to-face; a device on auto shows its resolved channel, so
 * the value is always an entry the list has. With `devices` given, a stored
 * device that is no longer listed reads as follow-default with its channel
 * kept, which is what the routing resolves. A centred pick belongs to its
 * device, so without one it is void and reads as auto.
 */
export function outletSelectValue(
  name: OutletName,
  stored: OutletChoice,
  faceToFace: boolean,
  devices?: readonly { deviceId: string }[],
): string {
  const gone = devices !== undefined && stored.device !== null && !devices.some((d) => d.deviceId === stored.device);
  const device = gone ? null : stored.device;
  const choice: OutletChoice = { device, channel: device === null && stored.channel === 'both' ? 'auto' : stored.channel };
  if (choice.device === null && choice.channel === 'auto' && !faceToFace) return entryValue(choice);
  return entryValue({ device: choice.device, channel: resolveChannel(name, choice.channel, faceToFace) });
}
