import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { ServiceFactory } from '../services/ServiceFactory';
import { persistSetting } from '../services/persistSetting';
import type { Scheme } from '../lib/theme/theme';
import { useScheme } from '../lib/theme/useScheme';
import { toneOf } from '../lib/view/tone';

interface ConversationDisplayState {
  // Typography
  fontSize: number;            // clamped [CONVERSATION_FONT_SIZE_MIN, CONVERSATION_FONT_SIZE_MAX]
  compactMode: boolean;
  showReadings: boolean;
  // Colors (hex), or null for one the user never set: it follows the app's
  // scheme (resolveConversationColours), so the first switch to the light
  // theme takes the conversation with it, and dark users see today's colours.
  bgColor: string | null;
  sourceTextColor: string | null;
  translationTextColor: string | null;

  // Actions (async because persistence is async — matches subtitleStore).
  // A colour setter takes null to follow the scheme again.
  setFontSize: (n: number) => Promise<void>;
  setCompactMode: (b: boolean) => Promise<void>;
  setShowReadings: (b: boolean) => Promise<void>;
  setBgColor: (s: string | null) => Promise<void>;
  setSourceTextColor: (s: string | null) => Promise<void>;
  setTranslationTextColor: (s: string | null) => Promise<void>;

  // Hydration (called once at app boot from src/routes/Home.tsx)
  hydrate: () => Promise<void>;
}

// ──────────── The scheme's colours (exported for popover preset wiring) ────────────
// The dark set is what the conversation has always been drawn in.
export const CONVERSATION_DISPLAY_DEFAULT_BG_COLOR = '#1f1f1f';
export const CONVERSATION_DISPLAY_DEFAULT_SOURCE_TEXT_COLOR = '#9aa0a6';
export const CONVERSATION_DISPLAY_DEFAULT_TRANSLATION_TEXT_COLOR = '#e8e8e8';

export interface ConversationColours {
  bgColor: string;
  sourceTextColor: string;
  translationTextColor: string;
}

export type StoredConversationColours = { [K in keyof ConversationColours]: string | null };

/**
 * What a colour the user never set resolves to, per scheme (spec 2026-10-22
 * §3, R3 as amended): dark is today's set, light the white one.
 */
export const CONVERSATION_SCHEME_COLOURS: Readonly<Record<Scheme, Readonly<ConversationColours>>> = {
  dark: {
    bgColor: CONVERSATION_DISPLAY_DEFAULT_BG_COLOR,
    sourceTextColor: CONVERSATION_DISPLAY_DEFAULT_SOURCE_TEXT_COLOR,
    translationTextColor: CONVERSATION_DISPLAY_DEFAULT_TRANSLATION_TEXT_COLOR,
  },
  light: { bgColor: '#ffffff', sourceTextColor: '#5f6368', translationTextColor: '#1a1a1a' },
};

/**
 * The colours as drawn: the user's where set. An unset background follows the
 * scheme; an unset text colour follows the tone of the background drawn, so a
 * stored dark background keeps light text in the light app (never dark on
 * dark), and a stored white one gets dark text in the dark app.
 */
export function resolveConversationColours(stored: StoredConversationColours, scheme: Scheme): ConversationColours {
  const bgColor = stored.bgColor ?? CONVERSATION_SCHEME_COLOURS[scheme].bgColor;
  const text = CONVERSATION_SCHEME_COLOURS[toneOf(bgColor)];
  return {
    bgColor,
    sourceTextColor: stored.sourceTextColor ?? text.sourceTextColor,
    translationTextColor: stored.translationTextColor ?? text.translationTextColor,
  };
}

const DEFAULTS = {
  fontSize: 14,
  compactMode: false,
  showReadings: false,
  bgColor: null as string | null,
  sourceTextColor: null as string | null,
  translationTextColor: null as string | null,
};

export const CONVERSATION_FONT_SIZE_MIN = 12;
export const CONVERSATION_FONT_SIZE_MAX = 64;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

const KEY = (suffix: string) => `settings.common.conversationDisplay.${suffix}`;

