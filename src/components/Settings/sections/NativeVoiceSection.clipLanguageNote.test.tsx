/**
 * The Add-a-voice dialog of a native clone-only card whose clones only work from a clip in the
 * language it will speak (FireRedTTS-3 Base) says so. The mock answers by KEY, so the
 * assertions fail if the code reads another key or none: the suites' default `t` returns the
 * fallback for every key and cannot see this.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const NOTE_KEY = 'voiceLibrary.clipInTargetLanguage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, def?: string) => (key === NOTE_KEY ? `[${key}]` : def ?? key),
  }),
}));

vi.mock('../../../lib/local-inference/native/nativePreviewTts', () => ({
  createPreviewTts: vi.fn(),
}));

import NativeVoiceSection from './NativeVoiceSection';
import { voiceStoreFor } from '../../../lib/local-inference/native/nativeVoiceStores';

const props = {
  capability: { builtin: 'none' as const, custom: 'clip' as const, transcriptRequired: true },
  builtinVoices: [],
  selected: '',
  targetLanguage: 'ja',
  ttsLanguages: ['ja'],
  isSessionActive: false,
  onSelect: vi.fn(),
  onCustomChanged: vi.fn(),
};

function openAddVoiceDialog(ttsModelId: string) {
  render(
    <NativeVoiceSection {...props} ttsModelId={ttsModelId} store={voiceStoreFor('clip', ttsModelId)} />,
  );
  fireEvent.click(screen.getByRole('button', { expanded: false }));
  fireEvent.click(screen.getByRole('button', { name: /add a voice/i }));
  return screen.getByRole('dialog', { name: /add a voice/i });
}

beforeEach(() => { vi.clearAllMocks(); cleanup(); });

describe('NativeVoiceSection clip-language note', () => {
  it("shows FireRedTTS-3 Base's note inside the Add-a-voice dialog", () => {
    const dialog = openAddVoiceDialog('fireredtts3-base');
    const note = screen.getByText(`[${NOTE_KEY}]`);
    expect(dialog).toContainElement(note);
    expect(note).toHaveClass('voice-create-modal__note');
  });

  it('shows no such note for another clone-only card', () => {
    const dialog = openAddVoiceDialog('omnivoice-0.6b');
    expect(dialog.querySelector('.voice-create-modal__note')).toBeNull();
    expect(screen.queryByText(`[${NOTE_KEY}]`)).toBeNull();
  });
});
