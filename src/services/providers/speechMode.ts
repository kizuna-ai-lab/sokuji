/**
 * Speech-mode vocabulary questions, answered from ProviderCapabilities.
 *
 * A mode is "push-gated" when audio reaches the provider only while the user
 * holds Space. Which mode NAMES mean that is per-provider vocabulary
 * ('Disabled' is OpenAI's spelling of push-to-talk), declared as
 * capabilities.pushGatedModes — this module is the one place that reads it,
 * shared by MainPanel and the subtitle window so the two can never disagree.
 */
import { ProviderConfigFactory } from './ProviderConfigFactory';
import type { ProviderType } from '../../types/Provider';

export function isPushGatedMode(provider: ProviderType, mode: string): boolean {
  const modes = ProviderConfigFactory.getDescriptor(provider).getConfig().capabilities.pushGatedModes;
  return modes?.includes(mode) ?? false;
}
