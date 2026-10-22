/**
 * A `FrameSource` an adapter test hands an adapter in place of a screen
 * capture (spec 2026-10-22 §4). The test emits frames, loses the source and
 * brings it back, and reads how many subscribers are still attached. A
 * subscriber that joins while `inHand` is set gets that frame at once, reason
 * 'first', as the capture layer does for a window already on screen. Test-only,
 * like the rest of the kit.
 */
import type { FrameReason, FrameSource } from '../adapter';

export interface FakeFrameSource extends FrameSource {
  /** Hands every subscriber a frame; `reason` defaults to 'changed'. */
  emit(jpeg?: Uint8Array, reason?: FrameReason): void;
  lose(): void;
  back(): void;
  /** Subscribers still attached. */
  readonly subscribers: number;
}

export const JPEG_A = new Uint8Array([0xff, 0xd8, 0x01]);
export const JPEG_B = new Uint8Array([0xff, 0xd8, 0x02]);

interface Subscriber {
  onFrame: (jpeg: Uint8Array, reason: FrameReason) => void;
  onLost: () => void;
  onBack: () => void;
}

/** `inHand`: a frame handed to each subscriber at subscribe, reason 'first'. */
export function fakeFrameSource(o: { name?: string; kind?: FrameSource['kind']; inHand?: Uint8Array | null } = {}): FakeFrameSource {
  const subscribers = new Set<Subscriber>();
  const inHand = o.inHand ?? null;
  // A snapshot, so a subscriber that detaches inside its own callback does not skip the rest.
  const each = (fn: (s: Subscriber) => void) => {
    for (const s of [...subscribers]) fn(s);
  };
  return {
    name: o.name ?? 'Fake window',
    kind: o.kind ?? 'window',
    subscribe(onFrame, onLost, onBack) {
      const s: Subscriber = { onFrame, onLost, onBack };
      subscribers.add(s);
      if (inHand) onFrame(inHand, 'first');
      return () => { subscribers.delete(s); };
    },
    emit(jpeg = JPEG_B, reason = 'changed') {
      each((s) => s.onFrame(jpeg, reason));
    },
    lose() {
      each((s) => s.onLost());
    },
    back() {
      each((s) => s.onBack());
    },
    get subscribers() {
      return subscribers.size;
    },
  };
}
