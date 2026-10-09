/**
 * The outlets (spec 2026-10-10 §2): where the user hears things, one per
 * spoken row of the Audio page — the other person's ear (`other`,
 * face-to-face only), my own playback of my translation (`me`, "我也听")
 * and the other's translation spoken to me (`them`). Each has a device
 * (null: follow the default playback device) and a channel; `resolveOutlet`
 * turns a stored choice into the sink the graph points at.
 */

export type OutletName = 'other' | 'me' | 'them';
export const OUTLET_NAMES: readonly OutletName[] = ['other', 'me', 'them'];

/** Both channels, or one ear of a stereo device. */
export type Channel = 'both' | 'left' | 'right';
/** A stored choice; `'auto'` resolves per context (ruling 2). */
export type ChannelChoice = Channel | 'auto';

export interface OutletChoice {
  /** A device id, or null: the default playback device. */
  device: string | null;
  channel: ChannelChoice;
}

export const DEFAULT_OUTLET_CHOICE: OutletChoice = { device: null, channel: 'auto' };

/** An outlet resolved: the device to point its element at (undefined: the browser default) and its pan. */
export interface OutletSink {
  device?: string;
  pan?: -1 | 1;
}

/** Who hears what (spec §4): the three switches, gated by mode, source and provider. */
export interface Speak {
  /** My translation is spoken to the other side. */
  other: boolean;
  /** …and also to me. */
  me: boolean;
  /** The other's translation is spoken to me. */
  them: boolean;
}

export function isChannelChoice(value: unknown): value is ChannelChoice {
  return value === 'auto' || value === 'both' || value === 'left' || value === 'right';
}

/** `'auto'`: face-to-face puts the other person in the right ear and me in the left; elsewhere everything is centred. */
export function resolveChannel(name: OutletName, choice: ChannelChoice, faceToFace: boolean): Channel {
  if (choice !== 'auto') return choice;
  if (!faceToFace) return 'both';
  return name === 'other' ? 'right' : name === 'them' ? 'left' : 'both';
}

export function panOf(channel: Channel): -1 | 1 | undefined {
  return channel === 'left' ? -1 : channel === 'right' ? 1 : undefined;
}

export interface OutletContext {
  /** The default playback device's id; undefined when none is known. */
  defaultDevice: string | undefined;
  /** The output devices present right now. */
  present: ReadonlySet<string>;
  faceToFace: boolean;
}

/** A chosen device that is not present follows the default; the stored id is left alone for when it returns. */
export function resolveOutlet(name: OutletName, choice: OutletChoice, context: OutletContext): OutletSink {
  const own = choice.device !== null && context.present.has(choice.device) ? choice.device : undefined;
  const device = own ?? context.defaultDevice;
  const pan = panOf(resolveChannel(name, choice.channel, context.faceToFace));
  return { ...(device !== undefined ? { device } : {}), ...(pan !== undefined ? { pan } : {}) };
}
