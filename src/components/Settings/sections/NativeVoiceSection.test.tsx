/**
 * Tests for NativeVoiceSection — the native adapter over the generalized
 * VoiceLibrarySection. It maps MOSS built-in + custom voices to VoiceEntry[],
 * writes `ttsVoice` on select, and owns capture: it validates a recorded clip
 * (Task 11) / decodes an uploaded file and persists via addNativeVoice, then
 * refreshes the parent list. Rejected clips never reach storage.
 *
 * VoiceLibrarySection is mocked to a thin harness so we can drive its
 * onSelect / onRecord / onImport callbacks deterministically in jsdom (the real
 * recorder + AudioContext.decodeAudioData don't run there). VoiceLibrarySection's
 * own rendering is covered by VoiceLibrarySection.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NativeVoiceSection, { validateVoiceClip } from './NativeVoiceSection';
import { addNativeVoice } from '../../../lib/local-inference/nativeVoiceStorage';

vi.mock('../../../lib/local-inference/nativeVoiceStorage', () => ({
  addNativeVoice: vi.fn().mockResolvedValue({ id: 1 }),
}));

// Captures the capability the adapter passes down, so we can assert the unified
// dropdown presentation + record/upload import without rendering the real component.
let lastCapability: any = null;

// Thin harness: renders selectable voices and exposes capture triggers.
vi.mock('./VoiceLibrarySection', () => ({
  __esModule: true,
  default: ({ voices, onSelect, onRecord, onImport, capability }: any) => {
    lastCapability = capability;
    return (
      <div>
        {voices.map((v: any) => (
          <button key={v.id} onClick={() => onSelect(v.id)}>{v.label}</button>
        ))}
        <button onClick={() => onRecord(new Float32Array(8000), 16000)}>rec-short</button>
        <button onClick={() => onRecord(new Float32Array(16000 * 5).fill(0.3), 16000)}>rec-ok</button>
        <button onClick={() => onImport(new File([new Uint8Array(8)], 'voice.wav'))}>import-bad</button>
      </div>
    );
  },
}));

const baseProps = {
  builtinVoices: [
    { name: 'Ava', language: 'en', curated: true, unstable: false, default: true },
    { name: 'Bella', language: 'en', curated: true, unstable: false, default: false },
    { name: 'Adam', language: 'en', curated: false, unstable: true, default: false },
  ],
  customVoices: [],
  selected: 'builtin:Ava',
  targetLanguage: 'en',
  isSessionActive: false,
  onSelect: vi.fn(),
  onCaptured: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
};

describe('validateVoiceClip', () => {
  it('rejects too-short, too-long, and silent clips; accepts a valid one', () => {
    expect(validateVoiceClip(new Float32Array(16000).fill(0.3), 16000)).toBe('too_short'); // 1s
    expect(validateVoiceClip(new Float32Array(16000 * 25).fill(0.3), 16000)).toBe('too_long'); // 25s
    expect(validateVoiceClip(new Float32Array(16000 * 5), 16000)).toBe('silent'); // 5s of zeros
    expect(validateVoiceClip(new Float32Array(16000 * 5).fill(0.3), 16000)).toBeNull();
  });
});

describe('NativeVoiceSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists builtin voices and writes ttsVoice on select', () => {
    const onSelect = vi.fn();
    render(<NativeVoiceSection {...baseProps} onSelect={onSelect} />);
    expect(screen.getByText('Ava')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Bella'));
    expect(onSelect).toHaveBeenCalledWith('builtin:Bella');
  });

  it('uses the unified dropdown presentation with record + upload import (audio)', () => {
    render(<NativeVoiceSection {...baseProps} />);
    expect(lastCapability.presentation).toBe('dropdown');
    expect(lastCapability.importModes).toEqual(['record', 'upload']);
    expect(lastCapability.accept).toBe('audio/*');
  });

  it('rejects a too-short recording without storing it and surfaces an error', async () => {
    const onCaptured = vi.fn();
    render(<NativeVoiceSection {...baseProps} onCaptured={onCaptured} />);
    fireEvent.click(screen.getByText('rec-short'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(addNativeVoice).not.toHaveBeenCalled();
    expect(onCaptured).not.toHaveBeenCalled();
  });

  it('stores a valid recording and refreshes the list', async () => {
    const onCaptured = vi.fn();
    render(<NativeVoiceSection {...baseProps} onCaptured={onCaptured} />);
    fireEvent.click(screen.getByText('rec-ok'));
    await waitFor(() => expect(addNativeVoice).toHaveBeenCalledTimes(1));
    expect(addNativeVoice).toHaveBeenCalledWith(expect.any(String), expect.any(Float32Array), 16000);
    expect(onCaptured).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces a message when an uploaded file cannot be decoded (no store)', async () => {
    // jsdom has no AudioContext.decodeAudioData → the import path fails gracefully.
    render(<NativeVoiceSection {...baseProps} />);
    fireEvent.click(screen.getByText('import-bad'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(addNativeVoice).not.toHaveBeenCalled();
  });

  it('renders a speaker-id slider for a range model and writes sid:<n>', () => {
    const onSelect = vi.fn();
    render(<NativeVoiceSection {...baseProps} shape="range" numSpeakers={904}
      selected="sid:3" onSelect={onSelect} builtinVoices={[]} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('max', '903');
    fireEvent.change(slider, { target: { value: '7' } });
    expect(onSelect).toHaveBeenCalledWith('sid:7');
  });

  it('renders nothing for a single-voice model', () => {
    const { container } = render(<NativeVoiceSection {...baseProps} shape="none" numSpeakers={1} builtinVoices={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
