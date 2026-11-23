import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ownProps, useProviderEntry, useStageProvider } from '../../providers/useProviderEntry';
import { useAnalytics } from '../../../lib/analytics';
import { useStageUnit } from '../../../lib/plan/fromStores';
import type { TurnMode } from '../../../lib/run/types';
import { presentProviders } from '../../../providers/registry';
import { stageIdsFor } from '../../../lib/lineup/catalog';
import { lineUpThatRuns, useStageProviderId } from '../../../stores/lineUpStore';
import { useNavigateToSettings } from '../../../stores/settingsStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';
import { DEFAULT_PUSH_KEY, isModifierKey, pushKeyAllowed, pushKeyLabel } from '../../../lib/turn/pushKey';
import { usePushKeyLabel } from '../../../lib/turn/usePushKeyLabel';
import { isMacOS } from '../../../utils/environment';

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
  // The event names the provider that transcribes: turns are its unit's.
  const selected = useStageProviderId('transcription');
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
              // With who serves each stage, as every event that names the provider: the ids of the line-up that runs
              // (the stored one, or the one shown where this device runs before one is stored).
              const { lineUp, stored } = lineUpThatRuns();
              trackEvent('speech_mode_changed', { provider: selected ?? '', ...(selected ? { stages: stageIdsFor(lineUp, stored, selected) } : {}), from_mode: LEGACY_NAME[turnMode], to_mode: LEGACY_NAME[mode] });
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
 * The tuning of automatic turn detection of the provider whose unit
 * transcribes (its own `TurnDetection`, D18: settings belong to the
 * provider), under Auto only — push-to-talk and push-to-translate detect
 * nothing. The Summary is one line,
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
  // The transcription unit's provider, with its entry; until the plan is ready, the provider the line-up names for
  // transcription, so that its entry loads.
  const transcription = useStageUnit('transcription');
  const transcribing = useStageProvider(providers, 'transcription');
  const selection = useProviderEntry(transcription?.provider ?? transcribing);
  const navigateToSettings = useNavigateToSettings();

  if (turnMode !== 'auto' || !transcription || !selection?.entry) return null;
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

/**
 * Push-to-Talk and Push-to-Translate in the mock's box: the key, with Change to pick another (owner 2026-11-21), then
 * what happens while it is held and while it is not, both, for each mode.
 */
