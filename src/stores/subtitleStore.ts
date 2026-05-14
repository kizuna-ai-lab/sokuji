import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useShallow } from 'zustand/shallow';
import { ServiceFactory } from '../services/ServiceFactory';

export type DisplayMode = 'source' | 'translation' | 'both';

export interface SubtitleWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SubtitleState {
  // Typography
  fontSize: number;            // clamped [FONT_SIZE_MIN, FONT_SIZE_MAX]
  compactMode: boolean;
  // Background
  bgOpacity: number;           // clamped [BG_OPACITY_MIN, BG_OPACITY_MAX]
  bgColor: string;             // hex
  // Text colours
  sourceTextColor: string;
  translationTextColor: string;
  // Window/positioning (Electron path; extension surface ignores them)
  alwaysOnTop: boolean;
  positionLocked: boolean;
  windowBounds: SubtitleWindowBounds | null;
  // Subtitle-local display-mode filters — INDEPENDENT of MainPanel's copies.
  speakerDisplayMode: DisplayMode;
  participantDisplayMode: DisplayMode;

  // Actions (all async because persistence is async — matches existing pattern in settingsStore)
  setFontSize: (n: number) => Promise<void>;
  setCompactMode: (b: boolean) => Promise<void>;
  setBgOpacity: (n: number) => Promise<void>;
  setBgColor: (s: string) => Promise<void>;
  setSourceTextColor: (s: string) => Promise<void>;
  setTranslationTextColor: (s: string) => Promise<void>;
  toggleAlwaysOnTop: () => Promise<void>;
  togglePositionLocked: () => Promise<void>;
  saveWindowBounds: (b: SubtitleWindowBounds) => Promise<void>;
  setSpeakerDisplayMode: (m: DisplayMode) => Promise<void>;
  setParticipantDisplayMode: (m: DisplayMode) => Promise<void>;

  // Hydration (called once at app boot — see Task 5)
  hydrate: () => Promise<void>;
}

// ──────────── Default colors (exported for popover preset wiring) ────────────
export const SUBTITLE_DEFAULT_BG_COLOR = '#000000';
export const SUBTITLE_DEFAULT_SOURCE_TEXT_COLOR = '#ffffff';
export const SUBTITLE_DEFAULT_TRANSLATION_TEXT_COLOR = '#9ad0ff';

const DEFAULTS = {
  fontSize: 24,
  compactMode: false,
  bgOpacity: 80,
  bgColor: SUBTITLE_DEFAULT_BG_COLOR,
  sourceTextColor: SUBTITLE_DEFAULT_SOURCE_TEXT_COLOR,
  translationTextColor: SUBTITLE_DEFAULT_TRANSLATION_TEXT_COLOR,
  alwaysOnTop: false,
  positionLocked: false,
  windowBounds: null as SubtitleWindowBounds | null,
  speakerDisplayMode: 'both' as DisplayMode,
  participantDisplayMode: 'both' as DisplayMode,
};

export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 64;
const BG_OPACITY_MIN = 0;
const BG_OPACITY_MAX = 100;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

const KEY = (suffix: string) => `settings.common.subtitle.${suffix}`;

// Persistence helper — keeps each setter compact and centralises the log format.
async function persist(
  keySuffix: string,
  value: unknown,
  fieldNameForLog: string,
): Promise<{ ok: boolean }> {
  try {
    await ServiceFactory.getSettingsService().setSetting(KEY(keySuffix), value);
    return { ok: true };
  } catch (error) {
    console.error(`[SubtitleStore] Error persisting ${fieldNameForLog}:`, error);
    return { ok: false };
  }
}

