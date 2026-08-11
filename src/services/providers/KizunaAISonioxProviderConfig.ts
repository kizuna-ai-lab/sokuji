import { SonioxProviderConfig, SonioxSettings, defaultSonioxSettings } from './SonioxProviderConfig';
import { ProviderConfig } from './ProviderConfig';
import { Credentials, CredentialCtx, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { SonioxClient } from '../clients/SonioxClient';

// Backend-managed KizunaAI twin reuses the existing Soniox slice shape.
export const defaultKizunaSonioxSettings: SonioxSettings = { ...defaultSonioxSettings };

/** The exact message this twin has always produced for a signed-out user.
 *  Exported so MainPanel's acquire path can throw the same sentence — the
 *  lease moved out of the client, so the sign-in gate now fires there first.
 *  Pinned by descriptorRegistry.test.ts. */
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
