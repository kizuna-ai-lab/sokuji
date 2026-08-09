import { describe, it, expect } from 'vitest';
import { resolveVoicePrepOutcome } from './prepareManagedVoice';
import type { VoicePrepResult } from './prepareManagedVoice';

/**
 * Regression coverage for two properties of MainPanel.tsx's connectConversation
 * that live in how the managed-voice prep block's result is WIRED, not in
 * `prepareManagedVoice` itself (that routine's own branches are covered in
 * prepareManagedVoice.test.ts).
 *
 * 1. ORDERING: the voice-prep fallback notice is appended to conversation
 *    items AFTER the post-init `setItems(speakerClientRef.current?.getConversationItems()
 *    || [])` overwrite, and therefore survives it — the exact ordering hazard
 *    participantErrorOrdering.test.ts documents for `participantErrorMessage`,
 *    now for `voicePrepMessage`. There is no React rendering harness in this
 *    repo, so — matching that sibling file's technique exactly, INCLUDING its
 *    pre-fix/post-fix contrast pairing — this reproduces React's setState
 *    value semantics rather than invoking MainPanel.tsx directly. The
 *    "pre-fix" case below reproduces the WRONG ordering and asserts the
 *    notice is actually lost, which is what proves the "right ordering"
 *    assertion depends on the ordering rather than being true by construction.
 *
 * 2. THE ASYMMETRIC SETTINGS WRITE: a FAILED prepareManagedVoice() result must
 *    never produce a settings patch — only a successful, voiceId-CHANGED
 *    result may. Unlike the ordering property, this decision is a plain
 *    function with no React or timing involved, so it was extracted out of
 *    connectConversation into `resolveVoicePrepOutcome` (prepareManagedVoice.ts)
 *    specifically so it has an actual production implementation to import and
 *    call here, rather than a hand-transcribed duplicate that could drift from
 *    the real branch without either side noticing. A contrast case shows what
 *    an UNCONDITIONAL write would do, to prove the guard is what's under test.
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
const speakerItems: Item[] = [{ id: 'speaker-1', text: 'hello' }];

describe('voice-prep notice vs. the post-init setItems overwrite', () => {
  describe('pre-fix ordering (append runs BEFORE the overwrite) — reproduces the bug', () => {
    it('the notice is wiped by the speaker\'s just-started list', () => {
      const { setItems, getState } = makeStateContainer([]);
      setItems(prev => [...prev, voicePrepItem]); // append ran first, hypothetically
      setItems(speakerItems); // setItems(speakerClientRef.current?.getConversationItems() || [])
      expect(getState()).toEqual(speakerItems); // notice is gone
    });
  });

  describe('fixed ordering (append runs AFTER the overwrite) — current MainPanel.tsx behavior', () => {
    it('the notice survives being appended after the overwrite', () => {
      const { setItems, getState } = makeStateContainer([]);
      setItems(speakerItems); // setItems(speakerClientRef.current?.getConversationItems() || [])
      setItems(prev => [...prev, voicePrepItem]); // the voicePrepMessage append, deferred like participantErrorMessage
      expect(getState()).toEqual([...speakerItems, voicePrepItem]);
    });
  });
});

describe('voice-prep result wiring: the asymmetric settings write (resolveVoicePrepOutcome, the real production function)', () => {
  it('never produces a settings patch when prepareManagedVoice fails', () => {
    const result: VoicePrepResult = { ok: false, reason: 'pool_exhausted' };
    const outcome = resolveVoicePrepOutcome(result, 'cloned-uuid-123', 'Maya');
    // A busy pool tonight must not silently demote the stored preference —
    // the next session should try the real voice again.
    expect(outcome.settingsPatch).toBeNull();
    // The session still gets a usable voice — just not a persisted one.
    expect(outcome.sessionVoice).toBe('Maya');
    expect(outcome.notice).not.toBeNull();
  });

  it('produces a settings patch only when the successful id actually changed', () => {
    const unchanged = resolveVoicePrepOutcome({ ok: true, voiceId: 'cloned-uuid-123' }, 'cloned-uuid-123', 'Maya');
    expect(unchanged.settingsPatch).toBeNull();
    expect(unchanged.sessionVoice).toBe('cloned-uuid-123');

    const rebuilt = resolveVoicePrepOutcome({ ok: true, voiceId: 'cloned-uuid-999' }, 'cloned-uuid-123', 'Maya');
    expect(rebuilt.settingsPatch).toEqual({ voice: 'cloned-uuid-999' });
    expect(rebuilt.sessionVoice).toBe('cloned-uuid-999');
  });

  it('contrast: an UNCONDITIONAL write would clobber the stored voice on every failure', () => {
    // NOT the real function — a hypothetical wrong implementation, kept only
    // to prove the assertions above actually depend on the guard inside
    // resolveVoicePrepOutcome, rather than being true no matter what a
    // settings-write function does.
    function unconditionalWrite(result: VoicePrepResult, builtinFallback: string): { voice: string } | null {
      if (result.ok) return { voice: result.voiceId };
      // BUG this contrast demonstrates: would persist the built-in fallback
      // as if the user had chosen it, on every single failed session start.
      return { voice: builtinFallback };
    }
    const failed: VoicePrepResult = { ok: false, reason: 'pool_exhausted' };
    const wrongPatch = unconditionalWrite(failed, 'Maya');
    expect(wrongPatch).toEqual({ voice: 'Maya' }); // the bug the real guard prevents

    const realOutcome = resolveVoicePrepOutcome(failed, 'cloned-uuid-123', 'Maya');
    expect(realOutcome.settingsPatch).toBeNull();
    expect(realOutcome.settingsPatch).not.toEqual(wrongPatch);
  });
});
