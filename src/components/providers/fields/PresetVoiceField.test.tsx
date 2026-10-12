import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useContext } from 'react';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
import type { VoiceLibrarySectionProps } from '../../Settings/sections/VoiceLibrarySection';
import type { PreviewPort } from '../../../lib/provider/types';
import { VoicePreviewContext } from '../VoicePreviewContext';
const { library } = vi.hoisted(() => ({ library: [] as Array<VoiceLibrarySectionProps & { port: unknown }> }));
vi.mock('../../Settings/sections/VoiceLibrarySection', () => ({
  default: function Library(props: VoiceLibrarySectionProps) {
    library.push({ ...props, port: useContext(VoicePreviewContext) });
    return null;
  },
}));
const libraryProps = () => library[library.length - 1];

import { PresetVoiceField, presetVoice, presetVoiceSummary } from './PresetVoiceField';

describe('presetVoiceSummary: a one-voice provider names that voice under every spoken row', () => {
  it("names the voice `voiceOf` picks by the list's name; an id the list lacks as itself; nothing when it picks none", () => {
    const Summary = presetVoiceSummary<{ voice: string }>([{ value: 'aoede', name: 'Aoede' }], ({ settings }) => settings.voice || undefined);
    const text = (voice: string, leg: 'speaker' | 'participant') => render(<Summary settings={{ voice }} update={() => {}} leg={leg} />).container.textContent;
    expect(text('aoede', 'speaker')).toBe('Aoede');
    expect(text('aoede', 'participant')).toBe('Aoede');
    expect(text('retired', 'speaker')).toBe('retired');
    expect(text('', 'speaker')).toBe('');
  });
});

const voices = [
  { id: 'Aoede', label: 'Aoede', group: 'builtin' as const, removable: false, previewable: true },
  { id: 'Puck', label: 'Puck', group: 'builtin' as const, removable: false, previewable: true },
];

beforeEach(() => { library.length = 0; });

describe("PresetVoiceField: a provider's prebuilt voices in the shared voice library (preset voice preview)", () => {
  it("is Settings' voice section, headed as the other voice libraries are, listing the voices with nothing to add", () => {
    const { container } = render(<PresetVoiceField voices={voices} value="Puck" onChange={vi.fn()} />);
    // `#voice-settings-section` stays Settings' `voice-settings` target (`Settings.tsx:51`).
    expect(container.querySelector('#voice-settings-section.settings-section.voice-settings-section')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'settings.voiceSettings' })).toBeInTheDocument();
    const props = libraryProps();
    expect(props.voices).toBe(voices);
    expect(props.selectedId).toBe('Puck');
    expect(props.capability).toEqual({ importModes: [] });
    expect(props.isSessionActive).toBe(false);
    expect(props.onPreview).toBeUndefined();
    expect(props.port).toBeNull();
  });

  it('writes the voice picked', () => {
    const onChange = vi.fn();
    render(<PresetVoiceField voices={voices} value="Puck" onChange={onChange} />);
    libraryProps().onSelect('Aoede');
    expect(onChange).toHaveBeenCalledWith('Aoede');
  });

  it("hands the library the audition, its reason when there is none, the note, and the host's preview route", () => {
    const onPreview = vi.fn(async () => null);
    const port: PreviewPort = { play: vi.fn(async () => {}), stop: vi.fn() };
    render(<PresetVoiceField voices={voices} value="Puck" onChange={vi.fn()} onPreview={onPreview} previewUnavailableReason="why" note="it costs" preview={port} />);
    const props = libraryProps();
    expect(props.onPreview).toBe(onPreview);
    expect(props.previewUnavailableReason).toBe('why');
    expect(props.manageNote).toBe('it costs');
    expect(props.port).toBe(port);
  });

  it("with the other party spoken, a second row over the same list: its own choice, its audition, the cost note under it, and a note when a run swaps it", () => {
    const onChange = vi.fn();
    const onPreview = vi.fn(async () => null);
    const theirPreview = vi.fn(async () => null);
    const { rerender } = render(
      <PresetVoiceField voices={voices} value="Aoede" onChange={vi.fn()} onPreview={onPreview} note="it costs" participant={{ value: 'Puck', effective: 'Puck', onChange, onPreview: theirPreview }} />
    );
    const [mine, theirs] = library.slice(-2);
    expect(mine).toMatchObject({ label: 'settings.voiceTheyHear', selectedId: 'Aoede', manageNote: undefined });
    expect(theirs).toMatchObject({ label: 'settings.voiceIHear', selectedId: 'Puck', manageNote: 'it costs', note: undefined });
    expect(theirs.voices).toBe(voices);
    expect(theirs.onPreview).toBe(theirPreview);
    theirs.onSelect('Aoede');
    expect(onChange).toHaveBeenCalledWith('Aoede');

    rerender(<PresetVoiceField voices={voices} value="Aoede" onChange={vi.fn()} onPreview={onPreview} participant={{ value: 'Aoede', effective: 'Puck', onChange }} />);
    const swapped = libraryProps();
    expect(swapped.note).toBe('settings.voiceIHearSame');
    expect(swapped.onPreview).toBe(onPreview);
  });

  it('makes a list entry an auditionable prebuilt voice, carrying only what the vendor documents', () => {
    expect(presetVoice({ value: 'marin', name: 'Marin' })).toEqual({ id: 'marin', label: 'Marin', group: 'builtin', removable: false, previewable: true });
    expect(presetVoice({ value: 'Kore', name: 'Kore', gender: 'female', style: 'firm' })).toEqual({
      id: 'Kore', label: 'Kore', group: 'builtin', removable: false, previewable: true,
      meta: { gender: 'F', facets: { gender: 'female', style: ['firm'] } },
    });
    expect(presetVoice({ value: 'ripple', name: 'Ripple', gender: 'male', description: 'Australian English' })).toEqual({
      id: 'ripple', label: 'Ripple', group: 'builtin', removable: false, previewable: true,
      meta: { gender: 'M', facets: { gender: 'male', description: 'Australian English' } },
    });
  });

  it('locks the choice while a run is not idle', () => {
    render(<PresetVoiceField voices={voices} value="Puck" onChange={vi.fn()} disabled />);
    expect(libraryProps().isSessionActive).toBe(true);
  });
});
