/**
 * The facet filter bar inside the voice picker's popover.
 *
 * Soniox's built-in roster went from 70 voices to 200 on 2026-09-10, and its
 * voice library exposes what each one sounds like (gender, age, accent,
 * use-case and style tags). A 200-entry alphabetical list is not a picker, so
 * those tags become filters — one choice per dimension, five dropdowns, no
 * search box.
 *
 * Fix round 1 (2026-09-17): a first pass at VoicePicker's `facetRow()`
 * (Task 3's own brief) read/wrote every dimension through one `string |
 * undefined` cast, which silently dropped `useCase` and `style` — both typed
 * `string[]` in `VoiceFacetCriteria`, unlike the other three's `string |
 * null` — since neither fit that cast. That trimmed the filter from five
 * dimensions to three, which was never an approved design decision (the spec
 * only ever said "no search box"; five-dimension single-select came from
 * jiangzhuo reviewing the real distribution data). This file restores all
 * five and adds regression guards for the other two losses the same pass
 * introduced: the neutral option reading the field's own label ("Gender")
 * instead of its `any*` wording ("Any gender"), and facet VALUES rendering
 * as a bare humanized tag instead of going through the locale catalog.
 *
 * Rules that are not obvious and are the reason this file exists:
 *
 *  - Filtering narrows the PRESETS group only. Cloned voices carry no metadata
 *    (no provider publishes any), so a facet selection would sweep every one of
 *    them out of the list — hiding the user's own recordings behind a filter
 *    they set to explore the built-ins.
 *  - The selected voice is never filtered out. A row that named no visible
 *    option would read as "my voice is gone" rather than as "it does not
 *    match".
 *  - `useCase`/`style` criteria are one-element ARRAYS even though this
 *    control is single-select: `matchesVoiceFacets`'s `hasEvery` requires
 *    every listed tag to be present, and a voice's OWN style/useCase array
 *    may carry several, so picking one tag matches any voice that carries it
 *    among others.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import VoiceLibrarySection from './VoiceLibrarySection';
import type { VoiceEntry } from './VoiceLibrarySection';

// `t` is mocked to its English DEFAULT here, not the real catalog: every
// facet-value assertion below is therefore against `humanizeFacetValue`'s
// fallback text, not a real translation. That's deliberate and matches this
// file's pre-Task-6 precedent — proving the KEYED lookup itself reaches the
// real locale (as opposed to `humanizeFacetValue` alone) needs a REAL
// `react-i18next`, so that proof lives in VoicePicker.test.tsx instead
// ('translates a facet value via the locale catalog...'), and
// locales.consistency.test.ts is what pins that every facet value has a key
// in every catalog.
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

/** The neutral option's own text — must read "Any gender", not "Gender". */
const neutralOption = (name: string) => facet(name).querySelector('option[value=""]')?.textContent;

