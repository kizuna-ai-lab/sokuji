import { useMemo } from 'react';
import SonioxVoiceSection from '../../components/Settings/sections/SonioxVoiceSection';
import { byokVoiceSource, type VoiceLibrarySource } from '../../components/Settings/sections/voiceLibrarySource';
import type { ProviderAccount } from '../../lib/provider/types';
import { asSonioxRegion, type SonioxRegion } from '../../lib/soniox/regions';
import { sonioxKeyField, sonioxVoiceField, type SonioxSettings } from './settings';
import { SonioxVoicesClient } from './voicesClient';

/** Where the voice library's voices come from, as a hook so each flavour memoizes on its own inputs (choice 12). */
export type VoiceSourceHook = (account: ProviderAccount | undefined, region: SonioxRegion) => VoiceLibrarySource | null;

/** An own key: the region's project, straight from the device; none until that region's key is saved. One source per (key, region). */
export const useByokVoiceSource: VoiceSourceHook = (account, region) => {
  const key = account?.credentials[sonioxKeyField(region)] ?? '';
  return useMemo(
    () => (key ? byokVoiceSource(new SonioxVoicesClient(key, region), { apiKey: key, region }) : null),
    [key, region],
  );
};

interface SonioxVoiceFieldProps {
  settings: SonioxSettings;
  update(patch: Partial<SonioxSettings>): void;
  disabled: boolean;
  /** The pair's target: what the preview speaks. */
  target: string;
  account?: ProviderAccount;
  managed: boolean;
  useVoiceSource: VoiceSourceHook;
}

/**
 * The voice library behind a thin wrapper (F13): today's `SonioxVoiceSection`,
 * unchanged, fed the active region's voice and key and writing the
 * region's own voice field (a clone is a UUID inside one project).
 */
export function SonioxVoiceField({ settings, update, disabled, target, account, managed, useVoiceSource }: SonioxVoiceFieldProps) {
  const region = asSonioxRegion(settings.region);
  const field = sonioxVoiceField(region);
  const source = useVoiceSource(account, region);
  return (
    <SonioxVoiceSection
      settings={{ voice: settings[field], apiKey: account?.credentials[sonioxKeyField(region)] ?? '', targetLanguage: target, ttsSpeed: settings.ttsSpeed, region }}
      onUpdate={({ voice }) => update({ [field]: voice } as Partial<SonioxSettings>)}
      source={source}
      managed={managed}
      isSessionActive={disabled}
    />
  );
}
