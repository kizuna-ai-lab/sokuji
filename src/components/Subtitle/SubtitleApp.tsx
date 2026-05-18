// src/components/Subtitle/SubtitleApp.tsx
import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import SubtitleBar from './SubtitleBar';
import SubtitleStream from './SubtitleStream';
import SubtitleSessionEnded from './SubtitleSessionEnded';
import useSettingsStore, {
  useExitSubtitleMode,
  useProvider,
  useCurrentProviderSettings,
  useLocalInferenceSettings,
  useCurrentTurnDetectionMode,
} from '../../stores/settingsStore';
import {
  useSubtitleSettings,
  useSaveSubtitleWindowBounds,
  useSubtitlePositionLocked,
  useSubtitleSpeakerDisplayMode as useSpeakerDisplayMode,
  useSubtitleParticipantDisplayMode as useParticipantDisplayMode,
} from '../../stores/subtitleStore';
import { useOverlayDragResize } from './useOverlayDragResize';
import {
  useIsSessionActive,
  useSessionStartTime,
  useItems,
  useSystemAudioItems,
  useRequestClearConversation,
} from '../../stores/sessionStore';
import type { ConversationItem } from '../../services/interfaces/IClient';
import './SubtitleApp.scss';

const AUTO_HIDE_MS = 1500;

function languageCodeShort(longCode: string | undefined): string {
  if (!longCode) return '?';
  return longCode.slice(0, 2).toUpperCase();
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-fA-F0-9]{6})$/.exec(hex);
  if (!m) return `rgba(0,0,0,${alpha})`;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

const HIGHLIGHT_ALPHA = 0.3;

/**
 * Returns a CSS color for the "newly-arrived item" overlay, chosen so it
 * contrasts with the user-selected background. YIQ luminance < 128 means
 * the background is dark → use a light overlay; otherwise use dark.
 *
 * The user-set bgOpacity is intentionally not factored in. When opacity is
 * very low and the actual visible background is whatever sits behind the
 * subtitle window, this falls back to the bgColor's nominal lightness —
 * a known limitation accepted in the design spec.
 */
export function getHighlightOverlayForBg(hex: string): string {
  const m = /^#?([a-fA-F0-9]{6})$/.exec(hex);
  if (!m) return `rgba(255,255,255,${HIGHLIGHT_ALPHA})`;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq < 128
    ? `rgba(255,255,255,${HIGHLIGHT_ALPHA})`
    : `rgba(0,0,0,${HIGHLIGHT_ALPHA})`;
}

export type SubtitleSurfaceKind = 'electron' | 'extension-overlay';

