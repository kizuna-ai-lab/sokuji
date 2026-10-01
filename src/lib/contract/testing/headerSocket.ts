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
}

export function fakeHeaderSockets(sockets: FakeSockets = fakeSockets()): FakeHeaderSockets {
  const registrations: Registration[] = [];
  let refusal: string | null = null;
  let held: Promise<void> | null = null;
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
      clear(rule) {
        for (let i = registrations.length - 1; i >= 0; i--) {
          const r = registrations[i];
          if (r.host === rule.host && r.path === rule.path && !r.cleared) {
            r.cleared = true;
            return;
          }
        }
      },
    }),
    (url) => sockets.create(url),
  );
  return {
    open,
    sockets,
    registrations,
    refuseNext: (reason = 'the platform would not take the rule') => { refusal = reason; },
    holdNext() {
      let release!: () => void;
      held = new Promise<void>((resolve) => { release = resolve; });
      return () => release();
    },
  };
}
