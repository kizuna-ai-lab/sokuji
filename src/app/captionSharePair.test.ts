// src/app/captionSharePair.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { useProviderStore } from '../stores/providerStore';
import { sharedPair } from './captionShare';

const initial = useProviderStore.getState();
afterEach(() => useProviderStore.setState(initial, true));

const entry = (source: string, target: string) => ({ settings: {}, credentials: {}, pair: { source, target } });

describe('sharedPair: viewers are told the pair a run starts with', () => {
  it("reads the selected provider's pair when the host never picked one (intent null)", () => {
    useProviderStore.setState({ selected: 'soniox', intent: null, entries: { soniox: entry('ja', 'zh-CN') } });
    expect(sharedPair.get()).toEqual({ source: 'ja', target: 'zh-CN' });
  });

  it('follows the pair the provider offers, not the raw pick, when they differ', () => {
    useProviderStore.setState({ selected: 'gemini', intent: { source: 'ja', target: 'yue' }, entries: { gemini: entry('ja', 'zh-CN') } });
    expect(sharedPair.get()).toEqual({ source: 'ja', target: 'zh-CN' });
  });

  it('is null with no provider selected or loaded', () => {
    useProviderStore.setState({ selected: null, intent: { source: 'ja', target: 'en' }, entries: {} });
    expect(sharedPair.get()).toBeNull();
    useProviderStore.setState({ selected: 'soniox', entries: {} });
    expect(sharedPair.get()).toBeNull();
  });
});
