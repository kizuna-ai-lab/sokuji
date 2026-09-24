// src/components/Subtitle/SubtitleApp.tsx
import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import SubtitleBar from './SubtitleBar';
import SubtitleStream from './SubtitleStream';
import SubtitleIdle from './SubtitleIdle';
import { deriveSubtitleIdleState } from './subtitleIdleState';
import type { StartBlockReason, DeviceScope } from '../MainPanel/sessionStartGate';
import { reasonToSettingsTarget } from '../MainPanel/sessionStartGate';
import {
  useExitSubtitleMode,
  useProvider,
  useCurrentProviderSettings,
  useLocalInferenceSettings,
  useCurrentTurnDetectionMode,
  useNavigateToSettings,
} from '../../stores/settingsStore';
import {
  useSubtitleSettings,
  useSubtitleSpeakerDisplayMode as useSpeakerDisplayMode,
  useSubtitleParticipantDisplayMode as useParticipantDisplayMode,
  useSubtitleNewItemHighlightEnabled,
} from '../../stores/subtitleStore';
import { useSubtitleChrome, type SubtitleSurfaceKind } from './useSubtitleChrome';
import {
  useIsSessionActive,
  useSessionStartTime,
  useItems,
  useParticipantItems,
  useRequestClearConversation,
  useLockedMode,
  useStartGate,
  useSessionIsInitializing,
  useInitProgress,
  useRequestSessionStart,
  useRequestSessionStop,
} from '../../stores/sessionStore';
import { useMode } from '../../stores/audioStore';
import type { ConversationItem } from '../../services/interfaces/IClient';
import { isPushGatedMode } from '../../services/providers/speechMode';
import './SubtitleApp.scss';

// Re-exported so existing importers (SubtitleApp.test.tsx, SubtitleBar.tsx,
// useOverlayDragResize.ts) keep working after the move into useSubtitleChrome.
export { getHighlightOverlayForBg } from './useSubtitleChrome';
export type { SubtitleSurfaceKind } from './useSubtitleChrome';

function languageCodeShort(longCode: string | undefined): string {
  if (!longCode) return '?';
  return longCode.slice(0, 2).toUpperCase();
}

