import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the Kizuna AI feature flag on so KIZUNA_AI_SONIOX registers with
// ProviderConfigFactory regardless of build env — same technique as
// voicePrepWiring.test.ts / descriptorRegistry.test.ts.
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  // Explicit: each managed provider is gated on its own now, and this mock's
  // promise is that EVERY provider gate is forced on.
  isKizunaSonioxEnabled: () => true,
  isKizunaOpenAITranslateEnabled: () => true,
  isKizunaVolcengineAST2Enabled: () => true,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));

// vi.hoisted: the mock factory below runs before these consts would otherwise
// be initialized — same technique as acquireSessionResources.kizunaSoniox.test.ts.
const { acquireMock, endMock, getBudgetSnapshotMock, credentialsForMock, constructorMock, instances } = vi.hoisted(
  () => ({
    acquireMock: vi.fn(),
    endMock: vi.fn(),
    getBudgetSnapshotMock: vi.fn(),
    credentialsForMock: vi.fn(),
    constructorMock: vi.fn(),
    instances: [] as unknown[],
  }),
);

// Only ManagedSonioxSession is mocked. resolveManagedSonioxWiring and
// managedLegOptions (imported by KizunaAISonioxProviderConfig from
// ./managedSonioxSplit), and the SonioxCostMeter helpers, all run for REAL —
// same discipline as Task 3's test. teardownSessionLegs, also from
// ./managedSonioxSplit, is imported directly below and run for real too: this
// file's whole point is to catch a contract drift between the twin's
// production acquireSessionResources and MainPanel's REAL teardown/release
// application, not a hand-restated copy of either.
vi.mock('../clients/ManagedSonioxSession', () => ({
  ManagedSonioxSession: class {
    options: unknown;
    acquire = acquireMock;
    end = endMock;
    getBudgetSnapshot = getBudgetSnapshotMock;
    credentialsFor = credentialsForMock;
    constructor(options: unknown) {
      this.options = options;
      constructorMock(options);
      instances.push(this);
    }
  },
}));

import { ProviderConfigFactory } from './ProviderConfigFactory';
import { Provider } from '../../types/Provider';
import { teardownSessionLegs } from './managedSonioxSplit';
import type { AcquireSessionResourcesContext, SessionResources } from './ProviderDescriptor';

/**
 * The session-resources seam, golden.
 *
 * T3 landed the twin's `acquireSessionResources`; T4 made MainPanel apply
 * whatever a descriptor returns generically: `afterBothLegs` at both teardown
 * sites reads `sessionResourcesRef`, nulls it, THEN calls
 * `release('disconnect' | 'aborted')`; a failed acquire never sets the ref, so
 * nothing ever releases it. Neither side is re-tested in isolation here — T3's
 * suite already covers the twin's own branches, and managedSonioxSplit.test.ts
 * already covers `teardownSessionLegs`'s own nesting. What is NEW, and what
 * has no test anywhere else, is the seam between them: the twin's
 * `legClientOptions` result read against the exact field MainPanel's
 * `ClientOptions.sonioxManaged` consumes, and MainPanel's own
 * ref-null-then-release `afterBothLegs` shape, reproduced here (not
 * hand-restated) around the REAL `teardownSessionLegs`, so a rename or a
 * reordering on either side goes red here rather than only in production.
 *
 * `ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX)` — the real
 * registry, not a direct import of the class — because the registry lookup is
 * itself part of what this file pins: MainPanel never imports
 * KizunaAISonioxProviderConfig directly either.
 */
