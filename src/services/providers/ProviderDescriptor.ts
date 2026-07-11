import { ProviderConfig, LanguageOption } from './ProviderConfig';
import { IClient, FilteredModel, SessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';

/** Transport for realtime providers. Moved here from settingsStore so the
 *  services layer no longer imports from stores. settingsStore re-exports it. */
export type TransportType = 'websocket' | 'webrtc';

/** Normalized credentials produced by a descriptor from its settings slice.
 *  `missing` carries the user-facing message shown when validation is attempted
 *  with incomplete fields (e.g. "Both Client ID and Client Secret are required
 *  for Palabra AI"). Callers never name provider-specific fields. */
export type Credentials =
  | { ok: true; primary: string; secret?: string; endpoint?: string }
  | { ok: false; missing: string };

export type CredentialCtx = {
  /** Better Auth session-token accessor — required only by the kizuna twins. */
  getAuthToken?: () => Promise<string | null>;
};

export type ClientOptions = {
  transport: TransportType;
  webrtcOptions?: { inputDeviceId?: string; outputDeviceId?: string };
};

/**
 * The deep module for one provider. Everything the app needs to know about a
 * provider is answered here; callers dispatch via
 * ProviderConfigFactory.getDescriptor(provider) instead of switching on the enum.
 * See CONTEXT.md ("ProviderDescriptor").
 */
export interface ProviderDescriptor {
  getConfig(): ProviderConfig;
  /** zustand slice in SettingsStore holding this provider's persisted settings. */
  readonly settingsSliceKey: string;
  /** i18n namespace under `providers.*`; defaults to getConfig().id. */
  readonly i18nKey?: string;
  /** True for providers that can run over WebRTC transport. */
  readonly supportsWebRTC: boolean;

  createClient(creds: Credentials & { ok: true }, options: ClientOptions): IClient;
  validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }>;
  latestRealtimeModel(models: FilteredModel[]): string;

  extractCredentials(slice: unknown, ctx: CredentialCtx): Promise<Credentials>;
  /** Sync read of what the user has typed as the primary credential — for UI
   *  display only (ProviderSection key indicator). '' when not applicable. */
  peekPrimaryCredential(slice: unknown): string;

  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig;

  resolveSourceLanguages(): LanguageOption[];
  resolveTargetLanguages(source: string): LanguageOption[];
  reconcileTarget(source: string, currentTarget: string): string;
}

/** Shared defaults. Subclasses override only what differs from the common case
 *  (single apiKey credential, model list from config, unrestricted languages). */
export abstract class BaseProviderDescriptor implements ProviderDescriptor {
  abstract getConfig(): ProviderConfig;
  abstract readonly settingsSliceKey: string;
  readonly i18nKey?: string;
  readonly supportsWebRTC: boolean = false;

  abstract createClient(creds: Credentials & { ok: true }, options: ClientOptions): IClient;
  abstract validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }>;
  abstract buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig;

  latestRealtimeModel(models: FilteredModel[]): string {
    return models[0]?.id ?? this.getConfig().models[0]?.id ?? '';
  }

  async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
    const apiKey = (slice as { apiKey?: string })?.apiKey ?? '';
    if (!apiKey) return { ok: false, missing: `API key is required for ${this.getConfig().id}` };
    return { ok: true, primary: apiKey };
  }

  peekPrimaryCredential(slice: unknown): string {
    return (slice as { apiKey?: string })?.apiKey ?? '';
  }

  resolveSourceLanguages(): LanguageOption[] {
    return this.getConfig().languages;
  }

  resolveTargetLanguages(_source: string): LanguageOption[] {
    const cfg = this.getConfig();
    return cfg.targetLanguages ?? cfg.languages;
  }

  reconcileTarget(source: string, currentTarget: string): string {
    const allowed = this.resolveTargetLanguages(source).map(l => l.value);
    return allowed.includes(currentTarget) ? currentTarget : (allowed[0] ?? currentTarget);
  }
}
