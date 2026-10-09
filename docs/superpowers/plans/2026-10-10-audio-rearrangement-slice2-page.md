# Audio Settings Rearrangement — Slice 2: The Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Audio page becomes 麦克风 → 语音 → 对方音频, with the 语音 block's six two-line rows (named by who hears what, each with its own device and channel, descriptions in tooltips), and the old Output block, Text Only and Keep-replay switches gone.

**Architecture:** A pure helper (`outletOptions.ts`) builds the device·channel entries and the select's value; a `SettingRow` helper draws the two-line row (label + ⓘ + switch, then the control); `SpeechOutputSection` binds the six rows to the stores through slice 1's model; `AudioDeviceSection` shrinks to the microphone; `AdvancedSettings`, `SimpleSettings`, `ProviderArea`, the navigation map and the Tour point at the new block. Strings land in all 30 catalogs. A headless render against the approved boards closes the slice.

**Tech Stack:** React, Zustand, SCSS (compiled in tests with `sass`), Vitest + Testing Library, i18next catalogs, headless Chromium for the render check.

**Spec:** `docs/superpowers/specs/2026-10-10-audio-settings-rearrangement-design.md` — §1 (the page), §6.1–6.2, §6.5 (strings), §7 (platforms), §9 slice 2. The boards: https://claude.ai/artifact/AYCKtFSu9FNbRzFwMgU78z boards 1–6.

**Depends on:** slice 1 (`docs/superpowers/plans/2026-10-10-audio-rearrangement-slice1-outlets.md`) merged into this branch: `outlets.ts`, `audioStore.outlets`, `routingStore.participantSpeech: boolean | null`, `speechFromStores`, `playback.preview(clip, outlet)`, `AppAudio.earPreview(outlet)`.

## Global Constraints

