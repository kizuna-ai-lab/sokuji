/**
 * Tests for NativeVoiceSection (Task 10) — the native adapter that renders the
 * generalized VoiceLibrarySection for MOSS voices (built-in + custom) and writes
 * `ttsVoice` on select. Built-in entries are curated-first (the rest behind the
 * "show all" expander); custom entries are passed through (capture lands in Task 11).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NativeVoiceSection from './NativeVoiceSection';

describe('NativeVoiceSection', () => {
  it('lists curated builtin voices and writes ttsVoice on select', () => {
    const onChange = vi.fn();
    render(<NativeVoiceSection builtinVoices={['Ava', 'Bella', 'Adam']} customVoices={[]}
      selected='builtin:Ava' targetLanguage='en' isSessionActive={false}
      onSelect={onChange} onImport={async () => {}} onRecord={async () => {}}
      onRename={async () => {}} onDelete={async () => {}} />);
    expect(screen.getByText('Ava')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Bella'));
    expect(onChange).toHaveBeenCalledWith('builtin:Bella');
  });
});
