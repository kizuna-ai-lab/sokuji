import { describe, it, expect } from 'vitest';
import { formatBytes, sanitizeEvent } from './sanitizeEvent';

describe('formatBytes', () => {
  it('formats bytes under 1024 as B', () => {
    expect(formatBytes(0)).toBe('0B');
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(1023)).toBe('1023B');
  });

  it('formats bytes in KB range', () => {
    expect(formatBytes(1024)).toBe('1.0KB');
    expect(formatBytes(1536)).toBe('1.5KB');
    expect(formatBytes(46080)).toBe('45.0KB');
  });

  it('formats bytes in MB range', () => {
    expect(formatBytes(1048576)).toBe('1.0MB');
    expect(formatBytes(2621440)).toBe('2.5MB');
  });
});

describe('sanitizeEvent', () => {
  describe('Layer 1: structure-aware detection (Gemini)', () => {
    it('replaces inlineData.data when mimeType is audio', () => {
      const event = {
        type: 'serverContent.modelTurn',
        data: {
          parts: [
            {
              inlineData: {
                mimeType: 'audio/pcm;rate=24000',
                data: 'A'.repeat(61440), // ~45KB base64
              },
            },
          ],
        },
      };
      const result = sanitizeEvent(event);
      expect(result.data.parts[0].inlineData.data).toBe('<audio:45.0KB>');
      expect(result.data.parts[0].inlineData.mimeType).toBe('audio/pcm;rate=24000');
    });

    it('preserves text and thought parts alongside audio parts', () => {
      const event = {
        type: 'serverContent.modelTurn',
        data: {
          parts: [
            { text: 'Translating Russian to German', thought: true },
            {
              inlineData: {
                mimeType: 'audio/pcm;rate=24000',
                data: 'B'.repeat(2560),
              },
            },
          ],
        },
      };
      const result = sanitizeEvent(event);
      expect(result.data.parts[0].text).toBe('Translating Russian to German');
      expect(result.data.parts[0].thought).toBe(true);
      expect(result.data.parts[1].inlineData.data).toBe('<audio:1.9KB>');
    });

    it('does not apply audio placeholder when mimeType is not audio', () => {
      const event = {
        inlineData: {
          mimeType: 'image/png',
          data: 'C'.repeat(500), // long base64, but not audio mimeType
        },
      };
      const result = sanitizeEvent(event);
      // Layer 1 does NOT trigger (not audio mimeType)
      // But Layer 2 catches the long base64 string
      expect(result.inlineData.data).toBe(`<base64:${formatBytes(Math.ceil(500 * 3 / 4))}>`);
    });
  });

  describe('Layer 2: generic base64 detection', () => {
    it('strips long base64 string in OpenAI audio delta field', () => {
      const event = {
        type: 'response.audio.delta',
        delta: 'AAAA'.repeat(200), // 800 chars of base64
      };
      const result = sanitizeEvent(event);
      expect(result.delta).toBe(`<base64:${formatBytes(Math.ceil(800 * 3 / 4))}>`);
      expect(result.type).toBe('response.audio.delta');
    });

    it('preserves text in OpenAI text delta field', () => {
      const event = {
        type: 'response.text.delta',
        delta: 'This is a normal text translation output that should not be stripped.',
      };
      const result = sanitizeEvent(event);
      expect(result.delta).toBe('This is a normal text translation output that should not be stripped.');
    });

    it('strips deeply nested base64 string', () => {
      const event = {
        level1: {
          level2: {
            level3: {
              payload: 'QUFB'.repeat(100), // 400 chars base64
            },
          },
        },
      };
      const result = sanitizeEvent(event);
      expect(result.level1.level2.level3.payload).toBe(
        `<base64:${formatBytes(Math.ceil(400 * 3 / 4))}>`
      );
    });

    it('does not strip short base64-like strings under 200 chars', () => {
      const event = {
        token: 'eyJhbGciOiJIUzI1NiJ9', // short JWT-like, 20 chars
      };
      const result = sanitizeEvent(event);
      expect(result.token).toBe('eyJhbGciOiJIUzI1NiJ9');
    });

    it('does not strip long strings that are not base64', () => {
      const longText = 'Hello world. This is a long human-readable sentence. '.repeat(10);
      const event = { description: longText };
      const result = sanitizeEvent(event);
      expect(result.description).toBe(longText);
    });

    it('strips base64 string passed as top-level primitive', () => {
      const base64Str = 'QUFBQQ=='.repeat(50); // 400 chars
      const result = sanitizeEvent(base64Str);
      expect(result).toBe(`<base64:${formatBytes(Math.ceil(400 * 3 / 4))}>`);
    });
  });

  describe('Layer 3: field-name rules', () => {
    it('strips long string in known audio field', () => {
      const event = {
        type: 'output_audio_data',
        audio: 'D'.repeat(300), // 300 chars in "audio" field
      };
      const result = sanitizeEvent(event);
      expect(result.audio).toBe(`<audio:${formatBytes(Math.ceil(300 * 3 / 4))}>`);
      expect(result.type).toBe('output_audio_data');
    });

    it('strips large array in known audio field', () => {
      const event = {
        pcmData: new Array(2000).fill(0),
      };
      const result = sanitizeEvent(event);
      expect(result.pcmData).toBe(`<binary:${formatBytes(2000 * 4)}>`);
    });

    it('preserves short values in known audio fields', () => {
      const event = {
        audio: 'ok',
        pcm: 42,
      };
      const result = sanitizeEvent(event);
      expect(result.audio).toBe('ok');
      expect(result.pcm).toBe(42);
    });
  });

  describe('passthrough and edge cases', () => {
    it('passes through events with no audio data unchanged', () => {
      const event = {
        type: 'session.created',
        data: { status: 'connected', provider: 'gemini', model: 'gemini-2.5-flash' },
      };
      const result = sanitizeEvent(event);
      expect(result).toEqual(event);
    });

    it('passes through null and undefined', () => {
      expect(sanitizeEvent(null)).toBeNull();
      expect(sanitizeEvent(undefined)).toBeUndefined();
    });

    it('passes through numbers and booleans', () => {
      expect(sanitizeEvent(42)).toBe(42);
      expect(sanitizeEvent(true)).toBe(true);
    });

    it('handles ArrayBuffer at top level', () => {
      const buf = new ArrayBuffer(1024);
      const result = sanitizeEvent(buf);
      expect(result).toBe('<binary:1.0KB>');
    });

    it('handles TypedArray at top level', () => {
      const arr = new Int16Array(512); // 1024 bytes
      const result = sanitizeEvent(arr);
      expect(result).toBe('<binary:1.0KB>');
    });
  });
});
