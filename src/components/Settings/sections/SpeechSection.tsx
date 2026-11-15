import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ownProps, useSelectedProvider } from '../../providers/useSelectedProvider';
import { useAnalytics } from '../../../lib/analytics';
import type { TurnMode } from '../../../lib/session/types';
import { presentProviders } from '../../../providers/registry';
import { useProviderStore } from '../../../stores/providerStore';
import { useNavigateToSettings } from '../../../stores/settingsStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';

const MODES: ReadonlyArray<[TurnMode, string, string]> = [
  ['auto', 'settings.auto', 'Auto'],
  ['push-to-talk', 'settings.pushToTalk', 'Push-to-Talk'],
  ['push-to-translate', 'settings.pushToTranslate', 'Push-to-Translate'],
];
/** Today's spellings, for `speech_mode_changed` (ruling 14). */
const LEGACY_NAME: Readonly<Record<TurnMode, string>> = { auto: 'Auto', 'push-to-talk': 'Push-to-Talk', 'push-to-translate': 'Push-to-Translate' };

/** The global turn mode (D15, 1e-3 ruling 7): locked while a run is not idle — the run's subtitle session reads it live (roadmap 1d-2 → 1e). */
export function TurnModeControl({ locked, title }: { locked: boolean; title?: string }) {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const selected = useProviderStore((s) => s.selected);
  return (
    <div className="setting-item">
      <div className="turn-detection-options settings-seg" role="group" aria-label={t('settings.speechMode')} title={title}>
        {MODES.map(([mode, key, fallback]) => (
          <button
            key={mode}
            type="button"
            className={`option-button ${turnMode === mode ? 'active' : ''}`}
            aria-pressed={turnMode === mode}
            disabled={locked}
            onClick={() => {
              if (mode === turnMode) return;
              trackEvent('speech_mode_changed', { provider: selected ?? '', from_mode: LEGACY_NAME[turnMode], to_mode: LEGACY_NAME[mode] });
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
 * push-to-talk and push-to-translate detect nothing. The Summary is one line,
 * a link; the Controls are a block of their own among the provider's options
 * (`ProviderTurnDetectionControls`), never drawn here. The link is the
 * settings deep link (`navigateToSettings`, target `'turn-detection-tuning'`),
 * which the settings page opens, scrolls to and highlights. It stays usable
 * during a run — it only navigates; the lock disables the Controls it leads to.
 *
 * `Help`, when the provider defines one, renders right after — a sibling of
 * the link button, never a descendant: `Tooltip`'s trigger is its own
 * hover/focus target, and a click on it must not also fire the button's
 * `onClick` and navigate.
 *
 * A Summary that renders nothing (nothing to tune now — LocalInference on a
 * streaming ASR, where endpoint detection replaces VAD) leaves its
 * `.turn-detection-summary` empty, and Settings.scss hides the row then.
 * `Help` follows the same rule on its own (renders nothing then too).
 */
function ProviderTurnDetection({ locked }: { locked: boolean }) {
  const { t } = useTranslation();
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const providers = useMemo(() => presentProviders(), []);
  const selection = useSelectedProvider(providers);
  const navigateToSettings = useNavigateToSettings();

  if (turnMode !== 'auto' || !selection?.entry) return null;
  const tuning = selection.provider.TurnDetection;
  if (!tuning) return null;
  const { Summary, Help } = tuning;
  const props = ownProps(selection, selection.entry, locked);

  const openControls = () => navigateToSettings('turn-detection-tuning');

  // The mock's box row: the turn end on the left, the provider's summary (the link to its tuning) on the right.
  return (
    <div className="turn-mode-box">
      <div className="setting-item turn-detection-tuning turn-mode-box__row">
        <span className="turn-mode-box__label">{t('settingsPage.lineup.uses.turn', 'Turn end')}</span>
        <div className="setting-label">
          <button type="button" className="turn-detection-summary turn-detection-link" onClick={openControls}>
            <Summary {...props} />
          </button>
          {Help && <Help {...props} />}
        </div>
      </div>
    </div>
  );
}

/** Push-to-Talk and Push-to-Translate in the mock's box: the key, and what it does. */
function HeldKeyBox() {
  const { t } = useTranslation();
  const turnMode = useTurnModeStore((s) => s.turnMode);
  if (turnMode === 'auto') return null;
  const rows: Array<[string, string]> = turnMode === 'push-to-talk'
    ? [[t('settingsPage.lineup.uses.key', 'Key'), t('settingsPage.lineup.uses.space', 'Space')],
      [t('settingsPage.lineup.uses.released', 'Once released'), t('settingsPage.lineup.uses.releasedValue', 'that stretch goes off to be translated')]]
    : [[t('settingsPage.lineup.uses.key', 'Key'), t('settingsPage.lineup.uses.space', 'Space')],
      [t('settingsPage.lineup.uses.notHeld', 'While not held'), t('settingsPage.lineup.uses.notHeldValue', 'your own voice goes straight to the other side, untranslated')]];
  return (
    <div className="turn-mode-box">
      {rows.map(([label, value]) => (
        <div className="turn-mode-box__row" key={label}><span className="turn-mode-box__label">{label}</span><span className="turn-mode-box__value">{value}</span></div>
      ))}
    </div>
  );
}

/**
 * The global turn mode's own section (1e-3b-2 ruling 6). Its tooltip is
 * provider-neutral (Stage 2 Soniox, ruling 8): what ends an utterance under
 * Auto is each provider's own detection. The turn modes come first, then
 * that detection's tuning — the provider's own.
 */
export function SpeechSection({ locked }: { locked: boolean }) {
  const { t } = useTranslation();
  const tooltip = `${t('settings.speechModeTooltip', 'Auto: the provider detects when you have finished speaking. \nPush-to-Talk: hold Space or the mic button to send audio manually. \nPush-to-Translate: like Push-to-Talk, but routes your raw mic to the virtual mic when idle so you can speak directly without translation.')}\n\n${t('settings.speechModeAppliesToAuto', "Applies to your voice. Other's audio always uses the provider's automatic detection.")}`;
  return (
    <div className="config-section turn-detection-section" id="turn-detection-section">
      {/* The mock's line-up page (v18): a plain heading with its hint; the modes explained on hover over the choice. */}
      <h3 className="settings-subhead">
        <span>{t('settings.speechMode')}</span>
        <small>{t('settingsPage.lineup.speechModeHint', 'When a stretch of speech goes off to be translated; fixed during a session')}</small>
      </h3>
      <div className="settings-field">
        <span className="settings-field__label">{t('settings.speechMode')}</span>
        <TurnModeControl locked={locked} title={tooltip} />
      </div>
      <ProviderTurnDetection locked={locked} />
      <HeldKeyBox />
    </div>
  );
}
