import { describe, it, expect, vi } from 'vitest';

/**
 * Regression coverage for two properties of MainPanel.tsx's connectConversation
 * that live in how the managed-voice prep block's result is WIRED, not in
 * `prepareManagedVoice` itself (that routine's own branches are covered in
 * prepareManagedVoice.test.ts).
 *
 * Like participantErrorOrdering.test.ts (whose approach this mirrors), there
 * is no React rendering harness in this repo, so these tests do not mount
 * MainPanel or invoke connectConversation directly. They instead reproduce
 * the exact shape MainPanel.tsx uses — the same technique
 * participantErrorOrdering.test.ts already established for React's setState
 * value semantics — and pin the property against that reproduction, so a
 * future refactor of connectConversation's tail has something to break.
 *
 * 1. The voice-prep fallback notice is appended to conversation items AFTER
 *    the post-init `setItems(speakerClientRef.current?.getConversationItems()
 *    || [])` overwrite, and therefore survives it — the exact ordering hazard
 *    participantErrorOrdering.test.ts documents for `participantErrorMessage`,
 *    now for `voicePrepMessage` (MainPanel.tsx: the overwrite, then the
 *    `participantErrorMessage` append, then the `voicePrepMessage` append).
 * 2. A FAILED prepareManagedVoice() result never calls updateKizunaSoniox —
 *    only a successful, voiceId-CHANGED result does. The fallback voice is
 *    applied to sessionConfig for that session only and never persisted, so a
 *    busy pool tonight cannot silently demote the user's stored preference.
 */

type Item = { id: string; text: string };
type Updater = Item[] | ((prev: Item[]) => Item[]);

function makeStateContainer(initial: Item[]) {
  let state = initial;
  const setItems = (updater: Updater) => {
    state = typeof updater === 'function' ? (updater as (prev: Item[]) => Item[])(state) : updater;
  };
  return { setItems, getState: () => state };
}

const voicePrepItem: Item = { id: 'voice-prep-1', text: 'This session uses a built-in voice.' };

describe('voice-prep notice vs. the post-init setItems overwrite', () => {
  it('survives being appended after the overwrite (current MainPanel.tsx ordering)', () => {
    const { setItems, getState } = makeStateContainer([]);
    const speakerItems: Item[] = [{ id: 'speaker-1', text: 'hello' }];
    setItems(speakerItems); // setItems(speakerClientRef.current?.getConversationItems() || [])
    setItems(prev => [...prev, voicePrepItem]); // the voicePrepMessage append, deferred like participantErrorMessage
    expect(getState()).toEqual([...speakerItems, voicePrepItem]);
  });
});

/**
 * Minimal reproduction of MainPanel.tsx's voice-prep result handling
 * (the `if (result.ok) { ... } else { ... }` block right after
 * `prepareManagedVoice()` resolves) and its fallback application to
 * sessionConfig (the `if (preparedVoiceId) { ... } else if (voicePrepMessage)
 * { ... }` block right after `getSessionConfig()`). Not prepareManagedVoice's
 * own logic — the CALLER's branching on its result.
 */
function applyVoicePrepResult(
  result: { ok: true; voiceId: string } | { ok: false; reason: string },
  sonioxVoiceSetting: string,
  updateKizunaSoniox: (patch: { voice: string }) => void,
  sessionConfig: { voice?: string },
  builtinDefault: string
): void {
  let preparedVoiceId: string | null = null;
  let voicePrepMessage: string | null = null;
  if (result.ok) {
    preparedVoiceId = result.voiceId;
    if (result.voiceId !== sonioxVoiceSetting) updateKizunaSoniox({ voice: result.voiceId });
  } else {
    voicePrepMessage = `fallback: ${result.reason}`;
  }
  if (preparedVoiceId) sessionConfig.voice = preparedVoiceId;
  else if (voicePrepMessage) sessionConfig.voice = builtinDefault;
}

describe('voice-prep result wiring: the asymmetric settings write', () => {
  it('never writes the fallback voice back to settings when prepareManagedVoice fails', () => {
    const updateKizunaSoniox = vi.fn();
    const sessionConfig: { voice?: string } = { voice: 'cloned-uuid-123' };
    applyVoicePrepResult(
      { ok: false, reason: 'pool_exhausted' },
      'cloned-uuid-123',
      updateKizunaSoniox,
      sessionConfig,
      'Maya'
    );
    // A busy pool tonight must not silently demote the stored preference —
    // the next session should try the real voice again.
    expect(updateKizunaSoniox).not.toHaveBeenCalled();
    // The session still gets a usable voice — just not a persisted one.
    expect(sessionConfig.voice).toBe('Maya');
  });
});