// The former local body caught a rejection but never read `result.success`, so
// the failure the service actually reports was dropped. `persistSetting` owns
// both channels; `fieldNameForLog` is gone because the key it derives from is
// already in the message.
async function persist(keySuffix: string, value: unknown): Promise<{ ok: boolean }> {
  return { ok: await persistSetting(KEY(keySuffix), value) };
}

export const useConversationDisplayStore = create<ConversationDisplayState>()(
  subscribeWithSelector((set, get) => ({
    ...DEFAULTS,

    setFontSize: async (n) => {
      const clamped = clamp(Math.round(n), CONVERSATION_FONT_SIZE_MIN, CONVERSATION_FONT_SIZE_MAX);
      const previous = get().fontSize;
      set({ fontSize: clamped });
      const { ok } = await persist('fontSize', clamped);
      if (!ok) set({ fontSize: previous });
    },
    setCompactMode: async (b) => {
      const previous = get().compactMode;
      set({ compactMode: b });
      const { ok } = await persist('compactMode', b);
      if (!ok) set({ compactMode: previous });
    },
    setShowReadings: async (b) => {
      const previous = get().showReadings;
      set({ showReadings: b });
      const { ok } = await persist('showReadings', b);
      if (!ok) set({ showReadings: previous });
    },
    setBgColor: async (s) => {
      const previous = get().bgColor;
      set({ bgColor: s });
      const { ok } = await persist('bgColor', s);
      if (!ok) set({ bgColor: previous });
    },
    setSourceTextColor: async (s) => {
      const previous = get().sourceTextColor;
      set({ sourceTextColor: s });
      const { ok } = await persist('sourceTextColor', s);
      if (!ok) set({ sourceTextColor: previous });
    },
    setTranslationTextColor: async (s) => {
      const previous = get().translationTextColor;
      set({ translationTextColor: s });
      const { ok } = await persist('translationTextColor', s);
      if (!ok) set({ translationTextColor: previous });
    },

    hydrate: async () => {
      const svc = ServiceFactory.getSettingsService();
      const [fontSize, compactMode, bgColor, sourceTextColor, translationTextColor, showReadings] =
        await Promise.all([
          svc.getSetting(KEY('fontSize'), DEFAULTS.fontSize),
          svc.getSetting(KEY('compactMode'), DEFAULTS.compactMode),
          svc.getSetting(KEY('bgColor'), DEFAULTS.bgColor),
          svc.getSetting(KEY('sourceTextColor'), DEFAULTS.sourceTextColor),
          svc.getSetting(KEY('translationTextColor'), DEFAULTS.translationTextColor),
          svc.getSetting(KEY('showReadings'), DEFAULTS.showReadings),
        ]);
      set({
        fontSize: clamp(Math.round(fontSize), CONVERSATION_FONT_SIZE_MIN, CONVERSATION_FONT_SIZE_MAX),
        compactMode,
        bgColor,
        sourceTextColor,
        translationTextColor,
        showReadings,
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

// ──────────── Action hooks ────────────
export const useSetConversationDisplayFontSize = () => useConversationDisplayStore((s) => s.setFontSize);
export const useSetConversationDisplayCompactMode = () => useConversationDisplayStore((s) => s.setCompactMode);
export const useSetConversationDisplayBgColor = () => useConversationDisplayStore((s) => s.setBgColor);
export const useSetConversationDisplaySourceTextColor = () => useConversationDisplayStore((s) => s.setSourceTextColor);
export const useSetConversationDisplayTranslationTextColor = () => useConversationDisplayStore((s) => s.setTranslationTextColor);
export const useConversationDisplayShowReadings = () => useConversationDisplayStore((s) => s.showReadings);
export const useSetConversationDisplayShowReadings = () => useConversationDisplayStore((s) => s.setShowReadings);

/** The conversation's colours as drawn: the user's where set, the scheme's otherwise. */
export const useConversationColours = (): ConversationColours => {
  const scheme = useScheme();
  const bgColor = useConversationDisplayBgColor();
  const sourceTextColor = useConversationDisplaySourceTextColor();
  const translationTextColor = useConversationDisplayTranslationTextColor();
  return resolveConversationColours({ bgColor, sourceTextColor, translationTextColor }, scheme);
};
