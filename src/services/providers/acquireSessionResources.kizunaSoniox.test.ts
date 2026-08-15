import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted: the mock factory below runs before these consts would otherwise
// be initialized, and vitest forbids a factory from closing over an
// un-hoisted outer binding. Same technique as prepareToStart.kizunaSoniox.test.ts.
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

// Only ManagedSonioxSession is mocked — resolveManagedSonioxWiring and
// managedLegOptions (imported directly by KizunaAISonioxProviderConfig from
// ./managedSonioxSplit) run for REAL, so the wiring assertions below exercise
// the actual mode-matrix and per-leg logic, not a hand-restated copy of it.
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

// Imported directly (not through ProviderConfigFactory), same technique as
// SonioxClient.managed.test.ts: this file needs none of the registry's
// feature-flag/environment mocking, since neither this class nor its runtime
// dependencies (managedSonioxSplit, SonioxCostMeter) read environment flags.
import { KizunaAISonioxProviderConfig, KIZUNA_SIGN_IN_REQUIRED } from './KizunaAISonioxProviderConfig';
import type { AcquireSessionResourcesContext } from './ProviderDescriptor';
import { computeSonioxRemainingMs, computeSonioxBudgetTotalMs, type SonioxBudgetSnapshot } from '../clients/SonioxCostMeter';

function makeCtx(
  wiringOverrides: Partial<AcquireSessionResourcesContext['wiring']> = {},
  opts: { getAuthToken?: AcquireSessionResourcesContext['getAuthToken']; onEvent?: AcquireSessionResourcesContext['onEvent'] } = {},
): AcquireSessionResourcesContext {
  return {
    getAuthToken: opts.getAuthToken ?? vi.fn().mockResolvedValue('sess_TOKEN'),
    onEvent: opts.onEvent ?? vi.fn(),
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

describe('KizunaAISonioxProviderConfig.acquireSessionResources', () => {
  beforeEach(() => {
    acquireMock.mockReset();
    endMock.mockReset();
    getBudgetSnapshotMock.mockReset();
    credentialsForMock.mockReset();
    constructorMock.mockReset();
    instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('(1) speaker-only wiring: session.acquire is called with the real matrix body from resolveManagedSonioxWiring', async () => {
    acquireMock.mockResolvedValue(undefined);
    const d = new KizunaAISonioxProviderConfig();
    const ctx = makeCtx({ speakerWillStart: true, participantWillStart: false, textOnly: true });

    await d.acquireSessionResources(ctx);

    expect(acquireMock).toHaveBeenCalledTimes(1);
    expect(acquireMock).toHaveBeenCalledWith({ mode: 'speaker', textOnly: true, bothSplit: false, region: 'us' });
  });

  it('(2) a null token throws KIZUNA_SIGN_IN_REQUIRED before any session is constructed', async () => {
    const d = new KizunaAISonioxProviderConfig();
    const ctx = makeCtx({}, { getAuthToken: vi.fn().mockResolvedValue(null) });

    await expect(d.acquireSessionResources(ctx)).rejects.toThrow(KIZUNA_SIGN_IN_REQUIRED);
    expect(constructorMock).not.toHaveBeenCalled();
  });

  it('(3) a rejected acquire calls end() exactly once, rethrows the same error, and resolves nothing', async () => {
    const error = new Error('boom: 409 conflict retries exhausted');
    acquireMock.mockRejectedValueOnce(error);
    const d = new KizunaAISonioxProviderConfig();
    const ctx = makeCtx();

    await expect(d.acquireSessionResources(ctx)).rejects.toBe(error);
    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it('(4) legClientOptions carries the speaker bundle from credentialsFor and is empty for the roleless participant', async () => {
    acquireMock.mockResolvedValue(undefined);
    const credentials = { stt: 'stt-temp-key', tts: 'tts-temp-key', clientReferenceId: 'sokuji1:acct:lease:spk_stt' };
    credentialsForMock.mockReturnValue(credentials);
    const d = new KizunaAISonioxProviderConfig();
    const ctx = makeCtx({ speakerWillStart: true, participantWillStart: false });

    const resources = await d.acquireSessionResources(ctx);
    expect(resources).not.toBeNull();
    const session = instances[0];

    const speakerOptions = resources!.legClientOptions('speaker');
    expect(credentialsForMock).toHaveBeenCalledWith('spk_stt');
    expect(speakerOptions).toEqual({
      sonioxManaged: {
        credentials,
        session,
        role: 'spk_stt',
        announcesSessionOutcome: true,
      },
    });

    expect(resources!.legClientOptions('participant')).toEqual({});
  });

  it('(5) budget() is null until a snapshot exists, then computed via the real SonioxCostMeter helpers; the snapshot is fetched at most once after it goes non-null', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    acquireMock.mockResolvedValue(undefined);
    const snapshot: SonioxBudgetSnapshot = { budgetMicroUsd: 500_000, rateUsdPerHour: 0.6, startedAtMs: now };
    getBudgetSnapshotMock.mockReturnValueOnce(null).mockReturnValue(snapshot);
    const d = new KizunaAISonioxProviderConfig();
    const ctx = makeCtx();

    const resources = await d.acquireSessionResources(ctx);

    // Call 1: no snapshot yet.
    expect(resources!.budget!()).toBeNull();
    // Call 2: snapshot now exists, computed with the real helpers.
    expect(resources!.budget!()).toEqual({
      remainingMs: computeSonioxRemainingMs(Date.now(), snapshot),
      totalMs: computeSonioxBudgetTotalMs(snapshot),
    });
    // Call 3: cached — getBudgetSnapshot is not consulted again.
    expect(resources!.budget!()).toEqual({
      remainingMs: computeSonioxRemainingMs(Date.now(), snapshot),
      totalMs: computeSonioxBudgetTotalMs(snapshot),
    });
    expect(getBudgetSnapshotMock).toHaveBeenCalledTimes(2);
  });

  it('(6) release(\'disconnect\') and release(\'aborted\') each delegate to end()', async () => {
    acquireMock.mockResolvedValue(undefined);
    const d = new KizunaAISonioxProviderConfig();
    const ctx = makeCtx();

    const resources = await d.acquireSessionResources(ctx);
    resources!.release('disconnect');
    resources!.release('aborted');

    expect(endMock).toHaveBeenCalledTimes(2);
  });

  it('(7) the constructor onEvent forwards session.retry to ctx.onEvent with the same arguments', async () => {
    acquireMock.mockResolvedValue(undefined);
    const onEvent = vi.fn();
    const d = new KizunaAISonioxProviderConfig();
    const ctx = makeCtx({}, { onEvent });

    await d.acquireSessionResources(ctx);

    expect(constructorMock).toHaveBeenCalledTimes(1);
    const passedOptions = constructorMock.mock.calls[0][0] as { onEvent: (type: string, data: unknown) => void };
    const data = { provider: 'soniox', status: 409, retryAfterMs: 3000 };
    passedOptions.onEvent('session.retry', data);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith('session.retry', data);
  });
});
