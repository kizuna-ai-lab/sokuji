/**
 * Wire contract for the 'sokuji-subtitle' chrome.runtime port between the
 * side-panel surface (sender: ExtensionContentScriptSubtitleSurface) and the
 * overlay-iframe mirror (receiver: sessionPortMirror).
 *
 * Both sides MUST import these types from here. The five downstream message
 * shapes used to be declared independently on each side of the port, coupled
 * by convention only — a renamed or added field needed a matching edit on the
 * other side that nothing enforced. This module is the single definition.
 *
 * Payload discipline: conversation items must be passed through
 * stripHeavyItemFields() before sending — `formatted.audio`/`formatted.file`
 * are multi-MB and blow the chrome.runtime port's message limit.
 */

/** Compact playback snapshot as sent over the port
 *  (i = playingItemId, c = currentTime, d = duration, b = bufferedTime). */
export type PlaybackWire = { i: string | null; c?: number | null; d?: number; b?: number };

/** Full-state push on (re)connect. */
export interface SubtitleStateInitMessage {
  type: 'state-init';
  payload: {
    items?: any[];
    participantItems?: any[];
    isSessionActive?: boolean;
    sessionStartTime?: number | null;
    provider?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    turnDetectionMode?: string;
    /** `null` is the explicit "nothing playing" signal — the receiver must
     *  clear stale playback state on reconnect rather than skip the field. */
    playback?: PlaybackWire | null;
  };
}

export interface SubtitleItemsMessage {
  type: 'items';
  items: any[];
  participantItems?: any[];
}

export interface SubtitleSessionMessage {
  type: 'session';
  isSessionActive: boolean;
  sessionStartTime?: number | null;
}

export interface SubtitleConfigMessage {
  type: 'config';
  /** Provider enum value (snake_case identifier). The receiver resolves the
   *  settings slice via the provider registry's settingsSliceKey — never by
   *  re-encoding the store layout on the wire side. */
  provider: string;
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode?: string;
}

export interface SubtitlePlaybackMessage extends PlaybackWire {
  type: 'playback';
}

/** side panel → overlay iframe */
export type SubtitleWireMessage =
  | SubtitleStateInitMessage
  | SubtitleItemsMessage
  | SubtitleSessionMessage
  | SubtitleConfigMessage
  | SubtitlePlaybackMessage;

/** overlay iframe → side panel */
export type SubtitleControlMessage =
  | { type: 'subtitle:request-clear' }
  | { type: 'subtitle:user-exit' };
