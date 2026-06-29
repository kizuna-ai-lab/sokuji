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
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  });
});
