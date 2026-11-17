/**
 * The word list on its way to Soniox: what the user keeps in Settings › Word list and background,
 * read into the run's shape at Start (`readShapeFromStores`), built into Soniox's config and sent in the STT socket's
 * first frame. Soniox takes the written forms, the translations and the background; it has no field for "often heard
 * as", so those never leave the app for Soniox. An empty list sends no context at all. Driven on `FakeSocket`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

import { recordEvents } from '../../lib/contract/events';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { readShapeFromStores } from '../../lib/session/appShape';
import { useWordList } from '../../lib/words/list';
import { useProviderStore } from '../../stores/providerStore';
import { createSonioxAdapter } from './adapter';
import { buildSoniox } from './config';
import { SONIOX_DEFAULTS } from './settings';
import { AUTO_CTX, isStt, KEY, trackedClock, type Json } from './testing';

const auth = { signedIn: false, getToken: async () => null };

/** The first frame Soniox's STT socket is sent at Start, with the word list as the stores hold it. */
async function firstFrame(entries: Array<{ written: string; translation?: string; heardAs?: string }>, background: string): Promise<Json> {
  useWordList.setState({ entries, background, loaded: true });
  const shape = readShapeFromStores(auth);
  if (!shape) throw new Error('no run shape: the Soniox entry did not load');
  const sockets = fakeSockets();
  const { clock } = trackedClock();
  const config = buildSoniox(AUTO_CTX, SONIOX_DEFAULTS, { ...shape.shared, models: [] });
  const starting = createSonioxAdapter({ openSocket: sockets.create }).start(
    { context: AUTO_CTX, config, credentials: KEY, clock, signal: new AbortController().signal },
    recordEvents().events,
  );
  for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open();
  await starting;
  const stt = sockets.all.filter(isStt);
  expect(stt).toHaveLength(1);
  return stt[0].sentJson<Json>()[0];
}

beforeEach(() => {
  useProviderStore.setState({
    selected: 'soniox',
    entries: { soniox: { settings: SONIOX_DEFAULTS, credentials: { apiKey: 'k', apiKeyEu: '', apiKeyJp: '', apiKeyIn: '' }, pair: { source: 'en', target: 'ja' } } } as never,
    readiness: {},
    legs: ['speaker'],
  });
});

describe('the word list in the request Soniox is sent', () => {
  it("sends a person's and a product's written forms, a translation and the background, and no \"often heard as\"", async () => {
    const frame = await firstFrame([
      { written: 'Tanaka Hiroshi', heardAs: 'tana car, tanaka hero' },
      { written: 'Sokuji', translation: '即時', heardAs: 'so cooj' },
    ], '  Weekly product review with the Osaka team. ');
    expect(frame.context).toEqual({
      terms: ['Tanaka Hiroshi', 'Sokuji'],
      translation_terms: [{ source: 'Sokuji', target: '即時' }],
      text: 'Weekly product review with the Osaka team.',
    });
    const sent = JSON.stringify(frame);
    for (const heard of ['tana car', 'tanaka hero', 'so cooj']) expect(sent).not.toContain(heard);
  });

  it('sends no context when the list and the background are empty: no empty arrays, no empty text', async () => {
    const frame = await firstFrame([], '   ');
    expect('context' in frame).toBe(false);
    const sent = JSON.stringify(frame);
    for (const key of ['terms', 'translation_terms', '"text"']) expect(sent).not.toContain(key);
  });

  it('sends no translation_terms when no entry has a translation, and no terms for a background alone', async () => {
    expect((await firstFrame([{ written: 'Sokuji' }], '')).context).toEqual({ terms: ['Sokuji'] });
    expect((await firstFrame([], 'Quarterly planning.')).context).toEqual({ text: 'Quarterly planning.' });
  });
});
