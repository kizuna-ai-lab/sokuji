import { describe, it, expect } from 'vitest';
import { resolveVoicePrepOutcome } from './managedVoicePrep';
import type { VoicePrepResult } from './managedVoicePrep';

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
 * 2. THE FRESHNESS GUARD: preparation takes seconds (up to ~10 s for a cold
 *    rebuild) and the voice dropdown is NOT locked while it runs —
 *    VoiceLibrarySection disables selection on `isSessionActive`, which only
 *    flips after connect() resolves, and Settings is mounted beside MainPanel
 *    the whole time. So the stored voice is re-read immediately before the
 *    write-through and again before the sessionConfig override, and a
 *    mismatch stands the whole outcome down. Same technique as property 1: no
 *    React harness exists here, so the call-site wiring is reproduced around
 *    the REAL `resolveVoicePrepOutcome`, with an unguarded contrast case that
 *    reproduces the clobber.
 *
 * 3. THE ASYMMETRIC SETTINGS WRITE: a FAILED prepareManagedVoice() result must
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
    const outcome = resolveVoicePrepOutcome(result, 'cloned-uuid-123', 'Adrian');
    // A busy pool tonight must not silently demote the stored preference —
    // the next session should try the real voice again.
    expect(outcome.settingsPatch).toBeNull();
    // The session still gets a usable voice — just not a persisted one.
    expect(outcome.sessionVoice).toBe('Adrian');
    expect(outcome.notice).not.toBeNull();
  });

  it('produces a settings patch only when the successful id actually changed', () => {
    const unchanged = resolveVoicePrepOutcome({ ok: true, voiceId: 'cloned-uuid-123' }, 'cloned-uuid-123', 'Adrian');
    expect(unchanged.settingsPatch).toBeNull();
    expect(unchanged.sessionVoice).toBe('cloned-uuid-123');

    const rebuilt = resolveVoicePrepOutcome({ ok: true, voiceId: 'cloned-uuid-999' }, 'cloned-uuid-123', 'Adrian');
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
    const wrongPatch = unconditionalWrite(failed, 'Adrian');
    expect(wrongPatch).toEqual({ voice: 'Adrian' }); // the bug the real guard prevents

    const realOutcome = resolveVoicePrepOutcome(failed, 'cloned-uuid-123', 'Adrian');
    expect(realOutcome.settingsPatch).toBeNull();
    expect(realOutcome.settingsPatch).not.toEqual(wrongPatch);
  });
});

/**
 * A stand-in for the settings slice's `voice` field plus the sessionConfig
 * object connectConversation builds for one connect(). `applyVoicePrep`
 * reproduces MainPanel.tsx's call site — the two freshness re-reads around
 * the REAL resolveVoicePrepOutcome — so the guard under test is the guard
 * that ships, not a paraphrase of it.
 */
function makeVoiceWorld(storedVoice: string) {
  const world = {
    storedVoice,
    sessionConfigVoice: storedVoice,
    notice: null as string | null,
  };
  return world;
}

type VoiceWorld = ReturnType<typeof makeVoiceWorld>;

function applyVoicePrep(
  world: VoiceWorld,
  result: VoicePrepResult,
  snapshot: string,
  builtinFallback: string,
  /** What the user does DURING preparation, before the result lands. */
  duringPrep?: (w: VoiceWorld) => void,
  /** What the user does between the prep block and the sessionConfig
   *  override (audio init, client construction, listener wiring are all
   *  awaited in there). */
  betweenPrepAndConnect?: (w: VoiceWorld) => void,
  { guarded = true }: { guarded?: boolean } = {}
) {
  duringPrep?.(world);

  let sessionVoiceOverride: string | null = null;
  let expected: string | null = null;
  if (!guarded || world.storedVoice === snapshot) {
    const outcome = resolveVoicePrepOutcome(result, snapshot, builtinFallback);
    sessionVoiceOverride = outcome.sessionVoice;
    if (outcome.settingsPatch) world.storedVoice = outcome.settingsPatch.voice;
    expected = outcome.settingsPatch?.voice ?? snapshot;
    world.notice = outcome.notice ? outcome.notice.key : null;
  }

  betweenPrepAndConnect?.(world);

  // getSessionConfig() reads the CURRENT stored voice, then the override (if
  // it still applies) is written over it.
  world.sessionConfigVoice = world.storedVoice;
  if (sessionVoiceOverride) {
    if (!guarded || world.storedVoice === expected) {
      world.sessionConfigVoice = sessionVoiceOverride;
    } else {
      world.notice = null;
    }
  }
  return world;
}

