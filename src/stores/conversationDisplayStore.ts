import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useShallow } from 'zustand/shallow';
import { ServiceFactory } from '../services/ServiceFactory';

interface ConversationDisplayState {
  // Typography
  fontSize: number;            // clamped [CONVERSATION_FONT_SIZE_MIN, CONVERSATION_FONT_SIZE_MAX]
  compactMode: boolean;
  // Colors (hex)
  bgColor: string;
  sourceTextColor: string;
  translationTextColor: string;

  // Actions (async because persistence is async — matches subtitleStore)
  setFontSize: (n: number) => Promise<void>;
  setCompactMode: (b: boolean) => Promise<void>;
  setBgColor: (s: string) => Promise<void>;
  setSourceTextColor: (s: string) => Promise<void>;
  setTranslationTextColor: (s: string) => Promise<void>;

  // Hydration (called once at app boot from src/routes/Home.tsx)
  hydrate: () => Promise<void>;
}

const DEFAULTS = {
  fontSize: 14,
  compactMode: false,
  bgColor: '#1f1f1f',
  sourceTextColor: '#9aa0a6',
  translationTextColor: '#e8e8e8',
};

export const CONVERSATION_FONT_SIZE_MIN = 12;
export const CONVERSATION_FONT_SIZE_MAX = 64;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

const KEY = (suffix: string) => `settings.common.conversationDisplay.${suffix}`;

async function persist(
  keySuffix: string,
  value: unknown,
  fieldNameForLog: string,
): Promise<{ ok: boolean }> {
  try {
    await ServiceFactory.getSettingsService().setSetting(KEY(keySuffix), value);
    return { ok: true };
  } catch (error) {
    console.error(`[ConversationDisplayStore] Error persisting ${fieldNameForLog}:`, error);
    return { ok: false };
  }
}

export const useConversationDisplayStore = create<ConversationDisplayState>()(
  subscribeWithSelector((set, get) => ({
    ...DEFAULTS,

    setFontSize: async (n) => {
      const clamped = clamp(Math.round(n), CONVERSATION_FONT_SIZE_MIN, CONVERSATION_FONT_SIZE_MAX);
      const previous = get().fontSize;
      set({ fontSize: clamped });
      const { ok } = await persist('fontSize', clamped, 'fontSize');
      if (!ok) set({ fontSize: previous });
    },
    setCompactMode: async (b) => {
      const previous = get().compactMode;
      set({ compactMode: b });
      const { ok } = await persist('compactMode', b, 'compactMode');
      if (!ok) set({ compactMode: previous });
    },
    setBgColor: async (s) => {
      const previous = get().bgColor;
      set({ bgColor: s });
      const { ok } = await persist('bgColor', s, 'bgColor');
      if (!ok) set({ bgColor: previous });
    },
    setSourceTextColor: async (s) => {
      const previous = get().sourceTextColor;
      set({ sourceTextColor: s });
      const { ok } = await persist('sourceTextColor', s, 'sourceTextColor');
      if (!ok) set({ sourceTextColor: previous });
    },
    setTranslationTextColor: async (s) => {
      const previous = get().translationTextColor;
      set({ translationTextColor: s });
      const { ok } = await persist('translationTextColor', s, 'translationTextColor');
      if (!ok) set({ translationTextColor: previous });
    },

    hydrate: async () => {
      const svc = ServiceFactory.getSettingsService();
      const [fontSize, compactMode, bgColor, sourceTextColor, translationTextColor] =
        await Promise.all([
          svc.getSetting(KEY('fontSize'), DEFAULTS.fontSize),
          svc.getSetting(KEY('compactMode'), DEFAULTS.compactMode),
          svc.getSetting(KEY('bgColor'), DEFAULTS.bgColor),
          svc.getSetting(KEY('sourceTextColor'), DEFAULTS.sourceTextColor),
          svc.getSetting(KEY('translationTextColor'), DEFAULTS.translationTextColor),
        ]);
      set({
        fontSize: clamp(Math.round(fontSize), CONVERSATION_FONT_SIZE_MIN, CONVERSATION_FONT_SIZE_MAX),
        compactMode,
        bgColor,
        sourceTextColor,
        translationTextColor,
      });
    },
  })),
);

// ──────────── Selector hooks ────────────
export const useConversationDisplayFontSize = () => useConversationDisplayStore((s) => s.fontSize);
export const useConversationDisplayCompactMode = () => useConversationDisplayStore((s) => s.compactMode);
export const useConversationDisplayBgColor = () => useConversationDisplayStore((s) => s.bgColor);
export const useConversationDisplaySourceTextColor = () => useConversationDisplayStore((s) => s.sourceTextColor);
export const useConversationDisplayTranslationTextColor = () => useConversationDisplayStore((s) => s.translationTextColor);

export const useConversationDisplaySettings = () =>
  useConversationDisplayStore(
    useShallow((s) => ({
      fontSize: s.fontSize,
      compactMode: s.compactMode,
      bgColor: s.bgColor,
      sourceTextColor: s.sourceTextColor,
      translationTextColor: s.translationTextColor,
    })),
  );

// ──────────── Action hooks ────────────
export const useSetConversationDisplayFontSize = () => useConversationDisplayStore((s) => s.setFontSize);
export const useSetConversationDisplayCompactMode = () => useConversationDisplayStore((s) => s.setCompactMode);
export const useSetConversationDisplayBgColor = () => useConversationDisplayStore((s) => s.setBgColor);
export const useSetConversationDisplaySourceTextColor = () => useConversationDisplayStore((s) => s.setSourceTextColor);
export const useSetConversationDisplayTranslationTextColor = () => useConversationDisplayStore((s) => s.setTranslationTextColor);
