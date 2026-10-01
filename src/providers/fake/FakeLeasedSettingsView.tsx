import ToggleSwitch from '../../components/Settings/shared/ToggleSwitch';
import type { SettingsProps } from '../../lib/provider/types';
import { FakeSettingsView, toMs } from './FakeSettingsView';
import type { FakeLeasedSettings } from './settings';

/**
 * The leased fake's settings: the fake's own controls, then the knobs of its
 * session hooks (choice 1). Development builds only, so this copy is
 * not localized, as `FakeSettingsView`'s.
 */
export function FakeLeasedSettingsView(props: SettingsProps<FakeLeasedSettings>) {
  const { settings, update, disabled } = props;
  return (
    <>
      <FakeSettingsView {...props} />
      <div className="settings-section">
        <h2>Leased fake</h2>
        <div className="setting-item">
          <ToggleSwitch
            checked={settings.prepareFallback}
            onChange={() => update({ prepareFallback: !settings.prepareFallback })}
            label="Prepare answers with a fallback"
            disabled={disabled}
          />
        </div>
        <div className="setting-item">
          <ToggleSwitch
            checked={settings.sharedBoth}
            onChange={() => update({ sharedBoth: !settings.sharedBoth })}
            label="Share one session in Both"
            disabled={disabled}
          />
        </div>
        <div className="setting-item">
          <label className="setting-label" htmlFor="fake-lease-ends"><span>Lease ends after (ms, 0 = never)</span></label>
          <input
            id="fake-lease-ends"
            className="settings-input"
            type="number"
            min={0}
            step={1000}
            value={settings.leaseEndsAfterMs}
            onChange={(e) => update({ leaseEndsAfterMs: toMs(e.target.value) })}
            disabled={disabled}
          />
        </div>
        <div className="setting-item">
          <ToggleSwitch
            checked={settings.acquireRefused}
            onChange={() => update({ acquireRefused: !settings.acquireRefused })}
            label="Acquire refuses (insufficient balance)"
            disabled={disabled}
          />
        </div>
        <div className="setting-item">
          <label className="setting-label" htmlFor="fake-min-balance"><span>Minimum balance, text only (µUSD; speech doubles it)</span></label>
          {/* `toMs` parses any non-negative integer, µUSD as well as ms. */}
          <input
            id="fake-min-balance"
            className="settings-input"
            type="number"
            min={0}
            step={1000}
            value={settings.minimumBalanceMicroUsd}
            onChange={(e) => update({ minimumBalanceMicroUsd: toMs(e.target.value) })}
            disabled={disabled}
          />
        </div>
      </div>
    </>
  );
}
