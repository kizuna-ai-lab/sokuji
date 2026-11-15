// src/lib/history/file/service.ts
//
// Which service transcribes a file: the line-up's recognition stage (owner, 2026-11-16), with the user's own key for
// the region selected there. This version knows Soniox's file recognition only.
import { asSonioxRegion, type SonioxRegion } from '../../soniox/regions';
import { sonioxProvider } from '../../../providers/soniox/provider';
import { sonioxKeyField } from '../../../providers/soniox/settings';
import { useLineUpStore } from '../../../stores/lineUpStore';
import { useProviderStore } from '../../../stores/providerStore';

export interface FileRecognitionService { service: 'soniox'; apiKey: string; region: SonioxRegion }
export interface FileRecognitionMissing { missing: 'not-soniox' | 'no-key' }

export async function fileRecognitionFromStores(): Promise<FileRecognitionService | FileRecognitionMissing> {
  if (useLineUpStore.getState().lineUp?.transcription !== 'soniox') return { missing: 'not-soniox' };
  if (!useProviderStore.getState().entries.soniox) await useProviderStore.getState().load(sonioxProvider);
  const entry = useProviderStore.getState().entries.soniox;
  const region = asSonioxRegion((entry?.settings as { region?: unknown } | undefined)?.region);
  const apiKey = String((entry?.credentials as Record<string, unknown> | undefined)?.[sonioxKeyField(region)] ?? '').trim();
  if (!apiKey) return { missing: 'no-key' };
  return { service: 'soniox', apiKey, region };
}
