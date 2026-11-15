// Which service transcribes a file: the line-up's recognition stage, with its key for the selected region.
import { describe, it, expect, beforeEach } from 'vitest';
import { useLineUpStore } from '../../../stores/lineUpStore';
import { useProviderStore } from '../../../stores/providerStore';
import { fileRecognitionFromStores } from './service';

const lineUp = (transcription: string) => ({ transcription, translation: transcription, speech: transcription, summarisation: null });
const soniox = (settings: Record<string, unknown>, credentials: Record<string, string>) =>
  useProviderStore.setState({ entries: { soniox: { settings, credentials, pair: { source: 'en', target: 'ja' } } } as never });

beforeEach(() => {
  useLineUpStore.setState({ lineUp: lineUp('soniox'), stored: true } as never);
  soniox({ region: 'us' }, { apiKey: ' sk-us ' });
});

describe('the file recognition service', () => {
  it('is Soniox with the key of the selected region', async () => {
    expect(await fileRecognitionFromStores()).toEqual({ service: 'soniox', apiKey: 'sk-us', region: 'us' });
    soniox({ region: 'eu' }, { apiKey: 'sk-us', apiKeyEu: 'sk-eu' });
    expect(await fileRecognitionFromStores()).toEqual({ service: 'soniox', apiKey: 'sk-eu', region: 'eu' });
  });

  it('is missing when the recognition service cannot transcribe files, or the region has no key', async () => {
    useLineUpStore.setState({ lineUp: lineUp('openai') } as never);
    expect(await fileRecognitionFromStores()).toEqual({ missing: 'no-file-service' });
    useLineUpStore.setState({ lineUp: null } as never);
    expect(await fileRecognitionFromStores()).toEqual({ missing: 'no-file-service' });
    useLineUpStore.setState({ lineUp: lineUp('soniox') } as never);
    soniox({ region: 'jp' }, { apiKey: 'sk-us' });
    expect(await fileRecognitionFromStores()).toEqual({ missing: 'no-key' });
  });
});
