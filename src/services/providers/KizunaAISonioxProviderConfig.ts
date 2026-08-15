import { SonioxProviderConfig, SonioxSettings, defaultSonioxSettings } from './SonioxProviderConfig';
import { ProviderConfig } from './ProviderConfig';
import {
  Credentials,
  CredentialCtx,
  ClientOptions,
  PreparePorts,
  PrepareOutcome,
  AcquireSessionResourcesContext,
  SessionResources,
} from './ProviderDescriptor';
import { IClient, FilteredModel } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { SonioxClient } from '../clients/SonioxClient';
import { ManagedVoicesClient } from '../clients/ManagedVoicesClient';
import { ManagedSonioxSession } from '../clients/ManagedSonioxSession';
import { computeSonioxRemainingMs, computeSonioxBudgetTotalMs, type SonioxBudgetSnapshot } from '../clients/SonioxCostMeter';
import { resolveManagedSonioxWiring, managedLegOptions } from './managedSonioxSplit';
import { prepareManagedVoice, resolveVoicePrepOutcome } from './managedVoicePrep';
import { loadVoiceClip } from '../../lib/soniox/voiceClipStorage';
import { SONIOX_DEFAULT_VOICE } from '../../lib/soniox/ttsCatalog';
import i18n from '../../locales';
import { asSonioxRegion } from '../../lib/soniox/regions';
import { sonioxVoiceField } from './SonioxProviderConfig';

// Backend-managed KizunaAI twin reuses the existing Soniox slice shape.
export const defaultKizunaSonioxSettings: SonioxSettings = { ...defaultSonioxSettings };

/** The exact message this twin has always produced for a signed-out user.
 *  Exported for tests to verify the exact error message thrown by
 *  acquireSessionResources when the auth token is not available. */
export const KIZUNA_SIGN_IN_REQUIRED = 'Sign in is required for Kizuna providers';

/**
 * KizunaAI Soniox — the backend-managed twin of the BYOK Soniox provider.
 * Same protocol/UI, but authenticated by the backend-managed Better Auth
 * session token instead of a user-entered Soniox API key: SonioxClient
 * exchanges the token for short-lived Soniox session keys via the backend's
 * /soniox/session-key endpoint (see SonioxClient's managed-mode docs).
 */
export class KizunaAISonioxProviderConfig extends SonioxProviderConfig {
  readonly settingsSliceKey: string = 'kizunaSoniox';

  // Backend-managed twin: credentials are a Better Auth session token fetched
  // from ctx, not the parent's apiKey settings-slice field.
  async extractCredentials(_slice: unknown, ctx: CredentialCtx): Promise<Credentials> {
    const token = ctx.getAuthToken ? await ctx.getAuthToken() : null;
    if (!token) return { ok: false, missing: KIZUNA_SIGN_IN_REQUIRED };
    return { ok: true, primary: token };
  }

  peekPrimaryCredential(): string {
    return '';
  }

  // The lease is not a stream property (design decision 7): MainPanel acquires
  // a ManagedSonioxSession and hands this client the bundle for its role. There
  // is deliberately no fallback that mints a lease here — a client that could
  // acquire its own would 409 the moment a session ran two of them.
  createClient(_creds: Credentials & { ok: true }, options: ClientOptions): IClient {
    const managed = options.sonioxManaged;
    if (!managed) {
      throw new Error(
        'The managed Soniox client must be built from a ManagedSonioxSession — acquire one and pass it as ClientOptions.sonioxManaged (see MainPanel.connectConversation).'
      );
    }
    return new SonioxClient(managed.credentials, {
      session: managed.session,
      // Same role the bundle was taken with — the client needs it to name its
      // own leg when it reports that Soniox accepted the stream.
      sttRole: managed.role,
      announcesSessionOutcome: managed.announcesSessionOutcome,
    });
  }

