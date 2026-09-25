import { Mic } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import ToggleSwitch from '../shared/ToggleSwitch';
import { useSelectedProvider } from '../../providers/useSelectedProvider';
import { useAnalytics } from '../../../lib/analytics';
import { storedProviderValue } from '../../../lib/session/storedSettings';
import type { TurnMode } from '../../../lib/session/types';
import { presentProviders } from '../../../providers/registry';
import { useMode } from '../../../stores/audioStore';
import { useProviderStore } from '../../../stores/providerStore';
import { useKeepReplayAudio, useSetKeepReplayAudio, useSetTextOnly, useTextOnly } from '../../../stores/settingsStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';
import { effectiveTextOnly } from '../../../utils/effectiveTextOnly';

const MODES: ReadonlyArray<[TurnMode, string, string]> = [
  ['auto', 'settings.auto', 'Auto'],
  ['push-to-talk', 'settings.pushToTalk', 'Push-to-Talk'],
  ['push-to-translate', 'settings.pushToTranslate', 'Push-to-Translate'],
];
/** Today's spellings, for `speech_mode_changed` (ruling 14). */
const LEGACY_NAME: Readonly<Record<TurnMode, string>> = { auto: 'Auto', 'push-to-talk': 'Push-to-Talk', 'push-to-translate': 'Push-to-Translate' };

/** The global turn mode (D15, 1e-3 ruling 7): locked while a run is not idle — the run's subtitle session reads it live (roadmap 1d-2 → 1e). */
export function TurnModeControl({ locked }: { locked: boolean }) {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const selected = useProviderStore((s) => s.selected);
  return (
    <div className="setting-item">
      <div className="turn-detection-options">
        {MODES.map(([mode, key, fallback]) => (
          <button
            key={mode}
            type="button"
            className={`option-button ${turnMode === mode ? 'active' : ''}`}
            disabled={locked}
            onClick={() => {
              if (mode === turnMode) return;
              trackEvent('speech_mode_changed', { provider: storedProviderValue(selected ?? ''), from_mode: LEGACY_NAME[turnMode], to_mode: LEGACY_NAME[mode] });
              useTurnModeStore.getState().setTurnMode(mode);
            }}
          >
            {t(key, fallback)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The global turn mode's own section (1e-3b-2 ruling 6): today's local-VAD
 * tooltip (`LocalSettingsControls.tsx`'s `SpeechModeControl` default),
 * accurate while LocalInference is the only provider — a provider-neutral
 * sentence needs new words and lands with Stage 2's second provider.
 */
export function SpeechSection({ locked }: { locked: boolean }) {
  const { t } = useTranslation();
  const tooltip = `${t('settings.localInferenceTurnDetectionTooltip', 'Auto: local Voice Activity Detection automatically detects speech. \nPush-to-Talk: hold Space or the mic button to send audio manually. \nPush-to-Translate: like Push-to-Talk, but routes your raw mic to the virtual mic when idle so you can speak directly without translation.')}\n\n${t('settings.speechModeAppliesTo', "Applies to your voice. Other's audio always uses semantic VAD.")}`;
  return (
    <div className="config-section turn-detection-section" id="turn-detection-section">
      <h3>
        <Mic size={18} />
        <span>{t('settings.speechMode')}</span>
        <Tooltip content={tooltip} position="top" icon="help" />
      </h3>
      <TurnModeControl locked={locked} />
    </div>
  );
}

/**
 * The Output block (ruling 6): Text only and Keep audio for replay, headless
 * — no heading, as they sat at the end of the language section today
 * (`LanguageSection.tsx:694-733`). Rendered by the hosts right after
 * `SpeechSection`, as its own `config-section`.
 *
 * Text only reads the selected provider's `speech` from the registry: a
 * provider that always speaks (`'always'`) is never text-only, so the switch
 * is hidden; one that never speaks (`'never'`) is always text-only, so it
 * shows on and locked; `'optional'` honours the toggle, except while the
 * speaker leg is out of scope (participant-only mode) — the participant
 * channel never synthesizes, so the switch shows the truth (on, locked)
 * instead of contradicting it. Keep audio for replay is never locked (spec:
 * "takes effect immediately").
 */
export function OutputToggles({ locked }: { locked: boolean }) {
  const { t } = useTranslation();
  const providers = useMemo(() => presentProviders(), []);
  const selection = useSelectedProvider(providers);
  const mode = useMode();
  const textOnly = useTextOnly();
  const setTextOnly = useSetTextOnly();
  const keepReplayAudio = useKeepReplayAudio();
  const setKeepReplayAudio = useSetKeepReplayAudio();

  const speech = selection?.provider.speech ?? 'optional';
  const speakerLegRuns = mode !== 'participant';

  return (
    <div className="config-section output-section" id="output-section">
      {speech === 'optional' && (
        <ToggleSwitch
          checked={effectiveTextOnly({ speakerLegRuns, textOnly })}
          onChange={() => setTextOnly(!textOnly)}
          label={t('simpleConfig.textOnly', 'Text Only')}
          disabled={locked || !speakerLegRuns}
          tooltip={
            speakerLegRuns
              ? t('simpleConfig.textOnlyDesc', 'Show translation as text only, without generating an audio response')
              // Name the mode through modePicker's own key so this reason and
              // the picker segment cannot drift apart in a locale.
              : t('simpleConfig.textOnlyForcedByMode', {
                  mode: t('modePicker.modeParticipants', 'Others'),
                  defaultValue: '"{{mode}}" mode turns what participants say into text for you and never generates audio, so Text Only stays on. Switch the translation mode to translate your own voice with speech.',
                })
          }
        />
      )}

      {speech === 'never' && (
        <ToggleSwitch
          checked={true}
          onChange={() => {}}
          label={t('simpleConfig.textOnly', 'Text Only')}
          disabled
          tooltip={t('simpleConfig.textOnlyDesc', 'Show translation as text only, without generating an audio response')}
        />
      )}

      <ToggleSwitch
        checked={keepReplayAudio}
        onChange={() => setKeepReplayAudio(!keepReplayAudio)}
        label={t('simpleConfig.keepReplayAudio', 'Keep audio for replay')}
        disabled={false}
        tooltip={t('simpleConfig.keepReplayAudioDesc', 'Store translated audio in memory so you can replay it later from each message. Off by default to reduce memory use during long sessions.')}
      />
    </div>
  );
}
