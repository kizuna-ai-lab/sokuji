/**
 * The header seam for tests (Stage 2 OpenAI Live, choice 1): the real seam —
 * its gate per rule key, its bound, its ending — over a registrar the test
 * drives, handing out `FakeSocket`s from the sockets it is given (a
 * lifecycle run's, whose sends it watches). It records every rule installed
 * and whether it was cleared since, and can refuse or hold the next
 * registration: a platform that would not take it, a round trip still in
 * flight. Test-only, like the rest of the kit.
 */
import { createHeaderSocket, type HeaderRule, type OpenHeaderSocket } from '../headerSocket';
import { fakeSockets, type FakeSockets } from './fakeSocket';

export interface Registration extends HeaderRule {
  cleared: boolean;
}

export interface FakeHeaderSockets {
  readonly open: OpenHeaderSocket;
  readonly sockets: FakeSockets;
  /** Every rule installed, in order, and whether it was cleared since. */
  readonly registrations: readonly Registration[];
  /** The next registration fails, as a platform that would not install it. */
  refuseNext(reason?: string): void;
  /** The next registration waits until the returned function is called. */
  holdNext(): () => void;
  /** The next clear's answer waits until the returned function is called (or never, if it is not). */
  holdNextClear(): () => void;
}

/** `requestIds` are handed out, one per open, as the platform's answer to the clear; none when they run out. */
export function fakeHeaderSockets(sockets: FakeSockets = fakeSockets(), o: { requestIds?: string[] } = {}): FakeHeaderSockets {
  const registrations: Registration[] = [];
  const requestIds = [...(o.requestIds ?? [])];
  /** Sockets that opened, and clears answered so far: a clear after an open is the one that answers. */
  let opens = 0;
  let answered = 0;
  let refusal: string | null = null;
  let held: Promise<void> | null = null;
  let heldClear: Promise<void> | null = null;
  const open = createHeaderSocket(
    () => ({
      set(rule) {
        const registration: Registration = { host: rule.host, path: rule.path, set: { ...rule.set }, remove: [...rule.remove], cleared: false };
        registrations.push(registration);
        const reason = refusal;
        refusal = null;
        if (reason !== null) return Promise.reject(new Error(reason));
        const wait = held ?? Promise.resolve();
        held = null;
        return wait;
      },
      async clear(rule) {
        const wait = heldClear;
        heldClear = null;
        await wait;
        for (let i = registrations.length - 1; i >= 0; i--) {
          const r = registrations[i];
          if (r.host === rule.host && r.path === rule.path && !r.cleared) {
            r.cleared = true;
            // Only a clear that follows an open consumes an id: a refused, dropped or aborted attempt leaves the next one's.
            const afterOpen = opens > answered;
            if (afterOpen) answered++;
            const requestId = afterOpen ? requestIds.shift() : undefined;
            return requestId === undefined ? undefined : { requestId };
          }
        }
      },
    }),
    (url) => {
      const socket = sockets.create(url);
      socket.addEventListener('open', () => { opens++; }, { once: true });
      return socket;
    },
  );
  return {
    open,
    sockets,
    registrations,
    refuseNext: (reason = 'the platform would not take the rule') => { refusal = reason; },
    holdNextClear() {
      let release!: () => void;
      heldClear = new Promise<void>((resolve) => { release = resolve; });
      return () => release();
    },
    holdNext() {
      let release!: () => void;
      held = new Promise<void>((resolve) => { release = resolve; });
      return () => release();
    },
  };
}