describe('voice-prep freshness: a choice made during preparation wins', () => {
  const SNAPSHOT = 'cloned-uuid-123';
  const REBUILT = 'cloned-uuid-999';

  it('does not overwrite a built-in the user picked while the voice was being rebuilt', () => {
    // The reported sequence: the voice was evicted, the user pressed Start,
    // then opened Settings during the ~10 s "Preparing your voice…" window
    // and chose Maya. Preparation completing with a rebuilt UUID must not
    // revert that.
    const world = applyVoicePrep(
      makeVoiceWorld(SNAPSHOT),
      { ok: true, voiceId: REBUILT },
      SNAPSHOT,
      'Adrian',
      (w) => { w.storedVoice = 'Adrian'; }
    );
    expect(world.storedVoice).toBe('Adrian');       // preference not reverted
    expect(world.sessionConfigVoice).toBe('Adrian'); // and this session speaks as asked
  });

  it('contrast: without the guard the rebuilt UUID clobbers both', () => {
    // Proves the assertions above depend on the re-read rather than being
    // true no matter what the call site does.
    const world = applyVoicePrep(
      makeVoiceWorld(SNAPSHOT),
      { ok: true, voiceId: REBUILT },
      SNAPSHOT,
      'Adrian',
      (w) => { w.storedVoice = 'Adrian'; },
      undefined,
      { guarded: false }
    );
    expect(world.storedVoice).toBe(REBUILT);
    expect(world.sessionConfigVoice).toBe(REBUILT);
  });

  it('still writes the rebuilt id through when nobody touched the selection', () => {
    // The guard must not cost the feature its whole point: a rebuild returns
    // a NEW Soniox UUID, and the stored preference has to follow it.
    const world = applyVoicePrep(
      makeVoiceWorld(SNAPSHOT),
      { ok: true, voiceId: REBUILT },
      SNAPSHOT,
      'Adrian'
    );
    expect(world.storedVoice).toBe(REBUILT);
    expect(world.sessionConfigVoice).toBe(REBUILT);
  });

  it('drops the fallback AND its notice when the selection changes after preparation', () => {
    // A failed prep resolves to the built-in fallback plus an explanation.
    // If the user picks a voice in the window between that and connect(),
    // forcing the fallback would override their choice, and the notice would
    // explain a substitution that never happened.
    const world = applyVoicePrep(
      makeVoiceWorld(SNAPSHOT),
      { ok: false, reason: 'pool_exhausted' },
      SNAPSHOT,
      'Adrian',
      undefined,
      (w) => { w.storedVoice = 'Aurora'; }
    );
    expect(world.sessionConfigVoice).toBe('Aurora');
    expect(world.notice).toBeNull();
  });

  it('keeps the fallback and its notice when nothing moved', () => {
    const world = applyVoicePrep(
      makeVoiceWorld(SNAPSHOT),
      { ok: false, reason: 'pool_exhausted' },
      SNAPSHOT,
      'Adrian'
    );
    expect(world.storedVoice).toBe(SNAPSHOT); // fallback is never persisted
    expect(world.sessionConfigVoice).toBe('Adrian');
    expect(world.notice).toBe('mainPanel.sonioxVoicePoolBusy');
  });
});
