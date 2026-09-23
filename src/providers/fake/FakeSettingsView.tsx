import ToggleSwitch from '../../components/Settings/shared/ToggleSwitch';
import type { SettingsProps } from '../../lib/provider/types';
import { FAKE_SCRIPT_NAMES, type FakeScriptName } from './scripts';
import type { FakeSettings } from './settings';

type Flag = 'requireKey' | 'checkFails' | 'buildRefused' | 'startThrows';

const FLAGS: ReadonlyArray<{ key: Flag; label: string }> = [
  { key: 'requireKey', label: 'Require an API key' },
  { key: 'checkFails', label: 'Check reports not ready' },
  { key: 'buildRefused', label: 'Refuse to build' },
  { key: 'startThrows', label: 'Fail to start' },
];

/** Whole, non-negative milliseconds from an input's text; anything else is 0. */
function toMs(text: string): number {
  const n = Math.round(Number(text));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The fake's own settings: which script plays, and its fault knobs (D24). The
 * fake exists in development builds only, so this copy is not localized.
 */
export function FakeSettingsView({ settings, update }: SettingsProps<FakeSettings>) {
  return (
    <div className="settings-section">
      <h2>Fake provider</h2>
      <div className="setting-item">
        <label className="setting-label" htmlFor="fake-script"><span>Script</span></label>
        <select
          id="fake-script"
          className="select-dropdown"
          value={settings.script}
          onChange={(e) => update({ script: e.target.value as FakeScriptName })}
        >
          {FAKE_SCRIPT_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      {FLAGS.map(({ key, label }) => (
        <div className="setting-item" key={key}>
          <ToggleSwitch
            checked={settings[key]}
            onChange={() => update({ [key]: !settings[key] } as Partial<FakeSettings>)}
            label={label}
          />
        </div>
      ))}
      <div className="setting-item">
        <label className="setting-label" htmlFor="fake-start-delay"><span>Start delay (ms)</span></label>
        <input
          id="fake-start-delay"
          className="settings-input"
          type="number"
          min={0}
          step={100}
          value={settings.startDelayMs}
          onChange={(e) => update({ startDelayMs: toMs(e.target.value) })}
        />
      </div>
      <div className="setting-item">
        <label className="setting-label" htmlFor="fake-fail-after"><span>Fail after (ms, 0 = never)</span></label>
        <input
          id="fake-fail-after"
          className="settings-input"
          type="number"
          min={0}
          step={1000}
          value={settings.failAfterMs}
          onChange={(e) => update({ failAfterMs: toMs(e.target.value) })}
        />
      </div>
    </div>
  );
}
