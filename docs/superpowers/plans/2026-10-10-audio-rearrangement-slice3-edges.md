# Audio Settings Rearrangement — Slice 3: The Edges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything around the page follows the outlets: the mode picker's popover rows, the conversation's ear tags and the ears strip, the setup wizard's presets, the session-start telemetry; the ears block, the hidden participant-speech switch and their strings are gone.

**Architecture:** `ModeDevicePopover` gains outlet rows whose device list is the page's device·channel entries; `useFaceToFace` derives each leg's ear and device from the outlets so the tags and the strip need no `swap`; `EarsBlock` is deleted; the wizard writes `participantSpeech`; `sessionStartProperties` reports `participant_speech` and the resolved channels; the orphaned switch, constant and keys are removed.

**Tech Stack:** React, Zustand, Vitest + Testing Library, i18next catalogs.

**Spec:** `docs/superpowers/specs/2026-10-10-audio-settings-rearrangement-design.md` — §4 (wizard presets), §5 (conversation surfaces), §6.3 (popover), §6.4 (telemetry), §6.5 (strings), §9 slice 3.

**Depends on:** slices 1 and 2 on this branch (`outlets.ts`, `outletOptions.ts`, `SpeechOutputSection`, `speechFromStores`, `earPreview(outlet)`, the `audioPanel.*` strings).

## Global Constraints

- Popover rows per mode (§6.3, ruling 3): 我 = 麦克风 · 我也听; 对方 = 对方音频 · 我听到的翻译; 两者·在线会议 = 麦克风 · 对方在哪里 · 对方音频; 两者·就在身边 = 麦克风 · 对方在哪里 · 对方听到的翻译 (▶ 试听) · 我听到的翻译 (▶ 试听). No ears block, no swap, anywhere.
- A pick in an outlet row writes the outlet and never flips the switch (§6.3); the microphone row keeps "a pick unmutes".
- Ear tags: the letter is the outlet's channel; a centred outlet gives no tag (§5). The "not played" mark is unchanged.
- Wizard presets (§4): `two-way-voice`, `face-to-face-voice` → `participantSpeech: true`; `two-way-text`, `face-to-face-text` → `false`; the other three leave it untouched.
- Telemetry (§6.4): `monitor_device_on` keeps its name; `participant_speech` and `outlet_channels` are added.
- Strings removed in this slice (every catalog): `audioPanel.participantSpeech`, `audioPanel.participantSpeechNotYetAvailable`, `audioPanel.participantSpeechDesc`, `audioPanel.participantSpeechBlockedWholeSystem`, `faceToFace.earsTitle`, `faceToFace.previewLeft`, `faceToFace.previewRight`, `faceToFace.swap`, `faceToFace.meListens`, `faceToFace.otherListens`, `modePicker.deviceSpeakerMonitor`, `popover.output`. Reworded: `settings.participantSectionDescriptionExtension` and `popover.participantSubtitleExtension` (both say "system default"; the tab plays on the default playback device the user chose).
- Comments in English; conventional commits; every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Binaries: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run <path>`, `…/node_modules/.bin/tsc --noEmit -p tsconfig.json`.

## Review Focus

1. Both outlets centred in face-to-face (the user picked `A` for both rows, no channel): the ears strip must still show both people with their devices and no L/R letters, and the conversation must draw no ear tags — Task 2's "centred outlets: a strip without letters, no tags".
2. The popover's 我听到的翻译 row on Electron with the whole-system source: its power button must be disabled with the blocked reason, not silently ignore the click — Task 1's "blocked: the power button is disabled with the reason".
3. A wizard re-run from a voice scenario to `understand-others`: `participantSpeech` must stay as it was (the preset is silent on it), while `two-way-text` must write `false` — Task 3's two cases.
4. The popover's outlet row when the stored device is unplugged: the summary must read the resolved (default) device, not "Not selected" — Task 1's "an absent device shows the default".
5. Telemetry when no provider entry has loaded yet (a start pressed early): `appStartInputs` must not throw (`speechFromStores` answers as optional) — Task 4's "answers with no provider loaded".
6. An application capture that widens to the whole system mid-run (its monitor never appears, or the helper dies): 我听到的翻译 must fall silent live, not play into the capture and be translated again — Task 6's "off, live, while the capture has widened" (slice 1's final review, Important 2).

---

### Task 1: The popover's rows

**Files:**
- Modify: `src/components/MainPanel/ModeDevicePopover.tsx`, `src/components/MainPanel/ModeDevicePopover.scss`
- Test: `src/components/MainPanel/ModeDevicePopover.test.tsx`

**Interfaces:**
- Consumes: `useOutlets`, `useSetOutletDevice`, `useSetOutletChannel` (slice 1); `outletEntries`, `entryValue`, `parseEntryValue`, `outletSelectValue` (slice 2); `useRoutingStore.participantSpeech/setParticipantSpeech`; `participantSpeechHeard`; `getAppAudio().earPreview(outlet)`; `useFaceToFace().speaks`.
- Produces: `ChannelKey = 'mic' | 'participant' | 'me' | 'other' | 'them'`; `ChannelRowSpec` gains `onPreview?: () => void` (a ▶ in the switch's column) and `disabledReason?: string` (the power button disabled, with a title). `EarsBlock` and `popover.output` leave the popover.

- [ ] **Step 1: Rewrite the Both / beside tests and add the Me / Other rows**

In `ModeDevicePopover.test.tsx`:

(a) The audio-store mock gains:
```ts
  useOutlets: () => outletsState.outlets,
  useSetOutletDevice: () => outletsState.setDevice,
  useSetOutletChannel: () => outletsState.setChannel,
  useSelectedMonitorDevice: () => store.monitor,
