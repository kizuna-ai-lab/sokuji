/** A WebSocket client for the engine's tests: open (with an Origin, if any), and read the next JSON message or the close. */
import WebSocket from 'ws';

export function openWs(port: number, opts: { origin?: string } = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { ...(opts.origin ? { origin: opts.origin } : {}), maxPayload: 128 * 1024 * 1024 });
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`Unexpected server response: ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

/** The next text message, parsed. */
export function nextJson(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return;
      ws.off('message', onMessage);
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    };
    ws.on('message', onMessage);
  });
}

/** The close code the server ends the socket with. */
export function nextClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
}
