// src/components/Subtitle/SubtitleApp.tsx
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import SubtitleBar from './SubtitleBar';
import SubtitleStream from './SubtitleStream';
import SubtitleSessionEnded from './SubtitleSessionEnded';
import useSettingsStore, {
  useSubtitleSettings,
  useExitSubtitleMode,
  useSaveSubtitleWindowBounds,
  useSpeakerDisplayMode,
  useParticipantDisplayMode,
  useProvider,
  useGetCurrentProviderSettings,
  useLocalInferenceSettings,
  useCurrentTurnDetectionMode,
} from '../../stores/settingsStore';
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

const SubtitleApp: React.FC = () => {
  const { t } = useTranslation();
  const subtitle = useSubtitleSettings();
  const exitSubtitleMode = useExitSubtitleMode();
  const saveBounds = useSaveSubtitleWindowBounds();
  const items = useItems();
  const systemAudioItems = useSystemAudioItems();
  const speakerMode = useSpeakerDisplayMode();
  const participantMode = useParticipantDisplayMode();
  const provider = useProvider();
  const getCurrentProviderSettings = useGetCurrentProviderSettings();
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

  const providerSettings = useMemo(
    () => getCurrentProviderSettings(),
    [getCurrentProviderSettings, provider],
  );
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

  // ESC to exit subtitle mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void exitSubtitleMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exitSubtitleMode]);

  // Bounds-changed listener (debounced 500 ms before persistence).
  // The main process emits this for any resize/move regardless of mode, so
  // we double-guard: only persist while subtitle mode is still active. This
  // prevents the resize event triggered by exiting (setBounds(restore))
  // from being saved as subtitle bounds.
  useEffect(() => {
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
  }, [saveBounds]);

  // Detect whether participant has produced any items
  const participantHasAudio = systemAudioItems.length > 0;

  // Build CSS variables for background. The intersection with
  // Record<string, string | number> lets us set CSS custom properties
  // without TS rejecting non-camelCase keys.
  const bgAlpha = subtitle.bgOpacity / 100;
  const rootStyle: React.CSSProperties & Record<string, string | number> = {
    background: hexToRgba(subtitle.bgColor, bgAlpha),
    '--bar-opacity': barVisible ? 1 : 0,
    '--bar-pointer-events': barVisible ? 'auto' : 'none',
  };

  return (
    <div
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
        <SubtitleSessionEnded onReturn={() => void exitSubtitleMode()} />
      )}
    </div>
  );
};

export default SubtitleApp;
