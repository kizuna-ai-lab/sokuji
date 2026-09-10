/**
 * The facet filter bar above the voice picker.
 *
 * Soniox's built-in roster went from 70 voices to 200 on 2026-09-10, and its
 * voice library exposes what each one sounds like (gender, age, accent,
 * use-case and style tags). A 200-entry alphabetical list is not a picker, so
 * those tags become filters — one choice per dimension, five dropdowns, no
 * search box.
 *
 * Two rules here are not obvious and are the reason this file exists:
 *
 *  - Filtering narrows the PRESETS group only. Cloned voices carry no metadata
 *    (no provider publishes any), so a facet selection would sweep every one of
 *    them out of the list — hiding the user's own recordings behind a filter
 *    they set to explore the built-ins.
 *  - The selected voice is never filtered out. A <select> whose value names no
 *    option renders blank, which reads as "my voice is gone" rather than as
 *    "it does not match".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import VoiceLibrarySection from './VoiceLibrarySection';
import type { VoiceEntry } from './VoiceLibrarySection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, def?: string) => def ?? _k }),
}));

const voice = (
  label: string,
  gender: string,
  age: string,
  accent: string,
  useCase: string[],
  style: string[],
  description = `${label} description`
): VoiceEntry => ({
  id: label,
  label,
  group: 'builtin',
  removable: false,
  meta: { facets: { gender, age, accent, useCase, style, description } },
});

const BUILTINS: VoiceEntry[] = [
  voice('Sakura', 'female', 'middle_aged', 'japanese', ['educational'], ['bright', 'calm']),
  voice('Yuto', 'male', 'young', 'japanese', ['conversational'], ['bright', 'energetic']),
  voice('Adrian', 'male', 'middle_aged', 'american', ['narration'], ['deep', 'calm'], 'crisp articulation'),
];

const CLONE: VoiceEntry = { id: 'clone:1', label: 'My voice', group: 'custom', removable: true };

const mount = (over: Partial<React.ComponentProps<typeof VoiceLibrarySection>> = {}) =>
  render(
    <VoiceLibrarySection
      selectedId="Sakura"
      onSelect={() => {}}
      onDelete={async () => {}}
      voices={[...BUILTINS, CLONE]}
      capability={{
        importModes: ['upload'],
        curation: false,
        presentation: 'dropdown',
        facetFilter: true,
      }}
      {...over}
    />
  );

/** The voice picker itself, named apart from the facet bar's own selects. */
const voiceSelect = () => screen.getByRole('combobox', { name: 'Voice' });

const presetOptions = () => {
  const group = within(voiceSelect()).getByRole('group', { name: 'Presets' });
  return [...group.querySelectorAll('option')].map((o) => o.textContent);
};

const customOptions = () => {
  const group = within(voiceSelect()).getByRole('group', { name: 'My Voices' });
  return [...group.querySelectorAll('option')].map((o) => o.textContent);
};

const facet = (name: string) => screen.getByLabelText(name) as HTMLSelectElement;

