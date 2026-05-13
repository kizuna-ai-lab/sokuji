import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
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
  fontSize: number;            // clamped [16, 48]
  compactMode: boolean;
  // Background
  bgOpacity: number;           // clamped [0, 100]
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

const DEFAULTS = {
  fontSize: 24,
  compactMode: false,
  bgOpacity: 80,
  bgColor: '#000000',
  sourceTextColor: '#ffffff',
  translationTextColor: '#9ad0ff',
  alwaysOnTop: false,
  positionLocked: false,
  windowBounds: null as SubtitleWindowBounds | null,
  speakerDisplayMode: 'both' as DisplayMode,
  participantDisplayMode: 'both' as DisplayMode,
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

const KEY = (suffix: string) => `settings.common.subtitle.${suffix}`;

export const useSubtitleStore = create<SubtitleState>()(
  subscribeWithSelector((set, get) => ({
    ...DEFAULTS,

    setFontSize: async (n) => {
      const clamped = clamp(Math.round(n), 16, 48);
      set({ fontSize: clamped });
      try {
        await ServiceFactory.getSettingsService().setSetting(KEY('fontSize'), clamped);
      } catch (e) {
        console.error('[SubtitleStore] persist fontSize failed', e);
      }
    },
    setCompactMode: async (b) => {
      set({ compactMode: b });
      try {
        await ServiceFactory.getSettingsService().setSetting(KEY('compactMode'), b);
      } catch (e) { console.error('[SubtitleStore] persist compactMode failed', e); }
    },
    setBgOpacity: async (n) => {
      const clamped = clamp(Math.round(n), 0, 100);
      set({ bgOpacity: clamped });
      try {
        await ServiceFactory.getSettingsService().setSetting(KEY('bgOpacity'), clamped);
      } catch (e) { console.error('[SubtitleStore] persist bgOpacity failed', e); }
    },
    setBgColor: async (s) => {
      set({ bgColor: s });
      try {
        await ServiceFactory.getSettingsService().setSetting(KEY('bgColor'), s);
      } catch (e) { console.error('[SubtitleStore] persist bgColor failed', e); }
    },
    setSourceTextColor: async (s) => {
      set({ sourceTextColor: s });
      try {
        await ServiceFactory.getSettingsService().setSetting(KEY('sourceTextColor'), s);
      } catch (e) { console.error('[SubtitleStore] persist sourceTextColor failed', e); }
    },
    setTranslationTextColor: async (s) => {
      set({ translationTextColor: s });
      try {
        await ServiceFactory.getSettingsService().setSetting(KEY('translationTextColor'), s);
      } catch (e) { console.error('[SubtitleStore] persist translationTextColor failed', e); }
    },
    toggleAlwaysOnTop: async () => {
      const next = !get().alwaysOnTop;
      set({ alwaysOnTop: next });
      try {
        await ServiceFactory.getSettingsService().setSetting(KEY('alwaysOnTop'), next);
      } catch (e) { console.error('[SubtitleStore] persist alwaysOnTop failed', e); }
    },
    togglePositionLocked: async () => {
      const next = !get().positionLocked;
      set({ positionLocked: next });
      try {
        await ServiceFactory.getSettingsService().setSetting(KEY('positionLocked'), next);
      } catch (e) { console.error('[SubtitleStore] persist positionLocked failed', e); }
    },
    saveWindowBounds: async (b) => {
      set({ windowBounds: b });
      try {
        await ServiceFactory.getSettingsService().setSetting(KEY('windowBounds'), b);
      } catch (e) { console.error('[SubtitleStore] persist windowBounds failed', e); }
    },
    setSpeakerDisplayMode: async (m) => {
      set({ speakerDisplayMode: m });
      try {
        await ServiceFactory.getSettingsService().setSetting(KEY('speakerDisplayMode'), m);
      } catch (e) { console.error('[SubtitleStore] persist speakerDisplayMode failed', e); }
    },
    setParticipantDisplayMode: async (m) => {
      set({ participantDisplayMode: m });
      try {
        await ServiceFactory.getSettingsService().setSetting(KEY('participantDisplayMode'), m);
      } catch (e) { console.error('[SubtitleStore] persist participantDisplayMode failed', e); }
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
        fontSize: clamp(Math.round(fontSize), 16, 48),
        compactMode,
        bgOpacity: clamp(Math.round(bgOpacity), 0, 100),
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

// Convenience snapshot reader (mirrors useSubtitleSettings from v1)
export const useSubtitleSettings = () => useSubtitleStore((s) => ({
  fontSize: s.fontSize,
  compactMode: s.compactMode,
  bgOpacity: s.bgOpacity,
  bgColor: s.bgColor,
  sourceTextColor: s.sourceTextColor,
  translationTextColor: s.translationTextColor,
  alwaysOnTop: s.alwaysOnTop,
  positionLocked: s.positionLocked,
  windowBounds: s.windowBounds,
}));

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
