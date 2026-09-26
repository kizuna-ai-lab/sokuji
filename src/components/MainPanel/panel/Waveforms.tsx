import { useTranslation } from 'react-i18next';
import WaveformStrip from '../WaveformStrip';
import type { LegName } from '../../../lib/conversation/types';
import type { LevelMeter } from '../../../lib/audio/levelMeter';
import type { BusMeter } from '../../../lib/audio/graph';
import type { AudioMode } from '../../../stores/audioStore';

/**
 * The advanced footer's mic + system strips (`MainPanel.tsx:4801-4822`):
 * mic while `mode` includes the speaker leg, system while it includes the
 * participant leg. Each draws its leg's spectrum — the same frequency bars as
 * the output strip, moving as smoothly: the meter emulates the output's
 * analyser and moves its window with time between chunks. The mic strip shows
 * whether the voice is fed into processing, not whether the microphone hears
 * sound: flat under push-to-talk until a turn is held (the session's
 * `meterGate`, `src/app/session.ts`). Each strip owns its draw loop
 * (`WaveformStrip.tsx`); only their strips' mounting follows `mode`, as
 * today's condition did — a hidden strip is unmounted, not merely styled
 * invisible, so it neither draws nor reads its meter.
 */
export function InputWaveforms({ mode, levels }: { mode: AudioMode; levels: Readonly<Record<LegName, LevelMeter>> | null }) {
  const { t } = useTranslation();
  const showMic = mode === 'speaker' || mode === 'both';
  const showSystem = mode === 'participant' || mode === 'both';

  return (
    <div className="waveform-input-group">
      {showMic && (
        <WaveformStrip
          kind="mic"
          read={() => levels?.speaker.read() ?? null}
          color="#0099ff"
          width={mode === 'both' ? 'half' : 'full'}
          title={t('mainPanel.waveformMicTooltip', 'Your microphone — your voice being captured for translation')}
        />
      )}
      {showSystem && (
        <WaveformStrip
          kind="system"
          read={() => levels?.participant.read() ?? null}
          color="#f59e0b"
          width={mode === 'both' ? 'half' : 'full'}
          title={t('mainPanel.waveformSystemTooltip', "Other's audio captured for translation (browser tab / system audio)")}
        />
      )}
    </div>
  );
}

/** The advanced footer's output strip (`MainPanel.tsx:4895`): what is sent to the virtual microphone. */
export function OutputWaveform({ meter }: { meter: BusMeter | null }) {
  const { t } = useTranslation();

  return (
    <WaveformStrip
      kind="output"
      read={() => meter?.read() ?? null}
      color="#ff9900"
      width="full"
      title={t('mainPanel.waveformOutputTooltip', 'Audio sent to the virtual microphone (translation + passthrough)')}
    />
  );
}
