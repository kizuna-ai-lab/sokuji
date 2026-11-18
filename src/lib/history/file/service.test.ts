// Which service transcribes a file: the line-up's recognition stage, with its key for the selected region.
import { describe, it, expect, beforeEach } from 'vitest';
import { useLineUpStore } from '../../../stores/lineUpStore';
import { useProviderStore } from '../../../stores/providerStore';
import { useWordList } from '../../words/list';
import { fileRecognitionFromStores } from './service';

const lineUp = (transcription: string) => ({ transcription, translation: transcription, speech: transcription, summarisation: null });
const soniox = (settings: Record<string, unknown>, credentials: Record<string, string>) =>
  useProviderStore.setState({ entries: { soniox: { settings, credentials, pair: { source: 'en', target: 'ja' } } } as never });

beforeEach(() => {
  useLineUpStore.setState({ lineUp: lineUp('soniox'), stored: true } as never);
  soniox({ region: 'us' }, { apiKey: ' sk-us ' });
  useWordList.setState({ entries: [], background: '', loaded: true });
});

describe('the file recognition service', () => {
  it('is Soniox with the key of the selected region', async () => {
    const named = { service: 'soniox', languageHint: expect.any(Function), languages: expect.any(Array) };
    expect(await fileRecognitionFromStores()).toEqual({ ...named, apiKey: 'sk-us', region: 'us' });
    soniox({ region: 'eu' }, { apiKey: 'sk-us', apiKeyEu: 'sk-eu' });
    expect(await fileRecognitionFromStores()).toEqual({ ...named, apiKey: 'sk-eu', region: 'eu' });
  });

  it('carries the app\u2019s word list, as the service sends it', async () => {
    useWordList.setState({ entries: [{ written: 'Sokuji' }], background: 'A weekly meeting.', loaded: true });
    expect(await fileRecognitionFromStores()).toMatchObject({ context: { terms: ['Sokuji'], text: 'A weekly meeting.' } });
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

  // B-35 (owner, 2026-11-17): Kizuna AI's Soniox transcribes live sessions only, for now; said as such, not as "not Soniox".
  it('is missing as Kizuna AI\'s Soniox when that is the transcription in the line-up', async () => {
    useLineUpStore.setState({ lineUp: lineUp('kizunaai_soniox') } as never);
    expect(await fileRecognitionFromStores()).toEqual({ missing: 'hosted-soniox' });
  });
});