const SubtitleApp: React.FC<{ surface?: SubtitleSurfaceKind }> = ({ surface = 'electron' }) => {
  const { t } = useTranslation();
  const subtitle = useSubtitleSettings();
  const exitSubtitleMode = useExitSubtitleMode();
  const saveBounds = useSaveSubtitleWindowBounds();
  const items = useItems();
  const systemAudioItems = useSystemAudioItems();
  const speakerMode = useSpeakerDisplayMode();
  const participantMode = useParticipantDisplayMode();
  const provider = useProvider();
  const localInferenceSettings = useLocalInferenceSettings();
  const isSessionActive = useIsSessionActive();
  const sessionStartTime = useSessionStartTime();
  const turnDetectionMode = useCurrentTurnDetectionMode();
  const requestClearConversation = useRequestClearConversation();
  // Mirrors isPttLikeMode in MainPanel — modes that send audio only while
  // the user holds Space.
  const canHoldToSpeak =
    turnDetectionMode === 'Push-to-Talk' ||
    turnDetectionMode === 'Push-to-Translate' ||
    turnDetectionMode === 'Disabled';

  // Reactive: re-emits whenever state[provider] is replaced, so changing
  // sourceLanguage / targetLanguage in the side panel (which mutates the
  // provider settings object) updates the bar live. A useMemo keyed on
  // the provider *name* would cache the first state[provider] reference
  // and never refresh, locking the bar to the language pair that was
  // active when SubtitleApp first mounted.
  const providerSettings = useCurrentProviderSettings();
  // The provider-settings union doesn't guarantee these fields (a few
  // members are text-only and never carry a language pair), so cast to a
  // narrow shape that exposes only what we actually read.
  const providerLanguages = providerSettings as { sourceLanguage?: string; targetLanguage?: string } | null | undefined;
  const sourceLanguage: string = providerLanguages?.sourceLanguage ?? 'en';
  const targetLanguage: string = providerLanguages?.targetLanguage ?? 'zh';

  // Combine items with source tagging (mirrors MainPanel's logic, simplified).
  // Tagged items extend ConversationItem with the speaker/participant role and
  // the snapshotted language pair so ConversationRow can render badges
  // consistently after the languages change mid-conversation.
  type TaggedItem = ConversationItem & {
    source: 'speaker' | 'participant';
    sourceLanguage: string;
    targetLanguage: string;
  };
  const combinedItems = useMemo<TaggedItem[]>(() => {
    const tagSpeaker = (item: ConversationItem): TaggedItem => ({
      ...item,
      source: item.source ?? 'speaker',
      sourceLanguage,
      targetLanguage,
    });
    const tagParticipant = (item: ConversationItem): TaggedItem => ({
      ...item,
      source: item.source ?? 'participant',
      sourceLanguage,
      targetLanguage,
    });
    const all = [
      ...items.map(tagSpeaker),
      ...systemAudioItems.map(tagParticipant),
    ];
    return all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }, [items, systemAudioItems, sourceLanguage, targetLanguage]);

  // Session timer
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isSessionActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isSessionActive]);
  const elapsedMs = isSessionActive && sessionStartTime ? now - sessionStartTime : 0;

  // Root ref — used to derive the owner document for keyboard listeners so
  // ESC works correctly when SubtitleApp is mounted inside an iframe.
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Auto-hide bar
  const [barVisible, setBarVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMouseEnter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setBarVisible(true);
  };
  const onMouseLeave = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setBarVisible(false), AUTO_HIDE_MS);
  };

  // Centralised exit request. In the extension-overlay surface we don't have
  // direct access to the side panel's settingsStore.exitSubtitleMode; instead
  // we dispatch a window event that the iframe entry forwards to the side
  // panel via the chrome.runtime port (see subtitle-overlay-entry.tsx).
  const requestExit = useCallback(() => {
    if (surface === 'extension-overlay') {
      window.dispatchEvent(new Event('sokuji:user-exit'));
    } else {
      void exitSubtitleMode();
    }
  }, [surface, exitSubtitleMode]);

  // ESC to exit subtitle mode
  useEffect(() => {
    const target = rootRef.current?.ownerDocument ?? document;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestExit();
    };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }, [requestExit]);

  // Bounds-changed listener (debounced 500 ms before persistence).
  // The main process emits this for any resize/move regardless of mode, so
  // we double-guard: only persist while subtitle mode is still active. This
  // prevents the resize event triggered by exiting (setBounds(restore))
  // from being saved as subtitle bounds.
  useEffect(() => {
    if (surface !== 'electron') return;
    if (!window.electron?.receive) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const handler = (bounds: { x: number; y: number; width: number; height: number }) => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!useSettingsStore.getState().subtitleModeActive) return;
        void saveBounds(bounds);
      }, 500);
    };
    window.electron.receive('subtitle:window-bounds-changed', handler);
    return () => {
      if (debounce) clearTimeout(debounce);
      window.electron?.removeListener?.('subtitle:window-bounds-changed', handler);
    };
  }, [saveBounds, surface]);

  // Detect whether participant has produced any items
  const participantHasAudio = systemAudioItems.length > 0;

  // Resize handles (extension-overlay only). Lock state from subtitleStore
  // gates rendering — locked = no handles, no cursor change.
  const positionLocked = useSubtitlePositionLocked();
  const { resizeHandleProps } = useOverlayDragResize({ surface });
  const showResizeHandles = surface === 'extension-overlay' && !positionLocked;

  // Build CSS variables for background. The intersection with
  // Record<string, string | number> lets us set CSS custom properties
  // without TS rejecting non-camelCase keys.
  const bgAlpha = subtitle.bgOpacity / 100;
  const rootStyle: React.CSSProperties & Record<string, string | number> = {
    background: hexToRgba(subtitle.bgColor, bgAlpha),
    '--bar-opacity': barVisible ? 1 : 0,
    '--bar-pointer-events': barVisible ? 'auto' : 'none',
    '--subtitle-highlight-overlay': getHighlightOverlayForBg(subtitle.bgColor),
  };

  return (
    <div
      ref={rootRef}
      className="subtitle-app"
      style={rootStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <SubtitleBar
        sessionElapsedMs={elapsedMs}
        sourceLanguageCode={languageCodeShort(sourceLanguage)}
        targetLanguageCode={languageCodeShort(targetLanguage)}
        onClearConversation={requestClearConversation}
        participantHasAudio={participantHasAudio}
        exportProps={{
          combinedItems,
          provider,
          currentProviderSettings: providerSettings,
          localInferenceSettings,
          sourceLanguage,
          targetLanguage,
        }}
        surface={surface}
      />
      {isSessionActive ? (
        canHoldToSpeak && combinedItems.length === 0 ? (
          <div className="subtitle-ptt-hint">
            <p>{t('subtitle.pttHint', 'Press Space to speak')}</p>
          </div>
        ) : (
          <SubtitleStream
            items={combinedItems}
            compact={subtitle.compactMode}
            fontSize={subtitle.fontSize}
            speakerMode={speakerMode}
            participantMode={participantMode}
            sourceLanguage={sourceLanguage}
            targetLanguage={targetLanguage}
            sourceTextColor={subtitle.sourceTextColor}
            translationTextColor={subtitle.translationTextColor}
          />
        )
      ) : (
        <SubtitleSessionEnded onReturn={requestExit} />
      )}
      {showResizeHandles && (
        <>
          <div className="subtitle-app__resize subtitle-app__resize--n"  {...resizeHandleProps.n} />
          <div className="subtitle-app__resize subtitle-app__resize--e"  {...resizeHandleProps.e} />
          <div className="subtitle-app__resize subtitle-app__resize--s"  {...resizeHandleProps.s} />
          <div className="subtitle-app__resize subtitle-app__resize--w"  {...resizeHandleProps.w} />
          <div className="subtitle-app__resize subtitle-app__resize--nw" {...resizeHandleProps.nw} />
          <div className="subtitle-app__resize subtitle-app__resize--ne" {...resizeHandleProps.ne} />
          <div className="subtitle-app__resize subtitle-app__resize--sw" {...resizeHandleProps.sw} />
          <div className="subtitle-app__resize subtitle-app__resize--se" {...resizeHandleProps.se} />
        </>
      )}
    </div>
  );
};

export default SubtitleApp;