describe('VoiceLibrarySection facet filter', () => {
  beforeEach(() => cleanup());

  it('renders no filter bar unless the capability asks for one', () => {
    mount({ capability: { importModes: ['upload'], curation: false, presentation: 'dropdown' } });
    expect(screen.queryByLabelText('Accent')).toBeNull();
    expect(presetOptions()).toEqual(['Sakura', 'Yuto', 'Adrian']);
  });

  it('offers no search box — the five dimensions are the whole filter', () => {
    mount();
    expect(screen.queryByRole('searchbox')).toBeNull();
    for (const dim of ['Gender', 'Age', 'Accent', 'Use case', 'Style']) {
      expect(facet(dim)).toBeInTheDocument();
    }
  });

  it('puts the filter above the picker it filters', () => {
    mount();
    const bar = document.querySelector('.voice-facet-bar');
    expect(bar).not.toBeNull();
    // Reading order is the whole point: choose what you want, then pick from
    // what is left. The bar sitting under the <select> asks the user to filter
    // a list they have already scrolled past.
    const position = bar!.compareDocumentPosition(voiceSelect());
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('gives every facet select the shared dropdown class, so its popup is themed', () => {
    // A <select>'s OS-drawn popup takes its colours from the control, and a
    // half-transparent background lands there as white-on-white — unreadable.
    // `.select-dropdown` is where the settings panel keeps the opaque
    // background AND the `appearance: base-select` themed picker
    // (Settings.scss); anything not carrying it falls back to the OS popup.
    mount();
    for (const dim of ['Gender', 'Age', 'Accent', 'Use case', 'Style']) {
      expect(facet(dim).classList.contains('select-dropdown')).toBe(true);
    }
  });

  it('narrows the presets by a single-choice facet', () => {
    mount({ selectedId: 'Adrian' });
    fireEvent.change(facet('Accent'), { target: { value: 'japanese' } });
    expect(presetOptions()).toEqual(['Sakura', 'Yuto', 'Adrian']); // Adrian is the selection
  });

  it('matches a voice on any one of the style tags it carries', () => {
    // Voices carry 3.67 style tags on average, so picking `calm` has to reach
    // a voice whose tags are ['deep', 'calm'], not only one tagged calm alone.
    mount({ selectedId: 'Sakura' });
    fireEvent.change(facet('Style'), { target: { value: 'calm' } });
    expect(presetOptions()).toEqual(['Sakura', 'Adrian']);
  });

  it('replaces the chosen style rather than adding to it', () => {
    mount({ selectedId: 'Adrian' });
    fireEvent.change(facet('Style'), { target: { value: 'bright' } });
    expect(presetOptions()).toEqual(['Sakura', 'Yuto', 'Adrian']); // Adrian is the selection
    fireEvent.change(facet('Style'), { target: { value: 'deep' } });
    expect(presetOptions()).toEqual(['Adrian']);
  });

  it('picks one use case at a time', () => {
    mount({ selectedId: 'Adrian' });
    fireEvent.change(facet('Use case'), { target: { value: 'conversational' } });
    expect(presetOptions()).toEqual(['Yuto', 'Adrian']); // Adrian is the selection
    fireEvent.change(facet('Use case'), { target: { value: 'educational' } });
    expect(presetOptions()).toEqual(['Sakura', 'Adrian']);
  });

  it('shows the chosen facet back in the control', () => {
    // The filter working while the <select> still reads "Any accent" would be
    // the worst of both: the list narrows and nothing on screen says why.
    mount({ selectedId: 'Adrian' });
    fireEvent.change(facet('Accent'), { target: { value: 'japanese' } });
    expect(facet('Accent').value).toBe('japanese');
  });

  it('keeps the selected voice listed even when it does not match', () => {
    mount({ selectedId: 'Adrian' });
    fireEvent.change(facet('Accent'), { target: { value: 'japanese' } });
    expect(presetOptions()).toContain('Adrian');
  });

  it('leaves cloned voices alone, since they carry no facets to match', () => {
    mount();
    fireEvent.change(facet('Accent'), { target: { value: 'american' } });
    expect(customOptions()).toEqual(['My voice']);
  });

  it('reports how many voices the filter left', () => {
    mount({ selectedId: 'Adrian' });
    fireEvent.change(facet('Style'), { target: { value: 'deep' } });
    expect(screen.getByText('1 of 3 voices')).toBeInTheDocument();
  });

  it('clears every dimension at once', () => {
    mount();
    fireEvent.change(facet('Accent'), { target: { value: 'japanese' } });
    fireEvent.change(facet('Style'), { target: { value: 'bright' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(presetOptions()).toEqual(['Sakura', 'Yuto', 'Adrian']);
    expect(facet('Accent').value).toBe('');
    expect(facet('Style').value).toBe('');
  });

  it('offers only the facet values its voices actually carry', () => {
    mount();
    const optionsOf = (name: string) =>
      [...facet(name).querySelectorAll('option')].map((o) => o.textContent);
    // These are the humanized fallbacks, because `t` is mocked to its English
    // default here. The real labels come from the locale, and
    // locales.consistency.test.ts is what pins that every facet value has one.
    expect(optionsOf('Accent')).toEqual(['Any accent', 'American', 'Japanese']);
    expect(optionsOf('Use case')).toEqual([
      'Any use case',
      'Conversational',
      'Educational',
      'Narration',
    ]);
    expect(optionsOf('Style')).toEqual(['Any style', 'Bright', 'Calm', 'Deep', 'Energetic']);
  });

  it('says so when a combination matches nothing but the selection', () => {
    mount({ selectedId: 'Adrian' });
    fireEvent.change(facet('Accent'), { target: { value: 'japanese' } });
    fireEvent.change(facet('Style'), { target: { value: 'deep' } });
    expect(screen.getByText('No voices match these filters.')).toBeInTheDocument();
  });

  it("shows the selected voice's description, which no <option> has room for", () => {
    mount({ selectedId: 'Adrian' });
    expect(screen.getByText('crisp articulation')).toBeInTheDocument();
  });

  it('shows no description line for a voice that has none', () => {
    mount({ selectedId: 'clone:1' });
    expect(document.querySelector('.voice-selected-description')).toBeNull();
  });
});
