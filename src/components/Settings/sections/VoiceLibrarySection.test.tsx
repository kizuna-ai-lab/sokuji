/**
 * Tests for the capability-driven VoiceLibrarySection (Task 9).
 *
 * The component is now provider-agnostic: it consumes a normalized
 * `VoiceEntry[]` + `VoiceLibraryCapability` model and treats `id` as opaque.
 * These two render tests are the only automated safety net for the refactor,
 * so they exercise real rendering (no mocks of the component itself):
 *   1. Capability allowing `record` shows a Record button and renders both the
 *      built-in and custom voice groups.
 *   2. Supertonic capability (`upload` only) hides the Record button.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import VoiceLibrarySection from './VoiceLibrarySection';

const base = {
  selectedId: 'builtin:Ava',
  onSelect: () => {},
  onRename: async () => {},
  onDelete: async () => {},
  onImport: async () => {},
};

describe('VoiceLibrarySection', () => {
  it('renders builtin + custom groups and a record button when capability allows', () => {
    render(
      <VoiceLibrarySection
        {...base}
        voices={[
          { id: 'builtin:Ava', label: 'Ava', group: 'builtin', removable: false, meta: { curated: true } },
          { id: 'custom:1', label: 'Mine', group: 'custom', removable: true },
        ]}
        capability={{ importModes: ['record', 'upload'], curation: true }}
        onRecord={async () => {}}
      />,
    );
    expect(screen.getByText('Ava')).toBeInTheDocument();
    expect(screen.getByText('Mine')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record/i })).toBeInTheDocument();
  });

  it('hides the record button when record is not an import mode (Supertonic)', () => {
    render(
      <VoiceLibrarySection
        {...base}
        selectedId="preset:0"
        voices={[{ id: 'preset:0', label: 'Sarah', group: 'builtin', removable: false }]}
        capability={{ importModes: ['upload'], curation: false }}
      />,
    );
    expect(screen.queryByRole('button', { name: /record/i })).toBeNull();
    // List mode (default): selection is rendered as buttons, not a <select>.
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('renders a dropdown with optgroups and fires onSelect on change (Supertonic)', () => {
    const onSelect = vi.fn();
    render(
      <VoiceLibrarySection
        {...base}
        selectedId="preset:0"
        onSelect={onSelect}
        voices={[
          { id: 'preset:0', label: 'Sarah', group: 'builtin', removable: false, meta: { gender: 'F' } },
          { id: 'custom:1', label: 'Mine', group: 'custom', removable: true },
        ]}
        capability={{ importModes: ['upload'], curation: false, presentation: 'dropdown' }}
      />,
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select).toBeInTheDocument();

    // Built-in entries under "Presets", custom entries under "My Voices".
    const presets = within(select).getByRole('group', { name: 'Presets' });
    expect(within(presets).getByRole('option', { name: 'Sarah (F)' })).toBeInTheDocument();
    const myVoices = within(select).getByRole('group', { name: 'My Voices' });
    expect(within(myVoices).getByRole('option', { name: 'Mine' })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'custom:1' } });
    expect(onSelect).toHaveBeenCalledWith('custom:1');
  });

  it('transcriptRequired gates import behind a non-empty transcript', async () => {
    const onImport = vi.fn();
    render(<VoiceLibrarySection voices={[]} selectedId="" onSelect={() => {}}
      onImport={onImport} onRename={async () => {}} onDelete={async () => {}}
      capability={{ importModes: ['upload'], curation: false, presentation: 'dropdown', transcriptRequired: true }} />);
    // manage details open → import button disabled while transcript empty
    fireEvent.click(screen.getByText(/manage imported voices/i));
    const btn = screen.getByRole('button', { name: /import voice/i });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/transcript/i), { target: { value: 'what the clip says' } });
    expect(btn).not.toBeDisabled();
  });
});

// Recording resources live only in a ref; the teardown effect must release
// the microphone both on unmount and when the settings panel hides inside
// its <Activity> boundary (effects unmount on hide).
describe('VoiceLibrarySection recording teardown under Activity hide', () => {
  it('stops the capture graph when the panel hides mid-recording', async () => {
    const { Activity } = await import('react');
    const { waitFor } = await import('@testing-library/react');

    const stopTrack = vi.fn();
    const gum = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: gum },
    });
    const closeCtx = vi.fn(async () => {});
    const disconnectSource = vi.fn();
    const disconnectProcessor = vi.fn();
    class FakeAudioContext {
      sampleRate = 48000;
      destination = {};
      createMediaStreamSource() { return { connect: vi.fn(), disconnect: disconnectSource }; }
      createScriptProcessor() { return { connect: vi.fn(), disconnect: disconnectProcessor, onaudioprocess: null }; }
      close = closeCtx;
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);

    try {
      const ui = (mode: 'visible' | 'hidden') => (
        <Activity mode={mode}>
          <VoiceLibrarySection
            {...base}
            voices={[{ id: 'builtin:Ava', label: 'Ava', group: 'builtin', removable: false }]}
            capability={{ importModes: ['record', 'upload'], curation: true }}
            onRecord={async () => {}}
          />
        </Activity>
      );
      const { rerender } = render(ui('visible'));
      fireEvent.click(screen.getByRole('button', { name: /record/i }));
      await waitFor(() => expect(gum).toHaveBeenCalled());

      rerender(ui('hidden'));
      expect(stopTrack).toHaveBeenCalled();
      expect(closeCtx).toHaveBeenCalled();
      expect(disconnectProcessor).toHaveBeenCalled();
      expect(disconnectSource).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
