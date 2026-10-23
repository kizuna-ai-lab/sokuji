import { useState } from 'react';
import { CircleHelp, Eye, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { ScreenContextPicture } from '../../components/MainPanel/panel/ScreenContextChip';
import { LinesField } from '../../components/providers/fields/LinesField';
import { PresetVoiceField, presetVoice } from '../../components/providers/fields/PresetVoiceField';
import type { VoiceEntry } from '../../components/Settings/sections/VoiceLibrarySection';
import SettingRow from '../../components/Settings/shared/SettingRow';
import Tooltip from '../../components/Tooltip/Tooltip';
import type { SettingsProps, VoiceSummaryProps } from '../../lib/provider/types';
import type { CaptureSourceInfo } from '../../lib/screen/desktopFrames';
import { useScreenContextStore, type PickedSource } from '../../stores/screenContextStore';
import { isElectron } from '../../utils/environment';
import { ENDPOINTS, isEndpointId } from './endpoints';
import { asQwenRegion, QWEN_REGION_LABELS, QWEN_REGIONS } from './regions';
import { QWEN_VOICES, qwenParticipantVoice, qwenSpeakerVoice, SPEAKER_CLONE, SPEAKER_CLONE_ONCE, type QwenSettings as S } from './settings';

/** The voice a spoken leg reads in, for the Speech rows, as its run resolves it: a preset's name, or whose own voice is cloned. */
export function QwenVoiceSummary({ settings, leg }: VoiceSummaryProps<S>) {
  const { t } = useTranslation();
  const id = leg === 'participant' ? qwenParticipantVoice(settings) : qwenSpeakerVoice(settings);
  if (id === SPEAKER_CLONE || id === SPEAKER_CLONE_ONCE) {
    return <>{leg === 'participant'
      ? t('providers.qwen_livetranslate.voiceSummaryCloneTheirs', 'Their own voice (cloned)')
      : t('providers.qwen_livetranslate.voiceSummaryCloneMine', 'Your own voice (cloned)')}</>;
  }
  return <>{QWEN_VOICES.find((v) => v.value === id)?.name ?? id}</>;
}

/**
 * Qwen LiveTranslate's own settings (spec §7): the region the check found
 * the key in, as a line under the key; the voice — cloning under a heading of its
 * own (each speaker on every turn, or the first speaker once), then the 47
 * presets, as Doubao AST 2.0 lists them; and the preferred translations
 * (`translation.corpus`), Soniox's field and words; and, where the other
 * side is heard, Soniox's speaker-labels pills. No preview: the official
 * voice list publishes no samples. No model or instructions: the endpoint
 * has none. No region picker either: an own key's region is the one it was
 * made in; the picker is the managed twin's (`KizunaQwenSettingsView`).
 */
export function QwenSettingsView({ settings, update, disabled = false, participantSpeaks = false, models = [], preview, legs }: SettingsProps<S>) {
  const { t } = useTranslation();
  const cloning = t('providers.qwen_livetranslate.voiceGroupClone', 'Voice cloning');
  const voices: VoiceEntry[] = [
    { id: SPEAKER_CLONE, label: t('providers.qwen_livetranslate.voiceClone', "Clone the speaker's voice"), group: 'builtin', removable: false, section: cloning },
    { id: SPEAKER_CLONE_ONCE, label: t('providers.qwen_livetranslate.voiceCloneOnce', "Clone the first speaker's voice"), group: 'builtin', removable: false, section: cloning },
    ...QWEN_VOICES.map((v) => presetVoice(v)),
  ];
  const endpoint = models[0]?.id;
  return (
    <>
      {isEndpointId(endpoint) && (
        <div className="settings-section">
          <div className="models-info">
            {t('providers.qwen_livetranslate.keyRegion', 'Key region: {{region}}', { region: QWEN_REGION_LABELS[ENDPOINTS[endpoint].region] })}
          </div>
        </div>
      )}
      <PresetVoiceField
        voices={voices} value={settings.voice} onChange={(voice) => update({ voice })} preview={preview} disabled={disabled}
        participant={participantSpeaks ? { value: settings.participantVoice, effective: qwenParticipantVoice(settings), onChange: (participantVoice) => update({ participantVoice }) } : undefined}
      />
      <div className="settings-section" id="qwen-screen-context-section" data-testid="qwen-screen-context">
        <ScreenContextRow on={settings.screenContext} update={update} disabled={disabled} />
      </div>
      <div className="settings-section" id="qwen-vocabulary-section">
        {/* No heading tooltip: Soniox's speaks of recognition too, which Qwen's corpus does not touch; the field's own explains it. */}
        <h2>{t('providers.qwen_livetranslate.vocabulary', 'Custom Vocabulary')}</h2>
        <LinesField
          id="qwen-vocabulary-translations"
          label={t('providers.qwen_livetranslate.vocabularyTranslations', 'Preferred Translations')}
          tooltip={t('providers.qwen_livetranslate.vocabularyTranslationsTooltip', "Biases how specific terms are translated — a preference, not a guaranteed replacement: names with an established rendering work best, while common words may keep the model's own wording. Entries are directional; the reverse direction only exists in Both mode, where you can add a reverse line.")}
          placeholder={t('providers.qwen_livetranslate.vocabularyTranslationsPlaceholder', 'One source=target per line')}
          value={settings.hotwords}
          onChange={(hotwords) => update({ hotwords })}
          disabled={disabled}
        />
      </div>
      {legs?.includes('participant') === true && (
        <div className="settings-section" id="qwen-speaker-labels-section">
          <h2>
            {t('providers.qwen_livetranslate.speakerLabels', 'Speaker labels')}
            <Tooltip
              content={t('providers.qwen_livetranslate.speakerLabelsTooltip', "Numbers the other side's people — Speaker 1, Speaker 2… — once more than one voice is heard.\n\nIt can mistake one person for several. Disabled: no numbers are shown.\n\nApplies from the next session.")}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
            </Tooltip>
          </h2>
          <div className="setting-item">
            <div className="turn-detection-options">
              <button type="button" className={`option-button ${settings.speakerLabels ? 'active' : ''}`} aria-pressed={settings.speakerLabels} onClick={() => update({ speakerLabels: true })} disabled={disabled}>
                {t('settings.enabled', 'Enabled')}
              </button>
              <button type="button" className={`option-button ${!settings.speakerLabels ? 'active' : ''}`} aria-pressed={!settings.speakerLabels} onClick={() => update({ speakerLabels: false })} disabled={disabled}>
                {t('settings.disabled', 'Disabled')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The Screen context switch (spec 2026-10-22 §3.1; owner, 2026-10-22). On the
 * desktop turning it on opens the panel's picker (`pickSource`) at once: a pick
 * is held in memory (`picked`, never stored) and turns it on, a cancel leaves it
 * off; while on, the switch's own line shows, just before it, what the next
 * Start opens (option B, owner 2026-10-22) — the window held as the footer's chip,
 * the system's own chooser (Wayland: nothing to choose here), or nothing yet,
 * asked at Start (Choose…). Turning it off lets the pick go, so there is no
 * Clear. The extension has no picker: the switch just flips, and the meeting
 * tab is used. Locked while a run is not idle, and while Start checks an area —
 * the runner is still idle then.
 */
function ScreenContextRow({ on, update, disabled: runLocked }: { on: boolean; update: SettingsProps<S>['update']; disabled: boolean }) {
  const { t } = useTranslation();
  const desktop = isElectron();
  const picked = useScreenContextStore((s) => s.picked);
  const pickSource = useScreenContextStore((s) => s.pickSource);
  const preparing = useScreenContextStore((s) => s.preparing);
  const disabled = runLocked || preparing;

  /** The panel's picker asked: a pick replaces the one held, a cancel keeps it. True on a pick. */
  const choose = async (): Promise<boolean> => {
    if (!pickSource) return false;
    const pick = await pickSource();
    if (pick) useScreenContextStore.getState().setPicked(pick);
    return pick !== null;
  };
  const toggle = () => {
    if (on) {
      update({ screenContext: false });
      useScreenContextStore.getState().setPicked(null);
    } else if (desktop && pickSource) {
      void choose().then((chosen) => { if (chosen) update({ screenContext: true }); });
    } else {
      // The extension uses the meeting tab; a desktop with no panel mounted asks at Start.
      update({ screenContext: true });
    }
  };

  return (
    <SettingRow
      className="qwen-screen-context"
      label={t('providers.qwen_livetranslate.screenContext', 'Screen context')}
      badge={t('providers.qwen_livetranslate.screenContextBeta', 'Beta')}
      tooltip={t('providers.qwen_livetranslate.screenContextTooltip', "Lets the model see one window, tab or screen you choose, so the names and terms on it are recognized and translated as written. Everything inside that area is sent to Alibaba Cloud's Qwen service, in the region of this session, as pictures; Kizuna AI never receives them. It adds to the charge for every second of speech while it is on — on your Alibaba Cloud bill with your own key, or on your account's pricing page with a Kizuna AI account; in Both mode each direction's session is billed.")}
      accessory={desktop && on && <PickedSourceButton picked={picked} disabled={pickSource === null || disabled} onChoose={() => { void choose(); }} />}
      switch={{ checked: on, onChange: toggle, disabled }}
    />
  );
}

/**
 * What the next Start opens, beside the switch: the control footer's chip, cut
 * for the settings (owner, 2026-10-22). The window held: the eye and its name,
 * its card the picker's still (`PickedSourceChip`); a click asks the picker
 * again. Nothing held: the same chip dashed, the eye and Choose…. Wayland: the
 * system's chooser decides at Start, so a timer and At start — not a button
 * that would choose nothing. A narrow row drops the words and keeps the icon,
 * as the basic layout's footer does; the accessible name always says it in full.
 */
function PickedSourceButton({ picked, disabled, onChoose }: { picked: PickedSource | null; disabled: boolean; onChoose(): void }) {
  const { t } = useTranslation();
  if (picked?.kind === 'portal') {
    const atStart = t('providers.qwen_livetranslate.screenContextAtStart', 'At start');
    // One image, named At start, its title the full sentence (the description a screen reader reads); what is inside is drawing.
    return (
      <span className="qwen-screen-context__at-start" role="img" aria-label={atStart} title={t('providers.qwen_livetranslate.screenContextPortal', 'The system asks which window or screen when the session starts.')}>
        <span className="qwen-screen-context__timer" aria-hidden="true"><Timer size={14} /></span>
        <span className="qwen-screen-context__caption" aria-hidden="true">{atStart}</span>
      </span>
    );
  }
  if (picked === null) {
    const choose = t('providers.qwen_livetranslate.screenContextChoose', 'Choose…');
    return (
      <button
        type="button"
        className="screen-context-chip qwen-screen-context__source qwen-screen-context__source--empty"
        title={t('providers.qwen_livetranslate.screenContextNone', "No window chosen yet: you'll be asked when the session starts.")}
        aria-label={choose}
        onClick={onChoose}
        disabled={disabled}
      >
        <Eye size={14} aria-hidden="true" />
        <span className="qwen-screen-context__caption">{choose}</span>
      </button>
    );
  }
  return <PickedSourceChip source={picked.source} disabled={disabled} onChoose={onChoose} />;
}

/**
 * The window held, as the footer's chip with its card. Hover or keyboard focus
 * shows the card: the picker's still of the window, its kind and name, and a
 * line saying the picture is from when it was chosen. None of the footer's
 * session parts — no dot, no frame count or time, no Choose again in the card:
 * nothing is sent before a session, and a click on the chip already chooses
 * again. Nothing in the card takes input, so it is the chip's tooltip, not a
 * dialog; a locked chip shows none.
 */
function PickedSourceChip({ source, disabled, onChoose }: { source: CaptureSourceInfo; disabled: boolean; onChoose(): void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const shown = open && !disabled;
  const { refs, floatingStyles, context } = useFloating({
    open: shown,
    onOpenChange: setOpen,
    placement: 'top',
    middleware: [offset(8), flip({ fallbackAxisSideDirection: 'start', crossAxis: false }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
    strategy: 'fixed',
  });
  const hover = useHover(context, { delay: { open: 100, close: 0 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
  const what = t('providers.qwen_livetranslate.screenContextPicked', 'The model will see: {{name}}', { name: source.name });
  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className="screen-context-chip qwen-screen-context__source"
        aria-label={what}
        disabled={disabled}
        {...getReferenceProps({ onClick: () => { setOpen(false); onChoose(); } })}
      >
        <Eye size={14} aria-hidden="true" />
        <span className="screen-context-chip__name">{source.name}</span>
      </button>
      {shown && (
        <FloatingPortal>
          <div ref={refs.setFloating} className="screen-context-card" style={{ ...floatingStyles, zIndex: 9999 }} {...getFloatingProps()}>
            <ScreenContextPicture thumbnail={source.thumbnail} name={source.name} kind={source.kind} />
            <div className="screen-context-card__meta">{t('providers.qwen_livetranslate.screenContextStill', 'Picture from when you chose it')}</div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/**
 * Kizuna AI's managed view: the region the session is bought in (spec
 * 2026-10-21, Beijing region, §8), in Soniox's region markup, above the
 * shared view. The user picks; the backend's grant names the endpoint.
 */
export function KizunaQwenSettingsView(props: SettingsProps<S>) {
  const { t } = useTranslation();
  const { settings, update, disabled = false } = props;
  return (
    <>
      <div className="settings-section" id="qwen-region-section">
        <h2>
          {t('settings.qwenRegion', 'Region')}
          <Tooltip
            content={t('settings.qwenRegionTooltip', 'Qwen runs a separate deployment per region. Your audio is processed in the region you pick. Applies from the next session.')}
            position="top"
          >
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        </h2>
        <div className="setting-item">
          <select
            id="qwen-region-select"
            className="select-dropdown"
            aria-label={t('settings.qwenRegion', 'Region')}
            value={settings.region}
            disabled={disabled}
            onChange={(e) => update({ region: asQwenRegion(e.target.value) })}
          >
            {QWEN_REGIONS.map((r) => <option key={r} value={r}>{QWEN_REGION_LABELS[r]}</option>)}
          </select>
          {settings.region === 'cn' && (
            <div className="setting-description" id="qwen-region-note">
              {t('settings.qwenRegionBeijingNote', 'Beijing may have noticeably higher latency from networks outside mainland China; if it does, try Singapore.')}
            </div>
          )}
        </div>
      </div>
      <QwenSettingsView {...props} />
    </>
  );
}
