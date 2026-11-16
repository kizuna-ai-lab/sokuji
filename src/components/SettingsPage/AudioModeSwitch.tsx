// src/components/SettingsPage/AudioModeSwitch.tsx
//
// The audio page's mode switch (owner, 2026-11-15): the drawing, the devices and which switches can be used all follow
// the mode, which was only chosen in the session's corner picker. The same three modes here, so how the sound goes in
// each can be seen at once. Like that picker, it switches only while no session runs.
import { useTranslation } from 'react-i18next';
import useAudioStore, { useMode, type AudioMode } from '../../stores/audioStore';

const MODES: readonly AudioMode[] = ['speaker', 'participant', 'both'];

export function AudioModeSwitch({ locked }: { locked: boolean }) {
  const { t } = useTranslation();
  const mode = useMode();
  const label = (m: AudioMode) => (m === 'speaker' ? t('modePicker.modeYou', 'Me')
    : m === 'participant' ? t('modePicker.modeParticipants', 'Other') : t('modePicker.modeBoth', 'Both'));
  const help = (m: AudioMode) => (m === 'speaker' ? t('modePicker.descYou', 'Your speech → translated for others.')
    : m === 'participant' ? t('modePicker.descOthers', "Others' speech → translated for you.") : t('modePicker.descBoth', 'Both directions.'));
  const name = t('modePicker.groupLabel', 'Translation mode');
  return (
    <div className="settings-field audio-mode-switch">
      <span className="settings-field__label">{name}</span>
      <span className="settings-seg" role="group" aria-label={name}>
        {MODES.map((m) => (
          <button key={m} type="button" className={mode === m ? 'active' : undefined} aria-pressed={mode === m}
            title={help(m)} disabled={locked} onClick={() => { if (!locked && m !== mode) useAudioStore.getState().setMode(m); }}>
            {label(m)}
          </button>
        ))}
      </span>
      {locked && <span className="setting-description">{t('modePicker.switchDisabled', 'Mode is locked during a session.')}</span>}
    </div>
  );
}
