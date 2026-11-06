import type { NetworkType } from '../lib/session/reconnectEvents';
import type { NetworkPort } from '../lib/session/ports';

/** `navigator.connection` is not in every browser (nor in lib.dom): read it defensively. */
function connectionType(): NetworkType {
  const type = (navigator as unknown as { connection?: { type?: string } }).connection?.type;
  return type === 'wifi' || type === 'cellular' || type === 'ethernet' ? type : 'unknown';
}

/** The page's network, for the runner's reconnects: the type at a drop, and a retry at once when the network returns. */
export function createBrowserNetwork(): NetworkPort {
  return {
    online: () => navigator.onLine,
    type: connectionType,
    onOnline: (fn) => {
      window.addEventListener('online', fn);
      return () => window.removeEventListener('online', fn);
    },
  };
}
