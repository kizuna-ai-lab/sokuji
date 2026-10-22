import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useConversationDisplayStore,
  CONVERSATION_FONT_SIZE_MIN,
  CONVERSATION_FONT_SIZE_MAX,
  CONVERSATION_SCHEME_COLOURS,
  resolveConversationColours,
  useConversationDisplayFontSize,
  useConversationDisplayBgColor,
} from './conversationDisplayStore';

const mockSetSetting = vi.fn(async () => ({ success: true }));
const mockGetSetting = vi.fn(async (_key: string, def: unknown) => def);

vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: mockGetSetting,
      setSetting: mockSetSetting,
    }),
  },
}));

describe('conversationDisplayStore', () => {
  beforeEach(() => {
    mockSetSetting.mockClear();
    mockGetSetting.mockClear();
    mockGetSetting.mockImplementation(async (_key: string, def: unknown) => def);
    useConversationDisplayStore.setState({
      fontSize: 14,
      compactMode: false,
      bgColor: null,
      sourceTextColor: null,
      translationTextColor: null,
    });
  });

  it('exports CONVERSATION_FONT_SIZE_MIN=12 and CONVERSATION_FONT_SIZE_MAX=64', () => {
    expect(CONVERSATION_FONT_SIZE_MIN).toBe(12);
    expect(CONVERSATION_FONT_SIZE_MAX).toBe(64);
  });

  // A colour the user never set is null: it follows the app's scheme
  // (resolveConversationColours), so the first switch to the light theme
  // takes the conversation with it, and dark users see today's colours.
  it('has the documented defaults: no colour stored', () => {
    const s = useConversationDisplayStore.getState();
    expect(s.fontSize).toBe(14);
    expect(s.compactMode).toBe(false);
    expect(s.bgColor).toBeNull();
    expect(s.sourceTextColor).toBeNull();
    expect(s.translationTextColor).toBeNull();
  });

  it("the follow-theme colours: dark is today's set, light is the white set", () => {
    expect(CONVERSATION_SCHEME_COLOURS.dark).toEqual({ bgColor: '#1f1f1f', sourceTextColor: '#9aa0a6', translationTextColor: '#e8e8e8' });
    expect(CONVERSATION_SCHEME_COLOURS.light).toEqual({ bgColor: '#ffffff', sourceTextColor: '#5f6368', translationTextColor: '#1a1a1a' });
  });

  it("resolveConversationColours takes the scheme's colour where nothing is stored, the stored one otherwise", () => {
    const unset = { bgColor: null, sourceTextColor: null, translationTextColor: null };
    expect(resolveConversationColours(unset, 'light')).toEqual(CONVERSATION_SCHEME_COLOURS.light);
    expect(resolveConversationColours(unset, 'dark')).toEqual(CONVERSATION_SCHEME_COLOURS.dark);
    expect(resolveConversationColours({ bgColor: '#123456', sourceTextColor: null, translationTextColor: '#abcdef' }, 'light'))
      .toEqual({ bgColor: '#123456', sourceTextColor: '#5f6368', translationTextColor: '#abcdef' });
  });

  it('setBgColor(null) persists null: the colour follows the theme again', async () => {
    useConversationDisplayStore.setState({ bgColor: '#FFFFFF' });
    await useConversationDisplayStore.getState().setBgColor(null);
    expect(mockSetSetting).toHaveBeenCalledWith('settings.common.conversationDisplay.bgColor', null);
    expect(useConversationDisplayStore.getState().bgColor).toBeNull();
  });

  it('hydrate keeps a stored colour and leaves an unset one null', async () => {
    mockGetSetting.mockImplementation(async (key: string, def: unknown) => (key.endsWith('.bgColor') ? '#FFFFFF' : def));
    await useConversationDisplayStore.getState().hydrate();
    const s = useConversationDisplayStore.getState();
    expect(s.bgColor).toBe('#FFFFFF');
    expect(s.sourceTextColor).toBeNull();
    expect(s.translationTextColor).toBeNull();
  });

  it('clamps setFontSize to [12, 64]', async () => {
    await useConversationDisplayStore.getState().setFontSize(8);
    expect(useConversationDisplayStore.getState().fontSize).toBe(12);
    await useConversationDisplayStore.getState().setFontSize(99);
    expect(useConversationDisplayStore.getState().fontSize).toBe(64);
    await useConversationDisplayStore.getState().setFontSize(28);
    expect(useConversationDisplayStore.getState().fontSize).toBe(28);
  });

  it('persists each setter under the conversationDisplay namespace', async () => {
    await useConversationDisplayStore.getState().setBgColor('#FFFFFF');
    expect(mockSetSetting).toHaveBeenCalledWith(
      'settings.common.conversationDisplay.bgColor',
      '#FFFFFF',
    );
    await useConversationDisplayStore.getState().setSourceTextColor('#000000');
    expect(mockSetSetting).toHaveBeenCalledWith(
      'settings.common.conversationDisplay.sourceTextColor',
      '#000000',
    );
    await useConversationDisplayStore.getState().setTranslationTextColor('#003B6F');
    expect(mockSetSetting).toHaveBeenCalledWith(
      'settings.common.conversationDisplay.translationTextColor',
      '#003B6F',
    );
    await useConversationDisplayStore.getState().setFontSize(20);
    expect(mockSetSetting).toHaveBeenCalledWith(
      'settings.common.conversationDisplay.fontSize',
      20,
    );
    await useConversationDisplayStore.getState().setCompactMode(true);
    expect(mockSetSetting).toHaveBeenCalledWith(
      'settings.common.conversationDisplay.compactMode',
      true,
    );
  });

  it('hydrate reads only from settings.common.conversationDisplay.* keys', async () => {
    await useConversationDisplayStore.getState().hydrate();
    const calls = mockGetSetting.mock.calls.map((c) => c[0] as string);
    expect(calls.length).toBeGreaterThan(0);
    for (const key of calls) {
      expect(key.startsWith('settings.common.conversationDisplay.')).toBe(true);
    }
    const s = useConversationDisplayStore.getState();
    expect(s.fontSize).toBe(14);
    expect(s.bgColor).toBeNull();
  });

  it('hydrate does NOT read the old conversationFontSize / conversationCompactMode keys', async () => {
    await useConversationDisplayStore.getState().hydrate();
    const calls = mockGetSetting.mock.calls.map((c) => c[0] as string);
    expect(calls).not.toContain('settings.common.conversationFontSize');
    expect(calls).not.toContain('settings.common.conversationCompactMode');
  });

  it('rolls back optimistic state when persistence fails', async () => {
    mockSetSetting.mockRejectedValueOnce(new Error('disk full'));
    const before = useConversationDisplayStore.getState().bgColor;
    await useConversationDisplayStore.getState().setBgColor('#FFFFFF');
    expect(useConversationDisplayStore.getState().bgColor).toBe(before);
  });

  it('selector hooks exist', () => {
    expect(typeof useConversationDisplayFontSize).toBe('function');
    expect(typeof useConversationDisplayBgColor).toBe('function');
  });

  it('has readings off by default and persists the switch under the conversationDisplay namespace', async () => {
    useConversationDisplayStore.setState({ showReadings: false } as never);
    expect(useConversationDisplayStore.getState().showReadings).toBe(false);
    await useConversationDisplayStore.getState().setShowReadings(true);
    expect(useConversationDisplayStore.getState().showReadings).toBe(true);
    expect(mockSetSetting).toHaveBeenCalledWith('settings.common.conversationDisplay.showReadings', true);
  });

  it('hydrates showReadings', async () => {
    mockGetSetting.mockImplementation(async (key: string, def: unknown) => (key.endsWith('showReadings') ? true : def));
    await useConversationDisplayStore.getState().hydrate();
    expect(useConversationDisplayStore.getState().showReadings).toBe(true);
    mockGetSetting.mockImplementation(async (_key: string, def: unknown) => def);
  });
});