```
with, near `store`:
```ts
const outletsState = {
  outlets: { other: { device: null, channel: 'auto' }, me: { device: null, channel: 'auto' }, them: { device: null, channel: 'auto' } } as Record<'other' | 'me' | 'them', { device: string | null; channel: 'auto' | 'both' | 'left' | 'right' }>,
  setDevice: vi.fn(), setChannel: vi.fn(),
};
```
`store` gains `monitor: { deviceId: 'out-1', label: 'AirPods Pro' } as { deviceId: string; label: string } | null` and the `useAudioContext` mock's `audioMonitorDevices` returns `[{ deviceId: 'out-1', label: 'AirPods Pro' }, { deviceId: 'out-2', label: 'MacBook Pro Speakers' }]`, `selectedMonitorDevice: store.monitor`. The routing-store mock becomes:
```ts
const routing = { participantSpeech: null as boolean | null, setParticipantSpeech: vi.fn() };
vi.mock('../../stores/routingStore', () => ({ useRoutingStore: (pick: (s: unknown) => unknown) => pick({ participantSpeech: routing.participantSpeech, setParticipantSpeech: routing.setParticipantSpeech }) }));
```
`tone` becomes `vi.fn(async (_outlet: string) => {})`. The `f2f` fixture: `{ offered: true, active: false, me: 'ja', other: 'en', speaks: { speaker: true, participant: true }, ears: {}, outletDevices: { other: 'AirPods Pro', them: 'AirPods Pro' } }` (the shape Task 2 gives the hook; until Task 2 lands the extra fields are harmless). `beforeEach` resets `routing` and `outletsState` too.

(b) Replace the describe `'ModeDevicePopover — Both, the other side'`'s row-order and ears cases with:
```tsx
  const order = () => Array.from(document.querySelectorAll('.mode-device-popover__row .mode-device-popover__row-label, [role="radiogroup"]'))
    .map((el) => (el.getAttribute('role') === 'radiogroup' ? 'choice' : el.textContent));

  it('in a meeting: the microphone, the choice, then the system-audio row', () => {
    mountBoth();
    expect(order()).toEqual(['Microphone', 'choice', "Other's audio"]);
  });

  it('beside me: the microphone, the choice, then the two translation rows with previews, and no ears block or swap', async () => {
    f2f.active = true;
    store.otherSide = 'beside';
    mountBoth();
    expect(order()).toEqual(['Microphone', 'choice', 'Translation the other side hears', 'Translation I hear']);
    expect(document.querySelector('.mode-device-popover__ears')).toBeNull();
    expect(screen.queryByRole('button', { name: /Swap/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview Translation the other side hears' }));
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith('other'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview Translation I hear' }));
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith('them'));
  });

  it('beside me: the translation rows list follow-default and each device three ways, summarise the resolved entry, and a pick writes the outlet without touching a switch', () => {
    f2f.active = true;
    store.otherSide = 'beside';
    mountBoth();
    const rows = Array.from(document.querySelectorAll('.mode-device-popover__row'));
    const them = rows.find((r) => r.textContent?.includes('Translation I hear'))!;
    expect(them.querySelector('.mode-device-popover__summary')?.textContent).toBe('Follow default · left channel');
    fireEvent.click(them.querySelector('.mode-device-popover__row-main')!);
    const options = Array.from(document.querySelectorAll('.mode-device-popover__device-row')).map((el) => el.textContent);
    expect(options).toEqual([
      'Follow default (AirPods Pro)', 'Follow default · left channel', 'Follow default · right channel',
      'AirPods Pro', 'AirPods Pro · left channel', 'AirPods Pro · right channel',
      'MacBook Pro Speakers', 'MacBook Pro Speakers · left channel', 'MacBook Pro Speakers · right channel',
    ]);
    fireEvent.click(screen.getByText('MacBook Pro Speakers · right channel'));
    expect(outletsState.setDevice).toHaveBeenCalledWith('them', 'out-2');
    expect(outletsState.setChannel).toHaveBeenCalledWith('them', 'right');
    expect(routing.setParticipantSpeech).not.toHaveBeenCalled();
  });

  it('an absent device shows the default in the summary (Review Focus 4)', () => {
    f2f.active = true;
    store.otherSide = 'beside';
    outletsState.outlets = { ...outletsState.outlets, other: { device: 'usb-gone', channel: 'right' } };
    mountBoth();
    const other = Array.from(document.querySelectorAll('.mode-device-popover__row')).find((r) => r.textContent?.includes('Translation the other side hears'))!;
    expect(other.querySelector('.mode-device-popover__summary')?.textContent).toBe('Follow default · right channel');
  });

  it("records a preview that did not play, as the panel's test tone does", async () => {
    f2f.active = true;
    store.otherSide = 'beside';
    tone.mockRejectedValue(new Error('no output device'));
    mountBoth();
    fireEvent.click(screen.getByRole('button', { name: 'Preview Translation I hear' }));
    await vi.waitFor(() => expect(report.error).toHaveBeenCalledTimes(1));
    expect(report.error.mock.calls[0][0]).toBe('ModeDevicePopover');
  });
```
Delete `'keeps the swap live during a run…'`, `'beside me: the headphones row has no switch…'`, `'beside me: no system-audio row, a headphones row…'`, `'the right ear previews panned right'`, `'swapped: …'`, `'a silent participant leg: …'`, `'Text Only: no ears block…'`.

(c) Add a describe for the Me and Other rows:
```tsx
describe('ModeDevicePopover — the speech rows in Me and Other', () => {
  const mount = (mode: 'speaker' | 'participant') => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    return render(<ModeDevicePopover mode={mode} open={true} anchorEl={anchor} onClose={vi.fn()} locked={false} />);
  };

  it('Me: the microphone, then 我也听 with the monitor switch and its device', () => {
    mount('speaker');
    const labels = Array.from(document.querySelectorAll('.mode-device-popover__row-label')).map((el) => el.textContent);
    expect(labels).toEqual(['Microphone', 'I hear it too']);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off I hear it too' }));
    expect(monitor.setMuted).toHaveBeenCalledWith(true);
  });

  it("Other: the system-audio row, then 我听到的翻译 whose switch writes participantSpeech", () => {
    store.selected = CHROMIUM;
    mount('participant');
    const labels = Array.from(document.querySelectorAll('.mode-device-popover__row-label')).map((el) => el.textContent);
    expect(labels).toEqual(["Other's audio", 'Translation I hear']);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Translation I hear' }));
    expect(routing.setParticipantSpeech).toHaveBeenCalledWith(true);
  });

  it('blocked: on a whole-system source the power button is disabled with the reason (Review Focus 2)', () => {
    store.selected = SYSTEM;
    mount('participant');
    const button = screen.getByRole('button', { name: 'Turn on Translation I hear' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(/All system sound is being captured/);
  });
});
```
(`monitor` is new: `const monitor = { setMuted: vi.fn() };` beside `store`, and the audio-store mock's `useSetMonitorMuted: () => monitor.setMuted` in place of the fresh `vi.fn()` it returns today, cleared in `beforeEach`. The `isElectron` mock already returns true outside the extension, and `getEnvironment` must be added to the environment mock: `getEnvironment: () => (env.extension ? 'extension' : 'electron')`.)

- [ ] **Step 2: Run to verify failure**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/components/MainPanel/ModeDevicePopover.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Change the popover**

Imports: drop `EarsBlock`; add `Play` to the lucide import; add
```ts
import { getAppAudio } from '../../lib/audio/appAudio';
import { entryValue, outletEntries, outletSelectValue, parseEntryValue } from '../../lib/audio/outletOptions';
import type { OutletName } from '../../lib/audio/outlets';
import { describeCause, reportError } from '../../lib/diagnostics/report';
import { participantSpeechHeard } from '../../lib/modern-audio/participantSource';
import { useRoutingStore } from '../../stores/routingStore';
import { getEnvironment } from '../../utils/environment';
```
and `useOutlets, useSetOutletDevice, useSetOutletChannel, useSelectedMonitorDevice` from the audio store.

`type ChannelKey = 'mic' | 'participant' | 'me' | 'other' | 'them';` `ChannelRowSpec` gains:
```ts
  /** A ▶ in the switch's column: plays the chime on this row's outlet (face-to-face). */
  onPreview?: () => void;
  /** The power button is disabled, and this is why (its title). */
  disabledReason?: string;
```
In the component, after the existing store hooks:
```ts
  const outlets = useOutlets();
  const setOutletDevice = useSetOutletDevice();
  const setOutletChannel = useSetOutletChannel();
  const defaultDevice = useSelectedMonitorDevice();
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const setParticipantSpeech = useRoutingStore((s) => s.setParticipantSpeech);
  const heard = participantSpeechHeard(getEnvironment(), selectedParticipantSource?.deviceId, beside);
  const blockedReason = t('audioPanel.blockedWholeSystem', 'All system sound is being captured: these playback options are off, so the translation is not translated again.');
  const channelName = (c: 'left' | 'right') => (c === 'left' ? t('audioPanel.channelLeft', 'left channel') : t('audioPanel.channelRight', 'right channel'));
  const previewOn = (outlet: OutletName) => {
    void getAppAudio()
      .then((app) => app.earPreview(outlet))
      .catch((error: unknown) => reportError('ModeDevicePopover', `The preview did not play: ${describeCause(error)}`, { cause: error }));
  };
  /** An outlet row's list: the page's device·channel entries as pseudo-devices, the selected one by its value. */
  const outletRow = (name: OutletName, key: ChannelKey, label: string, rest: Partial<ChannelRowSpec>): ChannelRowSpec => {
    const entries = outletEntries(filteredMonitorDevices).map((entry) => {
      const base = entry.device === null
        ? (entry.channel === 'auto' && defaultDevice ? t('audioPanel.followDefaultNamed', { device: defaultDevice.label, defaultValue: 'Follow default ({{device}})' }) : t('audioPanel.followDefault', 'Follow default'))
        : entry.label!;
      const text = entry.channel === 'left' || entry.channel === 'right' ? `${base} · ${channelName(entry.channel)}` : base;
      return { deviceId: entryValue(entry), label: text };
    });
    const value = outletSelectValue(name, outlets[name], beside);
    return {
      key, icon: Volume2, label,
      devices: entries,
      selectedDevice: entries.find((d) => d.deviceId === value) ?? null,
      isMuted: false,
      onSelectDevice: (d) => {
        const { device, channel } = parseEntryValue(d.deviceId);
        setOutletDevice(name, device);
        setOutletChannel(name, channel);
      },
      isMissing: false,
      ...rest,
    };
  };
```
(`filteredMonitorDevices` moves above `rows`, out of the memo, so `outletRow` can read it; keep the memo's dependency list honest: add `outlets`, `defaultDevice`, `participantSpeech`, `heard`, `beside`.)

The row list (replace the `showMonitor` block and the end of `showParticipant`):
```ts
    if (mode === 'speaker') {
      list.push(outletRow('me', 'me', t('audioPanel.meToo', 'I hear it too'), {
        isMuted: isMonitorMuted,
        onMuteToggle: () => setMonitorMuted(!isMonitorMuted),
      }));
    }
    if (showParticipant) { …the existing participant row… }
    if (mode === 'participant') {
      const on = participantSpeech ?? false;
      list.push(outletRow('them', 'them', t('audioPanel.iHear', 'Translation I hear'), {
        isMuted: !on || !heard,
        onMuteToggle: () => setParticipantSpeech(!on),
        ...(heard ? {} : { disabledReason: blockedReason }),
      }));
    }
    if (beside) {
      list.push(outletRow('other', 'other', t('audioPanel.otherHears', 'Translation the other side hears'), { onPreview: () => previewOn('other') }));
      list.push(outletRow('them', 'them', t('audioPanel.iHear', 'Translation I hear'), { onPreview: () => previewOn('them') }));
    }
```
(`showMonitor` and its comment go; `showMic` and `showParticipant` stay as they are: `showParticipant = mode === 'participant' || (mode === 'both' && !beside)`.)

In the JSX: the power button gets `disabled={!!row.disabledReason}` and `title={row.disabledReason ?? (row.isMuted ? … : …)}`; after the `row.onMuteToggle && (…)` block add
```tsx
                {row.onPreview && (
                  <button
                    type="button"
                    className="mode-device-popover__mute-btn mode-device-popover__preview-btn"
                    onClick={(e) => { e.stopPropagation(); row.onPreview?.(); }}
                    aria-label={t('audioPanel.previewRow', { row: row.label, defaultValue: 'Preview {{row}}' })}
                    title={t('audioPanel.preview', 'Preview')}
                  >
                    <Play size={14} />
                  </button>
                )}
                {!row.onMuteToggle && !row.onPreview && <span className="mode-device-popover__mute-slot" aria-hidden="true" />}
```
Delete `{mode === 'both' && <EarsBlock className="mode-device-popover__ears" />}`. In the SCSS, delete `&__ears` and add `&__preview-btn { color: #ddd; }`.

- [ ] **Step 4: Run the tests**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/components/MainPanel/ModeDevicePopover.test.tsx src/components/MainPanel/MainPanel.test.tsx`
Expected: PASS (MainPanel's popover cases read the choice and the flag only).

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/ModeDevicePopover.tsx src/components/MainPanel/ModeDevicePopover.scss src/components/MainPanel/ModeDevicePopover.test.tsx
git commit -m "feat(popover): the speech rows per mode, with the outlet's device and channel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Ear tags and the ears strip from the outlets; `EarsBlock` deleted

**Files:**
- Modify: `src/components/MainPanel/useFaceToFace.ts`, `src/components/MainPanel/panel/PanelFooter.tsx`, `src/components/MainPanel/MainPanel.tsx` (only if a type moves), `src/components/MainPanel/panel/PanelFooter.scss` (the device per entry)
- Delete: `src/components/FaceToFace/EarsBlock.tsx`, `EarsBlock.scss`, `EarsBlock.test.tsx`
- Test: `src/components/MainPanel/useFaceToFace.test.ts`, `src/components/MainPanel/panel/PanelFooter.test.tsx`, `src/components/Conversation/ConversationList.test.tsx` (fixture only), `src/components/MainPanel/MainPanel.test.tsx` (mock shape only)

**Interfaces:**
- Produces:
  ```ts
  export interface FaceToFaceView {
    offered: boolean; active: boolean;
    me: string | null; other: string | null;
    speaks: Readonly<Record<LegName, boolean>>;
    /** The ear each leg's translation plays in; absent when its outlet is centred. speaker → `other`, participant → `them`. */
    ears: Readonly<Partial<Record<LegName, Ear>>>;
    /** The resolved device label of each face-to-face outlet; null when none is known. */
    outletDevices: Readonly<Record<'other' | 'them', string | null>>;
  }
  export interface EarsLegendEntry { who: 'me' | 'other'; lang: string; ear?: Ear; device: string | null }
  export function earsLegend(view: FaceToFaceView): EarsLegendEntry[] | null;   // null outside face-to-face or when nothing is voiced; left-ear entry first
  export function voicedEars(view: FaceToFaceView): Partial<Record<LegName, Ear>> | null;   // voiced legs with an ear; null when none
  ```
  `swap` is gone. `PanelFooterProps.ears?: EarsLegendEntry[] | null`.

- [ ] **Step 1: Update the tests**

`useFaceToFace.test.ts`: the hook's first case expects `{ offered: true, active: true, me: 'ja', other: 'en', speaks: { speaker: true, participant: true }, ears: { speaker: 'right', participant: 'left' }, outletDevices: { other: 'AirPods Pro', them: 'AirPods Pro' } }` after `useAudioStore.setState({ audioMonitorDevices: [{ deviceId: 'out-1', label: 'AirPods Pro' }], selectedMonitorDevice: { deviceId: 'out-1', label: 'AirPods Pro' } })` in `beforeEach`. Replace `'reads the ears from the outlets…'` with:
```ts
  it('reads the ears and the devices from the outlets, live', () => {
    pick('soniox');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current.ears).toEqual({ speaker: 'right', participant: 'left' });
    act(() => { useAudioStore.getState().setOutletChannel('them', 'both'); useAudioStore.getState().setOutletDevice('other', 'out-1'); });
    expect(result.current.ears).toEqual({ speaker: 'right' });
    expect(result.current.outletDevices).toEqual({ other: 'AirPods Pro', them: 'AirPods Pro' });
  });
```
`earsLegend`/`voicedEars` describes: the `view` fixture becomes `{ offered: true, active: true, me: 'ja', other: 'en', speaks: { speaker: true, participant: true }, ears: { speaker: 'right', participant: 'left' }, outletDevices: { other: 'AirPods Pro', them: 'AirPods Pro' } }` and the cases:
```ts
describe('earsLegend', () => {
  it('one entry per voiced leg, the left ear first, each with its device', () => {
    expect(earsLegend(view)).toEqual([
      { who: 'me', lang: 'ja', ear: 'left', device: 'AirPods Pro' },
      { who: 'other', lang: 'en', ear: 'right', device: 'AirPods Pro' },
    ]);
    expect(earsLegend({ ...view, ears: { speaker: 'left', participant: 'right' } })![0]).toMatchObject({ who: 'other', ear: 'left' });
  });
  it('centred outlets: entries without ears, me first (Review Focus 1)', () => {
    expect(earsLegend({ ...view, ears: {} })).toEqual([
      { who: 'me', lang: 'ja', device: 'AirPods Pro' },
      { who: 'other', lang: 'en', device: 'AirPods Pro' },
    ]);
  });
  it('leaves out a silent leg, and is absent when nothing is voiced or outside face-to-face', () => {
    expect(earsLegend({ ...view, speaks: { speaker: true, participant: false } })).toEqual([{ who: 'other', lang: 'en', ear: 'right', device: 'AirPods Pro' }]);
    expect(earsLegend({ ...view, speaks: { speaker: false, participant: false } })).toBeNull();
    expect(earsLegend({ ...view, active: false })).toBeNull();
  });
});

describe('voicedEars', () => {
  it('gives each voiced leg its ear, and none to a centred outlet (Review Focus 1)', () => {
    expect(voicedEars(view)).toEqual({ speaker: 'right', participant: 'left' });
    expect(voicedEars({ ...view, ears: { participant: 'left' } })).toEqual({ participant: 'left' });
    expect(voicedEars({ ...view, speaks: { speaker: true, participant: false } })).toEqual({ speaker: 'right' });
  });
  it('is absent outside face-to-face, and when no leg is voiced', () => {
    expect(voicedEars({ ...view, active: false })).toBeNull();
    expect(voicedEars({ ...view, speaks: { speaker: false, participant: false } })).toBeNull();
  });
});
```
`PanelFooter.test.tsx` `'PanelFooter — the ears legend'`: every `ears: { leftLang: 'ja', rightLang: 'en', leftIsMe: true }` becomes `ears: [{ who: 'me', lang: 'ja', ear: 'left', device: 'AirPods Pro' }, { who: 'other', lang: 'en', ear: 'right', device: 'AirPods Pro' }]`; the `silent: 'left'` case becomes a one-entry array `[{ who: 'other', lang: 'en', ear: 'right', device: 'AirPods Pro' }]`; the "names the headphones in use" case asserts each entry's `.ears-legend__device` text ('AirPods Pro') and, with `device: null`, none. Add: a centred-entry case (`ear` absent) renders no `b` letter and no ear name.

`MainPanel.test.tsx` and `ConversationList.test.tsx`: any mocked `useFaceToFace` view drops `swap` and gains `ears`/`outletDevices`; `earsLegend`'s mocked return, where mocked, becomes the array shape.

- [ ] **Step 2: Run to verify failure**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/components/MainPanel src/components/Conversation`
Expected: FAIL.

- [ ] **Step 3: `useFaceToFace.ts`**

Replace the `ears`/`swap` computation and the two helpers:
```ts
  const outlets = useAudioStore((s) => s.outlets);
  const devices = useAudioStore((s) => s.audioMonitorDevices);
  const defaultDevice = useAudioStore((s) => s.selectedMonitorDevice);
  …
  const earOf = (name: 'other' | 'them'): Ear | undefined => {
    const channel = resolveChannel(name, outlets[name].channel, active);
    return channel === 'both' ? undefined : channel;
  };
  const ears: Partial<Record<LegName, Ear>> = {
    ...(earOf('other') ? { speaker: earOf('other') } : {}),
    ...(earOf('them') ? { participant: earOf('them') } : {}),
  };
  const labelOf = (name: 'other' | 'them'): string | null => {
    const own = outlets[name].device ? devices.find((d) => d.deviceId === outlets[name].device) : undefined;
    return own?.label ?? defaultDevice?.label ?? null;
  };
  const speak = speechFromStores(provider);
  return {
    offered, active,
    me: pair?.source ?? null, other: pair?.target ?? null,
    speaks: { speaker: speak.other, participant: speak.them },
    ears,
    outletDevices: { other: labelOf('other'), them: labelOf('them') },
  };
```
```ts
export interface EarsLegendEntry { who: 'me' | 'other'; lang: string; ear?: Ear; device: string | null }

/** The footer's ears strip: one entry per voiced leg — who, their language, the ear when the outlet has one, the device. The left ear first; otherwise me first. */
export function earsLegend(view: FaceToFaceView): EarsLegendEntry[] | null {
  if (!view.active || !view.me || !view.other) return null;
  const entries: EarsLegendEntry[] = [];
  // My ear is where the participant leg's translation (into my language) plays; theirs, the speaker leg's.
  if (view.speaks.participant) entries.push({ who: 'me', lang: view.me, ...(view.ears.participant ? { ear: view.ears.participant } : {}), device: view.outletDevices.them });
  if (view.speaks.speaker) entries.push({ who: 'other', lang: view.other, ...(view.ears.speaker ? { ear: view.ears.speaker } : {}), device: view.outletDevices.other });
  if (entries.length === 0) return null;
  const rank = (e: EarsLegendEntry) => (e.ear === 'left' ? 0 : e.ear === 'right' ? 2 : 1);
  return entries.sort((a, b) => rank(a) - rank(b));
}

/** The conversation's ear tags: the ear each voiced leg's translation plays in; a centred outlet or a silent leg has none. */
export function voicedEars(view: FaceToFaceView): Partial<Record<LegName, Ear>> | null {
  if (!view.active || (!view.speaks.speaker && !view.speaks.participant)) return null;
  return {
    ...(view.speaks.speaker && view.ears.speaker ? { speaker: view.ears.speaker } : {}),
    ...(view.speaks.participant && view.ears.participant ? { participant: view.ears.participant } : {}),
  };
}
```
(`Ear` stays exported from this file.)

- [ ] **Step 4: `PanelFooter.tsx`**

`ears?: EarsLegendEntry[] | null;` (import the type). `EarsLegend` renders:
```tsx
function EarsLegend({ ears }: { ears: EarsLegendEntry[] }) {
  const { t } = useTranslation();
  const label = useLanguageLabel();
  return (
    <div className="ears-legend">
      <Headphones size={14} aria-hidden="true" />
      {ears.map((entry) => (
        <span key={entry.who} className={`ears-legend__ear ears-legend__ear--${entry.who}`}>
          {entry.ear && <b aria-hidden="true">{entry.ear === 'left' ? t('faceToFace.earLeft', 'L') : t('faceToFace.earRight', 'R')}</b>}
          {entry.ear && <span className="ears-legend__ear-name">{entry.ear === 'left' ? t('faceToFace.leftEar', 'Left ear') : t('faceToFace.rightEar', 'Right ear')}</span>}
          <span className="ears-legend__ear-words">
            {entry.who === 'me'
              ? t('faceToFace.legendMe', '{{language}} · me', { language: label(entry.lang) })
              : t('faceToFace.legendOther', '{{language}} · other person', { language: label(entry.lang) })}
          </span>
          {entry.device && <span className="ears-legend__device">{entry.device}</span>}
        </span>
      ))}
    </div>
  );
}
```
Drop `useSelectedMonitorDevice` from the footer's imports. In `PanelFooter.scss` the `.ears-legend__device` rule stays (it now sits inside each entry; add `margin-left: 4px` if it touches the words).

- [ ] **Step 5: Delete `EarsBlock`**

`git rm src/components/FaceToFace/EarsBlock.tsx src/components/FaceToFace/EarsBlock.scss src/components/FaceToFace/EarsBlock.test.tsx`. `grep -rn "EarsBlock" src` must print nothing.

- [ ] **Step 6: tsc and the tests**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -v "ModernAudioRecorder.ts(78"` → nothing; `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/components/MainPanel src/components/Conversation src/components/FaceToFace` → PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/components/MainPanel src/components/Conversation src/components/FaceToFace
git commit -m "feat(face-to-face): ear tags and the ears strip read the outlets; the ears block goes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The setup wizard writes 我听到的翻译

**Files:**
- Modify: `src/lib/setup/scenarios.ts`, `src/components/SetupWizard/applySetup.ts`, `src/components/SetupWizard/useApplySetup.ts`, `src/components/SetupWizard/steps/StepLanguagePair.tsx`, `src/lib/session/appShape.ts` (export `heardFromStores`)
- Test: `src/lib/setup/scenarios.test.ts`, `src/components/SetupWizard/applySetup.test.ts`, `src/components/SetupWizard/useApplySetup.test.ts`, `src/components/SetupWizard/steps/StepLanguagePair.test.tsx`

**Interfaces:**
- `ScenarioPreset.participantSpeech?: boolean` — present on the four Both scenarios.
- `ApplySetupDeps.setParticipantSpeech: (on: boolean | null) => void`; `applySetupDraft` calls it only when the preset carries the field, after `setTextOnly`.
- `heardFromStores(faceToFace: boolean): boolean` becomes an export of `appShape.ts` (unchanged body; Task 6 extends it).
- The language step's offer: a preset that carries `participantSpeech` answers for the participant leg through `participantSpeechInput` (`shape.ts`) with that value, face-to-face when `otherSide === 'beside'`, and `heardFromStores(beside)`; a preset silent on it keeps `speechInputsFromStores().participantSpeech`.

- [ ] **Step 1: Tests**

`scenarios.test.ts`, the pins: `two-way-voice` → `{ id: 'two-way-voice', mode: 'both', textOnly: false, participantSpeech: true }`, `two-way-text` → `…textOnly: true, participantSpeech: false`; the three others unchanged. In the face-to-face describe: `expect(getScenario('face-to-face-voice')).toMatchObject({ participantSpeech: true }); expect(getScenario('face-to-face-text')).toMatchObject({ participantSpeech: false });`.

`applySetup.test.ts`: `deps()` gains `setParticipantSpeech: vi.fn()`. Add:
```ts
  it('writes 我听到的翻译 for the Both scenarios only: on for voice, off for text, untouched elsewhere (Review Focus 3)', async () => {
    const voice = deps();
    await applySetupDraft(draft({ scenario: 'two-way-voice' }), voice);
    expect(voice.setParticipantSpeech).toHaveBeenCalledWith(true);
    const text = deps();
    await applySetupDraft(draft({ scenario: 'face-to-face-text' }), text);
    expect(text.setParticipantSpeech).toHaveBeenCalledWith(false);
    const listen = deps();
    await applySetupDraft(draft({ scenario: 'understand-others', providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, credentials: {} }), listen);
    expect(listen.setParticipantSpeech).not.toHaveBeenCalled();
  });
```
`useApplySetup.test.ts`: where it asserts the deps bound to the stores, add that `setParticipantSpeech` is `useRoutingStore.getState().setParticipantSpeech` (follow the file's existing pattern for `setTextOnly`).

`StepLanguagePair.test.tsx` mocks `appShape` (`speechInputsFromStores: () => ({ textOnly: false, participantSpeech: participant.speech })`); extend that mock with `heardFromStores: () => true` and add, beside the test that reads the participant's speech from the stores:
```tsx
  it("takes the participant's speech from the scenario when its preset carries it: two-way-text offers as silent, two-way-voice as speaking, understand-others as the stores say", () => {
    participant.speech = true;
    const contexts: Array<{ participantSpeech: boolean }> = [];
    languageContextMock.mockImplementation((_p, _legs, ctx) => { contexts.push(ctx); return original(_p, _legs, ctx); });
    renderStep({ scenario: 'two-way-text' });
    renderStep({ scenario: 'two-way-voice' });
    renderStep({ scenario: 'understand-others' });
    expect(contexts.map((c) => c.participantSpeech)).toEqual([false, true, true]);
  });
```
where `languageContextMock` / `original` / `renderStep` are whatever the file already uses to spy on `languageContext` and render the step with a draft — if it spies on nothing, add `vi.mock('../../../lib/session/shape', async (importOriginal) => { const actual = await importOriginal<typeof import('../../../lib/session/shape')>(); return { ...actual, languageContext: vi.fn(actual.languageContext) }; })` at the top and read the spy's calls through `vi.mocked(languageContext).mock.calls.map(([, , ctx]) => ctx.participantSpeech)` instead of `contexts`.

- [ ] **Step 2: Run to verify failure** — `vitest run src/lib/setup src/components/SetupWizard/applySetup.test.ts src/components/SetupWizard/useApplySetup.test.ts src/components/SetupWizard/steps/StepLanguagePair.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

`scenarios.ts`: `ScenarioPreset` gains `/** 我听到的翻译 for the Both scenarios: on with voice, off with text. Absent: the wizard leaves it as it is. */ participantSpeech?: boolean;`; the presets: `two-way-voice` `participantSpeech: true`, `two-way-text` `false`, `face-to-face-voice` `true`, `face-to-face-text` `false`. Update the header comment (the participant leg now speaks in a meeting too when asked).

`applySetup.ts`: `ApplySetupDeps.setParticipantSpeech: (on: boolean | null) => void;` and after `deps.setTextOnly(preset.textOnly);`: `if (preset.participantSpeech !== undefined) deps.setParticipantSpeech(preset.participantSpeech);`.

`useApplySetup.ts`: `import { useRoutingStore } from '../../stores/routingStore';` and `setParticipantSpeech: useRoutingStore.getState().setParticipantSpeech,`.

`appShape.ts`: `function heardFromStores(` → `export function heardFromStores(` (body unchanged).

`StepLanguagePair.tsx`: the `speech` line becomes
```ts
  const beside = preset.otherSide === 'beside';
  // A preset that carries the participant's speech answers for that leg (two-way-text offers as silent); one silent on it keeps the stores' answer.
  const participantSpeech = preset.participantSpeech === undefined
    ? speechInputsFromStores().participantSpeech
    : participantSpeechInput({ participantSpeech: preset.participantSpeech, faceToFace: beside, heard: heardFromStores(beside) });
  const speech = languageContext(p, legsFor(preset.mode), { textOnly: preset.textOnly, participantSpeech }).speech;
```
with `heardFromStores` added to the `appShape` import and `participantSpeechInput` to the `shape` import. The old `preset.otherSide === 'beside' ? !preset.textOnly : …` special case goes: the face-to-face presets now carry the answer.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit**

```bash
git add src/lib/setup src/components/SetupWizard src/lib/session/appShape.ts
git commit -m "feat(wizard): the Both scenarios write 我听到的翻译

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Telemetry — `participant_speech`, `outlet_channels`

**Files:**
- Modify: `src/lib/analytics.ts`, `src/app/telemetry.ts`
- Test: `src/app/telemetry.test.ts`

**Interfaces:**
- `AnalyticsEvents['translation_session_start']` gains `participant_speech?: boolean;` and `outlet_channels?: Record<'other' | 'me' | 'them', 'both' | 'left' | 'right'>;`.
- `StartInputs` gains `speak: Speak` and `channels: Record<OutletName, Channel>`; `appStartInputs` fills them from `speechFromStores()` and `resolveChannel` over `audioStore.outlets` with `faceToFaceFromStores()`.
- `sessionStartProperties` returns the two new properties as well.

- [ ] **Step 1: Tests**

In `telemetry.test.ts` `'maps the audio, segmentation and punctuator inputs to the kept properties'`: the input gains `speak: { other: true, me: false, them: true }, channels: { other: 'both', me: 'both', them: 'left' }` and the expected object `participant_speech: true, outlet_channels: { other: 'both', me: 'both', them: 'left' }`. The second case gets `speak`/`channels` too (any values). `'reads the audio, settings and provider stores'`: add
```ts
    expect(inputs.speak).toEqual({ other: true, me: false, them: false });
    expect(inputs.channels).toEqual({ other: 'both', me: 'both', them: 'both' });
```
(with `useAudioStore.setState({ isMonitorMuted: true, mode: 'speaker', outlets: … auto })` and `useSettingsStore.setState({ textOnly: false })` in the case) and a new case:
```ts
  it('answers with no provider loaded (Review Focus 5)', () => {
    useProviderStore.setState({ selected: null, entries: {} });
    expect(() => appStartInputs(false)).not.toThrow();
  });
```
`decorateSessionAnalytics`' `startInputs` fixture gains `speak`/`channels`.

- [ ] **Step 2: Run to verify failure** — `vitest run src/app/telemetry.test.ts` → FAIL (type errors).

- [ ] **Step 3: Implement**

`analytics.ts`: after `monitor_device_on?: boolean;`:
```ts
    /** 我听到的翻译 at start (spec 2026-10-10 §6.4). */
    participant_speech?: boolean;
    /** Each outlet's resolved channel at start. */
    outlet_channels?: Record<'other' | 'me' | 'them', 'both' | 'left' | 'right'>;
```
`telemetry.ts`: imports `import { OUTLET_NAMES, resolveChannel, type Channel, type OutletName, type Speak } from '../lib/audio/outlets';` and `faceToFaceFromStores, speechFromStores` from `../lib/session/appShape`. `StartInputs` gains `speak: Speak; channels: Record<OutletName, Channel>;`. `sessionStartProperties`'s `Pick<…>` adds `'participant_speech' | 'outlet_channels'` and the return adds `participant_speech: i.speak.them, outlet_channels: i.channels,`. `appStartInputs`:
```ts
  const faceToFace = faceToFaceFromStores();
  const channels = {} as Record<OutletName, Channel>;
  for (const name of OUTLET_NAMES) channels[name] = resolveChannel(name, audio.outlets[name].channel, faceToFace);
  return { audio, speak: speechFromStores(), channels, segmentation: {…}, punctuationActive };
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit**

```bash
git add src/lib/analytics.ts src/app/telemetry.ts src/app/telemetry.test.ts
git commit -m "feat(telemetry): participant_speech and the outlets' channels at session start

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The leftovers — the hidden switch, its constant, the strings, the comments

**Files:**
- Delete: `src/components/Settings/sections/ParticipantSpeechSwitch.tsx`, `ParticipantSpeechSwitch.test.tsx`
- Modify: `src/stores/routingStore.ts` (`PARTICIPANT_SPEECH_SHOWN` and its comment), `src/components/Settings/sections/SystemAudioSection.tsx` (+ test), `src/providers/soniox/kizunaParticipantSpeech.test.tsx`, `src/lib/session/types.ts` (the `participantSpeech` comment), `src/locales/*/translation.json` (30), `CLAUDE.md`
- Test: the files above; `src/locales/locales.consistency.test.ts`

- [ ] **Step 1: The switch and the constant**

`git rm` the switch and its test. In `SystemAudioSection.tsx` drop the `ParticipantSpeechSwitch` and `PARTICIPANT_SPEECH_SHOWN` imports and the line `{!besideMe && PARTICIPANT_SPEECH_SHOWN && …}`; in its test delete `'does not render the participant-speech switch'` and, in `'beside me: the note replaces the picker, the refresh button and the speech switch'`, the speech-switch assertion and the words. In `routingStore.ts` delete `PARTICIPANT_SPEECH_SHOWN` and its comment. `grep -rn "PARTICIPANT_SPEECH_SHOWN\|ParticipantSpeechSwitch" src` → nothing.

- [ ] **Step 2: The Kizuna test**

In `kizunaParticipantSpeech.test.tsx`, the `describe('the switch', …)` block renders `SpeechOutputSection` instead (import it from `../../components/Settings/sections/SpeechOutputSection`; set `useAudioStore.setState({ mode: 'both', selectedParticipantSource: { deviceId: 'app:1', label: 'Zoom' } })` so the row is not blocked by mode or source; the file's environment is the web/jsdom default, where `participantSpeechHeard` is true):
```tsx
  it('the flag off: 我听到的翻译 off and disabled with the "not offered" tooltip, the stored choice kept', () => {
    standIn.provider = silent;
    useRoutingStore.setState({ participantSpeech: true });
    selectKizuna();
    render(<SpeechOutputSection isSessionActive={false} />);
    const sw = screen.getByRole('switch', { name: 'Translation I hear' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('aria-disabled')).toBe('true');
    expect(tooltips).toContain('audioPanel.iHearNotOffered');
    expect(useRoutingStore.getState().participantSpeech).toBe(true);
  });

  it('the flag on: enabled, following the stored choice', () => {
    standIn.provider = speaking;
    useRoutingStore.setState({ participantSpeech: true });
    selectKizuna();
    render(<SpeechOutputSection isSessionActive={false} />);
    const sw = screen.getByRole('switch', { name: 'Translation I hear' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-disabled')).not.toBe('true');
  });
```
(The file's `t` mock returns keys; the switch's accessible name is then the key `audioPanel.iHear` — use whichever the mock yields; the `tooltips` array collects `Tooltip` contents as today.)

- [ ] **Step 3: Strings**

Remove from all 30 catalogs the keys listed in Global Constraints; reword `settings.participantSectionDescriptionExtension` (en: "…and plays through the default playback device you chose" in place of "…through your system default output"; the other 29 accordingly). `grep -rn "participantSpeechDesc\|participantSpeechBlockedWholeSystem\|participantSpeechNotYetAvailable\|'audioPanel.participantSpeech'\|faceToFace.earsTitle\|faceToFace.previewLeft\|faceToFace.previewRight\|faceToFace.swap\|meListens\|otherListens\|deviceSpeakerMonitor\|popover.output" src --include='*.ts' --include='*.tsx'` → nothing before removing.

- [ ] **Step 4: Comments and docs**

`src/lib/session/types.ts`: the `participantSpeech` doc becomes `/** 我听到的翻译: the other's translation is spoken to me (the switch, the provider's flags and the recapture rule applied — \`speakFor\`). */`. `CLAUDE.md`: in "4. State Management" the `routingStore` line (if any) and in "UI Components" mention that the popover's rows mirror the 语音 block, that the ears strip and ear tags read the outlets, and that the wizard's Both scenarios write 我听到的翻译; remove any sentence that still says the participant-speech switch is hidden.

- [ ] **Step 5: Run and commit**

`vitest run src/locales src/components/Settings src/providers/soniox src/stores` → PASS.
```bash
git add -A src/components/Settings src/stores/routingStore.ts src/providers/soniox/kizunaParticipantSpeech.test.tsx src/lib/session/types.ts src/locales CLAUDE.md
git commit -m "chore(audio): the hidden participant-speech switch, its constant and the ears strings go

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The capture's widening silences 我听到的翻译, live

Slice 1's final review (Important 2): on Electron, `participantSpeechHeard` answers true for an application source (`app:…`) because its tap does not capture Sokuji's own playback. But the system-audio source widens to whole-system capture mid-run — `APP_MONITOR_MISSING` when the tap's monitor never appears at connect, `APP_CAPTURE_LOST` when the helper dies — and from then on the other's translation played on the real device IS recaptured and translated again as Other, the loop the recapture rule exists to prevent, while `heard` still reads true from the stored source id. The run's shape stays frozen (the leg still runs); the routing, the replay slot and the surfaces follow a store flag the source raises.

**Files:**
- Modify: `src/lib/audio/capture/systemAudio.ts`, `src/lib/audio/appCapture.ts`, `src/stores/audioStore.ts`, `src/lib/session/appShape.ts`, `src/components/Settings/sections/SpeechOutputSection.tsx` (slice 2), `src/components/MainPanel/ModeDevicePopover.tsx` (Task 1), `src/components/MainPanel/useFaceToFace.ts`, `CLAUDE.md`
- Test: `src/lib/audio/capture/systemAudio.test.ts`, `src/lib/audio/appCapture.test.ts`, `src/stores/audioStore.test.ts`, `src/lib/session/appShape.test.ts`, `src/components/MainPanel/useFaceToFace.test.ts`

**Interfaces:**
- Consumes: `SystemAudioSettings` (`systemAudio.ts`), `systemAudioSettings()` (`appCapture.ts`), `heardFromStores` (exported by Task 3), `participantSpeechHeard`.
- Produces: `SystemAudioSettings.widened(on: boolean): void`; `audioStore.participantCaptureWidened: boolean` (never persisted) and `setParticipantCaptureWidened(on: boolean)`; `heardFromStores(faceToFace)` now `participantSpeechHeard(…) && !participantCaptureWidened`.

- [ ] **Step 1: Tests**

`systemAudio.test.ts` — in `setup()`, beside `audioSeen`: `const widened = vi.fn();`, add `widened,` to the `settings` object and to the returned record. New describe:
```ts
describe('openSystemAudio — the widening flag', () => {
  it("flags the capture as widened when the tap's monitor never appears, and clears it when the source stops", async () => {
    const s = setup({ sourceId: 'app:7', answer: { success: true, monitorLabel: 'Sokuji Capture' } });
    const source = await openSystemAudio(s.settings, live(), s.deps);
    expect(s.widened).toHaveBeenLastCalledWith(true);
    await source.stop();
    expect(s.widened).toHaveBeenLastCalledWith(false);
  });

  it('flags it when the helper dies and the capture falls back to the whole system', async () => {
    const s = setup({ sourceId: 'app:42', answer: { success: true, capture: 'app' } });
    await openSystemAudio(s.settings, live(), s.deps);
    expect(s.widened).not.toHaveBeenCalledWith(true);
    s.app.onLost?.();
    await settle();
    expect(s.widened).toHaveBeenLastCalledWith(true);
  });

  it('never flags a whole-system source chosen as such, nor an application capture that works', async () => {
    const whole = setup({ sourceId: 'desktop-audio-loopback' });
    await openSystemAudio(whole.settings, live(), whole.deps);
    expect(whole.widened).not.toHaveBeenCalledWith(true);
    const app = setup({ sourceId: 'app:42', answer: { success: true, capture: 'app' } });
    await openSystemAudio(app.settings, live(), app.deps);
    expect(app.widened).not.toHaveBeenCalledWith(true);
  });

  it('clears it when a switch lands on a working application capture', async () => {
    const s = setup({ sourceId: 'app:7', answer: [{ success: true, monitorLabel: 'Sokuji Capture' }, { success: true, capture: 'app' }] });
    await openSystemAudio(s.settings, live(), s.deps);
    expect(s.widened).toHaveBeenLastCalledWith(true);
    s.set({ sourceId: 'app:9' });
    await settle();
    expect(s.widened).toHaveBeenLastCalledWith(false);
  });
});
```

`appCapture.test.ts`, in the `createAppCapture` describe after 'reads the participant source…':
```ts
  it('marks the participant capture widened, and unmarks it', () => {
    const settings = systemAudioSettings();
    useAudioStore.setState({ participantCaptureWidened: false });
    settings.widened(true);
    expect(useAudioStore.getState().participantCaptureWidened).toBe(true);
    settings.widened(false);
    expect(useAudioStore.getState().participantCaptureWidened).toBe(false);
  });
```

`audioStore.test.ts`, after the 'participant tap audio seen' describe:
```ts
describe('audioStore - participant capture widened', () => {
  beforeEach(() => {
    localStorage.clear();
    useAudioStore.setState({ participantCaptureWidened: false } as any);
  });

  it('starts out not widened, follows the setter, and is never persisted', () => {
    expect(useAudioStore.getState().participantCaptureWidened).toBe(false);
    useAudioStore.getState().setParticipantCaptureWidened(true);
    expect(useAudioStore.getState().participantCaptureWidened).toBe(true);
    useAudioStore.getState().setParticipantCaptureWidened(false);
    expect(useAudioStore.getState().participantCaptureWidened).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('is a no-op when unchanged, so the routing is not rebuilt for nothing', () => {
    const listener = vi.fn();
    const off = useAudioStore.subscribe(listener);
    useAudioStore.getState().setParticipantCaptureWidened(false);
    off();
    expect(listener).not.toHaveBeenCalled();
  });
});
```

`appShape.test.ts`, in the describe "readShapeFromStores — participant speech follows the whole-system rule":
```ts
  it('is off, live, while the application capture has widened to the whole system (slice 1 final review, Important 2)', () => {
    environment.value = 'electron';
    useAudioStore.setState({ mode: 'both', selectedParticipantSource: { deviceId: 'app:42', label: 'App' }, participantCaptureWidened: true });
    expect(speechFromStores(fakeProvider).them).toBe(false);
    expect(speechInputsFromStores().participantSpeech).toBe(false);
    useAudioStore.setState({ participantCaptureWidened: false });
    expect(speechFromStores(fakeProvider).them).toBe(true);
  });
```
(import `speechFromStores` and `speechInputsFromStores` from `./appShape` if the file does not already.)

`useFaceToFace.test.ts`, beside the test that `speaks` follows the switches (the one asserting `{ speaker: false, participant: true }` then `{ speaker: false, participant: false }`): a case that, in a meeting on Electron with an application source and 我听到的翻译 on, `result.current.speaks.participant` is true, and after `act(() => useAudioStore.setState({ participantCaptureWidened: true }))` it is false — follow that test's own setup for the environment mock and the provider.

- [ ] **Step 2: Run to verify failure** — `vitest run src/lib/audio/capture/systemAudio.test.ts src/lib/audio/appCapture.test.ts src/stores/audioStore.test.ts src/lib/session/appShape.test.ts src/components/MainPanel/useFaceToFace.test.ts` → FAIL (`widened` is not a function; `setParticipantCaptureWidened` undefined; `them` true).

- [ ] **Step 3: Implement**

`systemAudio.ts` — `SystemAudioSettings` gains, after `audioSeen`:
```ts
  /** The capture widened to the whole system although an application was chosen (true), or is no longer widened: it closed, or a switch landed on what was chosen (false). While on, the other's translation played on the real device would be recaptured. */
  widened(on: boolean): void;
```
In `connect`, the line before `core.degrade({ code: APP_MONITOR_MISSING, … })`: `settings.widened(true);`. In `fallBack`, the line after its `core.degrade({ code: APP_CAPTURE_LOST, … })`: `settings.widened(true);`. In `close`, after `await stopRecorder();`: `settings.widened(false);` (closing ends whatever was captured; a switch reconnects and sets it again if it must).

`appCapture.ts`, `systemAudioSettings()`: `widened: (on) => audio().setParticipantCaptureWidened(on),`.

`audioStore.ts` — state, after `participantTapAudioSeen`:
```ts
  /**
   * The participant capture has widened to the whole system although an
   * application was chosen (its monitor never appeared, or the helper died):
   * the other's translation played on the real device would be recaptured,
   * so `heardFromStores` answers false while this is on. Raised by the
   * system-audio source through `appCapture`'s binding, cleared when it
   * closes; never persisted.
   */
  participantCaptureWidened: boolean;
```
actions, after `markParticipantTapAudioSeen`: `setParticipantCaptureWidened: (on: boolean) => void;`; the initial state `participantCaptureWidened: false,`; the action:
```ts
    setParticipantCaptureWidened: (on) => {
      if (get().participantCaptureWidened !== on) set({ participantCaptureWidened: on });
    },
```

`appShape.ts` — `heardFromStores` (exported since Task 3):
```ts
/**
 * `participantSpeechHeard` over the stores, and the capture's own word: the
 * other's translation, played to me, is not recaptured by the participant
 * source. An application capture that widened to the whole system mid-run
 * (`audioStore`'s `participantCaptureWidened`) recaptures it, whatever the
 * chosen source says.
 */
export function heardFromStores(faceToFace: boolean): boolean {
  const audio = useAudioStore.getState();
  return participantSpeechHeard(getEnvironment(), audio.selectedParticipantSource?.deviceId, faceToFace) && !audio.participantCaptureWidened;
}
```

`SpeechOutputSection.tsx`: `const heard = participantSpeechHeard(platform, source?.deviceId, faceToFace);` → `const heard = heardFromStores(faceToFace);` with `useAudioStore((s) => s.participantCaptureWidened);` beside the section's other store subscriptions (so the blocked state follows the flag), importing `heardFromStores` from `../../../lib/session/appShape`; drop the `participantSpeechHeard` import if nothing else uses it. `ModeDevicePopover.tsx`: the same for `const heard = participantSpeechHeard(getEnvironment(), selectedParticipantSource?.deviceId, beside);` → `heardFromStores(beside)` plus the subscription. `useFaceToFace.ts`: `useAudioStore((s) => s.participantCaptureWidened);` after the `selectedParticipantSource?.deviceId` subscription, so `speaks` (and MainPanel's replay slot) follows. Both tests' environment mocks reach `heardFromStores`, which reads the same `getEnvironment()`.

`CLAUDE.md`, the routing sentence at the end of "5. Audio": add "The system-audio source tells the audio store when an application capture widened to the whole system (`participantCaptureWidened`); `heardFromStores` reads it, so 我听到的翻译 falls silent live instead of being recaptured."

- [ ] **Step 4: Run** — the Step 2 command → PASS; `vitest run src/components/Settings/sections src/components/MainPanel` → PASS; tsc: no error in a changed file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/capture/systemAudio.ts src/lib/audio/capture/systemAudio.test.ts src/lib/audio/appCapture.ts src/lib/audio/appCapture.test.ts src/stores/audioStore.ts src/stores/audioStore.test.ts src/lib/session/appShape.ts src/lib/session/appShape.test.ts src/components/Settings/sections/SpeechOutputSection.tsx src/components/MainPanel/ModeDevicePopover.tsx src/components/MainPanel/useFaceToFace.ts src/components/MainPanel/useFaceToFace.test.ts CLAUDE.md
git commit -m "fix(audio): an application capture widening to the whole system silences 我听到的翻译, live

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The whole suite, the builds, the PR notes

- [ ] **Step 1: Everything**

`/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run > /tmp/slice3-suite.log 2>&1; tail -6 /tmp/slice3-suite.log` → no failures; `tsc` clean but for the known line; `npm run build`, `npm run extension:build`, `node scripts/check-viewer-bundle.mjs` (if the viewer bundle check exists in `package.json`'s scripts, run it as the earlier slices did) → succeed.

- [ ] **Step 2: A render pass of the popover**

With the slice-2 harness recipe (`index-harness.html` → `harness-f2f.tsx`, which mounts the real popover): shoot `popover-beside-basic-450` and `popover-meeting-basic-450` and look: four rows in beside (microphone, the choice, the two translation rows with ▶), three in a meeting; no ears block; the summaries name the resolved entries. Clean up per HOWTO step 4.

- [ ] **Step 3: The PR notes**

Write `/home/jiangzhuo/.claude/jobs/99b15063/tmp/pr-audio-rearrangement.md`: a summary in the shape of `pr-client.md` (what changed per slice, the storage keys, the strings, the tests), and a "Live checks" list: each outlet on a different device; a channel entry on a mono device (Review Focus 2 of slice 2); face-to-face auto channels and a swap by picking; replay of each leg landing on its row's device; the whole-system block in 对方 and 两者; the wizard's Both scenarios; 保留回放; the popover rows per mode; the extension's field text. Do not open a PR: the owner opens PRs on his word.
