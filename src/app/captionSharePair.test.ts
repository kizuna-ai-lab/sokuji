// src/app/captionSharePair.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { useProviderStore } from '../stores/providerStore';
import { runsOn } from '../stores/lineUpStore.testing';
import { sharedPair } from './captionShare';

const initial = useProviderStore.getState();
afterEach(() => useProviderStore.setState(initial, true));

const entry = (source: string, target: string) => ({ settings: {}, credentials: {}, pair: { source, target } });

describe('sharedPair: viewers are told the pair a run starts with', () => {
  it("reads the selected provider's pair when the host never picked one (intent null)", () => {
    runsOn('soniox');
    useProviderStore.setState({ intent: null, entries: { soniox: entry('ja', 'zh-CN') } });
    expect(sharedPair.get()).toEqual({ source: 'ja', target: 'zh-CN' });
  });

  it('follows the pair the provider offers, not the raw pick, when they differ', () => {
    runsOn('gemini');
    useProviderStore.setState({ intent: { source: 'ja', target: 'yue' }, entries: { gemini: entry('ja', 'zh-CN') } });
    expect(sharedPair.get()).toEqual({ source: 'ja', target: 'zh-CN' });
  });

  it('is null with no provider selected or loaded', () => {
    runsOn(null);
    useProviderStore.setState({ intent: { source: 'ja', target: 'en' }, entries: {} });
    expect(sharedPair.get()).toBeNull();
    runsOn('soniox');
    useProviderStore.setState({ entries: {} });
    expect(sharedPair.get()).toBeNull();
  });
});