function HeldKeyBox({ locked }: { locked: boolean }) {
  const { t } = useTranslation();
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const pushKey = useTurnModeStore((s) => s.pushKey);
  const keyName = usePushKeyLabel();
  const [picking, setPicking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);

  // Focus leaves Change when picking starts, so that Space is picked as a key instead of pressing the button again, and
  // comes back to Change when picking ends, unless the user has put it somewhere else meanwhile.
  useEffect(() => {
    if (picking) statusRef.current?.focus();
    else if (document.activeElement === statusRef.current) changeRef.current?.focus();
  }, [picking]);
  // While picking, the next key press is the box's alone: taken on the way down, before the page's own handlers (the
  // hold itself among them) see it. Esc cancels; a key a hold cannot take is named, and the box keeps waiting. A click
  // or Tab out of the box, or the window losing focus, ends the picking, so the key pressed next reaches what the user
  // went to.
  useEffect(() => {
    if (!picking) return;
    const stop = () => {
      setPicking(false);
      setRefused(null);
    };
    const choose = (e: KeyboardEvent) => {
      if (!pushKeyAllowed(e.code)) {
        // A key with no code (an input method's, say) is named by what it types.
        setRefused(pushKeyLabel(e.code, isMacOS()) || e.key || '?');
        return;
      }
      useTurnModeStore.getState().setPushKey(e.code);
      stop();
    };
    // A modifier is chosen only when it is let go with no other key pressed meanwhile: Shift+Tab and a Ctrl shortcut
    // begin with the modifier's own press, and must not pick it.
    let pendingModifier: string | null = null;
    const take = (e: KeyboardEvent) => {
      if (isModifierKey(e.code)) {
        if (e.repeat) return;
        const alone = [e.ctrlKey, e.altKey, e.shiftKey, e.metaKey].filter(Boolean).length <= 1;
        pendingModifier = pendingModifier === null && alone ? e.code : null;
        return;
      }
      pendingModifier = null;
      // A key pressed with Ctrl, Alt, Shift or Cmd held is a shortcut (the app's or the browser's), not a choice.
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      // Tab still moves focus, and Enter or Space still presses Cancel, so the keyboard can leave the picking too.
      if (e.code === 'Tab') return;
      const onButton = e.target instanceof Element && e.target.closest('.turn-mode-box__action') !== null;
      if (onButton && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space')) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.code === 'Escape') {
        stop();
        return;
      }
      choose(e);
    };
    const letGo = (e: KeyboardEvent) => {
      if (pendingModifier === null || e.code !== pendingModifier) return;
      pendingModifier = null;
      e.stopImmediatePropagation();
      choose(e);
    };
    const away = (e: PointerEvent) => {
      if (e.target instanceof Node && boxRef.current?.contains(e.target)) return;
      // The focus goes where the user clicked, not back to Change.
      statusRef.current?.blur();
      stop();
    };
    const leave = (e: FocusEvent) => {
      if (!(e.target instanceof Node && boxRef.current?.contains(e.target))) stop();
    };
    window.addEventListener('keydown', take, { capture: true });
    window.addEventListener('keyup', letGo, { capture: true });
    window.addEventListener('pointerdown', away, { capture: true });
    window.addEventListener('focusin', leave);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('keydown', take, { capture: true });
      window.removeEventListener('keyup', letGo, { capture: true });
      window.removeEventListener('pointerdown', away, { capture: true });
      window.removeEventListener('focusin', leave);
      window.removeEventListener('blur', stop);
    };
  }, [picking]);
  // A session starting, or the mode leaving the keys behind (the box then draws nothing), ends the picking: its
  // listener would otherwise keep taking every key press with nothing on screen to say so.
  useEffect(() => {
    setPicking(false);
    setRefused(null);
  }, [locked, turnMode]);

  const reset = () => {
    useTurnModeStore.getState().setPushKey(DEFAULT_PUSH_KEY);
    // Reset goes away with the key it reset; the focus moves to Change instead of falling off the page.
    changeRef.current?.focus();
  };
  if (turnMode === 'auto') return null;
  const said: Array<[string, string]> = turnMode === 'push-to-talk'
    ? [[t('settingsPage.lineup.uses.held', 'While held'), t('settingsPage.lineup.uses.talkHeld', 'Sokuji listens; when you let go, that stretch is translated and the other side hears the translation. With Passthrough on, the other side also hears your own voice, quietly.')],
      [t('settingsPage.lineup.uses.notHeld', 'While not held'), t('settingsPage.lineup.uses.talkNotHeld', 'Sokuji does not listen; nothing you say is translated or reaches the other side.')]]
    : [[t('settingsPage.lineup.uses.held', 'While held'), t('settingsPage.lineup.uses.translateHeld', 'What you say is translated; the other side hears only the translation, not your own voice.')],
      [t('settingsPage.lineup.uses.notHeld', 'While not held'), t('settingsPage.lineup.uses.translateNotHeld', 'Your own voice goes straight to the other side, untranslated.')]];
  const space = pushKeyLabel(DEFAULT_PUSH_KEY, isMacOS());
  let status: ReactNode = <kbd>{keyName}</kbd>;
  if (picking && refused !== null) {
    status = t('settingsPage.lineup.uses.refused', '{{key}} cannot be used. Press another key.', { key: refused });
  } else if (picking) {
    status = t('settingsPage.lineup.uses.press', 'Press a key… (Esc to cancel)');
  }
  return (
    <div ref={boxRef} className="turn-mode-box turn-mode-box--keys">
      <div className="turn-mode-box__row turn-mode-box__row--key">
        <span className="turn-mode-box__label">{t('settingsPage.lineup.uses.key', 'Key')}</span>
        <span className="turn-mode-box__value turn-mode-box__key">
          {/* Always there, so a screen reader hears the prompt, a refusal and the new key alike. */}
          <span ref={statusRef} tabIndex={-1} className={picking ? 'turn-mode-box__picking' : 'turn-mode-box__status'} aria-live="polite">
            {status}
          </span>
          <button ref={changeRef} type="button" className="turn-mode-box__action" disabled={locked} onClick={() => { setRefused(null); setPicking((p) => !p); }}>
            {picking ? t('settingsPage.lineup.uses.cancel', 'Cancel') : t('settingsPage.lineup.uses.change', 'Change')}
          </button>
          {!picking && pushKey !== DEFAULT_PUSH_KEY && (
            <button type="button" className="turn-mode-box__action" disabled={locked} onClick={reset}>
              {t('settingsPage.lineup.uses.reset', 'Reset to {{key}}', { key: space })}
            </button>
          )}
        </span>
      </div>
      {said.map(([label, value]) => (
        <div className="turn-mode-box__row turn-mode-box__row--said" key={label}><span className="turn-mode-box__label">{label}</span><span className="turn-mode-box__value">{value}</span></div>
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
  const pushKeyName = usePushKeyLabel();
  const tooltip = `${t('settings.speechModeTooltip', 'Auto: the provider detects when you have finished speaking. \nPush-to-Talk: hold {{key}} or the mic button to send audio manually. \nPush-to-Translate: like Push-to-Talk, but routes your raw mic to the virtual mic when idle so you can speak directly without translation.', { key: pushKeyName })}\n\n${t('settings.speechModeAppliesToAuto', "Applies to your voice. Other's audio always uses the provider's automatic detection.")}`;
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
      <HeldKeyBox locked={locked} />
    </div>
  );
}
