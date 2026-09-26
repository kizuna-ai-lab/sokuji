import { ChevronDown, ChevronRight, Mic } from 'lucide-react';
import { useMemo, useState } from 'react';
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
 * The selected provider's own tuning of automatic turn detection (its
 * `TurnDetection`, D18: settings belong to the provider), under Auto only —
 * push-to-talk and push-to-translate detect nothing. Simple mode shows no
 * provider-specific controls, so there it is the Summary alone, one muted
 * line; Advanced makes that line a disclosure onto the full Controls,
 * collapsed until opened (the open state is this component's only). The
 * disclosure is `TranslationPromptControl`'s preview toggle
 * (`LocalSettingsControls.tsx`): a `.preview-toggle` button in a
 * `.setting-label` row, `aria-expanded`/`aria-controls`, a 16px chevron. It
 * stays usable during a run — it only shows what is set; the lock disables
 * the Controls inside.
 *
 * `Help`, when the provider defines one, renders right after — a sibling of
 * the disclosure button (or, in Simple, of the plain summary span), never a
 * descendant: `Tooltip`'s trigger is its own hover/focus target, and a click
 * on it must not also fire the button's `onClick` and toggle the disclosure.
 *
 * A Summary that renders nothing (nothing to tune now — LocalInference on a
 * streaming ASR, where endpoint detection replaces VAD) leaves its
 * `.turn-detection-summary` empty, and Settings.scss hides the row then:
 * the section cannot see what a provider's component rendered, and a row
 * left standing would be a bare chevron in Advanced. `Help` follows the same
 * rule on its own (renders nothing then too), so no stray icon is left
 * behind for `:has(.turn-detection-summary:empty)` to have missed.
 */
function ProviderTurnDetection({ locked, layout }: { locked: boolean; layout: 'simple' | 'advanced' }) {
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const providers = useMemo(() => presentProviders(), []);
  const selection = useSelectedProvider(providers);
  const [open, setOpen] = useState(false);

  if (turnMode !== 'auto' || !selection?.entry) return null;
  const tuning = selection.provider.TurnDetection;
  if (!tuning) return null;
  const { Summary, Controls, Help } = tuning;
  const props = { settings: selection.entry.settings, update: selection.update, disabled: locked, pair: selection.entry.pair };

  if (layout === 'simple') {
    return (
      <div className="setting-item turn-detection-tuning">
        <div className="setting-label">
          <span className="setting-value turn-detection-summary"><Summary {...props} /></span>
          {Help && <Help {...props} />}
        </div>
      </div>
    );
  }
  return (
    <div className="setting-item turn-detection-tuning">
      <div className="setting-label">
        <button
          type="button" className="preview-toggle"
          aria-expanded={open} aria-controls="turn-detection-controls"
          onClick={() => setOpen(!open)}
        >
          <span className="turn-detection-summary"><Summary {...props} /></span>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {Help && <Help {...props} />}
      </div>
      {open && (
        <div id="turn-detection-controls">
          <Controls {...props} />
        </div>
      )}
    </div>
  );
}

/**
 * The global turn mode's own section (1e-3b-2 ruling 6): today's local-VAD
 * tooltip (`LocalSettingsControls.tsx`'s `SpeechModeControl` default),
 * accurate while LocalInference is the only provider — a provider-neutral
 * sentence needs new words and lands with Stage 2's second provider. Below
 * the turn modes, the provider's own tuning of Auto, drawn for `layout`.
 */
export function SpeechSection({ locked, layout }: { locked: boolean; layout: 'simple' | 'advanced' }) {
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
      <ProviderTurnDetection locked={locked} layout={layout} />
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
