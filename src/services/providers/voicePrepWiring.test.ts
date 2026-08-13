import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the Kizuna AI feature flag on so KIZUNA_AI_SONIOX registers with
// ProviderConfigFactory regardless of build env — same technique as
// descriptorRegistry.test.ts / prepareToStart.kizunaSoniox.test.ts.
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));

// Only the NETWORK CORE is faked: prepareManagedVoice is the function that
// talks to ManagedVoicesClient (and, through it, the backend). Everything
// else this module exports — most importantly resolveVoicePrepOutcome, the
// pure function that actually decides the sessionPatch/settingsPatch keys
// under test below — stays real, via importOriginal. That is the difference
// between this file and prepareToStart.kizunaSoniox.test.ts (which mocks the
// whole module because it is testing prepareToStart's OWN dispatch, not the
// envelope those patches travel through afterwards).
const { prepareManagedVoiceMock } = vi.hoisted(() => ({ prepareManagedVoiceMock: vi.fn() }));
vi.mock('./managedVoicePrep', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./managedVoicePrep')>();
  return { ...actual, prepareManagedVoice: prepareManagedVoiceMock };
});

import { ProviderConfigFactory } from './ProviderConfigFactory';
import { Provider } from '../../types/Provider';
import { expectationHolds } from '../../components/MainPanel/prepareEnvelope';
import { defaultSonioxSettings, SonioxSettings } from './SonioxProviderConfig';
import { SONIOX_DEFAULT_VOICE } from '../../lib/soniox/ttsCatalog';
import type { PrepareOutcome } from './ProviderDescriptor';
import type { SonioxSessionConfig } from '../interfaces/IClient';
import type { VoicePrepResult } from './managedVoicePrep';

