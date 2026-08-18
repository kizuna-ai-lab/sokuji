import { describe, it, expect } from 'vitest';
import { isVirtualDevice, isVirtualMic, isVirtualSpeaker, isLoopbackInput } from './audioDevices';

const d = (label: string) => ({ label });

describe('isVirtualMic', () => {
  it('matches Sokuji virtual devices and VB-Cable', () => {
    expect(isVirtualMic(d('Sokuji_Virtual_Mic'))).toBe(true);
    expect(isVirtualMic(d('SokujiVirtualAudio'))).toBe(true);
    expect(isVirtualMic(d('CABLE Output (VB-Audio Virtual Cable)'))).toBe(true);
  });

  it('matches the monitor of Sokuji virtual speaker', () => {
    // PulseAudio exposes the sink monitor as "Monitor of <description>". That
    // monitor carries Sokuji's own TTS verbatim, so selecting it as the mic is
    // a guaranteed feedback loop — it must warn (and never be auto-picked).
    expect(isVirtualMic(d('Monitor of Sokuji_Virtual_Speaker'))).toBe(true);
    expect(isVirtualMic(d('sokuji_virtual_speaker.monitor'))).toBe(true);
  });

  it('leaves real microphones alone', () => {
    expect(isVirtualMic(d('Built-in Microphone'))).toBe(false);
    expect(isVirtualMic(d('USB Microphone (Blue Yeti)'))).toBe(false);
  });
});

describe('isLoopbackInput', () => {
  it('matches OS loopback-style inputs', () => {
    expect(isLoopbackInput(d('Stereo Mix (Realtek High Definition Audio)'))).toBe(true);
    expect(isLoopbackInput(d('What U Hear (Sound Blaster Z)'))).toBe(true);
    expect(isLoopbackInput(d('What You Hear (Sound Blaster)'))).toBe(true);
    expect(isLoopbackInput(d('Wave Out Mix (C-Media Audio)'))).toBe(true);
    expect(isLoopbackInput(d('VoiceMeeter Output (VB-Audio VoiceMeeter VAIO)'))).toBe(true);
    expect(isLoopbackInput(d('Monitor of Built-in Audio Analog Stereo'))).toBe(true);
  });

  it('is prefix-only for "monitor of" so product names are not caught', () => {
    // A device merely containing the words is not a PulseAudio sink monitor.
    expect(isLoopbackInput(d('ASUS Monitor of Doom USB Audio'))).toBe(false);
  });

  it('never matches plain "mix" or other legitimate device names', () => {
    // "mix" alone appears in mixer hardware people record with.
    expect(isLoopbackInput(d('MixPre-3 II USB Audio'))).toBe(false);
    expect(isLoopbackInput(d('USB Studio Mixer'))).toBe(false);
    expect(isLoopbackInput(d('Built-in Microphone'))).toBe(false);
    expect(isLoopbackInput(d('Headset Microphone (Jabra)'))).toBe(false);
  });

  it('is disjoint from Sokuji virtual-device detection for real mics', () => {
    // Both predicates must stay quiet on an ordinary microphone.
    const real = d('Built-in Microphone');
    expect(isVirtualDevice(real) || isVirtualMic(real) || isVirtualSpeaker(real) || isLoopbackInput(real)).toBe(false);
  });
});
