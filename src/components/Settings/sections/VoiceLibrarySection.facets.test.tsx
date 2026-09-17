/**
 * The facet filter bar inside the voice picker's popover.
 *
 * Soniox's built-in roster went from 70 voices to 200 on 2026-09-10, and its
 * voice library exposes what each one sounds like (gender, age, accent,
 * use-case and style tags). A 200-entry alphabetical list is not a picker, so
 * those tags become filters.
 *
 * Task 6 moved this bar from VoiceLibrarySection's own `<select>` into
 * VoicePicker's popover (Task 3), which renders it over three dimensions —
 * gender, age, accent — rather than the original five. `useCase` and `style`
 * were deliberately dropped from the FILTER: `matchesVoiceFacets` still
 * understands them (`src/lib/voiceLibrary/voiceFacets.ts`), and a row's own
 * subtitle now surfaces its style tags directly (`female · calm · soft`,
 * VoicePicker's `rowSubtitle`), which is what made a dedicated filter for them
 * feel redundant — see `VoicePicker.tsx`'s `facetRow` and Task 3's brief,
 * which hard-codes the same three dimensions. This file exercises the two
 * rules that are not obvious, over whichever dimensions the picker exposes:
 *
 *  - Filtering narrows the PRESETS group only. Cloned voices carry no metadata
 *    (no provider publishes any), so a facet selection would sweep every one of
 *    them out of the list — hiding the user's own recordings behind a filter
 *    they set to explore the built-ins.
 *  - The selected voice is never filtered out. A row that named no visible
 *    option would read as "my voice is gone" rather than as "it does not
 *    match".
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
        facetFilter: true,
      }}
      {...over}
    />
  );

/** Opens the picker's popover — the facet bar and the rows both live there. */
const openPicker = () => fireEvent.click(screen.getByRole('button', { expanded: false }));

const grid = () => screen.getByRole('grid');

/**
 * Names of every voice row currently shown, in one group or the other.
 *
 * Reads `.voice-row__pick`'s own `aria-label` directly rather than querying
 * by accessible name: a clone row also carries a Delete button (VoicePicker
 * always wires `onAskDelete` for a removable entry), so `getByRole('button')`
 * without a class filter would find two candidates on that row. The pick
 * button's OWN aria-label is exactly `v.label` with no subtitle appended —
 * the "gridcell reads as 'Mine My Voices'" gotcha applies to the wrapping
 * `role="gridcell"` div's COMPUTED name, not to this button's own attribute.
 */
const rowNames = (group: 'My Voices' | 'Presets'): string[] => {
  const rows = within(grid())
    .getAllByRole('row')
    .filter((r) => r.classList.contains('voice-row') && !r.classList.contains('voice-row--add'));
  return rows
    .map((r) => r.querySelector('.voice-row__pick')?.getAttribute('aria-label') ?? '')
    .filter((name) => {
      const isClone = name === CLONE.label;
      return group === 'My Voices' ? isClone : !isClone;
    });
};

const facet = (name: string) => screen.getByLabelText(name) as HTMLSelectElement;