- Row names (D2): 默认播放设备 / 对方听到的翻译 / 我也听 / 原声直通 / 我听到的翻译 / 保留译音以便回放; never 「译音」 as a noun in a label, never 「会议」 in a label (D3).
- Row layout (D4): line 1 = label, ⓘ right after it, switch at the right edge; line 2 = the control, full width, left edge on the label text; sub-rows (我也听, 原声直通) indented 30px with a └ connector. Captions become tooltips; only state lines stay visible (the merged blocked reason, face-to-face's headphones hint).
- Storage keys unchanged (spec §3); `textOnly` shown inverted as 对方听到的翻译; `isMonitorMuted` inverted as 我也听.
- The device list entries, in order (boards 4/5): 跟随默认 · 跟随默认 · 左声道 · 跟随默认 · 右声道 · then per device `A` · `A · 左声道` · `A · 右声道`.
- All 30 catalogs get every new key and lose every removed key in the same task: `src/locales/locales.consistency.test.ts` holds them in lockstep with en (keys, placeholders, no empty strings). Chinese (zh_CN) wording is the owner's, given below; the other 28 languages are the implementer's translations, as slice-3 B14 of #613 did them.
- Section ids: `microphone-section`, `speech-section` (new), `participant-section`; `speaker-section` and `output-section` disappear.
- Comments in English; conventional commits; every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Binaries: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run <path>`, `…/node_modules/.bin/tsc --noEmit -p tsconfig.json`.

## Review Focus

1. Text Only on with passthrough on today: after this slice 原声直通 greys with its parent (对方听到的翻译 off) but its stored value survives — Task 3's "greys 我也听 and 原声直通 when 对方听到的翻译 is off, keeping their values".
2. A user whose 默认播放设备 has no stereo (a mono USB speakerphone): the channel entries still appear and still work (a mono device plays a panned clip quieter, never silent) — Task 1's entries test covers presence; the render check (Task 6) plays nothing, so note it in the PR's live checks.
3. Face-to-face with 我听到的翻译 switched off (not auto): the 试听 button on that row must still play (it previews the outlet, not the switch) — Task 3's "the preview plays on the row's outlet whatever its switch".
4. Others mode on Electron with the whole-system source (the common Others setup): 我听到的翻译 shows blocked with the reason line, not merely greyed — Task 3's table row for 对方.
5. The Tour's monitor step after the Output block is gone: it must anchor the 语音 block and only when the block has something to say — Task 4's tour test.

---

### Task 1: `outletOptions.ts` — the entries and the select value

**Files:**
- Create: `src/lib/audio/outletOptions.ts`
- Test: `src/lib/audio/outletOptions.test.ts`

**Interfaces:**
- Consumes: `OutletName`, `OutletChoice`, `Channel`, `ChannelChoice`, `resolveChannel` (slice 1).
- Produces:
  ```ts
  export interface OutletEntry { device: string | null; channel: ChannelChoice; label?: string }   // label: the device's label; absent for the follow-default entries
  export function outletEntries(devices: readonly { deviceId: string; label: string }[]): OutletEntry[];
  export function entryValue(entry: Pick<OutletEntry, 'device' | 'channel'>): string;            // `${device ?? ''}#${channel}`
  export function parseEntryValue(value: string): { device: string | null; channel: ChannelChoice };
  export function outletSelectValue(name: OutletName, choice: OutletChoice, faceToFace: boolean): string;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/audio/outletOptions.test.ts
import { describe, it, expect } from 'vitest';
import { entryValue, outletEntries, outletSelectValue, parseEntryValue } from './outletOptions';

const DEVICES = [{ deviceId: 'airpods', label: 'AirPods Pro' }, { deviceId: 'mbp', label: 'MacBook Pro Speakers' }];

describe('outletEntries', () => {
  it('lists follow-default three ways, then each device three ways, in the boards\' order', () => {
    expect(outletEntries(DEVICES)).toEqual([
      { device: null, channel: 'auto' },
      { device: null, channel: 'left' },
      { device: null, channel: 'right' },
      { device: 'airpods', channel: 'both', label: 'AirPods Pro' },
      { device: 'airpods', channel: 'left', label: 'AirPods Pro' },
      { device: 'airpods', channel: 'right', label: 'AirPods Pro' },
      { device: 'mbp', channel: 'both', label: 'MacBook Pro Speakers' },
      { device: 'mbp', channel: 'left', label: 'MacBook Pro Speakers' },
      { device: 'mbp', channel: 'right', label: 'MacBook Pro Speakers' },
    ]);
  });

  it('with no devices, only the follow-default entries', () => {
    expect(outletEntries([])).toHaveLength(3);
  });
});

describe('entryValue / parseEntryValue', () => {
  it('round-trips every entry', () => {
    for (const entry of outletEntries(DEVICES)) {
      expect(parseEntryValue(entryValue(entry))).toEqual({ device: entry.device, channel: entry.channel });
    }
  });

  it('reads an unknown value as follow-default, auto', () => {
    expect(parseEntryValue('')).toEqual({ device: null, channel: 'auto' });
    expect(parseEntryValue('airpods#centre')).toEqual({ device: 'airpods', channel: 'auto' });
  });
});

describe('outletSelectValue — which entry the select shows', () => {
  it('follow-default, auto: the plain follow-default entry in a meeting, the resolved channel face-to-face', () => {
    expect(outletSelectValue('other', { device: null, channel: 'auto' }, false)).toBe('#auto');
    expect(outletSelectValue('other', { device: null, channel: 'auto' }, true)).toBe('#right');
    expect(outletSelectValue('them', { device: null, channel: 'auto' }, true)).toBe('#left');
  });

  it('a chosen channel shows as itself, with or without a device', () => {
    expect(outletSelectValue('me', { device: null, channel: 'left' }, false)).toBe('#left');
    expect(outletSelectValue('me', { device: 'airpods', channel: 'right' }, true)).toBe('airpods#right');
  });

  it('a device on auto shows the resolved channel: both in a meeting, the ear face-to-face', () => {
    expect(outletSelectValue('me', { device: 'airpods', channel: 'auto' }, false)).toBe('airpods#both');
    expect(outletSelectValue('them', { device: 'airpods', channel: 'auto' }, true)).toBe('airpods#left');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/lib/audio/outletOptions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/lib/audio/outletOptions.ts
/**
 * The entries of an outlet's device select and the value it shows (spec
 * 2026-10-10 §1.3): follow-default three ways, then every device three
 * ways — the whole device, its left channel, its right channel. A mono
 * device still gets the channel entries: nothing knows an output's channel
 * count, and a panned clip on a mono device plays quieter, never silent.
 */
import { isChannelChoice, resolveChannel, type ChannelChoice, type OutletChoice, type OutletName } from './outlets';

export interface OutletEntry {
  device: string | null;
  channel: ChannelChoice;
  /** The device's label; absent on the follow-default entries. */
  label?: string;
}

export function outletEntries(devices: readonly { deviceId: string; label: string }[]): OutletEntry[] {
  const entries: OutletEntry[] = [
    { device: null, channel: 'auto' },
    { device: null, channel: 'left' },
    { device: null, channel: 'right' },
  ];
  for (const d of devices) {
    for (const channel of ['both', 'left', 'right'] as const) entries.push({ device: d.deviceId, channel, label: d.label });
  }
  return entries;
}

/** `<device id>#<channel>`; the follow-default entries have an empty id. */
export function entryValue(entry: Pick<OutletEntry, 'device' | 'channel'>): string {
  return `${entry.device ?? ''}#${entry.channel}`;
}

export function parseEntryValue(value: string): { device: string | null; channel: ChannelChoice } {
  const at = value.lastIndexOf('#');
  if (at < 0) return { device: null, channel: 'auto' };
  const device = value.slice(0, at);
  const channel = value.slice(at + 1);
  return { device: device === '' ? null : device, channel: isChannelChoice(channel) ? channel : 'auto' };
}

/**
 * Which entry shows for a stored choice. An auto channel shows as the plain
 * follow-default entry in a meeting (where auto is centred) and as the ear it
 * resolves to face-to-face; a device on auto shows its resolved channel, so
 * the value is always an entry the list has.
 */
export function outletSelectValue(name: OutletName, choice: OutletChoice, faceToFace: boolean): string {
  if (choice.device === null && choice.channel === 'auto' && !faceToFace) return entryValue(choice);
  return entryValue({ device: choice.device, channel: resolveChannel(name, choice.channel, faceToFace) });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/lib/audio/outletOptions.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/outletOptions.ts src/lib/audio/outletOptions.test.ts
git commit -m "feat(audio): the outlet select's entries and value

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `SettingRow` — the two-line row; `ToggleSwitch` gets an aria-label

**Files:**
- Create: `src/components/Settings/shared/SettingRow.tsx`
- Modify: `src/components/Settings/shared/ToggleSwitch.tsx`, `src/components/Settings/Settings.scss` (append)
- Test: `src/components/Settings/shared/SettingRow.test.tsx`

**Interfaces:**
- Produces:
  ```tsx
  export interface SettingRowSwitch { checked: boolean; onChange: () => void; disabled?: boolean; title?: string }
  export interface SettingRowProps {
    label: string;
    tooltip: string;
    /** A sub-row: indented, with the └ connector. */
    sub?: boolean;
    /** The row is greyed for this reason (shown as the row's title); its controls are disabled. */
    greyed?: string;
    switch?: SettingRowSwitch;
    children?: React.ReactNode;    // line 2
    className?: string;
    id?: string;
  }
  export default function SettingRow(props: SettingRowProps): JSX.Element;
  ```
  `ToggleSwitch` gains `ariaLabel?: string`; with `label=""` it renders no label text.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/Settings/shared/SettingRow.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingRow from './SettingRow';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }) }));

describe('SettingRow', () => {
  it('draws the label, a help tooltip trigger, the switch named after the label, then the control on its own line', () => {
    const onChange = vi.fn();
    render(<SettingRow label="I hear it too" tooltip="Plays it to me as well" switch={{ checked: true, onChange }}><select aria-label="device"><option>AirPods</option></select></SettingRow>);
    expect(screen.getByText('I hear it too')).toBeInTheDocument();
    expect(document.querySelector('.setting-row__head .tooltip-trigger')).not.toBeNull();
    const sw = screen.getByRole('switch', { name: 'I hear it too' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.setting-row__control select')).not.toBeNull();
  });

  it('a row without a switch or a control is one line', () => {
    render(<SettingRow label="Default playback device" tooltip="…" />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(document.querySelector('.setting-row__control')).toBeNull();
  });

  it('a sub-row carries the connector class', () => {
    render(<SettingRow label="Passthrough" tooltip="…" sub />);
    expect(document.querySelector('.setting-row')?.classList.contains('setting-row--sub')).toBe(true);
  });

  it('greyed: the reason is the row\'s title, the switch is disabled, the control is inert', () => {
    const onChange = vi.fn();
    render(<SettingRow label="Translation I hear" tooltip="…" greyed="Not in Me mode." switch={{ checked: false, onChange }}><select aria-label="device" /></SettingRow>);
    const row = document.querySelector('.setting-row')!;
    expect(row.classList.contains('setting-row--greyed')).toBe(true);
    expect(row.getAttribute('title')).toBe('Not in Me mode.');
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('device')).toBeDisabled();
  });

  it('a switch with its own title (locked by the run) keeps it', () => {
    render(<SettingRow label="X" tooltip="…" switch={{ checked: true, onChange: () => {}, disabled: true, title: 'Fixed for this session' }} />);
    expect(screen.getByRole('switch').closest('.toggle-switch-component')?.getAttribute('title')).toBe('Fixed for this session');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/components/Settings/shared/SettingRow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: `ToggleSwitch.tsx`**

Add `ariaLabel?: string;` and `title?: string;` to `ToggleSwitchProps`; destructure them; on the outer `<div className={`toggle-switch-component ${className}`}>` add `title={title}`; on the `role="switch"` div add `aria-label={ariaLabel}`; render the label span only when `label !== ''`:
```tsx
        {label !== '' && <span className={`toggle-label-text ${checked ? 'active' : ''}`}>{label}</span>}
```

- [ ] **Step 4: `SettingRow.tsx`**

```tsx
// src/components/Settings/shared/SettingRow.tsx
import React from 'react';
import Tooltip from '../../Tooltip/Tooltip';
import ToggleSwitch from './ToggleSwitch';

export interface SettingRowSwitch {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** Why the switch is disabled while the row is not greyed (a run froze it). */
  title?: string;
}

export interface SettingRowProps {
  label: string;
  tooltip: string;
  /** A sub-row: indented, with the └ connector. */
  sub?: boolean;
  /** The row is greyed for this reason (its title); every control in it is disabled. */
  greyed?: string;
  switch?: SettingRowSwitch;
  /** Line 2: the control, full width. */
  children?: React.ReactNode;
  className?: string;
  id?: string;
}

/**
 * A two-line setting row (spec 2026-10-10 D4): the label, its help tooltip
 * and, at the right edge, the switch; under them the control. A greyed row
 * says why in its title and takes no input.
 */
const SettingRow: React.FC<SettingRowProps> = ({ label, tooltip, sub, greyed, switch: sw, children, className = '', id }) => {
  const classes = ['setting-row', sub ? 'setting-row--sub' : '', greyed ? 'setting-row--greyed' : '', className].filter(Boolean).join(' ');
  return (
    <div className={classes} id={id} title={greyed} aria-disabled={greyed ? true : undefined}>
      <div className="setting-row__head">
        <span className="setting-row__label">{label}</span>
        <Tooltip content={tooltip} position="top" icon="help" maxWidth={300} />
        {sw && (
          <ToggleSwitch
            className="setting-row__switch"
            checked={sw.checked}
            onChange={sw.onChange}
            disabled={sw.disabled || !!greyed}
            label=""
            ariaLabel={label}
            title={sw.title}
          />
        )}
      </div>
      {children && (
        <div className="setting-row__control">
          {greyed ? <fieldset disabled className="setting-row__inert">{children}</fieldset> : children}
        </div>
      )}
    </div>
  );
};

export default SettingRow;
```

- [ ] **Step 5: `Settings.scss`**

Append at the end of the file:
```scss
// ── Two-line setting rows (spec 2026-10-10 D4) ───────────────────────────
.setting-row {
  margin-top: 10px;
  position: relative;

  &__head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
  }
  &__label {
    font-size: vars.$font-title;
    color: vars.$text-primary;
  }
  &__switch {
    margin-left: auto;
  }
  &__control {
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 8px;

    .select-dropdown { flex: 1; min-width: 0; }
  }
  &__inert {
    display: contents;
    border: 0;
    padding: 0;
    margin: 0;
  }
  // A read-only box the same height as a closed select.
  &__field {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    background: vars.$bg-control;
    border: 1px solid vars.$border-default;
    border-radius: vars.$radius-sm;
    font-size: vars.$font-title;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    .muted { color: vars.$text-secondary; }
  }
  &__preview {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    padding: 6px 10px;
    border: 1px solid vars.$border-default;
    border-radius: vars.$radius-sm;
    background: vars.$bg-control;
    color: vars.$text-primary;
    font-size: vars.$font-caption;
    cursor: pointer;

    &:hover { border-color: vars.$color-primary; }
  }
  &__slider {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;

    input[type='range'] { flex: 1; min-width: 0; }
    .setting-value { color: vars.$color-primary; font-size: vars.$font-caption; white-space: nowrap; }
  }
  &__reason {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-top: 8px;
  }

  &--sub {
    margin-left: 30px;

    &::before {
      content: '';
      position: absolute;
      left: -18px;
      top: -4px;
      width: 10px;
      height: 16px;
      border-left: 2px solid #888;
      border-bottom: 2px solid #888;
      border-bottom-left-radius: 3px;
    }
  }
  &--greyed {
    opacity: 0.5;

    .tooltip-trigger { opacity: 1; pointer-events: auto; }
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/components/Settings/shared`
Expected: PASS (the `fieldset disabled` makes the greyed select report `disabled`).

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings/shared/SettingRow.tsx src/components/Settings/shared/SettingRow.test.tsx src/components/Settings/shared/ToggleSwitch.tsx src/components/Settings/Settings.scss
git commit -m "feat(settings): SettingRow — the two-line row with a tooltip and a switch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `SpeechOutputSection` — the 语音 block

**Files:**
- Create: `src/components/Settings/sections/SpeechOutputSection.tsx`
- Modify: `src/lib/audio/virtualSpeaker.ts` (add `virtualMicrophoneName`), `src/lib/audio/virtualSpeaker.test.ts`
- Test: `src/components/Settings/sections/SpeechOutputSection.test.tsx`

**Interfaces:**
- Consumes: Task 1's helpers; Task 2's `SettingRow`; slice 1's `useOutlets`, `useSetOutletDevice`, `useSetOutletChannel`, `useRoutingStore.participantSpeech`, `getAppAudio().earPreview(outlet)`, `participantSpeechHeard`, `selectedFromStores`, `useFaceToFace`.
- Produces:
  ```tsx
  export interface SpeechOutputSectionProps { isSessionActive: boolean; className?: string }
  export default function SpeechOutputSection(props): JSX.Element;      // id="speech-section", data-tour="speech-section"
  export function virtualMicrophoneName(): string;                       // virtualSpeaker.ts: 'Sokuji_Virtual_Mic' | 'SokujiVirtualAudio' | 'CABLE Output (VB-Audio Virtual Cable)'
  ```
  Strings are used by key with their English defaults inline; Task 5 adds them to the catalogs.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/Settings/sections/SpeechOutputSection.test.tsx
/**
 * The 语音 block (spec 2026-10-10 §1.1–1.2): six two-line rows named by who
 * hears what, each with its own device and channel, greyed / blocked /
 * hidden per mode as the table says.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, def?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      const o = typeof def === 'object' ? def : opts;
      const d = typeof def === 'string' ? def : (o?.defaultValue as string | undefined) ?? key;
      return d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(o?.[k] ?? ''));
    },
  }),
}));
vi.mock('../../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
const env = vi.hoisted(() => ({ platform: 'electron' as 'electron' | 'extension' | 'web', os: 'mac' as 'mac' | 'win' | 'linux' }));
vi.mock('../../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/environment')>()),
  getEnvironment: () => env.platform,
  isElectron: () => env.platform === 'electron',
  isExtension: () => env.platform === 'extension',
  isMacOS: () => env.os === 'mac',
  isWindows: () => env.os === 'win',
  isLinux: () => env.os === 'linux',
}));
const preview = vi.hoisted(() => vi.fn(async (_outlet: string) => {}));
vi.mock('../../../lib/audio/appAudio', () => ({ getAppAudio: async () => ({ earPreview: preview }) }));

import useAudioStore from '../../../stores/audioStore';
import { useProviderStore } from '../../../stores/providerStore';
import { useRoutingStore } from '../../../stores/routingStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';
import { SONIOX_DEFAULTS } from '../../../providers/soniox/settings';
import SpeechOutputSection from './SpeechOutputSection';

const AIRPODS = { deviceId: 'airpods', label: 'AirPods Pro' };
const MBP = { deviceId: 'mbp', label: 'MacBook Pro Speakers' };
const SYSTEM = { deviceId: 'desktop-audio-loopback', label: 'System Audio (All Applications)' };
const ZOOM = { deviceId: 'app:pid:7', label: 'Zoom' };

const pick = (id: string) => useProviderStore.setState({
  selected: id,
  entries: { [id]: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
} as never);

beforeEach(() => {
  env.platform = 'electron';
  env.os = 'mac';
  preview.mockClear();
  pick('soniox');
  useAudioStore.setState({
    mode: 'speaker', otherSide: 'meeting',
    audioMonitorDevices: [AIRPODS, MBP], selectedMonitorDevice: AIRPODS,
    isMonitorMuted: true, isRealVoicePassthroughEnabled: true, realVoicePassthroughVolume: 0.2,
    participantSources: [SYSTEM, ZOOM], selectedParticipantSource: SYSTEM,
    outlets: { other: { device: null, channel: 'auto' }, me: { device: null, channel: 'auto' }, them: { device: null, channel: 'auto' } },
  });
  useRoutingStore.setState({ participantSpeech: null });
  useSettingsStore.setState({ textOnly: false, keepReplayAudio: false });
  useTurnModeStore.setState({ turnMode: 'auto' });
});

const mount = (isSessionActive = false) => render(<SpeechOutputSection isSessionActive={isSessionActive} />);
const row = (label: string) => screen.getByText(label).closest('.setting-row') as HTMLElement;
const sw = (label: string) => screen.getByRole('switch', { name: label });
const greyed = (label: string) => row(label).classList.contains('setting-row--greyed');

describe('SpeechOutputSection — the rows', () => {
  it('is the speech section, with the six rows in order, under the 语音 heading', () => {
    mount();
    expect(document.getElementById('speech-section')).not.toBeNull();
    expect(screen.getByRole('heading', { name: /Speech/ })).toBeInTheDocument();
    const labels = Array.from(document.querySelectorAll('.setting-row__label')).map((el) => el.textContent);
    expect(labels).toEqual(['Default playback device', 'Translation the other side hears', 'I hear it too', 'Passthrough', 'Translation I hear', 'Keep spoken translations for replay']);
    expect(document.querySelectorAll('.setting-row__head .tooltip-trigger')).toHaveLength(6);
  });

  it('默认播放设备 is a select over the devices, writing the monitor device', () => {
    mount();
    const select = within(row('Default playback device')).getByRole('combobox');
    expect((select as HTMLSelectElement).value).toBe('airpods');
    fireEvent.change(select, { target: { value: 'mbp' } });
    expect(useAudioStore.getState().selectedMonitorDevice).toEqual(MBP);
  });

  it('对方听到的翻译 is Text Only inverted, and shows the virtual microphone\'s name as a read-only field', () => {
    mount();
    expect(sw('Translation the other side hears')).toHaveAttribute('aria-checked', 'true');
    expect(row('Translation the other side hears').querySelector('.setting-row__field')?.textContent).toBe('Virtual microphone · SokujiVirtualAudio');
    fireEvent.click(sw('Translation the other side hears'));
    expect(useSettingsStore.getState().textOnly).toBe(true);
    expect(sw('Translation the other side hears')).toHaveAttribute('aria-checked', 'false');
  });

  it('names the virtual microphone per platform: Linux, Windows, the extension\'s tab', () => {
    env.os = 'linux';
    const { unmount } = mount();
    expect(row('Translation the other side hears').querySelector('.setting-row__field')?.textContent).toBe('Virtual microphone · Sokuji_Virtual_Mic');
    unmount();
    env.os = 'win';
    const second = mount();
    expect(row('Translation the other side hears').querySelector('.setting-row__field')?.textContent).toBe('Virtual microphone · CABLE Output (VB-Audio Virtual Cable)');
    second.unmount();
    env.platform = 'extension';
    mount();
    expect(row('Translation the other side hears').querySelector('.setting-row__field')?.textContent).toBe('Virtual microphone · the meeting tab');
  });

  it('我也听 is the monitor inverted, with its own device select; the select lists follow-default and each device three ways', () => {
    mount();
    expect(sw('I hear it too')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw('I hear it too'));
    expect(useAudioStore.getState().isMonitorMuted).toBe(false);
    const select = within(row('I hear it too')).getByRole('combobox') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Follow default (AirPods Pro)', 'Follow default · left channel', 'Follow default · right channel',
      'AirPods Pro', 'AirPods Pro · left channel', 'AirPods Pro · right channel',
      'MacBook Pro Speakers', 'MacBook Pro Speakers · left channel', 'MacBook Pro Speakers · right channel',
    ]);
    fireEvent.change(select, { target: { value: 'mbp#left' } });
    expect(useAudioStore.getState().outlets.me).toEqual({ device: 'mbp', channel: 'left' });
    fireEvent.change(select, { target: { value: '#auto' } });
    expect(useAudioStore.getState().outlets.me).toEqual({ device: null, channel: 'auto' });
  });

  it('greys 我也听 and 原声直通 when 对方听到的翻译 is off, keeping their values (Review Focus 1)', () => {
    useSettingsStore.setState({ textOnly: true });
    mount();
    expect(greyed('I hear it too')).toBe(true);
    expect(greyed('Passthrough')).toBe(true);
    expect(useAudioStore.getState().isRealVoicePassthroughEnabled).toBe(true);
    expect(useAudioStore.getState().isMonitorMuted).toBe(true);
  });

  it('原声直通: its switch, a slider labelled Volume N%, and the push-to-translate lock', () => {
    mount();
    expect(sw('Passthrough')).toHaveAttribute('aria-checked', 'true');
    const slider = within(row('Passthrough')).getByRole('slider') as HTMLInputElement;
    expect(slider.max).toBe('0.6');
    expect(within(row('Passthrough')).getByText('Volume 20%')).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: '0.4' } });
    expect(useAudioStore.getState().realVoicePassthroughVolume).toBeCloseTo(0.4);
    fireEvent.click(sw('Passthrough'));
    expect(useAudioStore.getState().isRealVoicePassthroughEnabled).toBe(false);
    useTurnModeStore.setState({ turnMode: 'push-to-translate' });
    expect(sw('Passthrough')).toHaveAttribute('aria-checked', 'true');
    expect(sw('Passthrough')).toHaveAttribute('aria-disabled', 'true');
    expect(within(row('Passthrough')).queryByRole('slider')).toBeNull();
  });

  it('我听到的翻译 is greyed in Me mode (the other side\'s leg does not run)', () => {
    mount();
    expect(greyed('Translation I hear')).toBe(true);
    expect(row('Translation I hear').getAttribute('title')).toBe('Not in "Me" mode.');
  });

  it('保留译音以便回放 toggles the setting and is never locked', () => {
    mount(true);
    fireEvent.click(sw('Keep spoken translations for replay'));
    expect(useSettingsStore.getState().keepReplayAudio).toBe(true);
  });
});

describe('SpeechOutputSection — per mode (spec §1.2)', () => {
  it('对方: 对方听到的翻译 and its sub-rows greyed; 我听到的翻译 blocked on a whole-system source with the reason line (Review Focus 4)', () => {
    useAudioStore.setState({ mode: 'participant' });
    mount();
    expect(greyed('Translation the other side hears')).toBe(true);
    expect(greyed('I hear it too')).toBe(true);
    expect(greyed('Passthrough')).toBe(true);
    expect(sw('Translation I hear')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/All system sound is being captured/)).toBeInTheDocument();
    useAudioStore.setState({ selectedParticipantSource: ZOOM });
    expect(sw('Translation I hear')).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText(/All system sound is being captured/)).toBeNull();
  });

  it('两者 · 在线会议 · 整个系统: 我也听 and 我听到的翻译 blocked, one reason line; 原声直通 free', () => {
    useAudioStore.setState({ mode: 'both' });
    mount();
    expect(sw('I hear it too')).toHaveAttribute('aria-disabled', 'true');
    expect(sw('Translation I hear')).toHaveAttribute('aria-disabled', 'true');
    expect(sw('Passthrough')).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByText(/All system sound is being captured/)).toHaveLength(1);
  });

  it('两者 · 在线会议 · 应用: nothing blocked; 我听到的翻译 off until switched, then on', () => {
    useAudioStore.setState({ mode: 'both', selectedParticipantSource: ZOOM });
    mount();
    expect(sw('I hear it too')).not.toHaveAttribute('aria-disabled', 'true');
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw('Translation I hear'));
    expect(useRoutingStore.getState().participantSpeech).toBe(true);
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'true');
  });

  it('两者 · 就在身边: device·channel selects with previews on both rows, no 我也听, no 原声直通, the headphones hint; 我听到的翻译 on by auto', () => {
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    mount();
    expect(screen.queryByText('I hear it too')).toBeNull();
    expect(screen.queryByText('Passthrough')).toBeNull();
    const other = within(row('Translation the other side hears')).getByRole('combobox') as HTMLSelectElement;
    expect(other.value).toBe('#right');
    const them = within(row('Translation I hear')).getByRole('combobox') as HTMLSelectElement;
    expect(them.value).toBe('#left');
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Use headphones, one side each/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Preview/ })).toHaveLength(2);
  });

  it('the preview plays on the row\'s outlet whatever its switch (Review Focus 3)', async () => {
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    useRoutingStore.setState({ participantSpeech: false });
    mount();
    fireEvent.click(within(row('Translation I hear')).getByRole('button', { name: /Preview/ }));
    await vi.waitFor(() => expect(preview).toHaveBeenCalledWith('them'));
    fireEvent.click(within(row('Translation the other side hears')).getByRole('button', { name: /Preview/ }));
    await vi.waitFor(() => expect(preview).toHaveBeenCalledWith('other'));
  });

  it('a run locks 对方听到的翻译 and 我听到的翻译, with the reason, and leaves the selects live', () => {
    useAudioStore.setState({ mode: 'both', selectedParticipantSource: ZOOM });
    mount(true);
    expect(sw('Translation the other side hears')).toHaveAttribute('aria-disabled', 'true');
    expect(sw('Translation I hear')).toHaveAttribute('aria-disabled', 'true');
    expect(sw('Translation I hear').closest('.toggle-switch-component')?.getAttribute('title')).toBe('Fixed for this session; stop it to change.');
    expect(within(row('I hear it too')).getByRole('combobox')).not.toBeDisabled();
  });

  it("a provider that always speaks shows 对方听到的翻译 on and disabled; one whose participant never speaks disables 我听到的翻译", () => {
    useAudioStore.setState({ mode: 'both', selectedParticipantSource: ZOOM });
    shapeOverride.provider = { id: 'x', speech: 'always', participantSpeech: true };
    const first = mount();
    expect(sw('Translation the other side hears')).toHaveAttribute('aria-checked', 'true');
    expect(sw('Translation the other side hears')).toHaveAttribute('aria-disabled', 'true');
    first.unmount();
    shapeOverride.provider = { id: 'x', speech: 'optional', participantSpeech: false };
    mount();
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'false');
    expect(sw('Translation I hear')).toHaveAttribute('aria-disabled', 'true');
  });
});
```
The last case needs the provider's flags pinned without a registered provider carrying them. Add, with the other mocks at the top of the file:
```ts
const shapeOverride = vi.hoisted(() => ({ provider: null as null | { id: string; speech: 'always' | 'optional' | 'never'; participantSpeech?: boolean } }));
vi.mock('../../../lib/session/appShape', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/session/appShape')>();
  return {
    ...actual,
    selectedFromStores: () => (shapeOverride.provider
      ? { provider: shapeOverride.provider, entry: { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } } }
      : actual.selectedFromStores()),
  };
});
```
and `shapeOverride.provider = null;` in `beforeEach`. The section imports `selectedFromStores` from that module, so the override reaches it; `useFaceToFace`'s own calls stay real, which these two cases do not depend on.

- [ ] **Step 2: Run the test to verify it fails**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/components/Settings/sections/SpeechOutputSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: `virtualMicrophoneName`**

In `src/lib/audio/virtualSpeaker.ts` add (importing `isLinux`, `isWindows` from `../../utils/environment`):
```ts
/**
 * The virtual microphone's name as the user's meeting app lists it (spec
 * 2026-10-10 §7): the input side of the device `findVirtualSpeaker` plays
 * into. Linux's PulseAudio remap, macOS's driver, Windows' VB-Cable.
 */
export function virtualMicrophoneName(): string {
  if (isLinux()) return 'Sokuji_Virtual_Mic';
  if (isWindows()) return 'CABLE Output (VB-Audio Virtual Cable)';
  return 'SokujiVirtualAudio';
}
```
and in `virtualSpeaker.test.ts` a case per OS (mock `../../utils/environment`'s `isLinux`/`isWindows` as the section test does).

- [ ] **Step 4: Write the section**

```tsx
// src/components/Settings/sections/SpeechOutputSection.tsx
import React, { useId } from 'react';
import { Info, Play, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import SettingRow from '../shared/SettingRow';
import { useFilteredDevices } from '../shared/hooks';
import { getAppAudio } from '../../../lib/audio/appAudio';
import { entryValue, outletEntries, outletSelectValue, parseEntryValue } from '../../../lib/audio/outletOptions';
import type { OutletName } from '../../../lib/audio/outlets';
import { virtualMicrophoneName } from '../../../lib/audio/virtualSpeaker';
import { describeCause, reportError } from '../../../lib/diagnostics/report';
import { useAnalytics } from '../../../lib/analytics';
import { participantSpeechHeard } from '../../../lib/modern-audio/participantSource';
import { selectedFromStores } from '../../../lib/session/appShape';
import { useAudioContext, useMode, useOutlets, useSelectedParticipantSource, useSetOutletChannel, useSetOutletDevice } from '../../../stores/audioStore';
import { useProviderStore } from '../../../stores/providerStore';
import { useRoutingStore } from '../../../stores/routingStore';
import { useKeepReplayAudio, useSetKeepReplayAudio, useSetTextOnly, useTextOnly } from '../../../stores/settingsStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';
import { getEnvironment } from '../../../utils/environment';
import { useFaceToFace } from '../../MainPanel/useFaceToFace';

export interface SpeechOutputSectionProps {
  /** A run is live: 对方听到的翻译 and 我听到的翻译 froze into its shape. */
  isSessionActive: boolean;
  className?: string;
}

/**
 * The 语音 block (spec 2026-10-10 §1): who hears what, each row with its
 * own output. Every row reads and writes the stores slice 1 taught the
 * model to read, so what the page shows is what the routing does.
 */
const SpeechOutputSection: React.FC<SpeechOutputSectionProps> = ({ isSessionActive, className = '' }) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const platform = getEnvironment();
  const mode = useMode();
  const f2f = useFaceToFace();
  const faceToFace = f2f.active;
  // Subscribed to what the provider lookup reads, so the rows follow a selection or a load.
  useProviderStore((s) => s.selected);
  useProviderStore((s) => s.entries);
  const provider = selectedFromStores()?.provider;
  const speech = provider?.speech ?? 'optional';
  const participantOffered = provider?.participantSpeech !== false;

  const textOnly = useTextOnly();
  const setTextOnly = useSetTextOnly();
  const keepReplayAudio = useKeepReplayAudio();
  const setKeepReplayAudio = useSetKeepReplayAudio();
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const setParticipantSpeech = useRoutingStore((s) => s.setParticipantSpeech);
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const {
    audioMonitorDevices, selectedMonitorDevice, selectMonitorDevice,
    isMonitorMuted, setMonitorMuted,
    isRealVoicePassthroughEnabled, realVoicePassthroughVolume, toggleRealVoicePassthrough, setRealVoicePassthroughVolume,
  } = useAudioContext();
  const outlets = useOutlets();
  const setOutletDevice = useSetOutletDevice();
  const setOutletChannel = useSetOutletChannel();
  const source = useSelectedParticipantSource();
  const devices = useFilteredDevices(audioMonitorDevices);
  const reasonId = useId();

  const myLegRuns = mode !== 'participant';
  const theirLegRuns = mode !== 'speaker';
  const heard = participantSpeechHeard(platform, source?.deviceId, faceToFace);
  // The recapture rule (D10): a whole-system capture would translate the playback again.
  const recaptured = theirLegRuns && !faceToFace && !heard;
  const otherOn = speech === 'always' ? true : speech === 'never' ? false : !textOnly;
  const themOn = participantOffered && speech !== 'never' && (speech === 'always' || (participantSpeech ?? faceToFace));
  const hasVirtualBus = platform !== 'web';
  const pushToTranslate = turnMode === 'push-to-translate';

  const modeName = mode === 'speaker' ? t('modePicker.modeYou', 'Me') : mode === 'participant' ? t('modePicker.modeParticipants', 'Other') : t('modePicker.modeBoth', 'Both');
  const notInMode = t('audioPanel.lockedByMode', { mode: modeName, defaultValue: 'Not in "{{mode}}" mode.' });
  const lockedByRun = t('audioPanel.rowLockedByRun', 'Fixed for this session; stop it to change.');
  const channelName = (channel: 'left' | 'right') => (channel === 'left' ? t('audioPanel.channelLeft', 'left channel') : t('audioPanel.channelRight', 'right channel'));

  const previewOn = (outlet: OutletName) => {
    void getAppAudio()
      .then((app) => app.earPreview(outlet))
      .catch((error: unknown) => reportError('SpeechOutputSection', `The preview did not play: ${describeCause(error)}`, { cause: error }));
  };

  /** An outlet's device·channel select (spec §1.3), and face-to-face's 试听 beside it. */
  const outletSelect = (name: OutletName, rowLabel: string, withPreview: boolean) => (
    <>
      <select
        className="select-dropdown"
        aria-label={rowLabel}
        value={outletSelectValue(name, outlets[name], faceToFace)}
        onChange={(e) => {
          const { device, channel } = parseEntryValue(e.target.value);
          setOutletDevice(name, device);
          setOutletChannel(name, channel);
        }}
      >
        {outletEntries(devices).map((entry) => {
          const base = entry.device === null
            ? (entry.channel === 'auto'
              ? (selectedMonitorDevice ? t('audioPanel.followDefaultNamed', { device: selectedMonitorDevice.label, defaultValue: 'Follow default ({{device}})' }) : t('audioPanel.followDefault', 'Follow default'))
              : t('audioPanel.followDefault', 'Follow default'))
            : entry.label!;
          const text = entry.channel === 'left' || entry.channel === 'right' ? `${base} · ${channelName(entry.channel)}` : base;
          return <option key={entryValue(entry)} value={entryValue(entry)}>{text}</option>;
        })}
      </select>
      {withPreview && (
        <button type="button" className="setting-row__preview" aria-label={t('audioPanel.previewRow', { row: rowLabel, defaultValue: 'Preview {{row}}' })} onClick={() => previewOn(name)}>
          <Play size={12} />
          {t('audioPanel.preview', 'Preview')}
        </button>
      )}
    </>
  );

  const otherLabel = t('audioPanel.otherHears', 'Translation the other side hears');
  const themLabel = t('audioPanel.iHear', 'Translation I hear');
  const meLabel = t('audioPanel.meToo', 'I hear it too');
  const passthroughLabel = t('audioPanel.realVoicePassthrough', 'Passthrough');

  return (
    <div className={`config-section speech-section ${className}`} id="speech-section" data-tour="speech-section">
      <h3>
        <Volume2 size={18} />
        <span>{t('audioPanel.speechTitle', 'Speech')}</span>
        <Tooltip content={t('audioPanel.speechTooltip', 'Which translations are spoken, to whom, and on which device.')} position="top" icon="help" maxWidth={300} />
      </h3>

      <SettingRow label={t('audioPanel.defaultPlayback', 'Default playback device')} tooltip={t('audioPanel.defaultPlaybackTip', 'Sounds with no device of their own play here.')}>
        <select
          className="select-dropdown"
          aria-label={t('audioPanel.defaultPlayback', 'Default playback device')}
          value={selectedMonitorDevice?.deviceId ?? ''}
          onChange={(e) => {
            const device = devices.find((d) => d.deviceId === e.target.value);
            if (device) {
              selectMonitorDevice(device);
              trackEvent('audio_device_changed', { device_type: 'output', device_name: device.label, change_type: 'selected', during_session: isSessionActive });
            }
          }}
        >
          {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      </SettingRow>

      <SettingRow
        label={otherLabel}
        tooltip={speech === 'always' ? t('audioPanel.otherHearsAlwaysSpeaks', 'This service always speaks.') : speech === 'never' ? t('audioPanel.otherHearsNeverSpeaks', 'This service never speaks.') : t('audioPanel.otherHearsTip', 'What I say, translated and read aloud to the other side. Into the virtual microphone: the other side picks it as the microphone in their own app.')}
        greyed={myLegRuns ? undefined : notInMode}
        switch={{ checked: otherOn, onChange: () => setTextOnly(!textOnly), disabled: isSessionActive || speech !== 'optional', title: isSessionActive ? lockedByRun : undefined }}
      >
        {faceToFace
          ? outletSelect('other', otherLabel, true)
          : hasVirtualBus && (
            <div className="setting-row__field">
              {platform === 'extension'
                ? t('audioPanel.virtualMicTabs', 'Virtual microphone · the meeting tab')
                : <>{t('audioPanel.virtualMicrophone', 'Virtual microphone')}<span className="muted"> · {virtualMicrophoneName()}</span></>}
            </div>
          )}
      </SettingRow>

      {!faceToFace && (
        <SettingRow
          label={meLabel}
          tooltip={t('audioPanel.meTooTip', 'Also plays the translation the other side hears on my side (the spoken translation, not my own voice).')}
          sub
          greyed={!myLegRuns ? notInMode : !otherOn ? t('audioPanel.needsOtherHears', 'Nothing to hear while the translation is not spoken.') : undefined}
          switch={{ checked: !isMonitorMuted, onChange: () => setMonitorMuted(!isMonitorMuted), disabled: recaptured && mode === 'both' }}
        >
          {outletSelect('me', meLabel, false)}
        </SettingRow>
      )}

      {!faceToFace && hasVirtualBus && (
        <SettingRow
          label={passthroughLabel}
          tooltip={pushToTranslate ? t('audioPanel.passthroughManagedByPushToTranslate') : t('audioPanel.passthroughTip', 'Mixes my own voice, at a lower level, under the translation into the virtual microphone. 60% at most.')}
          sub
          greyed={!myLegRuns ? notInMode : !otherOn && !pushToTranslate ? t('audioPanel.needsOtherHears', 'Nothing to hear while the translation is not spoken.') : undefined}
          switch={{
            checked: isRealVoicePassthroughEnabled || pushToTranslate,
            onChange: () => {
              if (pushToTranslate) return;
              toggleRealVoicePassthrough();
              trackEvent('audio_passthrough_toggled', { enabled: !isRealVoicePassthroughEnabled, volume_level: realVoicePassthroughVolume });
            },
            disabled: pushToTranslate,
            title: pushToTranslate ? t('audioPanel.passthroughManagedByPushToTranslate') : undefined,
          }}
        >
          {!pushToTranslate && (
            <div className="setting-row__slider">
              <input
                type="range" min="0" max="0.6" step="0.01"
                aria-label={t('audioPanel.realVoiceVolume', 'Original Audio Volume')}
                value={realVoicePassthroughVolume}
                onChange={(e) => setRealVoicePassthroughVolume(parseFloat(e.target.value))}
                onMouseUp={(e) => trackEvent('ui_interaction', { component: 'SpeechOutputSection', action: 'passthrough_volume_changed', element: 'volume_slider', value: parseFloat((e.target as HTMLInputElement).value) })}
                className="volume-slider"
              />
              <span className="setting-value">{t('audioPanel.passthroughVolume', { percent: Math.round(realVoicePassthroughVolume * 100), defaultValue: 'Volume {{percent}}%' })}</span>
            </div>
          )}
        </SettingRow>
      )}

      <SettingRow
        label={themLabel}
        tooltip={!participantOffered ? t('audioPanel.iHearNotOffered', "This service does not speak the other side's translation.") : t('audioPanel.iHearTip', 'What the other side says, translated and read aloud to me.')}
        greyed={theirLegRuns ? undefined : notInMode}
        switch={{
          checked: themOn,
          onChange: () => setParticipantSpeech(!(participantSpeech ?? faceToFace)),
          disabled: isSessionActive || recaptured || !participantOffered || speech !== 'optional',
          title: isSessionActive ? lockedByRun : undefined,
        }}
      >
        {faceToFace ? outletSelect('them', themLabel, true) : outletSelect('them', themLabel, false)}
      </SettingRow>

      {recaptured && (
        <p className="setting-description setting-row__reason" id={reasonId}>
          <Info size={14} aria-hidden="true" />
          <span>{t('audioPanel.blockedWholeSystem', 'All system sound is being captured: these playback options are off, so the translation is not translated again.')}</span>
        </p>
      )}

      {faceToFace && (
        <p className="setting-description ears-hint">{t('faceToFace.speakersHint', 'Use headphones, one side each. Any speaker lets the microphone pick up the translation and translate it again.')}</p>
      )}

      <SettingRow
        label={t('audioPanel.keepReplay', 'Keep spoken translations for replay')}
        tooltip={t('audioPanel.keepReplayTip', "Keeps the spoken translations in memory so each message's ▶ works; a long session uses more memory.")}
        switch={{ checked: keepReplayAudio, onChange: () => setKeepReplayAudio(!keepReplayAudio) }}
      />
    </div>
  );
};

export default SpeechOutputSection;
```
Note the keys this introduces beyond the spec's §6.5 list: `audioPanel.otherHearsNeverSpeaks`, `audioPanel.needsOtherHears`, `audioPanel.iHearNotOffered`, `audioPanel.previewRow`, `audioPanel.rowLockedByRun`; and it reuses `audioPanel.virtualMicrophone` ("Virtual microphone", already in the catalogs) for the field's first word, so `virtualMicField` of §6.5 is not needed. Task 5 adds exactly these.

- [ ] **Step 5: Run the tests**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/components/Settings/sections/SpeechOutputSection.test.tsx src/lib/audio/virtualSpeaker.test.ts`
Expected: PASS. If a `t()` default with an object second argument renders the key, fix the test's `t` mock, not the component (the mock above handles both call shapes).

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/sections/SpeechOutputSection.tsx src/components/Settings/sections/SpeechOutputSection.test.tsx src/lib/audio/virtualSpeaker.ts src/lib/audio/virtualSpeaker.test.ts
git commit -m "feat(settings): the 语音 block — six rows, each with its own output

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The hosts — Advanced, Simple, the microphone block, the navigation, the Tour

**Files:**
- Modify: `src/components/Settings/sections/AudioDeviceSection.tsx`, `src/components/Settings/sections/index.ts`, `src/components/Settings/ProviderArea.tsx`, `src/components/Settings/sections/SpeechSection.tsx` (delete `OutputToggles`), `src/components/Settings/AdvancedSettings/AdvancedSettings.tsx`, `src/components/Settings/SimpleSettings/SimpleSettings.tsx`, `src/components/Settings/Settings.tsx` (`NAVIGATION_TAB_MAP`), `src/components/Tour/steps.ts`, `src/components/Settings/shared/DeviceList.tsx` (the output aria-label key)
- Delete: `src/components/Settings/sections/VoicePassthroughSection.tsx`
- Tests: `AudioDeviceSection.test.tsx`, `SpeechSection.test.tsx`, `AdvancedSettings/AdvancedSettings.test.tsx`, `SimpleSettings/SimpleSettings.order.test.tsx`, `Settings.highlight.test.tsx`, `ProviderArea.test.tsx`, `Tour/steps.test.ts`

**Interfaces:**
- `AudioDeviceSection` props shrink to `{ isSessionActive; isLocked?; lockedReason?; className? }` — microphone only; `showMicrophone`, `showSpeaker`, `isSystemAudioEnabled`, `onSpeakerMutualExclusivity`, `children` go.
- `SessionSettingsGeneral` renders languages, provider, speech mode (no `OutputToggles`).
- Navigation targets: `'speech'` → the audio tab; `'speaker'` is removed from the map. The Tour's `monitor` step anchors `speech-section` and opens `'speech'`.

- [ ] **Step 1: Update the tests first**

(a) `AudioDeviceSection.test.tsx`: delete the describes `'AudioDeviceSection: the Output section'` and `'AudioDeviceSection: picking an Output device'` and the `'renders nothing participant-related in the speaker instance'` case; `renderSpeaker` becomes `renderMic` rendering `<AudioDeviceSection isSessionActive={false} {...props} />`; the mocked store drops `useIsMonitorChannelInScope`, `selectedMonitorDevice`, `isMonitorMuted`, `selectMonitorDevice`, `setMonitorMuted`; drop the `EarsBlock` and `useFaceToFace` mocks. The locked-reason cases keep working on the mic list (they only read `lockedReason`).

(b) `SpeechSection.test.tsx`: delete the `describe('OutputToggles', …)` block; in `"locked disables the three turn-mode buttons, and OutputToggles' Text only — Keep audio for replay stays enabled"` keep only the turn-mode assertions and rename it `'locked disables the three turn-mode buttons'`.

(c) `AdvancedSettings.test.tsx`: replace `'AdvancedSettings: the Audio tab passthrough'` with:
```tsx
describe('AdvancedSettings: the Audio tab', () => {
  it('renders the microphone, then the speech block, then the other side\'s audio', () => {
    renderAudioTab();
    const ids = Array.from(document.querySelectorAll('.audio-section .config-section')).map((el) => el.id);
    expect(ids).toEqual(['microphone-section', 'speech-section', 'participant-section']);
  });

  it('has no output block and no passthrough of its own', () => {
    renderAudioTab();
    expect(document.getElementById('speaker-section')).toBeNull();
    expect(document.querySelector('.voice-passthrough-section')).toBeNull();
  });
});
```
(`renderAudioTab` is whatever the file's existing helper renders the audio tab with; keep its mocks and add a mock for `../sections/SpeechOutputSection` returning `<div className="config-section" id="speech-section" />` if the real one needs stores the file does not set.)

(d) `SimpleSettings.order.test.tsx`: the expected id order becomes `['languages-section' …, 'provider-section', 'turn-detection-section', 'microphone-section', 'speech-section', 'participant-section', 'help-section']` — read the file's current expected array and replace `output-section` (removed) and `speaker-section` → `speech-section`.

(e) `Settings.highlight.test.tsx`: where a case uses `'speaker'`, use `'speech'`; add a case `"target='speech' maps to the audio tab and highlights #speech-section"` in the shape of the `'microphone'` case.

(f) `ProviderArea.test.tsx` `'renders the blocks in order…'`: drop `output-section` from the expected order.

(g) `Tour/steps.test.ts`: the id lists keep `'monitor'`; add:
```ts
  it('the monitor step anchors the speech block and opens it', () => {
    const step = BASICS_STEPS.find((s) => s.id === 'monitor')!;
    expect(step.anchor).toBe('speech-section');
    const openSettings = vi.fn();
    step.prepare!(ctxFor('be-heard', 'managed'), { openSettings } as never);
    expect(openSettings).toHaveBeenCalledWith('speech');
  });
```
(adapt `ctxFor`/the actions object to the file's own helpers).

- [ ] **Step 2: Run them to verify they fail**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/components/Settings src/components/Tour`
Expected: FAIL on the new expectations.

- [ ] **Step 3: `AudioDeviceSection.tsx` → microphone only**

Remove: the `Volume2` import, `EarsBlock`, `useFaceToFace`, `useIsMonitorChannelInScope`; the props `showMicrophone`, `showSpeaker`, `isSystemAudioEnabled`, `onSpeakerMutualExclusivity`, `children`; `faceToFace`, `monitorInScope`; `selectedMonitorDevice`, `isMonitorMuted`, `selectMonitorDevice`, `setMonitorMuted`, `filteredMonitorDevices`, `handleMonitorDeviceSelect`, `handleOutputVirtualDeviceClick`; the whole `{/* Speaker Section */}` block; `reasonIdFor`/`renderReason` lose their `channel` parameter (one id). `locked = isLocked ?? isSessionActive`. The microphone block renders unconditionally (no `showMicrophone &&`), without `{children}`. `WarningModal` stays (the virtual-mic and loopback warnings).

- [ ] **Step 4: Delete `OutputToggles` and `VoicePassthroughSection`**

In `SpeechSection.tsx` delete the `OutputToggles` function and the imports only it used (`presentProviders`, `useMode`, `useKeepReplayAudio`, `useSetKeepReplayAudio`, `useSetTextOnly`, `useTextOnly`, `effectiveTextOnly`, `ToggleSwitch` if nothing else uses it). `git rm src/components/Settings/sections/VoicePassthroughSection.tsx`; in `sections/index.ts` replace its export with `export { default as SpeechOutputSection } from './SpeechOutputSection';`. In `ProviderArea.tsx` drop `OutputToggles` from the import and the JSX, and the comment's "Text only and Keep audio".

- [ ] **Step 5: The hosts**

`AdvancedSettings.tsx`: import `SpeechOutputSection` instead of `VoicePassthroughSection`; drop `useFaceToFace`, `useTurnModeStore`, `lockMonitor`, `monitorLockedReason`; the audio tab renders
```tsx
            <AudioDeviceSection isSessionActive={locked} isLocked={lockMic} />
            <SpeechOutputSection isSessionActive={locked} />
            <SystemAudioSection isSessionActive={locked} isLocked={lockParticipant} />
```
`SimpleSettings.tsx`: the same three in the same order after `SessionSettingsGeneral`; drop `lockMonitor`/`monitorLockedReason`. Update the hosts' lock comments (the monitor mutex paragraph goes; the mode picker remains the master control).

`Settings.tsx` `NAVIGATION_TAB_MAP`: replace `'speaker': 'audio',` with `'speech': 'audio',`.

`Tour/steps.ts` line 39: `anchor: 'speech-section'`, `prepare: (_c, a) => a.openSettings('speech')`. Grep `tour.monitor` in `src/locales/en/translation.json`: if its copy says "speaker monitor" or "Output", reword to "I hear it too" in Task 5's pass.

`DeviceList.tsx`: the output branch of the aria-label uses `t('audioPanel.defaultPlayback', 'Default playback device')`.

- [ ] **Step 6: tsc and the tests**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -v "ModernAudioRecorder.ts(78"` → no output. Then `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/components/Settings src/components/Tour` → PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/components/Settings src/components/Tour
git commit -m "feat(settings): 麦克风 → 语音 → 对方音频; the Output block and the output toggles go

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Strings — 30 catalogs

**Files:**
- Modify: `src/locales/*/translation.json` (all 30)
- Test: `src/locales/locales.consistency.test.ts` (existing; must pass)

**Interfaces:** the keys Tasks 3–4 use. Added under `audioPanel`:

| Key | en | zh_CN |
|---|---|---|
| speechTitle | Speech | 语音 |
| speechTooltip | Which translations are spoken, to whom, and on which device. | 朗读哪些翻译、给谁听、用哪个设备。 |
| defaultPlayback | Default playback device | 默认播放设备 |
| defaultPlaybackTip | Sounds with no device of their own play here. | 未单独指定设备的声音，从这里播放。 |
| otherHears | Translation the other side hears | 对方听到的翻译 |
| otherHearsTip | What I say, translated and read aloud to the other side. Into the virtual microphone: the other side picks it as the microphone in their own app. | 我说的话翻译后朗读给对方。送进虚拟麦克风时，对方在自己的软件里把它选作麦克风就能听到。 |
| otherHearsAlwaysSpeaks | This service always speaks. | 此服务总是朗读。 |
| otherHearsNeverSpeaks | This service never speaks. | 此服务不朗读。 |
| meToo | I hear it too | 我也听 |
| meTooTip | Also plays the translation the other side hears on my side (the spoken translation, not my own voice). | 我这边也播放一遍对方听到的翻译（是译音，不是我的原声）。 |
| needsOtherHears | Nothing to hear while the translation is not spoken. | 翻译不朗读时没有可听的。 |
| passthroughTip | Mixes my own voice, at a lower level, under the translation into the virtual microphone. 60% at most. | 把我的原声以较低音量混在译音下面，一起送进虚拟麦克风。最大 60%。 |
| passthroughVolume | Volume {{percent}}% | 音量 {{percent}}% |
| iHear | Translation I hear | 我听到的翻译 |
| iHearTip | What the other side says, translated and read aloud to me. | 对方说的话翻译后朗读给我。 |
| iHearNotOffered | This service does not speak the other side's translation. | 此服务不朗读对方的翻译。 |
| keepReplay | Keep spoken translations for replay | 保留译音以便回放 |
| keepReplayTip | Keeps the spoken translations in memory so each message's ▶ works; a long session uses more memory. | 译音留在内存里，每条消息的 ▶ 才能用；长会话会多占内存。 |
| followDefault | Follow default | 跟随默认 |
| followDefaultNamed | Follow default ({{device}}) | 跟随默认（{{device}}） |
| channelLeft | left channel | 左声道 |
| channelRight | right channel | 右声道 |
| preview | Preview | 试听 |
| previewRow | Preview {{row}} | 试听{{row}} |
| blockedWholeSystem | All system sound is being captured: these playback options are off, so the translation is not translated again. | 正在录制整个系统的声音，为避免翻译音频循环，已禁用这些播放选项。 |
| virtualMicTabs | Virtual microphone · the meeting tab | 虚拟麦克风 · 会议标签页 |
| lockedByMode | Not in "{{mode}}" mode. | 「{{mode}}」模式下不可用。 |
| rowLockedByRun | Fixed for this session; stop it to change. | 本次会话已固定，停止后可改。 |

`audioPanel.realVoicePassthrough`'s en value becomes "Passthrough" (zh_CN stays 「原声直通」; other languages: their short noun for passthrough). Removed everywhere: `simpleConfig.output`, `simpleConfig.outputDesc`, `simpleConfig.textOnly`, `simpleConfig.textOnlyDesc`, `simpleConfig.textOnlyForcedByMode`, `simpleConfig.keepReplayAudio`, `simpleConfig.keepReplayAudioDesc`, `audioPanel.turnOnMonitor`, `audioPanel.turnOffMonitor`, `audioPanel.realVoicePassthroughDescription`, `audioPanel.monitorLockedByMode`. Before removing a key, `grep -rn "<key>" src --include='*.ts' --include='*.tsx'` must find no reader (the Tour, the wizard and the subtitle window read `simpleConfig.*` keys of their own — leave those).

- [ ] **Step 1: en and zh_CN by hand**

Edit `src/locales/en/translation.json` and `src/locales/zh_CN/translation.json`: add the keys above inside `"audioPanel"`, change `realVoicePassthrough`, delete the removed keys. Keep each file's key order (new keys after `passthroughManagedByPushToTranslate`).

- [ ] **Step 2: The other 28 catalogs**

For each of `ar bn de es fa fi fil fr he hi id it ja ko ms nl pl pt_BR pt_PT ru sv ta te th tr uk vi zh_TW`: add the same keys with a translation of the en text (zh_TW from zh_CN in traditional characters; ja: 音声 / 既定の再生デバイス / 相手に聞こえる翻訳 / 自分にも再生 / 原音ミックス stays as the catalog's existing 原音… term / 自分に聞こえる翻訳 / 再生用に音声を保持 …), keep every `{{placeholder}}` verbatim, delete the removed keys. A small Node script in the job scratch directory that reads a JSON map `{ lang: { key: text } }` and patches each catalog (as `apply-keys.mjs` did for #613's B14) is the way; commit only the catalogs.

- [ ] **Step 3: Verify**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/locales src/components/Settings`
Expected: PASS — lockstep keys, placeholders intact, no empty strings, no reader of a removed key (`grep -rn "simpleConfig.textOnly\|simpleConfig.output\b\|turnOnMonitor\|monitorLockedByMode\|realVoicePassthroughDescription" src --include='*.ts' --include='*.tsx'` prints nothing).

- [ ] **Step 4: Commit**

```bash
git add src/locales
git commit -m "i18n(settings): the 语音 block's rows and tooltips in 30 catalogs; the output toggles' keys go

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Render check against the boards

**Files:**
- Create (temporary, deleted at the end): `src/harness-audio.tsx`, `index-harness.html`, `vite.harness.config.ts` (copies of `/home/jiangzhuo/.claude/jobs/99b15063/tmp/p11/harness/` with a new entry)
- Output: screenshots under `/home/jiangzhuo/.claude/jobs/99b15063/tmp/slice2-render/`

The harness `HOWTO.txt` in `/home/jiangzhuo/.claude/jobs/99b15063/tmp/p11/` says how to serve and shoot; the board screenshots to compare with are `/home/jiangzhuo/.claude/jobs/99b15063/tmp/canvas-shots/v4/*.png` (boards 1–6).

- [ ] **Step 1: The entry**

Write `src/harness-audio.tsx` from `harness-f2f.tsx`'s preamble (the same store setup: Soniox, pair ja→en, devices "MacBook Pro Microphone" / "AirPods Pro" / "MacBook Pro Speakers", participant sources System + Zoom) that mounts, at `?w=450|300`, `?layout=advanced|simple`, `?state=me|both-system|both-app|f2f`: Advanced's audio tab (`AudioDeviceSection` + `SpeechOutputSection` + `SystemAudioSection` inside `<div className="settings-section audio-section">`) or `SimpleSettings`' three blocks, after setting `mode`/`otherSide`/`selectedParticipantSource`/`textOnly`/`isMonitorMuted` per state as boards 1–6 show them (board 3: 我也听 off, 我听到的翻译 on, 保留回放 on). It appends `<pre id="M">` with `document.body.scrollWidth`/`clientWidth` after 1.5 s, as the f2f harness does.

- [ ] **Step 2: Shoot**

Serve with `bash /home/jiangzhuo/.claude/jobs/99b15063/tmp/p11/harness/run.sh <this worktree> 5284` (after copying `harness-audio.tsx` beside `harness-f2f.tsx` and pointing `index-harness.html` at it), start the headless Chromium with CDP as HOWTO step 2, and screenshot the eight combinations (four states × 450 Advanced, f2f at 300, me/f2f Simple) with a small CDP script modelled on `drive.mjs` (one `Page.captureScreenshot` per URL at device scale 2), into `/home/jiangzhuo/.claude/jobs/99b15063/tmp/slice2-render/`.

- [ ] **Step 3: Look, then fix what differs**

Open each shot beside its board (`v4/Main.png` ↔ me/450, `B-both-meeting-system` ↔ both-system, `C-both-meeting-app` ↔ both-app, `D-face-to-face` ↔ f2f/450, `E-face-to-face-300` ↔ f2f/300, `F-simple` ↔ Simple f2f). What must match: the row order and names, the switch at the right edge, line 2 aligned to the label text, the sub-rows' indent and connector, the one-line virtual-microphone field, the merged reason line on both-system, no caption text under any row, and no horizontal overflow at 300 (`scrollWidth <= clientWidth`). Spacing within a few px is fine. Fix the SCSS or the section for anything else, re-shoot, and record each fix in the ledger.

- [ ] **Step 4: Clean up**

HOWTO step 4: kill the vite and chromium processes by PID, `bash …/run.sh clean <worktree>`, delete `src/harness-audio.tsx`, and confirm `git status --short` lists no harness file.

- [ ] **Step 5: Commit the fixes (if any)**

```bash
git add src/components/Settings
git commit -m "fix(settings): the 语音 block against the boards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The whole suite, the builds, CLAUDE.md

- [ ] **Step 1: Run everything**

`/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run > /tmp/slice2-suite.log 2>&1; tail -6 /tmp/slice2-suite.log` → no failures. `npm run build 2>&1 | tail -3`, `npm run extension:build 2>&1 | tail -3` → both succeed (the extension's `node_modules` symlink trick from slice 1's Task 10 if needed).

- [ ] **Step 2: CLAUDE.md**

"UI Components → Simple Mode Components → SimpleSettings": replace "the microphone and speaker, system audio (…)" with "the microphone, the 语音 block (`SpeechOutputSection`: who hears what, each row with its own output device and channel; `textOnly` shows inverted as 对方听到的翻译, the monitor as 我也听, the participant-speech switch as 我听到的翻译), the other side's audio (…)". In "Audio Handling", the passthrough bullet: "…its switch and slider are the 原声直通 sub-row of 对方听到的翻译 in the 语音 block (hidden in face-to-face)". Remove the sentence about Text Only wherever CLAUDE.md states it as a switch (grep "Text Only" / "textOnly").

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: the 语音 block in CLAUDE.md

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
