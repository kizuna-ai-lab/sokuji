// src/lib/history/file/service.ts
//
// Which service transcribes a file: the line-up's recognition stage (owner, 2026-11-16), through what its provider
// declares it needs (`Provider.fileRecognition`): the service that runs the job, the user's own key, its region.
import type { FileRecognitionSpec } from '../../provider/types';
import { getProvider } from '../../../providers/registry';
import { useLineUpStore } from '../../../stores/lineUpStore';
import { useProviderStore } from '../../../stores/providerStore';
import { useWordList } from '../../words/list';
import type { SessionWords } from '../../provider/types';

export type FileRecognitionService = FileRecognitionSpec;
export interface FileRecognitionMissing { missing: 'no-file-service' | 'hosted-soniox' | 'no-key' }

export async function fileRecognitionFromStores(): Promise<FileRecognitionService | FileRecognitionMissing> {
  const id = useLineUpStore.getState().lineUp?.transcription;
  const provider = id ? getProvider(id) : undefined;
  // Kizuna AI's Soniox transcribes live sessions only, for now: said as such, not as a service that is not Soniox (B-35).
  if (id === 'kizunaai_soniox') return { missing: 'hosted-soniox' };
  if (!id || !provider?.fileRecognition) return { missing: 'no-file-service' };
  if (!useProviderStore.getState().entries[id]) await useProviderStore.getState().load(provider);
  const entry = useProviderStore.getState().entries[id];
  if (!entry) return { missing: 'no-key' };
  // The word list as a session reads it at start: what the user has now.
  if (!useWordList.getState().loaded) await useWordList.getState().load();
  const { entries, background } = useWordList.getState();
  const words: SessionWords = { entries, background };
  return (provider.fileRecognition as (s: unknown, k: unknown, w: SessionWords) => FileRecognitionSpec | { missing: 'no-key' })(entry.settings, entry.credentials, words);
}
