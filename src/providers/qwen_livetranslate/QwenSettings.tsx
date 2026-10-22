import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LinesField } from '../../components/providers/fields/LinesField';
import { PresetVoiceField, presetVoice } from '../../components/providers/fields/PresetVoiceField';
import type { VoiceEntry } from '../../components/Settings/sections/VoiceLibrarySection';
import SettingRow from '../../components/Settings/shared/SettingRow';
import Tooltip from '../../components/Tooltip/Tooltip';
import type { SettingsProps, VoiceSummaryProps } from '../../lib/provider/types';
import { useScreenContextStore, type PickedSource } from '../../stores/screenContextStore';
import { isElectron } from '../../utils/environment';
import { isEndpointId } from './endpoints';
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
 * Qwen LiveTranslate's own settings (spec §7): the storefront the check
 * found, as a line under the key; the voice — cloning under a heading of its
 * own (each speaker on every turn, or the first speaker once), then the 47
 * presets, as Doubao AST 2.0 lists them; and the preferred translations
 * (`translation.corpus`), Soniox's field and words. No preview: the official
 * voice list publishes no samples. No model or instructions: the endpoint
 * has none. No region either: an own key detects its storefront; the region
 * is the managed twin's (`KizunaQwenSettingsView`).
 */
export function QwenSettingsView({ settings, update, disabled = false, participantSpeaks = false, models = [], preview }: SettingsProps<S>) {
  const { t } = useTranslation();
  const cloning = t('providers.qwen_livetranslate.voiceGroupClone', 'Voice cloning');
  const voices: VoiceEntry[] = [
    { id: SPEAKER_CLONE, label: t('providers.qwen_livetranslate.voiceClone', "Clone the speaker's voice"), group: 'builtin', removable: false, section: cloning },
    { id: SPEAKER_CLONE_ONCE, label: t('providers.qwen_livetranslate.voiceCloneOnce', "Clone the first speaker's voice"), group: 'builtin', removable: false, section: cloning },
    ...QWEN_VOICES.map((v) => presetVoice(v)),
  ];
  const storefront = models[0]?.id;
  return (
    <>
      {isEndpointId(storefront) && (
        <div className="settings-section">
          <div className="models-info">
            {storefront === 'intl'
              ? t('providers.qwen_livetranslate.storefrontIntl', 'Key from QwenCloud (international)')
              : t('providers.qwen_livetranslate.storefrontCn', 'Key from 千问云 (mainland China)')}
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
    </>
  );
}

/**
 * The Screen context switch (spec 2026-10-22 §3.1; owner, 2026-10-22). On the
 * desktop turning it on opens the panel's picker (`pickSource`) at once: a pick
 * is held in memory (`picked`, never stored) and turns it on, a cancel leaves it
 * off; while on, a line under it says what the next Start opens — the window
 * held, the portal's own chooser, or nothing yet (asked at Start) — with
 * Change, Clear or Choose. Turning it off lets the pick go. The extension has
 * no picker: the switch just flips, and the meeting tab is used.
 */
function ScreenContextRow({ on, update, disabled }: { on: boolean; update: SettingsProps<S>['update']; disabled: boolean }) {
  const { t } = useTranslation();
  const desktop = isElectron();
  const picked = useScreenContextStore((s) => s.picked);
  const pickSource = useScreenContextStore((s) => s.pickSource);

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
      label={t('providers.qwen_livetranslate.screenContext', 'Screen context')}
      badge={t('providers.qwen_livetranslate.screenContextBeta', 'Beta')}
      tooltip={t('providers.qwen_livetranslate.screenContextTooltip', "Lets the Qwen engine see one window, tab or screen you choose when a session starts, so the names and terms on it are recognized and translated as written. Everything inside that area is sent to Alibaba Cloud's Qwen service, in the region of this session, as pictures; Kizuna AI never receives them. It adds to the charge for every second of speech while it is on — on your Alibaba Cloud bill with your own key, or on your account's pricing page with a Kizuna AI account; in Both mode each direction's session is billed.")}
      switch={{ checked: on, onChange: toggle, disabled }}
      footer={desktop && on && <PickedLine picked={picked} canChoose={pickSource !== null && !disabled} disabled={disabled} onChoose={() => { void choose(); }} />}
    />
  );
}

/** What the next Start opens, under the switch: its words, and the buttons that change it. */
function PickedLine({ picked, canChoose, disabled, onChoose }: { picked: PickedSource | null; canChoose: boolean; disabled: boolean; onChoose(): void }) {
  const { t } = useTranslation();
  const text = picked === null
    ? t('providers.qwen_livetranslate.screenContextNone', "No window chosen yet: you'll be asked when the session starts.")
    : picked.kind === 'portal'
      ? t('providers.qwen_livetranslate.screenContextPortal', 'The system asks which window or screen when the session starts.')
      : t('providers.qwen_livetranslate.screenContextPicked', 'The model will see: {{name}}', { name: picked.source.name });
  return (
    <div className="qwen-screen-context__picked">
      <span className="qwen-screen-context__text" title={text}>{text}</span>
      <button type="button" className="qwen-screen-context__button" onClick={onChoose} disabled={!canChoose}>
        {picked === null
          ? t('providers.qwen_livetranslate.screenContextChoose', 'Choose…')
          : t('providers.qwen_livetranslate.screenContextChange', 'Change')}
      </button>
      {picked?.kind === 'desktop' && (
        <button type="button" className="qwen-screen-context__button" onClick={() => useScreenContextStore.getState().setPicked(null)} disabled={disabled}>
          {t('providers.qwen_livetranslate.screenContextClear', 'Clear')}
        </button>
      )}
    </div>
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
