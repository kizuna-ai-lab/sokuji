import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { SegmentId } from '../../lib/conversation/types';
import type { Exporter } from '../../lib/export/exporter';
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
  // An uncoded reason stays as it is — `noticeText` returns the message.
  if (idle.kind === 'unready') return { kind: 'unready', message: noticeText(t, idle) };
  if (idle.kind === 'failed') {
    // start_failed's own message is already "the session didn't start:
    // <detail>" (NOTICE_WORDS); noticeText would wrap it a second time
    // ("Failed to start: The session didn't start: …"). Every other failed
    // code still goes through noticeText for its words.
    const message = idle.notice.code === 'start_failed' ? idle.notice.message : noticeText(t, idle.notice);
    return { kind: 'failed', message };
  }
  return idle;
}

const noop = () => {};

/**
 * The subtitle surface over the new model (spec: "The two subtitle surfaces
 * are not the same thing"): the Electron takeover draws it from the runner in
 * its own window, the extension overlay from its wire. Today's `SubtitleApp`
 * layout, class for class.
 */
export function SubtitleView({ surface, model, controls, exporter }: {
  surface: SubtitleSurfaceKind;
  model: SubtitleModel;
  controls: SubtitleControls;
  /** The conversation's export, Electron only: the overlay's tail is not the whole conversation. */
  exporter?: Exporter;
}) {
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
  const elapsedMs = running && session.since !== null ? Math.max(0, now - session.since) : 0;

  // A leg's display-mode button shows when the conversation has that leg:
  // the session's legs (set once a run is live) or an entry already drawn
  // for it. Unlike today's SubtitleApp, which follows the routing mode's
  // intent, nothing shows for either leg before the first run — plan 1e
  // will feed that intent into `SubtitleSession.legs` while idle (roadmap).
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
        exportMenu={exporter ? { exporter, speakerMode: speaker, participantMode: participant } : undefined}
        surface={surface}
        onExit={controls.exit}
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