/**
 * Two independent regression properties around managed Soniox voice prep,
 * neither of which lives inside `prepareManagedVoice` or
 * `resolveVoicePrepOutcome` themselves (those routines' own branches are
 * covered by managedVoicePrep.test.ts).
 *
 * 1. ORDERING: the voice-prep fallback notice is appended to conversation
 *    items AFTER the post-init `setItems(speakerClientRef.current?.getConversationItems()
 *    || [])` overwrite in MainPanel.tsx's connectConversation, and therefore
 *    survives it — the exact ordering hazard participantErrorOrdering.test.ts
 *    documents for `participantErrorMessage`, now for the voice-prep notice.
 *    There is no React rendering harness in this repo, so — matching that
 *    sibling file's technique exactly, INCLUDING its pre-fix/post-fix
 *    contrast pairing — this reproduces React's setState value semantics
 *    rather than invoking MainPanel.tsx directly. The "pre-fix" case below
 *    reproduces the WRONG ordering and asserts the notice is actually lost,
 *    which is what proves the "right ordering" assertion depends on the
 *    ordering rather than being true by construction.
 *
 * 2. THE HOOK↔MAINPANEL ENVELOPE SEAM: `KizunaAISonioxProviderConfig.prepareToStart`
 *    hands MainPanel a `PrepareOutcome` whose `sessionPatch` / `settingsPatch`
 *    are untyped `Record<string, unknown>` (ProviderDescriptor.ts), merged in
 *    with `Object.assign`/`updateProviderSlice` — nothing type-checks that
 *    their keys agree with what `SonioxSessionConfig` and the kizunaSoniox
 *    settings slice actually read. A key rename on either side (the hook
 *    emitting `voiceId` instead of `voice`, or a settings-slice rename)
 *    compiles cleanly and passes every OTHER test in the suite; only the
 *    session actually starting in the wrong voice would catch it. This
 *    section drives the REAL `prepareToStart` (with only the network core
 *    faked, see above), applies its outcome through the REAL
 *    `expectationHolds` using MainPanel's own two-guard application
 *    semantics (guard 1 gates the whole outcome including the settingsPatch
 *    write; guard 2 re-gates only the sessionPatch + notice), and reads the
 *    result back through the REAL `buildSessionConfig` / a real
 *    `SonioxSessionConfig`-shaped object — so a key drift on either patch
 *    fails an assertion here, not just in production.
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
      setItems(prev => [...prev, voicePrepItem]); // the notice append, deferred like participantErrorMessage
      expect(getState()).toEqual([...speakerItems, voicePrepItem]);
    });
  });
});

describe('the hook↔MainPanel envelope seam', () => {
  const descriptor = () => ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX);

  const ports = (
    overrides: Partial<{ speakerWillStart: boolean; participantWillStart: boolean; textOnly: boolean }> = {}
  ) => ({
    getAuthToken: vi.fn().mockResolvedValue('tok-123'),
    userId: 'user-1',
    revalidate: vi.fn(),
    sessionShape: { speakerWillStart: true, participantWillStart: false, textOnly: false, ...overrides },
    onPhase: vi.fn(),
    signal: new AbortController().signal,
  });

  const sliceWith = (voice: string): SonioxSettings => ({ ...defaultSonioxSettings, voice });

  beforeEach(() => {
    prepareManagedVoiceMock.mockReset();
  });

  /**
   * MainPanel's own application of a `PrepareOutcome` (connectConversation,
   * MainPanel.tsx ~1848 and ~2067), reproduced around the REAL
   * `expectationHolds` rather than a hand-transcribed `===` check — so a
   * change to `expectationHolds` itself, or to which guard gates what, shows
   * up here too:
   *  - Guard 1 gates the WHOLE outcome, including the settingsPatch write —
   *    preparation takes seconds and the settings UI stays mounted the whole
   *    time, so a choice the user made meanwhile must win outright.
   *  - Guard 2 re-gates only the sessionPatch + its notice, immediately
   *    before the sessionPatch is merged into the session config that is
   *    about to be sent — everything between prep and connect (audio init,
   *    client construction, listener wiring) is awaited, so the same
   *    freshness hazard exists a second time, narrower.
   */
  function applyEnvelope(
    outcome: PrepareOutcome & { ok: true },
    settingsSlice: Record<string, unknown>,
    sessionConfig: SonioxSessionConfig,
    /** What the user does BETWEEN the settingsPatch write (end of guard 1)
     *  and the sessionConfig override (guard 2) — audio init, client
     *  construction and listener wiring are all awaited there in MainPanel. */
    betweenGuards?: (slice: Record<string, unknown>) => void,
    /** Mirrors MainPanel's check-before-apply line: `prepareAbortRef.current
     *  = null; if (prepareAbort.signal.aborted) return;`, which runs right
     *  after the try/catch that produces `prepared` — BEFORE guard 1 even
     *  looks at `outcome.expect`. A teardown that raced this prepare
     *  discards the whole outcome silently, same as an early `return`. */
    aborted = false,
  ): { notice: string | null } {
    if (aborted) return { notice: null };

    let notice: string | null = null;
    let pendingSessionPatch: Record<string, unknown> | undefined;
    let pendingExpectAtApply: Record<string, unknown> | undefined;

    if (expectationHolds(outcome.expect, settingsSlice)) {
      if (outcome.settingsPatch) Object.assign(settingsSlice, outcome.settingsPatch);
      pendingSessionPatch = outcome.sessionPatch;
      pendingExpectAtApply = outcome.expectAtApply;
      notice = outcome.notice ?? null;
    }
    betweenGuards?.(settingsSlice);
    if (pendingSessionPatch) {
      if (expectationHolds(pendingExpectAtApply, settingsSlice)) {
        Object.assign(sessionConfig, pendingSessionPatch);
      } else {
        notice = null;
      }
    }
    return { notice };
  }

  it('a rebuilt voice: settingsPatch and sessionPatch both land on the real `voice` field', async () => {
    prepareManagedVoiceMock.mockResolvedValue({ ok: true, voiceId: 'cloned-uuid-999' } satisfies VoicePrepResult);
    const slice = sliceWith('cloned-uuid-123');

    const outcome = await descriptor().prepareToStart!(slice, ports());
    if (!outcome.ok) throw new Error('expected ok:true');

    // The concrete key contract: sessionPatch's key is what
    // SonioxSessionConfig's reader (buildSessionConfig, exercised below)
    // actually consumes, and settingsPatch's key is a real key of the
    // kizunaSoniox settings slice — not a paraphrase of either. This is
    // what breaks if the hook is ever edited to emit e.g. `voiceId`.
    expect(Object.keys(outcome.sessionPatch ?? {})).toEqual(['voice']);
    expect(Object.keys(outcome.settingsPatch ?? {})).toEqual(['voice']);
    expect(Object.prototype.hasOwnProperty.call(defaultSonioxSettings, 'voice')).toBe(true);

    const settingsSlice: Record<string, unknown> = { ...slice };
    // getSessionConfig() reads the CURRENT stored voice at connect time —
    // built from the pre-prep slice, exactly like MainPanel.tsx's
    // `const sessionConfig = getSessionConfig();`.
    const sessionConfig = descriptor().buildSessionConfig(slice, '') as SonioxSessionConfig;

    applyEnvelope(outcome, settingsSlice, sessionConfig);

    // Read back through the REAL production reader, not a hand-built
    // stand-in: rebuilding the session config from the patched slice must
    // agree with the direct sessionPatch override, and both must actually be
    // `voice` — if either side drifted, one of these two would still read
    // the stale pre-prep id.
    expect((descriptor().buildSessionConfig(settingsSlice, '') as SonioxSessionConfig).voice).toBe('cloned-uuid-999');
    expect(sessionConfig.voice).toBe('cloned-uuid-999');
  });

  it('a warm hit (id unchanged): sessionPatch still applies, but settingsPatch is asymmetrically withheld', async () => {
    prepareManagedVoiceMock.mockResolvedValue({ ok: true, voiceId: 'cloned-uuid-123' } satisfies VoicePrepResult);
    const slice = sliceWith('cloned-uuid-123');

    const outcome = await descriptor().prepareToStart!(slice, ports());
    if (!outcome.ok) throw new Error('expected ok:true');

    // A busy pool tonight must not silently demote the stored preference —
    // only a genuinely CHANGED id is ever persisted.
    expect(outcome.settingsPatch).toBeUndefined();
    expect(Object.keys(outcome.sessionPatch ?? {})).toEqual(['voice']);

    const settingsSlice: Record<string, unknown> = { ...slice };
    const sessionConfig = descriptor().buildSessionConfig(slice, '') as SonioxSessionConfig;
    applyEnvelope(outcome, settingsSlice, sessionConfig);

    expect(settingsSlice.voice).toBe('cloned-uuid-123'); // no redundant write
    expect(sessionConfig.voice).toBe('cloned-uuid-123');
  });

  it('a busy pool: falls back to the built-in voice for this session only, and never persists it', async () => {
    prepareManagedVoiceMock.mockResolvedValue({ ok: false, reason: 'pool_exhausted' } satisfies VoicePrepResult);
    const slice = sliceWith('cloned-uuid-123');

    const outcome = await descriptor().prepareToStart!(slice, ports());
    if (!outcome.ok) throw new Error('expected ok:true');

    expect(outcome.settingsPatch).toBeUndefined();
    expect(Object.keys(outcome.sessionPatch ?? {})).toEqual(['voice']);
    expect(outcome.sessionPatch?.voice).toBe(SONIOX_DEFAULT_VOICE);
    expect(outcome.notice).toBeTruthy();

    const settingsSlice: Record<string, unknown> = { ...slice };
    const sessionConfig = descriptor().buildSessionConfig(slice, '') as SonioxSessionConfig;
    const { notice } = applyEnvelope(outcome, settingsSlice, sessionConfig);

    expect(settingsSlice.voice).toBe('cloned-uuid-123'); // the stored preference is untouched
    expect(sessionConfig.voice).toBe(SONIOX_DEFAULT_VOICE); // only THIS session degrades
    expect(notice).toBe(outcome.notice);
  });

  it('guard 1: a selection made WHILE prep is in flight stands the whole outcome down, including the settingsPatch write', async () => {
    prepareManagedVoiceMock.mockResolvedValue({ ok: true, voiceId: 'cloned-uuid-999' } satisfies VoicePrepResult);
    const slice = sliceWith('cloned-uuid-123');

    const outcome = await descriptor().prepareToStart!(slice, ports());
    if (!outcome.ok) throw new Error('expected ok:true');

    // The reported sequence: the voice was evicted, the user pressed Start,
    // then opened Settings during the ~10s "Preparing your voice…" window
    // and picked a different (built-in) voice before the hook's promise
    // resolved. Preparation completing with a rebuilt UUID must not revert
    // that, and must not persist the rebuild either.
    const settingsSlice: Record<string, unknown> = { ...slice, voice: 'Aurora' };
    const sessionConfig = descriptor().buildSessionConfig({ ...slice, voice: 'Aurora' }, '') as SonioxSessionConfig;

    const { notice } = applyEnvelope(outcome, settingsSlice, sessionConfig);

    expect(settingsSlice.voice).toBe('Aurora'); // not clobbered by the rebuilt id
    expect(sessionConfig.voice).toBe('Aurora'); // this session speaks as asked
    expect(notice).toBeNull();
  });

  it('guard 2: a selection made BETWEEN prep and connect drops the sessionPatch and its notice, but any settingsPatch already landed', async () => {
    prepareManagedVoiceMock.mockResolvedValue({ ok: false, reason: 'pool_exhausted' } satisfies VoicePrepResult);
    const slice = sliceWith('cloned-uuid-123');

    const outcome = await descriptor().prepareToStart!(slice, ports());
    if (!outcome.ok) throw new Error('expected ok:true');

    const settingsSlice: Record<string, unknown> = { ...slice };
    const sessionConfig = descriptor().buildSessionConfig(slice, '') as SonioxSessionConfig;

    // Guard 1 sees the still-unchanged slice and holds (there is no
    // settingsPatch to write for a failed prep); the user then picks a
    // built-in voice in the gap before connect() reaches the sessionConfig
    // override.
    const { notice } = applyEnvelope(outcome, settingsSlice, sessionConfig, (s) => {
      s.voice = 'Aurora';
    });

    expect(settingsSlice.voice).toBe('Aurora'); // the user's own choice, unclobbered
    expect(sessionConfig.voice).toBe('cloned-uuid-123'); // fallback never applied
    expect(notice).toBeNull(); // would otherwise explain a substitution that never happened
  });

  it('an aborted prepare: the outcome is discarded wholesale — neither patch applies, no notice, mirroring the return before the ok check', async () => {
    // Same rebuilt-voice outcome as the first test in this block, which
    // WOULD apply both patches — the only difference here is `aborted: true`,
    // proving the discard happens ahead of (and regardless of) guard 1.
    prepareManagedVoiceMock.mockResolvedValue({ ok: true, voiceId: 'cloned-uuid-999' } satisfies VoicePrepResult);
    const slice = sliceWith('cloned-uuid-123');

    const outcome = await descriptor().prepareToStart!(slice, ports());
    if (!outcome.ok) throw new Error('expected ok:true');

    const settingsSlice: Record<string, unknown> = { ...slice };
    const sessionConfig = descriptor().buildSessionConfig(slice, '') as SonioxSessionConfig;

    const { notice } = applyEnvelope(outcome, settingsSlice, sessionConfig, undefined, true);

    expect(settingsSlice.voice).toBe('cloned-uuid-123'); // settingsPatch never applied
    expect(sessionConfig.voice).toBe('cloned-uuid-123'); // sessionPatch never applied
    expect(notice).toBeNull();
  });
});