describe('VoiceLibrarySection facet filter', () => {
  beforeEach(() => cleanup());

  it('renders no filter bar unless the capability asks for one', () => {
    mount({ capability: { importModes: ['upload'] } });
    openPicker();
    expect(screen.queryByLabelText('Accent')).toBeNull();
    expect(rowNames('Presets')).toEqual(['Sakura', 'Yuto', 'Adrian']);
  });

  it('offers no search box — all five dimensions are the whole filter', () => {
    mount();
    openPicker();
    expect(screen.queryByRole('searchbox')).toBeNull();
    for (const dim of ['Gender', 'Age', 'Accent', 'Use case', 'Style']) {
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
    for (const dim of ['Gender', 'Age', 'Accent', 'Use case', 'Style']) {
      expect(facet(dim).classList.contains('select-dropdown')).toBe(true);
    }
  });

  it('gives the neutral option each dimension\'s own "Any …" wording, not its field label', () => {
    // Fix round 1: a first pass rendered the blank option as the field
    // label itself ("Gender"), which reads as if nothing had been chosen
    // FOR you rather than as the "no filter" state.
    mount();
    openPicker();
    expect(neutralOption('Gender')).toBe('Any gender');
    expect(neutralOption('Age')).toBe('Any age');
    expect(neutralOption('Accent')).toBe('Any accent');
    expect(neutralOption('Use case')).toBe('Any use case');
    expect(neutralOption('Style')).toBe('Any style');
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

  it('matches a voice on any one of the style tags it carries', () => {
    // Voices carry several style tags at once, so picking `calm` has to
    // reach a voice whose tags are ['deep', 'calm'], not only one tagged
    // calm alone — the array-criteria semantics `ARRAY_DIMS` exists for.
    mount({ selectedId: 'Sakura' });
    openPicker();
    fireEvent.change(facet('Style'), { target: { value: 'calm' } });
    expect(rowNames('Presets')).toEqual(['Sakura', 'Adrian']);
  });

  it('replaces the chosen style rather than adding to it', () => {
    mount({ selectedId: 'Adrian' });
    openPicker();
    fireEvent.change(facet('Style'), { target: { value: 'bright' } });
    expect(rowNames('Presets')).toEqual(['Sakura', 'Yuto', 'Adrian']); // Adrian is the selection
    fireEvent.change(facet('Style'), { target: { value: 'deep' } });
    expect(rowNames('Presets')).toEqual(['Adrian']);
  });

  it('picks one use case at a time', () => {
    mount({ selectedId: 'Adrian' });
    openPicker();
    fireEvent.change(facet('Use case'), { target: { value: 'conversational' } });
    expect(rowNames('Presets')).toEqual(['Yuto', 'Adrian']); // Adrian is the selection
    fireEvent.change(facet('Use case'), { target: { value: 'educational' } });
    expect(rowNames('Presets')).toEqual(['Sakura', 'Adrian']);
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
    fireEvent.change(facet('Style'), { target: { value: 'deep' } });
    fireEvent.change(facet('Use case'), { target: { value: 'narration' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(rowNames('Presets')).toEqual(['Sakura', 'Yuto', 'Adrian']);
    expect(facet('Accent').value).toBe('');
    expect(facet('Gender').value).toBe('');
    expect(facet('Style').value).toBe('');
    expect(facet('Use case').value).toBe('');
  });

  it('offers only the facet values its voices actually carry', () => {
    mount();
    openPicker();
    const optionsOf = (name: string) =>
      [...facet(name).querySelectorAll('option')].map((o) => o.textContent);
    // These are the humanized fallbacks, because `t` is mocked to its English
    // default here. The real labels come from the locale, and
    // locales.consistency.test.ts is what pins that every facet value has one.
    expect(optionsOf('Gender')).toEqual(['Any gender', 'Female', 'Male']);
    expect(optionsOf('Age')).toEqual(['Any age', 'Middle aged', 'Young']);
    expect(optionsOf('Accent')).toEqual(['Any accent', 'American', 'Japanese']);
    expect(optionsOf('Use case')).toEqual([
      'Any use case',
      'Conversational',
      'Educational',
      'Narration',
    ]);
    expect(optionsOf('Style')).toEqual(['Any style', 'Bright', 'Calm', 'Deep', 'Energetic']);
  });

  it('says so when a combination matches nothing but the selection, not the empty-roster hint', () => {
    // Fix round 1 addendum: the shipped section rendered `filter.empty` in
    // this spot; the picker's first pass showed nothing at all — narrowing
    // ~200 Soniox presets to zero would have left a silently empty list.
    // `emptyHint` ("No imported voices yet.") is a DIFFERENT message for a
    // different condition (the My Voices group having no clones), and must
    // not appear here instead.
    mount({ selectedId: 'Adrian' });
    openPicker();
    fireEvent.change(facet('Accent'), { target: { value: 'japanese' } });
    fireEvent.change(facet('Style'), { target: { value: 'deep' } });
    expect(within(grid()).getByText('No voices match these filters.')).toBeInTheDocument();
    expect(screen.queryByText('No imported voices yet.')).not.toBeInTheDocument();
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

  it('flags an unstable voice on its row, and leaves a stable one untagged', () => {
    // Fix round 1 addendum: the shipped section rendered `voiceLibrary.
    // unstable` on a flagged voice; Task 6's stylesheet notes said the class
    // "moved to the picker", but nothing ever rendered the tag there — the
    // class moved, the warning did not.
    const STABLE: VoiceEntry = { id: 'Stable', label: 'Stable', group: 'builtin', removable: false };
    const UNSTABLE: VoiceEntry = {
      id: 'Shaky', label: 'Shaky', group: 'builtin', removable: false, meta: { unstable: true },
    };
    render(
      <VoiceLibrarySection
        selectedId="Stable"
        onSelect={() => {}}
        onDelete={async () => {}}
        voices={[STABLE, UNSTABLE]}
        capability={{ importModes: ['upload'] }}
      />,
    );
    openPicker();
    // Scoped to the grid: "Stable" also appears on the trigger button (the
    // current selection's own label), which a bare `screen.getByText` would
    // match too.
    const stableRow = within(grid()).getByText('Stable').closest('[role="row"]') as HTMLElement;
    const unstableRow = within(grid()).getByText('Shaky').closest('[role="row"]') as HTMLElement;
    expect(within(unstableRow).getByText('unstable')).toBeInTheDocument();
    expect(within(stableRow).queryByText('unstable')).toBeNull();
  });
});
