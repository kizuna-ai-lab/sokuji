// A session takes the word list as it stands at Start, so a name added
// from the notes reaches the next session.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));

import { readShapeFromStores } from './appShape';
import { addWord, useWordList } from '../words/list';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { useProviderStore } from '../../stores/providerStore';

const auth = { signedIn: false, getToken: async () => null };

beforeEach(() => {
  useProviderStore.setState({
    selected: 'fake', legs: ['speaker'],
    entries: { fake: { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' }, pair: { source: 'en', target: 'ja' } } },
  });
  useWordList.setState({ entries: [{ written: 'Kizuna AI' }], background: 'Weekly sync.', loaded: true });
});

describe('a word added from the notes takes effect in the next session', () => {
  it('carries the word list and background of the moment of Start, and the added name in the next one', async () => {
    const first = readShapeFromStores(auth)!;
    expect(first.shared.words).toEqual({ entries: [{ written: 'Kizuna AI' }], background: 'Weekly sync.' });
    await addWord({ written: 'Sokuji', heardAs: 'Soku G' });
    // The first session's shape is frozen; the next Start reads the list again.
    expect(first.shared.words!.entries).toEqual([{ written: 'Kizuna AI' }]);
    expect(readShapeFromStores(auth)!.shared.words!.entries).toEqual([{ written: 'Kizuna AI' }, { written: 'Sokuji', heardAs: 'Soku G' }]);
  });
});
