import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { SegmentId } from '../../lib/conversation/types';
import type { Entry } from '../../lib/projection/types';
import type { SubtitleIdleModel, SubtitleSession } from '../../lib/subtitle/session';
import { noticeText } from '../../lib/view/noticeText';
import {
  useSubtitleNewItemHighlightEnabled,
  useSubtitleParticipantDisplayMode,
  useSubtitleSettings,
  useSubtitleSpeakerDisplayMode,
} from '../../stores/subtitleStore';
import { HoldToTalk } from './HoldToTalk';
import SubtitleBar from './SubtitleBar';
import { SubtitleBody } from './SubtitleBands';
import SubtitleIdle from './SubtitleIdle';
import type { SubtitleIdleState } from './subtitleIdleState';
import { useSubtitleChrome, type SubtitleSurfaceKind } from './useSubtitleChrome';
import './SubtitleApp.scss';

/** What a subtitle surface draws: the conversation's entries (the overlay gets their tail), karaoke, and the run. */
export interface SubtitleModel {
  entries: readonly Entry[];
  lit: ReadonlyMap<SegmentId, number>;
  /** Null on the overlay until the side panel has sent one. */
  session: SubtitleSession | null;
}

export interface SubtitleControls {
  exit(): void;
  clear(): void;
  press(): void;
  release(): void;
  /** The Electron takeover starts and stops the run itself; the overlay does not. */
  start?(): void;
  stop?(): void;
}

function languageCodeShort(code: string | undefined): string {
  return code ? code.slice(0, 2).toUpperCase() : '?';
}

function idleState(idle: SubtitleIdleModel | undefined, t: TFunction): SubtitleIdleState {
  if (!idle) return { kind: 'ended' };
  if (idle.kind === 'failed') return { kind: 'failed', message: noticeText(t, idle.notice) };
  return idle;
}

const noop = () => {};

/**
 * The subtitle surface over the new model (spec: "The two subtitle surfaces
 * are not the same thing"): the Electron takeover draws it from the runner in
 * its own window, the extension overlay from its wire. Today's `SubtitleApp`
 * layout, class for class.
 */
export function SubtitleView({ surface, model, controls }: { surface: SubtitleSurfaceKind; model: SubtitleModel; controls: SubtitleControls }) {
  const { t } = useTranslation();
  const chrome = useSubtitleChrome({ surface, onExit: controls.exit });
  const subtitle = useSubtitleSettings();
  const speaker = useSubtitleSpeakerDisplayMode();
  const participant = useSubtitleParticipantDisplayMode();
  const newItemHighlightEnabled = useSubtitleNewItemHighlightEnabled();
  const filters = useMemo(() => ({ speaker, participant }), [speaker, participant]);
  const { entries, lit, session } = model;
  const running = session?.phase === 'running';

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const elapsedMs = running && session.since !== null ? now - session.since : 0;

  // A leg's display-mode button shows when the conversation has that leg (today: the mode's intent, or items for it).
  const legs = session?.legs ?? [];
  const speakerActive = legs.includes('speaker') || entries.some((e) => e.leg === 'speaker');
  const participantActive = legs.includes('participant') || entries.some((e) => e.leg === 'participant');
  const { start, stop } = controls;

  return (
    <div ref={chrome.rootRef} {...chrome.rootProps}>
      <SubtitleBar
        sessionElapsedMs={elapsedMs}
        sourceLanguageCode={languageCodeShort(session?.pair?.source)}
        targetLanguageCode={languageCodeShort(session?.pair?.target)}
        onClearConversation={controls.clear}
        speakerActive={speakerActive}
        participantActive={participantActive}
        surface={surface}
        sessionControl={surface === 'electron' && start && stop ? {
          isSessionActive: running,
          isInitializing: session?.phase === 'starting',
          canStart: session?.canStart ?? false,
          onStart: start,
          onStop: stop,
        } : undefined}
      />
      {running ? (
        <>
          {surface === 'electron' && session.holdToTalk && entries.length === 0 ? (
            // The takeover is the same window, and the panel's Space key works in it; on the overlay Space is the meeting's.
            <div className="subtitle-ptt-hint">
              <p>{t('subtitle.pttHint', 'Press Space to speak')}</p>
            </div>
          ) : (
            <SubtitleBody
              entries={entries}
              lit={lit}
              compact={subtitle.compactMode}
              fontSize={subtitle.fontSize}
              filters={filters}
              sourceTextColor={subtitle.sourceTextColor}
              translationTextColor={subtitle.translationTextColor}
              newItemHighlightEnabled={newItemHighlightEnabled}
            />
          )}
          {surface === 'extension-overlay' && session.holdToTalk && (
            <HoldToTalk onPress={controls.press} onRelease={controls.release} />
          )}
        </>
      ) : (
        <SubtitleIdle
          state={idleState(session?.idle, t)}
          onStart={start ?? noop}
          onFix={noop}
          onReturn={controls.exit}
          allowSessionControl={surface === 'electron'}
          canStart={session?.canStart ?? false}
        />
      )}
      {chrome.resizeHandles}
    </div>
  );
}
