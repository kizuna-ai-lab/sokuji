import type { Source } from '../../session/source';

/**
 * Face-to-face's participant source (spec 2026-10-08, slice 3): the other
 * person speaks into my microphone, so their leg captures nothing of its own.
 * The shared socket hears both through the speaker's source.
 */
export function silentSource(): Source {
  return {
    onPcm: () => () => {},
    onEnded: () => () => {},
    onDegraded: () => () => {},
    stop: () => Promise.resolve(),
  };
}
