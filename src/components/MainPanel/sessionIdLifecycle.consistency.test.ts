import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The session id must exist before anything can report against it.
 *
 * `translation_completed` shipped `session_id: ''` on 15866 of 15866 events over
 * seven days. Two causes, at opposite ends of a session:
 *
 *  - START: the id was minted by the analytics effect, which runs only after
 *    `isSessionActive` flips — by then the clients exist, their handlers have
 *    been handed over, and recording has started.
 *  - END: teardown flips `isSessionActive` false, the effect clears the store's
 *    `sessionId`, and only THEN is `client.disconnect()` awaited — so a final
 *    completion flushed during disconnect had nothing to read.
 *
 * Neither is observable from a unit test: this is a 4000-line component with no
 * rendering harness here, and the defect is an ordering property between a React
 * effect and an object React does not own. What can be pinned is the ordering
 * itself, which is what makes the runtime behaviour correct.
 */

const SOURCE = readFileSync(join(__dirname, 'MainPanel.tsx'), 'utf8');
const indexOf = (needle: string) => {
  const at = SOURCE.indexOf(needle);
  // Guards the guard: without this, a needle that no longer exists yields -1,
  // `slice(-1)` returns the file's last character, and every negative assertion
  // below passes on it — so deleting the code under test would go unnoticed.
  expect(at, `expected to find ${needle}`).toBeGreaterThan(-1);
  return at;
};
const lineOf = (needle: string) => SOURCE.slice(0, indexOf(needle)).split('\n').length;
const sliceFrom = (needle: string) => SOURCE.slice(indexOf(needle));

describe('session id lifecycle', () => {
  it('mints the id before any client handler is registered', () => {
    // Handlers capture the id at hand-off; a mint after this point would capture
    // null, which is the bug this ordering exists to prevent.
    expect(lineOf('sessionIdRef.current = uuidv4();')).toBeLessThan(lineOf('await setupClientListeners();'));
  });

  it('mints the id before recording can start', () => {
    // Audio accepted before the id exists could complete a translation with
    // nothing to attribute it to.
    expect(lineOf('sessionIdRef.current = uuidv4();')).toBeLessThan(lineOf('startRecording('));
  });

  it('mints the id before the session is marked active', () => {
    expect(lineOf('sessionIdRef.current = uuidv4();')).toBeLessThan(lineOf('setIsSessionActive(true);'));
  });

  it('captures the owning id in the listener rather than reading a live one', () => {
    // A live read reports whichever session is current, which for a callback
    // arriving after teardown is the wrong one — or none.
    expect(SOURCE).toMatch(/const ownerSessionId = sessionIdRef\.current;/);
    expect(SOURCE).toMatch(/session_id: ownerSessionId \?\? '',/);
  });

  it('does not read the store for translation_completed', () => {
    const event = sliceFrom("trackEvent('translation_completed'");
    const call = event.slice(0, event.indexOf('});'));
    expect(call).not.toMatch(/useSessionStore\.getState\(\)/);
    expect(call).not.toMatch(/session_id:\s*sessionId\b/);
  });

  it('lets the analytics effect adopt the minted id instead of replacing it', () => {
    // Minting a second id there would leave the clients' handlers reporting an
    // id that matches no translation_session_start.
    expect(SOURCE).toMatch(/const newSessionId = sessionIdRef\.current \?\? uuidv4\(\);/);
  });

  it('keeps the id after the session ends, so a disconnect flush still resolves', () => {
    // `setSessionId(null)` clears the STORE. Clearing the ref alongside it would
    // reopen the teardown hole.
    const end = sliceFrom('setSessionId(null);');
    expect(end.slice(0, 400)).not.toMatch(/sessionIdRef\.current = null/);
  });
});
