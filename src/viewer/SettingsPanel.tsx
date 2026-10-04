// src/viewer/SettingsPanel.tsx
import React from 'react';
import Button from '../components/Settings/shared/Button';
import ToggleSwitch from '../components/Settings/shared/ToggleSwitch';
import type { Layout, Size, Theme } from './layout';
import { SIZES, THEMES } from './layout';
import Segmented from './Segmented';
import type { T } from './strings';

const SIZE_KEYS: Record<Size, string> = {
  small: 'viewer.settings.sizes.small',
  medium: 'viewer.settings.sizes.medium',
  large: 'viewer.settings.sizes.large',
  xlarge: 'viewer.settings.sizes.xlarge',
};
const THEME_KEYS: Record<Theme, string> = {
  dark: 'viewer.settings.themes.dark',
  light: 'viewer.settings.themes.light',
  contrast: 'viewer.settings.themes.contrast',
};

interface SettingsPanelProps {
  t: T;
  layout: Layout;
  choiceControl: React.ReactNode;
  size: Size;
  onSize(size: Size): void;
  theme: Theme;
  onTheme(theme: Theme): void;
  completeOnly: boolean;
  onCompleteOnly(on: boolean): void;
  awake: boolean;
  onAwake(on: boolean): void;
  allowSave: boolean;
  onSave(): void;
  onClose(): void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = (p) => (
  <>
    {p.layout === 'phone' && <div className="viewer-backdrop" onClick={p.onClose} />}
    <section className={`viewer-settings viewer-settings--${p.layout === 'phone' ? 'sheet' : 'menu'}`} role="dialog" aria-label={p.t('viewer.settings.title')}>
      <div className="viewer-settings__head">
        <h2>{p.t('viewer.settings.title')}</h2>
        <Button variant="ghost" size="sm" onClick={p.onClose}>{p.t('viewer.settings.close')}</Button>
      </div>
      {p.layout === 'phone' && (
        <div className="viewer-settings__field"><span>{p.t('viewer.settings.iRead')}</span>{p.choiceControl}</div>
      )}
      <div className="viewer-settings__field">
        <span>{p.t('viewer.settings.textSize')}</span>
        <Segmented label={p.t('viewer.settings.textSize')} value={p.size} onChange={p.onSize}
          options={SIZES.map((s) => ({ value: s, label: p.t(SIZE_KEYS[s]) }))} />
      </div>
      <div className="viewer-settings__field">
        <span>{p.t('viewer.settings.theme')}</span>
        <Segmented label={p.t('viewer.settings.theme')} value={p.theme} onChange={p.onTheme}
          options={THEMES.map((s) => ({ value: s, label: p.t(THEME_KEYS[s]) }))} />
      </div>
      <ToggleSwitch checked={p.completeOnly} onChange={() => p.onCompleteOnly(!p.completeOnly)}
        label={p.t('viewer.settings.completeOnly')} tooltip={p.t('viewer.settings.completeOnlyHint')} />
      <ToggleSwitch checked={p.awake} onChange={() => p.onAwake(!p.awake)} label={p.t('viewer.settings.keepAwake')} />
      {p.allowSave && (
        <div className="viewer-settings__save">
          <div><b>{p.t('viewer.settings.save')}</b><span>{p.t('viewer.settings.saveHint')}</span></div>
          <Button variant="secondary" size="sm" onClick={p.onSave}>{p.t('viewer.settings.saveButton')}</Button>
        </div>
      )}
      <p className="viewer-settings__note">{p.t('viewer.settings.aiNote')}</p>
    </section>
  </>
);

export default SettingsPanel;
