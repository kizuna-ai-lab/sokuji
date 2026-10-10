/**
 * The two routing switches (spec 2026-10-10 §3): whether the meeting hears
 * the speaker's translation (on by default; a dev switch), and Translation I hear —
 * the other's translation spoken to me. The latter is `null` until the user
 * touches it: on in face-to-face, off in a meeting (`shape.ts`'s
 * `participantSpeechInput`, ruling 1). The monitor (I hear it too) and passthrough
 * stay in `audioStore`; each outlet's device and channel too.
 */
import { create } from 'zustand';
import { persistSetting } from '../services/persistSetting';
import { ServiceFactory } from '../services/ServiceFactory';

const MEETING = 'settings.routing.meeting';
const PARTICIPANT_SPEECH = 'settings.routing.participantSpeech';

interface RoutingStore {
  meeting: boolean;
  /** Translation I hear: true/false as chosen; null = auto (on in face-to-face, off elsewhere). */
  participantSpeech: boolean | null;
  load(): Promise<void>;
  setMeeting(on: boolean): void;
  setParticipantSpeech(on: boolean | null): void;
}

export const useRoutingStore = create<RoutingStore>()((set) => ({
  meeting: true,
  participantSpeech: null,
  async load() {
    const settings = ServiceFactory.getSettingsService();
    const [meeting, participantSpeech] = await Promise.all([
      settings.getSetting(MEETING, true),
      settings.getSetting<unknown>(PARTICIPANT_SPEECH, null),
    ]);
    set({
      meeting: typeof meeting === 'boolean' ? meeting : true,
      participantSpeech: typeof participantSpeech === 'boolean' ? participantSpeech : null,
    });
  },
  setMeeting(on) {
    set({ meeting: on });
    void persistSetting(MEETING, on);
  },
  setParticipantSpeech(on) {
    set({ participantSpeech: on });
    void persistSetting(PARTICIPANT_SPEECH, on);
  },
}));
