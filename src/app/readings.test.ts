import { describe, it, expect, vi, beforeEach } from 'vitest';

const setJapaneseWanted = vi.fn();
vi.mock('../lib/reading/ja/runtime', () => ({ setJapaneseWanted }));
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));

const { useConversationDisplayStore } = await import('../stores/conversationDisplayStore');
const { useSubtitleStore } = await import('../stores/subtitleStore');
const { useProviderStore } = await import('../stores/providerStore');
const { bindReadings } = await import('./readings');

const choose = (target: string) => useProviderStore.setState({ selected: 'soniox', entries: { soniox: { pair: { source: 'zh', target } } } } as never);

describe('bindReadings', () => {
  beforeEach(() => {
    setJapaneseWanted.mockClear();
    useConversationDisplayStore.setState({ showReadings: false } as never);
    useSubtitleStore.setState({ showReadings: false } as never);
    choose('ja');
  });

  it('wants Japanese while either switch is on and the target is Japanese', () => {
    const unbind = bindReadings();
    expect(setJapaneseWanted).toHaveBeenLastCalledWith(false);
    useSubtitleStore.setState({ showReadings: true } as never);
    expect(setJapaneseWanted).toHaveBeenLastCalledWith(true);
    unbind();
  });

  it('tells the runtime when Japanese stops being wanted: the pair moved to Korean', () => {
    useConversationDisplayStore.setState({ showReadings: true } as never);
    const unbind = bindReadings();
    expect(setJapaneseWanted).toHaveBeenLastCalledWith(true);
    choose('ko');
    expect(setJapaneseWanted).toHaveBeenLastCalledWith(false);
    unbind();
  });

  it('stops Japanese when unbound', () => {
    useConversationDisplayStore.setState({ showReadings: true } as never);
    const unbind = bindReadings();
    unbind();
    expect(setJapaneseWanted).toHaveBeenLastCalledWith(false);
  });
});
