// Edge's voices, in the line-up's speech card when Edge speaks (mock v18 ②): one voice per direction that speaks,
// from the voices of the language it speaks, each with a preview, and the speed they are read at. The voice is this
// device's setting for that direction (`voices[dir]` of Edge's own settings), the one a session reads.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { StagePart } from '../../components/providers/stageParts';
import { useRunPair } from '../../components/providers/useProviderEntry';
import { TtsSpeedControl } from '../../components/Settings/sections/LocalSettingsControls';
import { languageNameFor } from '../../components/Settings/engine/languageName';
import type { Voice } from '../../lib/edge-tts/edgeTts';
import { previewEdgeVoice } from '../../lib/edge-tts/preview';
import { filterVoicesByLanguage, getEdgeTtsVoices, getVoiceDisplayName } from '../../lib/edge-tts/voiceList';
import { describeCause, reportError } from '../../lib/diagnostics/report';
import { SP } from '../../lib/lineup/types';
import { directionKey } from '../../lib/local-inference/selection/types';
import type { SettingsProps } from '../../lib/provider/types';
import { useProviderStore } from '../../stores/providerStore';
import type { EdgeSettings as S } from './settings';

type Status = 'loading' | 'loaded' | 'error';

/** Exported as `EdgeSettingsView`: `EdgeSettings` already names the settings type this component edits (`./settings`). */
export function EdgeSettingsView({ settings, update, disabled = false, pair: ownPair, legs: givenLegs, participantSpeaks, preview }: SettingsProps<S>) {
  const { t } = useTranslation();
  const storeLegs = useProviderStore((s) => s.legs);
  const storeParticipantSpeech = useProviderStore((s) => s.speech.participantSpeech);
  // The host's decision also counts the provider's own allowance; the store's switch only stands in without one.
  const participantSpeech = participantSpeaks ?? storeParticipantSpeech;
  const legs = givenLegs ?? storeLegs;
  const [all, setAll] = useState<Voice[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const playing = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    getEdgeTtsVoices().then(
      (voices) => { if (live) { setAll(voices); setStatus('loaded'); } },
      (error: unknown) => {
        if (!live) return;
        reportError('EdgeTTS', `Failed to fetch voice list: ${describeCause(error)}`, { cause: error });
        setStatus('error');
      },
    );
    return () => { live = false; };
  }, []);
  useEffect(() => () => { playing.current?.abort(); preview?.stop(); }, [preview]);

  // The session's pair, the transcription provider's: the voices are for the language that will be spoken, also when
  // this device only reads another provider's translation. Each voice is still kept under its direction.
  const runPair = useRunPair();
  const pair = runPair ?? ownPair;
  // The directions that speak, as a session opens them: mine always, theirs when the other side's translation is spoken.
  const rows = useMemo(() => {
    if (!pair) return [];
    const { source, target } = pair;
    const out: Array<{ dir: string; language: string; who: string }> = [];
    if (legs.includes('speaker')) out.push({ dir: directionKey(source, target), language: target, who: t('audioPanel.otherHears', 'Translation the other side hears') });
    if (legs.includes('participant') && participantSpeech) {
      out.push({ dir: directionKey(target, source), language: source, who: t('audioPanel.iHear', 'Translation I hear') });
    }
    return out;
  }, [pair, legs, participantSpeech, t]);

  // A direction showing the fallback first voice has it stored as soon as the list is known: choosing the shown voice
  // fires no change, and SettingsInitializer stores it only once the plan is ready. The same write it would make.
  useEffect(() => {
    if (disabled || status !== 'loaded') return;
    let table = settings.voices;
    for (const { dir, language } of rows) {
      const voices = filterVoicesByLanguage(all, language);
      if (voices.length === 0 || voices.some((v) => v.ShortName === table[dir])) continue;
      table = { ...table, [dir]: voices[0].ShortName };
    }
    if (table !== settings.voices) update({ voices: table });
  }, [disabled, status, all, rows, settings.voices, update]);

  const write = (dir: string, voice: string) => update({ voices: { ...settings.voices, [dir]: voice } });

  const play = async (voice: string, language: string) => {
    playing.current?.abort();
    preview?.stop();
    const stop = new AbortController();
    playing.current = stop;
    const clip = await previewEdgeVoice(voice, language, stop.signal);
    if (!clip || stop.signal.aborted) return;
    try {
      await preview?.play(clip);
    } catch (error) {
      reportError('EdgeTTS', `Could not play the sample of ${voice}: ${describeCause(error)}`, { cause: error });
    }
  };

  return (
    <StagePart stages={SP}>
      {rows.length > 0 && (
        <div className="edge-voices" id="edge-voices-section">
          <p className="edge-voices__hint">{t('settingsPage.lineup.edgeVoices.hint', 'Voices are kept per language: these are the ones this language pair uses.')}</p>
          {rows.map(({ dir, language, who }) => {
            const label = t('settingsPage.lineup.edgeVoices.voiceFor', '{{who}} ({{language}})', { who, language: languageNameFor(language) });
            const voices = filterVoicesByLanguage(all, language);
            // What is shown is what plays and what is stored: no stored voice, or one this language does not list, is the
            // first listed voice, the one SettingsInitializer stores for it.
            const stored = settings.voices[dir];
            const value = voices.find((v) => v.ShortName === stored)?.ShortName ?? voices[0]?.ShortName ?? '';
            const placeholder = status === 'loading' ? t('settings.loadingVoices', 'Loading voices...')
              : status === 'error' ? t('settings.edgeTtsVoiceLoadError', 'Failed to load voices — check LogsPanel')
              : voices.length === 0 ? t('settings.edgeTtsNoVoicesForLanguage', 'No voices available for this language')
              : null;
            const id = `edge-voice-${dir}`;
            const previewLabel = t('audioPanel.previewRow', { row: label, defaultValue: 'Preview {{row}}' });
            return (
              <div className="edge-voices__row" key={dir}>
                <label htmlFor={id}>{label}</label>
                <div className="edge-voices__pick">
                  <select id={id} className="select-dropdown" value={placeholder ? '' : value} disabled={disabled || placeholder !== null}
                    onChange={(e) => write(dir, e.target.value)}>
                    {placeholder && <option value="">{placeholder}</option>}
                    {voices.map((v) => <option key={v.ShortName} value={v.ShortName}>{getVoiceDisplayName(v)}</option>)}
                  </select>
                  <button type="button" className="setting-row__preview" aria-label={previewLabel} title={previewLabel}
                    disabled={disabled || placeholder !== null || !value} onClick={() => void play(value, language)}>
                    <Play size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <TtsSpeedControl value={settings.speed} onChange={(speed) => update({ speed })} disabled={disabled} />
    </StagePart>
  );
}