  /** Managed cloned voices are cache entries, not registrations: the one
   *  selected days ago may have been evicted since. Claim (and if needed
   *  rebuild) it now, before any client exists — the backend pins the slot
   *  for a short start window, which session-started then extends to the
   *  session's own expiry. Only the speaker channel speaks, so a
   *  participant-only or text-only session has no voice to prepare.
   *
   *  The envelope's two expectations carry the dropdown-stays-live race
   *  rule (the caller enforces it): preparation takes seconds, Settings is
   *  mounted throughout, and a choice the user made meanwhile must not be
   *  silently overwritten — `expect` guards the whole outcome at hook
   *  return, `expectAtApply` re-guards the session-config override after
   *  the further awaits between prep and connect. */
  async prepareToStart(slice: unknown, ports: PreparePorts): Promise<PrepareOutcome> {
    if (!ports.sessionShape.speakerWillStart || ports.sessionShape.textOnly) return { ok: true };
    const region = asSonioxRegion((slice as { region?: string })?.region);
    // The voice THIS region has selected: a cloned UUID exists only inside one
    // project, so the US selection means nothing to an EU session.
    const voice = (slice as Record<string, string | undefined>)?.[sonioxVoiceField(region)];
    const builtIn = new Set(this.getConfig().voices.map((v) => v.value));
    if (!voice || builtIn.has(voice)) return { ok: true };

    ports.onPhase({ phase: 'preparing-voice' });
    try {
      const result = await prepareManagedVoice({
        // Claimed in the region the session will actually run in.
        client: new ManagedVoicesClient(ports.getAuthToken, region),
        // Scoped to the signed-in account: the clip is one record on a
        // device several people may share, and handing this account
        // somebody else's recording would upload their voice under this
        // account. A mismatch (or nobody signed in) reads as "no clip
        // here", which the routine already degrades to a built-in voice.
        loadClip: () => loadVoiceClip(ports.userId),
        // The same Start-scoped aborter the hook itself already checks
        // post-await (below): threading it into the core too means a
        // mid-flight cancel now reaches the network instead of only being
        // noticed once the whole prep call has already settled.
        signal: ports.signal,
      });
      if (ports.signal.aborted) {
        // The Start this prepare belonged to is gone; hand back nothing to apply.
        // MainPanel discards an aborted prepare wholesale anyway — this keeps the
        // hook honest about the contract rather than relying on that.
        return { ok: true };
      }
      const outcome = resolveVoicePrepOutcome(result, voice, SONIOX_DEFAULT_VOICE);
      return {
        ok: true,
        ...(outcome.sessionVoice ? { sessionPatch: { voice: outcome.sessionVoice } } : {}),
        ...(outcome.settingsPatch ? { settingsPatch: outcome.settingsPatch } : {}),
        expect: { voice },
        expectAtApply: { voice: outcome.settingsPatch?.voice ?? voice },
        ...(outcome.notice ? { notice: i18n.t(outcome.notice.key, outcome.notice.defaultValue) } : {}),
      };
    } finally {
      ports.onPhase(null);
    }
  }

  async acquireSessionResources(ctx: AcquireSessionResourcesContext): Promise<SessionResources | null> {
    // The whole wiring decision, in one pure value: the matrix body to buy,
    // and the STT role each leg runs. Both roles are derived from the body,
    // so they mirror the server's own expansion — `credentialsFor` throws for
    // a role that was never issued, and `session-started` answers 400
    // `role_not_issued`, which leaves the lease at its start window while
    // both Soniox keys stay valid for the full grant.
    const wiring = resolveManagedSonioxWiring({
      speakerWillStart: ctx.wiring.speakerWillStart,
      participantWillStart: ctx.wiring.participantWillStart,
      textOnly: ctx.wiring.textOnly,
      sonioxSharedBoth: ctx.wiring.sharedBoth,
      sonioxSplitBoth: ctx.wiring.splitBoth,
      // From the slice the user actually configured. The RESPONSE's region is
      // what the bundles end up carrying (see ManagedSonioxSession.fileBundles)
      // -- this is only the request.
      region: asSonioxRegion(ctx.region),
    });
    const token = await ctx.getAuthToken();
    if (!token) throw new Error(KIZUNA_SIGN_IN_REQUIRED);
    const session = new ManagedSonioxSession({
      sessionToken: token,
      // The session's sink is typed `(type: string, ...)` because it must not
      // depend on any event union; the ctx port carries the closed two-member
      // vocabulary, so this narrows rather than widens — same escape as when
      // SonioxClient emitted these itself.
      onEvent: (type, data) =>
        ctx.onEvent(type as Parameters<AcquireSessionResourcesContext['onEvent']>[0], data),
    });
    try {
      await session.acquire(wiring.acquire);
    } catch (error) {
      // Normative error path: clean up our own partial state, then rethrow.
      // end() no-ops without a lease, so this is safe wherever acquire failed.
      session.end();
      throw error;
    }
    // Static budget parameters are read once (they don't change over the
    // lease); remaining time is recomputed against the clock on every call —
    // the caller polls once a second.
    let snapshot: SonioxBudgetSnapshot | null = null;
    return {
      legClientOptions: (role) => {
        const options = managedLegOptions(role, session, wiring);
        return options ? { sonioxManaged: options } : {};
      },
      budget: () => {
        snapshot ??= session.getBudgetSnapshot();
        return snapshot
          ? {
              remainingMs: computeSonioxRemainingMs(Date.now(), snapshot),
              totalMs: computeSonioxBudgetTotalMs(snapshot),
            }
          : null;
      },
      release: () => {
        // end() carries its own idempotency and no-lease guards; the reason
        // parameter is contract vocabulary, not behavior, today.
        session.end();
      },
    };
  }

  // Backend-managed twin: the "credential" is a Better Auth session token,
  // not a Soniox API key — sending it to Soniox's own validation endpoint
  // would fail, and minting a temporary key just to validate would burn one
  // of the org's limited (100/min) issuances for no benefit. A signed-in user
  // (non-empty token) validates statically; the backend enforces real auth
  // (and balance) when the managed session is actually started.
  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    return {
      validation: { valid: true, message: '', validating: false },
      models: [{ id: 'stt-rt-v5', type: 'realtime', created: Date.now() / 1000 }],
    };
  }

  getConfig(): ProviderConfig {
    const base = super.getConfig();
    return {
      ...base,
      id: 'kizunaai_soniox',
      displayName: 'KizunaAI Soniox',
      requiresAuth: true,
    };
  }
}