describe('VoiceLibrarySection facet filter', () => {
  beforeEach(() => cleanup());

  it('renders no filter bar unless the capability asks for one', () => {
    mount({ capability: { importModes: ['upload'] } });
    openPicker();
    expect(screen.queryByLabelText('Accent')).toBeNull();
    expect(rowNames('Presets')).toEqual(['Sakura', 'Yuto', 'Adrian']);
  });

  it('offers no search box — gender, age and accent are the whole filter', () => {
    mount();
    openPicker();
    expect(screen.queryByRole('searchbox')).toBeNull();
    for (const dim of ['Gender', 'Age', 'Accent']) {
      expect(facet(dim)).toBeInTheDocument();
    }
  });

  it('puts the filter above the grid it narrows', () => {
    mount();
    openPicker();
    const bar = document.querySelector('.voice-pop__facets');
    expect(bar).not.toBeNull();
    // Reading order is the whole point: choose what you want, then pick from
    // what is left.
    const position = bar!.compareDocumentPosition(grid());
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('gives every facet select the shared dropdown class, so its popup is themed', () => {
    // A <select>'s OS-drawn popup takes its colours from the control, and a
    // half-transparent background lands there as white-on-white — unreadable.
    // `.select-dropdown` is where the settings panel keeps the opaque
    // background AND the `appearance: base-select` themed picker
    // (Settings.scss); anything not carrying it falls back to the OS popup.
    mount();
    openPicker();
    for (const dim of ['Gender', 'Age', 'Accent']) {
      expect(facet(dim).classList.contains('select-dropdown')).toBe(true);
    }
  });

  it('narrows the presets by a single-choice facet', () => {
    mount({ selectedId: 'Adrian' });
    openPicker();
    fireEvent.change(facet('Accent'), { target: { value: 'japanese' } });
    expect(rowNames('Presets')).toEqual(['Sakura', 'Yuto', 'Adrian']); // Adrian is the selection
  });

  it('replaces the chosen value rather than adding to it', () => {
    mount({ selectedId: 'Adrian' });
    openPicker();
    fireEvent.change(facet('Accent'), { target: { value: 'american' } });
    expect(rowNames('Presets')).toEqual(['Adrian']);
    fireEvent.change(facet('Accent'), { target: { value: 'japanese' } });
    expect(rowNames('Presets')).toEqual(['Sakura', 'Yuto', 'Adrian']); // Adrian is the selection
  });

  it('narrows across two dimensions at once (every chosen facet must match)', () => {
    mount({ selectedId: 'Yuto' });
    openPicker();
    fireEvent.change(facet('Accent'), { target: { value: 'japanese' } });
    fireEvent.change(facet('Gender'), { target: { value: 'female' } });
    // Sakura is the only voice that is both japanese AND female; Yuto stays
    // only because he is the current selection.
    expect(rowNames('Presets')).toEqual(['Sakura', 'Yuto']);
  });

  it('shows the chosen facet back in the control', () => {
    // The filter working while the select still reads "Any accent" would be
    // the worst of both: the list narrows and nothing on screen says why.
    mount({ selectedId: 'Adrian' });
    openPicker();
    fireEvent.change(facet('Accent'), { target: { value: 'japanese' } });
    expect(facet('Accent').value).toBe('japanese');
  });

  it('keeps the selected voice listed even when it does not match', () => {
    mount({ selectedId: 'Adrian' });
    openPicker();
    fireEvent.change(facet('Accent'), { target: { value: 'japanese' } });
    expect(rowNames('Presets')).toContain('Adrian');
  });

  it('leaves cloned voices alone, since they carry no facets to match', () => {
    mount();
    openPicker();
    fireEvent.change(facet('Accent'), { target: { value: 'american' } });
    expect(rowNames('My Voices')).toEqual(['My voice']);
  });

  it('reports how many voices the filter left', () => {
    mount({ selectedId: 'Adrian' });
    openPicker();
    fireEvent.change(facet('Accent'), { target: { value: 'american' } });
    expect(within(grid()).getByText('1 of 3')).toBeInTheDocument();
  });

  it('clears every dimension at once', () => {
    mount();
    openPicker();
    fireEvent.change(facet('Accent'), { target: { value: 'japanese' } });
    fireEvent.change(facet('Gender'), { target: { value: 'male' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(rowNames('Presets')).toEqual(['Sakura', 'Yuto', 'Adrian']);
    expect(facet('Accent').value).toBe('');
    expect(facet('Gender').value).toBe('');
  });

  it('offers only the facet values its voices actually carry', () => {
    mount();
    openPicker();
    const optionsOf = (name: string) =>
      [...facet(name).querySelectorAll('option')].map((o) => o.textContent);
    // These are the humanized fallbacks, because `t` is mocked to its English
    // default here. The real labels come from the locale, and
    // locales.consistency.test.ts is what pins that every facet value has one.
    expect(optionsOf('Accent')).toEqual(['Accent', 'American', 'Japanese']);
    expect(optionsOf('Gender')).toEqual(['Gender', 'Female', 'Male']);
    expect(optionsOf('Age')).toEqual(['Age', 'Middle aged', 'Young']);
  });

  it('says so when a combination matches nothing but the selection', () => {
    mount({ selectedId: 'Adrian' });
    openPicker();
    fireEvent.change(facet('Accent'), { target: { value: 'japanese' } });
    fireEvent.change(facet('Gender'), { target: { value: 'female' } });
    // Nobody is both japanese and female except Sakura, and Adrian (male,
    // american) is kept only for being the selection — so among PRESETS the
    // filter itself matches nothing besides the pinned selection; Sakura
    // being female-japanese means she DOES match, so pick a combination with
    // no real match instead.
    fireEvent.change(facet('Accent'), { target: { value: 'american' } });
    fireEvent.change(facet('Gender'), { target: { value: 'female' } });
    expect(within(grid()).getByText('0 of 3')).toBeInTheDocument();
  });

  it("shows the selected voice's description, which no row has room for", () => {
    mount({ selectedId: 'Adrian' });
    // Rendered by the section itself, beside the picker — not inside the
    // popover, so it is visible without opening it.
    expect(screen.getByText('crisp articulation')).toBeInTheDocument();
  });

  it('shows no description line for a voice that has none', () => {
    mount({ selectedId: 'clone:1' });
    expect(document.querySelector('.voice-selected-description')).toBeNull();
  });

  it('keeps the chosen filter when the popover is closed and reopened', () => {
    // The picker's own open-effect resets row/cell navigation and the
    // type-ahead buffer on every open (VoicePicker.tsx), but not `criteria` —
    // closing to glance at the selected voice, then reopening, must not lose
    // a filter the user just set.
    mount({ selectedId: 'Adrian' });
    openPicker();
    fireEvent.change(facet('Accent'), { target: { value: 'japanese' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();

    openPicker();
    expect(facet('Accent').value).toBe('japanese');
    expect(rowNames('Presets')).toEqual(['Sakura', 'Yuto', 'Adrian']);
  });
});
