// "Audio" is partly locked during a session. What each section is told; the
// sections' own locked rows are their own tests' business.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const props = vi.hoisted(() => ({} as Record<string, Record<string, unknown>>));
vi.mock('../Settings/sections/AudioDeviceSection', () => ({ default: (p: Record<string, unknown>) => { props.microphone = p; return null; } }));
vi.mock('../Settings/sections/SpeechOutputSection', () => ({ default: (p: Record<string, unknown>) => { props.speech = p; return null; } }));
vi.mock('../Settings/sections/SystemAudioSection', () => ({ default: (p: Record<string, unknown>) => { props.participant = p; return null; } }));
vi.mock('./AudioModeSwitch', () => ({ AudioModeSwitch: (p: Record<string, unknown>) => { props.mode = p; return null; } }));
vi.mock('./ModelsPage', () => ({ ModelsPage: () => null }));

import { AudioCategory } from './DeviceCategories';
import useAudioStore from '../../stores/audioStore';

afterEach(() => cleanup());

describe('audio during a session: partly locked', () => {
  it('in "Me" mode the mode is locked but the microphone stays changeable', () => {
    useAudioStore.setState({ mode: 'speaker' });
    render(<AudioCategory locked />);
    expect(props.mode).toMatchObject({ locked: true });
    expect(props.microphone).toMatchObject({ isSessionActive: true, isLocked: false });
    expect(props.speech).toMatchObject({ isSessionActive: true });
  });

  it('in "Other" mode the microphone is locked too', () => {
    useAudioStore.setState({ mode: 'participant' });
    render(<AudioCategory locked />);
    expect(props.microphone).toMatchObject({ isSessionActive: true, isLocked: true });
    expect(props.participant).toMatchObject({ isSessionActive: true, isLocked: false });
  });

  it('once the session stops nothing is locked by it', () => {
    useAudioStore.setState({ mode: 'participant' });
    const { rerender } = render(<AudioCategory locked />);
    rerender(<AudioCategory locked={false} />);
    expect(props.mode).toMatchObject({ locked: false });
    expect(props.microphone).toMatchObject({ isSessionActive: false, isLocked: false });
    expect(props.speech).toMatchObject({ isSessionActive: false });
    expect(props.participant).toMatchObject({ isSessionActive: false });
    expect(useAudioStore.getState().mode).toBe('participant');
  });
});
