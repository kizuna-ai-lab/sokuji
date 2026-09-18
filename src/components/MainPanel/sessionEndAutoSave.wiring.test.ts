import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Wiring of the session-end auto-save and the desktop close hold in
 * MainPanel.tsx, asserted on its source text.
 *
 * sessionEndAutoSave.test.ts replays disconnectConversation's steps around the
 * real teardown and merge, but a replay cannot notice the component drifting
 * from it: deleting the save call, or reading `wasActive` after the session is
 * marked inactive (which makes it always false, so nothing is ever saved),
 * passed every test. There is no React rendering harness here (see
 * sessionIdLifecycle.consistency.test.ts for the same method), so what is
 * pinned is the text that makes the runtime behaviour correct.
 */

const SOURCE = readFileSync(join(__dirname, 'MainPanel.tsx'), 'utf8');

/** Index of `needle` in `text`; fails (rather than returning -1) when it is gone. */
const at = (text: string, needle: string | RegExp) => {
  const i = typeof needle === 'string' ? text.indexOf(needle) : text.search(needle);
  expect(i, `expected to find ${needle}`).toBeGreaterThan(-1);
  return i;
};

/** disconnectConversation's body: from its declaration to its dependency list. */
const DISCONNECT = (() => {
  const start = at(SOURCE, 'const disconnectConversation = useCallback(');
  const end = at(SOURCE.slice(start), '}, [refetchAll');
  return SOURCE.slice(start, start + end);
})();

/** connectConversation's body: from its declaration to its dependency list. */
const CONNECT = (() => {
  const start = at(SOURCE, 'const connectConversation = useCallback(');
  const end = at(SOURCE.slice(start), '\n  }, [');
  return SOURCE.slice(start, start + end);
})();

// Statements, not the comments that mention them.
const MARK_INACTIVE = /^\s*setIsSessionActive\(false\);/m;
const READ_WAS_ACTIVE = 'const wasActive = useSessionStore.getState().isSessionActive';
const SAVE = 'await autoSaveTranscript(';
const BUSY_TRUE = "invoke('app:session-busy', true)";
const BUSY_FALSE = "invoke('app:session-busy', false)";

describe('session-end auto-save wiring (MainPanel.tsx)', () => {
  it('reads wasActive before the teardown marks the session inactive', () => {
    // Read after, it is always false and no session is ever saved.
    expect(at(DISCONNECT, READ_WAS_ACTIVE)).toBeLessThan(at(DISCONNECT, MARK_INACTIVE));
  });

  it('saves from disconnectConversation, only for a session that ran with auto-save on', () => {
    // The setting gates the whole block, not only the save: with auto-save
    // off, no snapshot is built and no provider settings are read.
    const gate = at(DISCONNECT, 'if (wasActive && useSettingsStore.getState().autoSaveOnStop) {');
    expect(gate).toBeLessThan(at(DISCONNECT, 'getCurrentProviderSettings()'));
    expect(gate).toBeLessThan(at(DISCONNECT, 'mergeConversationItems('));
    expect(gate).toBeLessThan(at(DISCONNECT, SAVE));
  });

  it('keeps the rows a client drops in disconnect(), in both legs', () => {
    // PalabraAIClient empties its items there: read only afterwards, the file
    // is empty and the stopped view blanks.
    const speakerBefore = at(DISCONNECT, 'const speakerBefore = client.getConversationItems();');
    expect(speakerBefore).toBeLessThan(at(DISCONNECT, 'await client.disconnect();'));
    expect(DISCONNECT).toMatch(
      /speakerFinal = keepRowsDroppedOnDisconnect\(speakerBefore, client\.getConversationItems\(\)\);\s*setItems\(speakerFinal\);/,
    );
    const participantBefore = at(DISCONNECT, 'const participantBefore = participantClient.getConversationItems();');
    expect(participantBefore).toBeLessThan(at(DISCONNECT, 'await participantClient.disconnect();'));
    expect(DISCONNECT).toContain(
      'participantFinal = keepRowsDroppedOnDisconnect(participantBefore, participantClient.getConversationItems());',
    );
  });

  it('releases the participant client even when its disconnect() throws', () => {
    // Kept in the ref, it outlives its session: the next speaker-only
    // session tears it down again on Stop and saves its old lines.
    const leg = DISCONNECT.slice(at(DISCONNECT, 'participant: async () => {'), at(DISCONNECT, 'afterBothLegs:'));
    const cleanup = at(leg, '} finally {');
    expect(cleanup).toBeGreaterThan(at(leg, 'await participantClient.disconnect();'));
    const capture = at(leg, 'participantFinal = keepRowsDroppedOnDisconnect(');
    const reset = at(leg, 'participantClient.reset();');
    expect(cleanup).toBeLessThan(capture);
    expect(capture).toBeLessThan(reset);
    // Compare-and-clear: a Start inside the disconnect() gap owns the ref by now.
    expect(at(leg, 'if (participantClientRef.current === participantClient) participantClientRef.current = null;'))
      .toBeGreaterThan(reset);
    expect(leg).not.toMatch(/^\s*participantClientRef\.current = null;/m);
  });

  it('saves before publishing the teardown as done', () => {
    // A queued Start and the close handshake both wait on that promise; the
    // file must be written by then.
    expect(at(DISCONNECT, SAVE)).toBeLessThan(at(DISCONNECT, 'markDisconnectDone();'));
  });
});

describe('desktop close hold wiring (MainPanel.tsx)', () => {
  it('reports busy in the same step that marks the session active', () => {
    // An effect on isSessionActive runs only after the render commits; a
    // close landing before it would pass through with busy still false.
    const i = at(SOURCE, BUSY_TRUE);
    expect(SOURCE.lastIndexOf(BUSY_TRUE)).toBe(i);
    const line = SOURCE.slice(SOURCE.lastIndexOf('\n', i) + 1, SOURCE.indexOf('\n', i));
    expect(line.trim()).toBe(`if (isElectron()) void window.electron.${BUSY_TRUE};`);
    const activate = at(CONNECT, 'setIsSessionActive(true);');
    const busyLine = CONNECT.lastIndexOf('\n', at(CONNECT, BUSY_TRUE));
    expect(activate).toBeLessThan(busyLine);
    // Comments aside, at most a couple of statements between them, none awaiting.
    const code = CONNECT.slice(activate, busyLine).split('\n').slice(1)
      .map(l => l.trim()).filter(l => l && !l.startsWith('//'));
    expect(code.length).toBeLessThanOrEqual(2);
    expect(code.join('\n')).not.toMatch(/\bawait\b/);
  });

  it('reports not-busy only at the end of the teardown, after the save', () => {
    // isSessionActive turns false as the teardown begins; the hold must cover
    // the teardown and its save, so not-busy is sent from the outer finally.
    expect(DISCONNECT).not.toContain(BUSY_TRUE);
    const busyFalse = at(DISCONNECT, BUSY_FALSE);
    expect(busyFalse).toBeGreaterThan(at(DISCONNECT, SAVE));
    expect(busyFalse).toBeGreaterThan(DISCONNECT.lastIndexOf('} finally {'));
    expect(SOURCE.indexOf(BUSY_FALSE)).toBe(SOURCE.lastIndexOf(BUSY_FALSE));
  });
});