const SubtitleApp: React.FC<{ surface?: SubtitleSurfaceKind }> = ({ surface = 'electron' }) => {
  const { t } = useTranslation();
  const subtitle = useSubtitleSettings();
  const exitSubtitleMode = useExitSubtitleMode();
  const items = useItems();
  const participantItems = useParticipantItems();
  const speakerMode = useSpeakerDisplayMode();
  const participantMode = useParticipantDisplayMode();
  const newItemHighlightEnabled = useSubtitleNewItemHighlightEnabled();
  const provider = useProvider();
  const localInferenceSettings = useLocalInferenceSettings();
  const isSessionActive = useIsSessionActive();
  const sessionStartTime = useSessionStartTime();
  const turnDetectionMode = useCurrentTurnDetectionMode();
  const requestClearConversation = useRequestClearConversation();
  const startGate = useStartGate();
  const sessionInitializing = useSessionIsInitializing();
  const initProgress = useInitProgress();
  const requestSessionStart = useRequestSessionStart();
  const requestSessionStop = useRequestSessionStop();
  const navigateToSettings = useNavigateToSettings();

  // "A session has run during this visit to subtitle mode" — drives the
  // ended-vs-never-started headline. translationCount cannot be used: it
  // survives endSession, and a session can legitimately end with zero
  // translations.
  const hasRunSessionRef = useRef(false);
  if (isSessionActive && !hasRunSessionRef.current) hasRunSessionRef.current = true;

  // Timestamp of the last start requested from this window. Lets the idle
  // state tell a genuine start failure apart from an old error item that
  // happens to sit at the end of the conversation.
  const startRequestedAtRef = useRef<number | null>(null);
  const handleStart = useCallback(() => {
    // Defense in depth: nothing downstream re-checks the gate before firing
    // connectConversation (unlike MainPanel, where the gate is enforced
    // purely by the button's `disabled`). A start request must never express
    // something the gate currently forbids — e.g. Retry after the mic was
    // unplugged following an earlier failure.
    if (!startGate.canStart) return;
    startRequestedAtRef.current = Date.now();
    requestSessionStart();
  }, [requestSessionStart, startGate.canStart]);

  const handleFix = useCallback((reason: StartBlockReason, deviceScope?: DeviceScope) => {
    const target = reasonToSettingsTarget(reason, deviceScope);
    if (!target) return;
    // Leave subtitle mode first so the main window is restored before the
    // settings panel opens and scrolls to the section.
    void exitSubtitleMode();
    navigateToSettings(target);
  }, [exitSubtitleMode, navigateToSettings]);

  const idleState = deriveSubtitleIdleState({
    isInitializing: sessionInitializing,
    initProgress,
    startGate,
    items,
    hasRunSession: hasRunSessionRef.current,
    startRequestedAt: startRequestedAtRef.current,
  });
  // Modes that send audio only while the user holds Space — the same
  // capabilities-driven predicate MainPanel uses, so the two windows can
  // never disagree about what counts as push-gated.
  const canHoldToSpeak = isPushGatedMode(provider, turnDetectionMode);

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
      ...participantItems.map(tagParticipant),
    ];
    return all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }, [items, participantItems, sourceLanguage, targetLanguage]);

  // Session timer
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isSessionActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isSessionActive]);
  const elapsedMs = isSessionActive && sessionStartTime ? now - sessionStartTime : 0;

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

  // The window's own chrome (auto-hiding bar, layered Escape, Electron
  // fullscreen/bounds mirroring, overlay resize handles, root style) — shared
  // with the new SubtitleView. See useSubtitleChrome.
  const chrome = useSubtitleChrome({ surface, onExit: requestExit });

  // Display-mode buttons follow the same intent-driven logic as MainPanel's
  // conversation toolbar: show a channel's button when that channel is
  // intent-active for the (current or locked) session, OR when items already
  // exist for it. effectiveMode reads the locked session mode while a session
  // runs and falls back to the current setting after it ends; the items
  // fallback then keeps the buttons available so historical conversation
  // remains reconfigurable. See MainPanel.tsx.
  const currentMode = useMode();
  const lockedMode = useLockedMode();
  const effectiveMode = lockedMode ?? currentMode;
  const speakerActive = effectiveMode === 'speaker' || effectiveMode === 'both' || items.length > 0;
  const participantActive = effectiveMode === 'participant' || effectiveMode === 'both' || participantItems.length > 0;

  return (
    <div ref={chrome.rootRef} {...chrome.rootProps}>
      <SubtitleBar
        sessionElapsedMs={elapsedMs}
        sourceLanguageCode={languageCodeShort(sourceLanguage)}
        targetLanguageCode={languageCodeShort(targetLanguage)}
        onClearConversation={requestClearConversation}
        speakerActive={speakerActive}
        participantActive={participantActive}
        exportProps={{
          // Full list; the export menu scopes it itself, seeded from the same
          // two modes the subtitle band filters on.
          combinedItems,
          speakerMode,
          participantMode,
          provider,
          currentProviderSettings: providerSettings,
          localInferenceSettings,
          sourceLanguage,
          targetLanguage,
        }}
        surface={surface}
        sessionControl={{
          isSessionActive,
          isInitializing: sessionInitializing,
          canStart: startGate.canStart,
          onStart: handleStart,
          onStop: requestSessionStop,
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
            newItemHighlightEnabled={newItemHighlightEnabled}
          />
        )
      ) : (
        <SubtitleIdle
          state={idleState}
          onStart={handleStart}
          onFix={handleFix}
          onReturn={requestExit}
          allowSessionControl={surface === 'electron'}
          canStart={startGate.canStart}
        />
      )}
      {chrome.resizeHandles}
    </div>
  );
};

export default SubtitleApp;
