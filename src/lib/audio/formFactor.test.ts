import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  UNKNOWN_FORM,
  cleanOutputLabel,
  getOutputFormFactor,
  matchOutputForm,
  unmatchedOutputLabels,
  useOutputFormFactor,
  type FormFactor,
  type OutputDeviceInfo,
} from './formFactor';
import useAudioStore from '../../stores/audioStore';

const n = (label: string, formFactor: FormFactor, isDefault = false): OutputDeviceInfo => ({
  label,
  isDefault,
  formFactor,
  transport: 'builtin',
  raw: {},
});

const HEADPHONES = { formFactor: 'headphones', transport: 'builtin' };

describe('cleanOutputLabel', () => {
  it('trims and removes a leading Default - or Communications - prefix', () => {
    expect(cleanOutputLabel('  Default - Speakers  ')).toBe('Speakers');
    expect(cleanOutputLabel('Communications - Speakers')).toBe('Speakers');
    expect(cleanOutputLabel('Speakers')).toBe('Speakers');
  });
});

describe('matchOutputForm', () => {
  it('no native list is unknown', () => {
    expect(matchOutputForm('id1', 'Speakers', null, true)).toEqual(UNKNOWN_FORM);
  });

  it.each([undefined, '', 'default'])('the default sink (%j) is the native default', (id) => {
    const native = [n('A', 'speakers'), n('B', 'headphones', true)];
    expect(matchOutputForm(id, undefined, native, true)).toEqual(HEADPHONES);
    // The default needs no label, so it is found even before labels are readable.
    expect(matchOutputForm(id, undefined, native, false)).toEqual(HEADPHONES);
  });

  it('no default or two defaults is unknown', () => {
    expect(matchOutputForm('default', undefined, [n('A', 'speakers'), n('B', 'headphones')], true)).toEqual(UNKNOWN_FORM);
    expect(
      matchOutputForm('default', undefined, [n('A', 'speakers', true), n('B', 'headphones', true)], true),
    ).toEqual(UNKNOWN_FORM);
  });

  it('communications is unknown', () => {
    const native = [n('A', 'speakers'), n('B', 'headphones', true)];
    expect(matchOutputForm('communications', 'Communications - A', native, true)).toEqual(UNKNOWN_FORM);
  });

  it('labels not known is unknown', () => {
    expect(matchOutputForm('x', 'A', [n('A', 'speakers')], false)).toEqual(UNKNOWN_FORM);
  });

  it('an exact label matches', () => {
    const label = 'Speakers (Realtek(R) Audio)';
    expect(matchOutputForm('x', label, [n(label, 'speakers')], true)).toEqual({
      formFactor: 'speakers',
      transport: 'builtin',
    });
  });

  it('prefixes and outer spaces are removed before matching', () => {
    const native = [n('Headphones (USB)', 'headphones')];
    expect(matchOutputForm('x', '  Default - Headphones (USB)  ', native, true)).toEqual(HEADPHONES);
    expect(matchOutputForm('x', 'Communications - Headphones (USB)', native, true)).toEqual(HEADPHONES);
  });

  it('native labels are trimmed before matching', () => {
    expect(matchOutputForm('x', 'Headphones (USB)', [n(' Headphones (USB) ', 'headphones')], true)).toEqual(HEADPHONES);
  });

  it('two native devices with the same label match neither', () => {
    const native = [n('USB Headset', 'headphones'), n('USB Headset', 'headphones')];
    expect(matchOutputForm('x', 'USB Headset', native, true)).toEqual(UNKNOWN_FORM);
  });

  it('the browser default among same-named devices is the native default', () => {
    const native = [n('USB Headset', 'speakers'), n('USB Headset', 'headphones', true)];
    expect(matchOutputForm('x', 'Default - USB Headset', native, true, true)).toEqual(HEADPHONES);
    expect(matchOutputForm('x', 'Default - USB Headset', native, true, false)).toEqual(UNKNOWN_FORM);

    const otherDefault = [n('USB Headset', 'headphones'), n('USB Headset', 'headphones'), n('Other', 'speakers', true)];
    expect(matchOutputForm('x', 'USB Headset', otherDefault, true, true)).toEqual(UNKNOWN_FORM);
  });

  it('no fuzzy match', () => {
    const native = [n('Headphones (USB)', 'headphones')];
    expect(matchOutputForm('x', 'Headphones', native, true)).toEqual(UNKNOWN_FORM);
    expect(matchOutputForm('x', 'headphones (usb)', native, true)).toEqual(UNKNOWN_FORM);
  });

  it('a near-miss of a native label with a transport suffix is unknown, never a wrong answer', () => {
    const native = [n('MacBook Pro Speakers (Built-in)', 'speakers')];
    expect(matchOutputForm('x', 'MacBook Pro Speakers (Built-In)', native, true)).toEqual(UNKNOWN_FORM);
    expect(matchOutputForm('x', 'MacBook Pro Speakers', native, true)).toEqual(UNKNOWN_FORM);
  });

  it('an undefined browser label is unknown', () => {
    expect(matchOutputForm('x', undefined, [n('A', 'speakers')], true)).toEqual(UNKNOWN_FORM);
  });

  it('a blank browser label names no device, even a native one with an empty label', () => {
    const native = [n('', 'headphones', true), n('A', 'speakers')];
    expect(matchOutputForm('x', '   ', native, true)).toEqual(UNKNOWN_FORM);
    // Also as the browser's default entry, whose branch compares with the native default.
    expect(matchOutputForm('x', ' ', native, true, true)).toEqual(UNKNOWN_FORM);
  });

  it('returns copies, never the native object', () => {
    const native = [n('A', 'speakers', true)];
    const out = matchOutputForm('default', undefined, native, true);
    expect(out).not.toBe(native[0]);
    expect(Object.keys(out).sort()).toEqual(['formFactor', 'transport']);
  });
});

