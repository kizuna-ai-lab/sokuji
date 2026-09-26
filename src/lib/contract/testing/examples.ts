/**
 * Two adapters the kit's tests drive (F9). `createEchoAdapter` is the
 * shape a Stage 2 socket adapter takes: a config that carries its socket
 * factory, events from the server's frames, `degraded` for a frame that
 * will not parse, `closed` on a close it did not ask for, and a start that
 * rejects when its signal aborts while it opens, or when its connection is
 * refused before `open` (an `AdapterStartError` with a notice code, and no
 * `closed`: no session began). `createBrokenAdapter` breaks the rules the
 * scenarios must catch. Test-only: nothing but a test imports it.
 */
import { AdapterStartError, type Adapter, type AdapterSession } from '../adapter';
import { describeCause } from '../../diagnostics/describeCause';

export interface EchoConfig { openSocket(url: string): WebSocket }

export function createEchoAdapter(): Adapter<EchoConfig, { key: string }> {
  return {
    start(request, events) {
      return new Promise<AdapterSession>((resolve, reject) => {
        if (request.signal.aborted) return reject(request.signal.reason ?? new Error('aborted'));
        const ws = request.config.openSocket('wss://echo.test/translate');
        let opened = false;
        let ended = false;
        let nextRef = 1;
        const onAbort = () => { ended = true; ws.close(); reject(request.signal.reason ?? new Error('aborted')); };
        request.signal.addEventListener('abort', onAbort, { once: true });
        const exchange = (source: string, translation: string) => {
          const src = nextRef++;
          const tr = nextRef++;
          const origin = `o${src}`;
          events.segmentOpened({ ref: src, side: 'source', origin });
          events.segmentText({ ref: src, text: source });
          events.segmentClosed({ ref: src, origin });
          events.segmentOpened({ ref: tr, side: 'translation', origin });
          events.segmentText({ ref: tr, text: translation });
          if (request.context.speech) events.audio({ ref: tr, range: [0, translation.length], pcm: new Int16Array(2400) });
          events.segmentClosed({ ref: tr, origin });
        };
        const session: AdapterSession = {
          info: { transport: 'websocket' },
          appendAudio: (pcm) => { if (!ended) ws.send(pcm.buffer); },
          appendText: (text) => { if (!ended) exchange(text, `«${text}»`); },
          beginTurn() {},
          endTurn: () => { if (!ended) ws.send(JSON.stringify({ type: 'commit' })); },
          cancelTurn: () => { if (!ended) ws.send(JSON.stringify({ type: 'clear' })); },
          // Closes the socket before any await (the AdapterSession rule on `stop`).
          async stop() { ended = true; ws.close(1000); },
        };
        ws.onopen = () => {
          opened = true;
          request.signal.removeEventListener('abort', onAbort);
          ws.send(JSON.stringify({ type: 'session.start', source: request.context.direction.source }));
          events.frame({ direction: 'out', type: 'session.start' });
          resolve(session);
        };
        ws.onmessage = (ev) => {
          if (ended) return;
          let msg: { source: string; translation: string };
          try {
            msg = JSON.parse(String(ev.data)) as { source: string; translation: string };
          } catch (cause) {
            // One bad frame degrades the session; it does not end it.
            events.degraded({ code: 'parse_error', message: `A frame from the echo server would not parse: ${describeCause(cause)}`, cause });
            return;
          }
          exchange(msg.source, msg.translation);
        };
        // A failed connection fires `error` and then `close`: the close decides.
        ws.onclose = (ev) => {
          if (ended) return;
          ended = true;
          if (!opened) {
            // Refused before `open`: the start rejects, with the notice the user reads. The echo
            // server closes 4001 on a key it refuses; anything else is the connection failing.
            request.signal.removeEventListener('abort', onAbort);
            const code = ev.code === 4001 ? 'auth' : 'network';
            reject(new AdapterStartError(`The echo server closed the connection before it opened (${ev.code}).`, code, { detail: ev.reason || `close code ${ev.code}` }));
            return;
          }
          events.closed({ reason: `the socket closed (${ev.code})` });
        };
      });
    },
  };
}

/**
 * Breaks the rules the scenarios check: `start` resolves at once whatever
 * its signal or its server says, the session produces nothing for the
 * server's frames nor says when its server went away, and `stop()` emits
 * afterwards.
 */
export function createBrokenAdapter(): Adapter<Record<string, never>, Record<string, never>> {
  return {
    async start(request, events) {
      return {
        info: { transport: 'broken' },
        appendAudio() {},
        appendText() {},
        beginTurn() {},
        endTurn() {},
        cancelTurn() {},
        async stop() {
          request.clock.setTimeout(() => events.segmentOpened({ ref: 99, side: 'source' }), 100);
        },
      };
    },
  };
}
