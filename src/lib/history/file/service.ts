// src/lib/history/file/service.ts
//
// Which service transcribes a file: the line-up's recognition stage (owner, 2026-11-16), through what its provider
// declares it needs (`Provider.fileRecognition`): the service that runs the job, the user's own key, its region.
import type { FileRecognitionSpec } from '../../provider/types';
import { getProvider } from '../../../providers/registry';
import { useLineUpStore } from '../../../stores/lineUpStore';
import { useProviderStore } from '../../../stores/providerStore';

export type FileRecognitionService = FileRecognitionSpec;
export interface FileRecognitionMissing { missing: 'no-file-service' | 'no-key' }

export async function fileRecognitionFromStores(): Promise<FileRecognitionService | FileRecognitionMissing> {
  const id = useLineUpStore.getState().lineUp?.transcription;
  const provider = id ? getProvider(id) : undefined;
  if (!id || !provider?.fileRecognition) return { missing: 'no-file-service' };
  if (!useProviderStore.getState().entries[id]) await useProviderStore.getState().load(provider);
  const entry = useProviderStore.getState().entries[id];
  if (!entry) return { missing: 'no-key' };
  return (provider.fileRecognition as (s: unknown, k: unknown) => FileRecognitionSpec | { missing: 'no-key' })(entry.settings, entry.credentials);
}