describe('getOutputFormFactor', () => {
  beforeEach(() => {
    useAudioStore.setState({
      nativeFormsCurrent: true,
      defaultOutputForm: { formFactor: 'headphones', transport: 'bluetooth' },
      audioMonitorDevices: [
        { deviceId: 'spk', label: 'Speakers', isVirtual: false, formFactor: 'speakers', transport: 'builtin' },
        // Listed before any form was joined in.
        { deviceId: 'bare', label: 'Bare', isVirtual: false },
      ],
    });
  });

  it('getOutputFormFactor covers default, communications, a listed id and an absent id', () => {
    const HEADPHONES_BT = { formFactor: 'headphones', transport: 'bluetooth' };
    expect(getOutputFormFactor()).toEqual(HEADPHONES_BT);
    expect(getOutputFormFactor('')).toEqual(HEADPHONES_BT);
    expect(getOutputFormFactor('default')).toEqual(HEADPHONES_BT);
    expect(getOutputFormFactor('communications')).toEqual(UNKNOWN_FORM);
    expect(getOutputFormFactor('spk')).toEqual({ formFactor: 'speakers', transport: 'builtin' });
    expect(getOutputFormFactor('gone')).toEqual(UNKNOWN_FORM);
    expect(getOutputFormFactor('bare')).toEqual(UNKNOWN_FORM);
  });

  it('returns copies, never the store\'s objects', () => {
    const out = getOutputFormFactor();
    expect(out).not.toBe(useAudioStore.getState().defaultOutputForm);
    expect(Object.keys(out).sort()).toEqual(['formFactor', 'transport']);
    expect(Object.keys(getOutputFormFactor('spk')).sort()).toEqual(['formFactor', 'transport']);
  });

  it('useOutputFormFactor follows the store, and keeps its object while the answer holds', () => {
    const { result } = renderHook(() => useOutputFormFactor('spk'));
    expect(result.current).toEqual({ formFactor: 'speakers', transport: 'builtin' });
    const first = result.current;

    act(() => useAudioStore.setState({ defaultOutputForm: { formFactor: 'speakers', transport: 'usb' } }));
    expect(result.current).toBe(first);

    act(() =>
      useAudioStore.setState({
        audioMonitorDevices: [{ deviceId: 'spk', label: 'Speakers', isVirtual: false, formFactor: 'headphones', transport: 'builtin' }],
      }),
    );
    expect(result.current).toEqual({ formFactor: 'headphones', transport: 'builtin' });
  });

  it('every lookup is unknown while the forms in the lists are not from a current answer', () => {
    useAudioStore.setState({ nativeFormsCurrent: false });
    for (const sink of [undefined, '', 'default', 'communications', 'spk', 'bare', 'gone']) {
      expect(getOutputFormFactor(sink)).toEqual(UNKNOWN_FORM);
    }
    useAudioStore.setState({ nativeFormsCurrent: true });
    expect(getOutputFormFactor('spk')).toEqual({ formFactor: 'speakers', transport: 'builtin' });
  });

  it('useOutputFormFactor follows the same flag', () => {
    const { result } = renderHook(() => useOutputFormFactor());
    expect(result.current).toEqual({ formFactor: 'headphones', transport: 'bluetooth' });
    act(() => useAudioStore.setState({ nativeFormsCurrent: false }));
    expect(result.current).toEqual(UNKNOWN_FORM);
    act(() => useAudioStore.setState({ nativeFormsCurrent: true }));
    expect(result.current).toEqual({ formFactor: 'headphones', transport: 'bluetooth' });
  });
});

describe('unmatchedOutputLabels', () => {
  const native = [
    { label: 'Speakers (Realtek(R) Audio)', isDefault: true, formFactor: 'speakers', transport: 'builtin', raw: {} },
    { label: 'Twin', isDefault: false, formFactor: 'headphones', transport: 'usb', raw: {} },
    { label: 'Twin', isDefault: false, formFactor: 'headphones', transport: 'usb', raw: {} },
  ] as const;

  it('names each browser label no system device carries, once, cleaned', () => {
    expect(
      unmatchedOutputLabels(
        ['Default - Speakers (Realtek(R) Audio)', 'Headset (Brand) (1234:abcd)', 'Headset (Brand) (1234:abcd)', 'Twin', '  '],
        native,
        true,
      ),
    ).toEqual(['Headset (Brand) (1234:abcd)']);
  });

  it('a label two devices share matched, just not uniquely: it is not unmatched', () => {
    expect(unmatchedOutputLabels(['Twin'], native, true)).toEqual([]);
  });

  it('says nothing without the system list or the browser labels', () => {
    expect(unmatchedOutputLabels(['Anything'], null, true)).toEqual([]);
    expect(unmatchedOutputLabels(['Anything'], native, false)).toEqual([]);
  });
});
