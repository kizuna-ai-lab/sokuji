// src/components/SettingsPage/EdgeVoices.tsx
//
// Edge's voices, in the line-up's speech card when Edge speaks (mock v18 ②): one voice per direction that speaks,
// from the voices of the language it speaks, each with a preview. The voice is this device's setting for that
// direction (`voices[dir].edge`), the one a session reads; the Audio page's voice line leads here.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { appVoicePreview } from '../../app/voicePreview';
import type { Voice } from '../../lib/edge-tts/edgeTts';
import { previewEdgeVoice } from '../../lib/edge-tts/preview';
import { filterVoicesByLanguage, getEdgeTtsVoices, getVoiceDisplayName } from '../../lib/edge-tts/voiceList';
import { describeCause, reportError } from '../../lib/diagnostics/report';
import { directionKey } from '../../lib/local-inference/selection/types';
import { localInferenceProvider } from '../../providers/localInference/provider';
import type { LocalInferenceSettings } from '../../providers/localInference/settings';
import { directionVoice, withDirectionVoice } from '../../providers/localInference/voices';
import { useProviderStore } from '../../stores/providerStore';
import { languageNameFor } from '../Settings/engine/languageName';

type Status = 'loading' | 'loaded' | 'error';

export function EdgeVoices({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const entry = useProviderStore((s) => s.entries.local_inference);
  const legs = useProviderStore((s) => s.legs);
  const participantSpeech = useProviderStore((s) => s.speech.participantSpeech);
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
  useEffect(() => () => { playing.current?.abort(); appVoicePreview.stop(); }, []);

  const settings = entry?.settings as LocalInferenceSettings | undefined;
  const pair = entry?.pair;
  // The directions that speak, as a session opens them: mine always, theirs when the other side's translation is spoken.
  const rows = useMemo(() => {
    if (!pair) return [];
    const { source, target } = pair;
    const out: Array<{ dir: string; language: string; who: string }> = [];
    if (legs.includes('speaker')) out.push({ dir: directionKey(source, target), language: target, who: t('audioPanel.otherHears', 'Translation the other side hears') });
    if (legs.includes('participant') && participantSpeech && localInferenceProvider.participantSpeech !== false) {
      out.push({ dir: directionKey(target, source), language: source, who: t('audioPanel.iHear', 'Translation I hear') });
    }
    return out;
  }, [pair, legs, participantSpeech, t]);

  if (!settings || rows.length === 0) return null;

  const write = (dir: string, edge: string) =>
    useProviderStore.getState().updateSettings(localInferenceProvider, withDirectionVoice(settings.voices, dir, { edge }));

  const play = async (voice: string, language: string) => {
    playing.current?.abort();
    appVoicePreview.stop();
    const stop = new AbortController();
    playing.current = stop;
    const clip = await previewEdgeVoice(voice, language, stop.signal);
    if (clip && !stop.signal.aborted) await appVoicePreview.play(clip);
  };

  return (
    <div className="edge-voices" id="edge-voices-section">
      <p className="edge-voices__hint">{t('settingsPage.lineup.edgeVoices.hint', 'Voices are kept per language: these are the ones this language pair uses.')}</p>
      {rows.map(({ dir, language, who }) => {
        const label = t('settingsPage.lineup.edgeVoices.voiceFor', '{{who}} ({{language}})', { who, language: languageNameFor(language) });
        const voices = filterVoicesByLanguage(all, language);
        const value = directionVoice(settings.voices, dir).edge ?? '';
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
  );
}