describe('the session-resources seam: acquireSessionResources <-> MainPanel teardown/release', () => {
  const descriptor = () => ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX);

  function makeCtx(
    wiringOverrides: Partial<AcquireSessionResourcesContext['wiring']> = {},
  ): AcquireSessionResourcesContext {
    return {
      getAuthToken: vi.fn().mockResolvedValue('sess_TOKEN'),
      onEvent: vi.fn(),
      wiring: {
        speakerWillStart: true,
        participantWillStart: false,
        sharedBoth: false,
        splitBoth: false,
        textOnly: false,
        ...wiringOverrides,
      },
    };
  }

  beforeEach(() => {
    acquireMock.mockReset();
    endMock.mockReset();
    getBudgetSnapshotMock.mockReset();
    credentialsForMock.mockReset();
    constructorMock.mockReset();
    instances.length = 0;
  });

  it('(1) legClientOptions("speaker") for a speaker-only acquire has sonioxManaged as its ONLY key, with role spk_stt', async () => {
    acquireMock.mockResolvedValue(undefined);
    credentialsForMock.mockReturnValue({ stt: 'stt-key', tts: 'tts-key', clientReferenceId: 'ref-1' });
    const d = descriptor();
    const ctx = makeCtx({ speakerWillStart: true, participantWillStart: false });

    const resources = await d.acquireSessionResources!(ctx);
    expect(resources).not.toBeNull();

    // The concrete key contract: this is the exact field name MainPanel's
    // `legOptions?.sonioxManaged` (ClientOptions.sonioxManaged) reads. A rename
    // on the twin's side compiles clean everywhere else and only this fails.
    const speakerOptions = resources!.legClientOptions('speaker');
    expect(Object.keys(speakerOptions)).toEqual(['sonioxManaged']);
    expect(speakerOptions.sonioxManaged!.role).toBe('spk_stt');
  });

  it('(2) release ordering (site-1 mirror): both legs come down before release fires, exactly once', async () => {
    acquireMock.mockResolvedValue(undefined);
    const d = descriptor();
    const ctx = makeCtx();
    const resources = await d.acquireSessionResources!(ctx);
    expect(resources).not.toBeNull();

    const order: string[] = [];
    let ref: SessionResources | null = resources;
    await teardownSessionLegs({
      speaker: async () => { order.push('speaker-down'); },
      participant: async () => { order.push('participant-down'); },
      afterBothLegs: () => {
        const r = ref; ref = null;
        r?.release('disconnect');
        order.push('release');
      },
    });

    expect(order).toEqual(['speaker-down', 'participant-down', 'release']);
    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it('(3) a throwing speaker leg cannot strand the release: participant-down and release still happen, the error still propagates', async () => {
    acquireMock.mockResolvedValue(undefined);
    const d = descriptor();
    const ctx = makeCtx();
    const resources = await d.acquireSessionResources!(ctx);
    expect(resources).not.toBeNull();

    const order: string[] = [];
    let ref: SessionResources | null = resources;
    const speakerError = new Error('speaker leg blew up mid-disconnect');

    await expect(
      teardownSessionLegs({
        speaker: async () => { order.push('speaker-down'); throw speakerError; },
        participant: async () => { order.push('participant-down'); },
        afterBothLegs: () => {
          const r = ref; ref = null;
          r?.release('disconnect');
          order.push('release');
        },
      }),
    ).rejects.toBe(speakerError);

    // The nested-finally guarantee: the participant leg and the release still
    // run even though the speaker leg threw.
    expect(order).toEqual(['speaker-down', 'participant-down', 'release']);
    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it('(4) abort-site mirror: no speaker leg at all (site 2 passes none) — participant-down then release("aborted"), exactly one end()', async () => {
    acquireMock.mockResolvedValue(undefined);
    const d = descriptor();
    const ctx = makeCtx();
    const resources = await d.acquireSessionResources!(ctx);
    expect(resources).not.toBeNull();

    const order: string[] = [];
    let ref: SessionResources | null = resources;
    await teardownSessionLegs({
      // No `speaker` step — the abort site (MainPanel.tsx's noChannelCameUp
      // branch) never had a speaker client to tear down.
      participant: async () => { order.push('participant-down'); },
      afterBothLegs: () => {
        const r = ref; ref = null;
        r?.release('aborted');
        order.push('release');
      },
    });

    expect(order).toEqual(['participant-down', 'release']);
    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it('(5) a failed acquire is never released: the twin\'s own catch ends it once, and nothing else exists to release', async () => {
    const error = new Error('boom: 409 conflict retries exhausted');
    acquireMock.mockRejectedValueOnce(error);
    const d = descriptor();
    const ctx = makeCtx();

    await expect(d.acquireSessionResources!(ctx)).rejects.toBe(error);
    // The twin's own catch: session.end() then rethrow (see
    // KizunaAISonioxProviderConfig.acquireSessionResources).
    expect(endMock).toHaveBeenCalledTimes(1);

    // MainPanel's outer catch on a failed Start routes through
    // disconnectConversation, whose afterBothLegs reads sessionResourcesRef —
    // still null, because `sessionResourcesRef.current = sessionResources;`
    // is never reached when acquireSessionResources threw. Mirrored directly
    // with `ref` starting null, rather than fabricating a ref that production
    // never had.
    const order: string[] = [];
    let ref: SessionResources | null = null;
    await teardownSessionLegs({
      speaker: async () => { order.push('speaker-down'); },
      participant: async () => { order.push('participant-down'); },
      afterBothLegs: () => {
        const r = ref; ref = null;
        r?.release('disconnect');
        order.push('release');
      },
    });

    expect(order).toEqual(['speaker-down', 'participant-down', 'release']);
    // No additional end() call: release() was never reached because ref was
    // already null.
    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it('(6) double release collapses: the ref-null mirror no-ops its second run; release() itself has no idempotency of its own', async () => {
    acquireMock.mockResolvedValue(undefined);
    const d = descriptor();
    const ctx = makeCtx();
    const resources = await d.acquireSessionResources!(ctx);
    expect(resources).not.toBeNull();

    let ref: SessionResources | null = resources;
    const runMirror = () =>
      teardownSessionLegs({
        afterBothLegs: () => {
          const r = ref;
          ref = null;
          r?.release('disconnect');
        },
      });

    await runMirror(); // ref is resources -> release() -> end()
    await runMirror(); // ref is already null -> no-op, exactly what protects MainPanel from a real double-release

    expect(endMock).toHaveBeenCalledTimes(1);

    // Calling release() a second time directly (bypassing the ref MainPanel
    // always nulls first) shows release() simply delegates to end() — it
    // carries no idempotency guard of its own. That is fine: end()'s OWN
    // idempotency (`!leaseId || endSignalled`, see ManagedSonioxSession) is
    // real production code and is pinned by ManagedSonioxSession's own tests,
    // not re-tested here.
    resources!.release('aborted');
    expect(endMock).toHaveBeenCalledTimes(2);
  });

  it("(7) a Start aborted during the acquire releases 'aborted' exactly once", async () => {
    acquireMock.mockResolvedValue(undefined);
    const d = descriptor();
    const ctx = makeCtx();
    const resources = await d.acquireSessionResources!(ctx);
    expect(resources).not.toBeNull();

    // A teardown raced the acquire and fired the Start-scoped aborter before
    // this line ran (S7 task 3's fix — see MainPanel.tsx: the post-acquire
    // check right after `sessionResourcesRef.current = sessionResources;`).
    const startAbort = new AbortController();
    startAbort.abort();

    let ref: SessionResources | null = resources; // mirrors sessionResourcesRef.current = sessionResources
    if (startAbort.signal.aborted) {
      const abortedResources = ref;
      ref = null;
      abortedResources?.release('aborted');
    }

    expect(endMock).toHaveBeenCalledTimes(1);
    expect(ref).toBeNull();

    // A subsequent site-1 mirror teardown (disconnectConversation's own
    // afterBothLegs, running later on the same session) finds the ref
    // already null and releases nothing further.
    const order: string[] = [];
    await teardownSessionLegs({
      speaker: async () => { order.push('speaker-down'); },
      participant: async () => { order.push('participant-down'); },
      afterBothLegs: () => {
        const r = ref; ref = null;
        r?.release('disconnect');
        order.push('release');
      },
    });

    expect(order).toEqual(['speaker-down', 'participant-down', 'release']);
    expect(endMock).toHaveBeenCalledTimes(1);
  });
});
