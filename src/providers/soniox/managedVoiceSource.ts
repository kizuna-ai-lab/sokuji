/**
 * Kizuna Soniox's voice library source (survey §2.7): the account's one
 * cached voice, through our backend. One source per account and region —
 * keyed on the user and the account's `getToken`, which
 * `ProviderOwnSettings` keeps stable per account — so an account switch
 * mints a new one and the section reloads (the old memo's rule,
 * `ProviderSpecificSettings.tsx:273-289`). None while signed out.
 */
import { useMemo } from 'react';
import { managedVoiceSource, type VoiceLibrarySource } from '../../components/Settings/sections/voiceLibrarySource';
import { ManagedVoicesClient } from './managedVoicesClient';
import type { VoiceSourceHook } from './SonioxVoiceField';

let standIn: VoiceLibrarySource | null = null;

/** The development preview's stand-in (choice 15): its `&signedin=1` sign-in is not real, so no source may call the backend with it. Never set in the app. */
export function setManagedVoiceStandIn(source: VoiceLibrarySource | null): void {
  standIn = source;
}

export const useManagedVoiceSource: VoiceSourceHook = (account, region) => {
  const userId = account?.auth.signedIn ? account.auth.userId ?? null : null;
  const getToken = account?.auth.getToken;
  return useMemo(() => {
    if (!userId || !getToken) return null;
    if (standIn) return standIn;
    return managedVoiceSource(new ManagedVoicesClient(getToken, region), userId);
  }, [userId, getToken, region]);
};
