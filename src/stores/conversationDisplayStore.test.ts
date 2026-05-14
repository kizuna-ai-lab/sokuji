import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useConversationDisplayStore,
  CONVERSATION_FONT_SIZE_MIN,
  CONVERSATION_FONT_SIZE_MAX,
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
    useConversationDisplayStore.setState({
      fontSize: 14,
      compactMode: false,
      bgColor: '#1f1f1f',
      sourceTextColor: '#9aa0a6',
      translationTextColor: '#e8e8e8',
    });
  });

  it('exports CONVERSATION_FONT_SIZE_MIN=12 and CONVERSATION_FONT_SIZE_MAX=64', () => {
    expect(CONVERSATION_FONT_SIZE_MIN).toBe(12);
    expect(CONVERSATION_FONT_SIZE_MAX).toBe(64);
  });

  it('has the documented defaults', () => {
    const s = useConversationDisplayStore.getState();
    expect(s.fontSize).toBe(14);
    expect(s.compactMode).toBe(false);
    expect(s.bgColor).toBe('#1f1f1f');
    expect(s.sourceTextColor).toBe('#9aa0a6');
    expect(s.translationTextColor).toBe('#e8e8e8');
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
    expect(s.bgColor).toBe('#1f1f1f');
  });

  it('hydrate does NOT read the old conversationFontSize / conversationCompactMode keys', async () => {
    await useConversationDisplayStore.getState().hydrate();
    const calls = mockGetSetting.mock.calls.map((c) => c[0] as string);
    expect(calls).not.toContain('settings.common.conversationFontSize');
    expect(calls).not.toContain('settings.common.conversationCompactMode');
  });

  it('selector hooks exist', () => {
    expect(typeof useConversationDisplayFontSize).toBe('function');
    expect(typeof useConversationDisplayBgColor).toBe('function');
  });
});