export const useSubtitleStore = create<SubtitleState>()(
  subscribeWithSelector((set, get) => ({
    ...DEFAULTS,

    setFontSize: async (n) => {
      const clamped = clamp(Math.round(n), FONT_SIZE_MIN, FONT_SIZE_MAX);
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
    setBgOpacity: async (n) => {
      const clamped = clamp(Math.round(n), BG_OPACITY_MIN, BG_OPACITY_MAX);
      const previous = get().bgOpacity;
      set({ bgOpacity: clamped });
      const { ok } = await persist('bgOpacity', clamped, 'bgOpacity');
      if (!ok) set({ bgOpacity: previous });
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
    toggleAlwaysOnTop: async () => {
      const previous = get().alwaysOnTop;
      const next = !previous;
      set({ alwaysOnTop: next });
      const { ok } = await persist('alwaysOnTop', next, 'alwaysOnTop');
      if (!ok) set({ alwaysOnTop: previous });
    },
    togglePositionLocked: async () => {
      const previous = get().positionLocked;
      const next = !previous;
      set({ positionLocked: next });
      const { ok } = await persist('positionLocked', next, 'positionLocked');
      if (!ok) set({ positionLocked: previous });
    },
    saveWindowBounds: async (b) => {
      const previous = get().windowBounds;
      set({ windowBounds: b });
      const { ok } = await persist('windowBounds', b, 'windowBounds');
      if (!ok) set({ windowBounds: previous });
    },
    setSpeakerDisplayMode: async (m) => {
      const previous = get().speakerDisplayMode;
      set({ speakerDisplayMode: m });
      const { ok } = await persist('speakerDisplayMode', m, 'speakerDisplayMode');
      if (!ok) set({ speakerDisplayMode: previous });
    },
    setParticipantDisplayMode: async (m) => {
      const previous = get().participantDisplayMode;
      set({ participantDisplayMode: m });
      const { ok } = await persist('participantDisplayMode', m, 'participantDisplayMode');
      if (!ok) set({ participantDisplayMode: previous });
    },

    hydrate: async () => {
      const svc = ServiceFactory.getSettingsService();
      const [
        fontSize, compactMode, bgOpacity, bgColor,
        sourceTextColor, translationTextColor,
        alwaysOnTop, positionLocked, windowBounds,
        speakerDisplayMode, participantDisplayMode,
      ] = await Promise.all([
        svc.getSetting(KEY('fontSize'), DEFAULTS.fontSize),
        svc.getSetting(KEY('compactMode'), DEFAULTS.compactMode),
        svc.getSetting(KEY('bgOpacity'), DEFAULTS.bgOpacity),
        svc.getSetting(KEY('bgColor'), DEFAULTS.bgColor),
        svc.getSetting(KEY('sourceTextColor'), DEFAULTS.sourceTextColor),
        svc.getSetting(KEY('translationTextColor'), DEFAULTS.translationTextColor),
        svc.getSetting(KEY('alwaysOnTop'), DEFAULTS.alwaysOnTop),
        svc.getSetting(KEY('positionLocked'), DEFAULTS.positionLocked),
        svc.getSetting<SubtitleWindowBounds | null>(KEY('windowBounds'), DEFAULTS.windowBounds),
        svc.getSetting<DisplayMode>(KEY('speakerDisplayMode'), DEFAULTS.speakerDisplayMode),
        svc.getSetting<DisplayMode>(KEY('participantDisplayMode'), DEFAULTS.participantDisplayMode),
      ]);
      set({
        fontSize: clamp(Math.round(fontSize), FONT_SIZE_MIN, FONT_SIZE_MAX),
        compactMode,
        bgOpacity: clamp(Math.round(bgOpacity), BG_OPACITY_MIN, BG_OPACITY_MAX),
        bgColor,
        sourceTextColor,
        translationTextColor,
        alwaysOnTop,
        positionLocked,
        windowBounds,
        speakerDisplayMode,
        participantDisplayMode,
      });
    },
  })),
);

// ──────────── Selector hooks ────────────
export const useSubtitleFontSize = () => useSubtitleStore((s) => s.fontSize);
export const useSubtitleCompactMode = () => useSubtitleStore((s) => s.compactMode);
export const useSubtitleBgOpacity = () => useSubtitleStore((s) => s.bgOpacity);
export const useSubtitleBgColor = () => useSubtitleStore((s) => s.bgColor);
export const useSubtitleSourceTextColor = () => useSubtitleStore((s) => s.sourceTextColor);
export const useSubtitleTranslationTextColor = () => useSubtitleStore((s) => s.translationTextColor);
export const useSubtitleAlwaysOnTop = () => useSubtitleStore((s) => s.alwaysOnTop);
export const useSubtitlePositionLocked = () => useSubtitleStore((s) => s.positionLocked);
export const useSubtitleWindowBounds = () => useSubtitleStore((s) => s.windowBounds);
export const useSubtitleSpeakerDisplayMode = () => useSubtitleStore((s) => s.speakerDisplayMode);
export const useSubtitleParticipantDisplayMode = () => useSubtitleStore((s) => s.participantDisplayMode);

// Convenience snapshot reader (mirrors useSubtitleSettings from v1).
// useShallow keeps the returned object reference stable across renders when
// the individual fields haven't changed — avoids re-render loops in consumers.
export const useSubtitleSettings = () =>
  useSubtitleStore(
    useShallow((s) => ({
      fontSize: s.fontSize,
      compactMode: s.compactMode,
      bgOpacity: s.bgOpacity,
      bgColor: s.bgColor,
      sourceTextColor: s.sourceTextColor,
      translationTextColor: s.translationTextColor,
      alwaysOnTop: s.alwaysOnTop,
      positionLocked: s.positionLocked,
      windowBounds: s.windowBounds,
    })),
  );

// Action hooks
export const useSetSubtitleFontSize = () => useSubtitleStore((s) => s.setFontSize);
export const useSetSubtitleCompactMode = () => useSubtitleStore((s) => s.setCompactMode);
export const useSetSubtitleBgOpacity = () => useSubtitleStore((s) => s.setBgOpacity);
export const useSetSubtitleBgColor = () => useSubtitleStore((s) => s.setBgColor);
export const useSetSubtitleSourceTextColor = () => useSubtitleStore((s) => s.setSourceTextColor);
export const useSetSubtitleTranslationTextColor = () => useSubtitleStore((s) => s.setTranslationTextColor);
export const useToggleSubtitleAlwaysOnTop = () => useSubtitleStore((s) => s.toggleAlwaysOnTop);
export const useToggleSubtitlePositionLocked = () => useSubtitleStore((s) => s.togglePositionLocked);
export const useSaveSubtitleWindowBounds = () => useSubtitleStore((s) => s.saveWindowBounds);
export const useSetSubtitleSpeakerDisplayMode = () => useSubtitleStore((s) => s.setSpeakerDisplayMode);
export const useSetSubtitleParticipantDisplayMode = () => useSubtitleStore((s) => s.setParticipantDisplayMode);
