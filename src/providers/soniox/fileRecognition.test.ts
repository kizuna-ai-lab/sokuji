// Soniox declares it can transcribe a saved recording, with the key of the region its settings name.
import { describe, it, expect } from 'vitest';
import { sonioxProvider } from './provider';

describe('Soniox file recognition', () => {
  it('names the service, the region and that region’s key', () => {
    const spec = sonioxProvider.fileRecognition!;
    const settings = { ...sonioxProvider.settings.defaults, region: 'eu' as const };
    expect(spec(settings, { apiKey: 'sk-us', apiKeyEu: ' sk-eu ', apiKeyJp: '', apiKeyIn: '' } as never)).toEqual({ service: 'soniox', apiKey: 'sk-eu', region: 'eu' });
    expect(spec({ ...settings, region: 'us' }, { apiKey: 'sk-us' } as never)).toEqual({ service: 'soniox', apiKey: 'sk-us', region: 'us' });
  });

  it('says the key is missing when the region has none', () => {
    expect(sonioxProvider.fileRecognition!({ ...sonioxProvider.settings.defaults, region: 'jp' }, { apiKey: 'sk-us' } as never)).toEqual({ missing: 'no-key' });
  });
});
