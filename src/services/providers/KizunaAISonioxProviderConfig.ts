import { SonioxProviderConfig, SonioxSettings, defaultSonioxSettings } from './SonioxProviderConfig';
import { ProviderConfig } from './ProviderConfig';
import { Credentials, CredentialCtx, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { SonioxClient } from '../clients/SonioxClient';

// Backend-managed KizunaAI twin reuses the existing Soniox slice shape.
export const defaultKizunaSonioxSettings: SonioxSettings = { ...defaultSonioxSettings };

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
    if (!token) return { ok: false, missing: 'Sign in is required for Kizuna providers' };
    return { ok: true, primary: token };
  }

  peekPrimaryCredential(): string {
    return '';
  }

  // Override — SonioxClient exchanges the session token for temporary Soniox
  // keys at connect() time; no BYOK apiKey is ever used here.
  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new SonioxClient('', { managed: { sessionToken: creds.primary } });
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
