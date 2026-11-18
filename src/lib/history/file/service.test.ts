// Which service transcribes a file: the line-up's recognition stage, with its key for the selected region, or Kizuna
// AI's service with the sign-in.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerAuth } from '../../../app/currentAuth';
import { useAccountStore } from '../../../stores/accountStore';
import { useLineUpStore } from '../../../stores/lineUpStore';
import { useProviderStore } from '../../../stores/providerStore';
import { getApiUrl } from '../../../utils/environment';
import { setUseOwnBalance } from '../../session/payerChoice';
import type { AccountState } from '../../session/types';
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

  // Kizuna AI's Soniox transcribes a file through the Kizuna AI service, reached with the sign-in, never a key.
  describe('Kizuna AI’s Soniox', () => {
    const member: AccountState = {
      status: 'known', balanceMicroUsd: 0, frozen: false,
      organization: { name: 'Org', availableMicroUsd: 1, frozen: false }, personal: { balanceMicroUsd: 1, frozen: false },
    };

    beforeEach(() => {
      useLineUpStore.setState({ lineUp: lineUp('kizunaai_soniox') } as never);
      useProviderStore.setState({ entries: { kizunaai_soniox: { settings: { region: 'jp' }, credentials: {}, pair: { source: 'en', target: 'ja' } } } as never });
      useAccountStore.setState({ account: null });
    });
    afterEach(() => {
      registerAuth(() => undefined);
      setUseOwnBalance(false);
    });

    it('asks for the sign-in when signed out', async () => {
      registerAuth(() => ({ signedIn: false, getToken: async () => null }));
      expect(await fileRecognitionFromStores()).toEqual({ missing: 'sign-in' });
      // No sign-in wired at all reads as signed out.
      registerAuth(() => undefined);
      expect(await fileRecognitionFromStores()).toEqual({ missing: 'sign-in' });
    });

    it('signed in, is the Kizuna AI service in the saved region, reached at the app’s service address', async () => {
      registerAuth(() => ({ signedIn: true, getToken: async () => 'tok' }));
      useWordList.setState({ entries: [{ written: 'Sokuji' }], background: '', loaded: true });
      const service = await fileRecognitionFromStores();
      if ('missing' in service || !('hosted' in service)) throw new Error('not hosted');
      expect(service).toMatchObject({ service: 'kizunaai_soniox', hosted: true, region: 'jp', context: { terms: ['Sokuji'] } });
      expect(service).not.toHaveProperty('apiKey');
      expect(service.access?.apiUrl).toBe(getApiUrl());
      // A non-member has no payer to name.
      expect(service.access?.payer).toBeUndefined();
    });

    // The token is read when a track is sent, not when the service is looked up: a sign-out in between is seen.
    it('reads the sign-in’s token each time it is asked, as the sign-in is then', async () => {
      registerAuth(() => ({ signedIn: true, getToken: async () => 'tok' }));
      const service = await fileRecognitionFromStores();
      if ('missing' in service || !('hosted' in service)) throw new Error('not hosted');
      await expect(service.access!.token()).resolves.toBe('tok');
      registerAuth(() => ({ signedIn: true, getToken: async () => 'tok-2' }));
      await expect(service.access!.token()).resolves.toBe('tok-2');
      registerAuth(() => ({ signedIn: false, getToken: async () => null }));
      await expect(service.access!.token()).resolves.toBeNull();
      registerAuth(() => undefined);
      await expect(service.access!.token()).resolves.toBeNull();
    });

    it('names the payer as hosted notes do: the organization, or the person when the switch says so', async () => {
      registerAuth(() => ({ signedIn: true, getToken: async () => 'tok' }));
      useAccountStore.setState({ account: member });
      const asOrg = await fileRecognitionFromStores();
      expect('missing' in asOrg ? null : asOrg.access?.payer).toBe('organization');
      setUseOwnBalance(true);
      const asPerson = await fileRecognitionFromStores();
      expect('missing' in asPerson ? null : asPerson.access?.payer).toBe('personal');
    });
  });

  it('reaches the user’s own key with nothing more: no service address, no sign-in', async () => {
    expect(await fileRecognitionFromStores()).not.toHaveProperty('access');
  });
});
