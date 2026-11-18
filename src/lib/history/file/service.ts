// src/lib/history/file/service.ts
//
// Which service transcribes a file: the line-up's recognition stage (owner, 2026-11-16), through what its provider
// declares it needs (`Provider.fileRecognition`): the service that runs the job, the user's own key, its region; or,
// for Kizuna AI's Soniox, the Kizuna AI service, reached with the sign-in.
import type { FileRecognitionSpec } from '../../provider/types';
import { getProvider } from '../../../providers/registry';
import { currentAuth } from '../../../app/currentAuth';
import { useAccountStore } from '../../../stores/accountStore';
import { useLineUpStore } from '../../../stores/lineUpStore';
import { useProviderStore } from '../../../stores/providerStore';
import { getApiUrl } from '../../../utils/environment';
import { accountPayer } from '../../session/payerChoice';
import { useWordList } from '../../words/list';
import type { SessionWords } from '../../provider/types';

/** How a hosted service is reached: its address, the sign-in's token as it is when asked, and who pays. */
export interface HostedAccess {
  apiUrl: string;
  /** Read just before each track is sent, so a sign-out between tracks is seen; null signed out. */
  token(): Promise<string | null>;
  payer?: 'organization' | 'personal';
}

/** A provider's file recognition, with how to reach it: `access` is present exactly when the spec is `hosted`. */
export type FileRecognitionService = FileRecognitionSpec & { access?: HostedAccess };
export interface FileRecognitionMissing { missing: 'no-file-service' | 'no-key' | 'sign-in' }

export async function fileRecognitionFromStores(): Promise<FileRecognitionService | FileRecognitionMissing> {
  const id = useLineUpStore.getState().lineUp?.transcription;
  const provider = id ? getProvider(id) : undefined;
  if (!id || !provider?.fileRecognition) return { missing: 'no-file-service' };
  if (!useProviderStore.getState().entries[id]) await useProviderStore.getState().load(provider);
  const entry = useProviderStore.getState().entries[id];
  if (!entry) return { missing: 'no-key' };
  // The word list as a session reads it at start: what the user has now.
  if (!useWordList.getState().loaded) await useWordList.getState().load();
  const { entries, background } = useWordList.getState();
  const words: SessionWords = { entries, background };
  const spec = (provider.fileRecognition as (s: unknown, k: unknown, w: SessionWords) => FileRecognitionSpec | { missing: 'no-key' })(entry.settings, entry.credentials, words);
  if ('missing' in spec || !('hosted' in spec)) return spec;
  // Kizuna AI's service takes the sign-in for a key, and charges the payer hosted notes name.
  if (currentAuth()?.signedIn !== true) return { missing: 'sign-in' };
  return {
    ...spec,
    access: {
      apiUrl: getApiUrl(),
      token: async () => (await currentAuth()?.getToken()) ?? null,
      payer: accountPayer(useAccountStore.getState().account),
    },
  };
}
