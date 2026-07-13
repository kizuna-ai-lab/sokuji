import { describe, it, expect } from 'vitest';
import { checkModelFile, ModelFileValidationError } from './modelFileValidation';

describe('checkModelFile', () => {
  it('accepts a well-formed ONNX file with a matching size', () => {
    expect(() =>
      checkModelFile({
        filename: 'onnx/audio_encoder.onnx',
        size: 1000,
        expectedSizeBytes: 1000,
        head: new Uint8Array([0x08, 0x00, 0x12, 0x00]),
      }),
    ).not.toThrow();
  });

  it('rejects a file that is actually an HTML error page', () => {
    expect(() =>
      checkModelFile({
        filename: 'onnx/decoder.onnx',
        size: 500,
        expectedSizeBytes: 500,
        head: new Uint8Array([0x3c, 0x21, 0x64, 0x6f]), // '<!do…'
      }),
    ).toThrow(ModelFileValidationError);
    try {
      checkModelFile({ filename: 'x.onnx', size: 1, expectedSizeBytes: 1, head: new Uint8Array([0x3c]) });
    } catch (e) {
      expect((e as Error).message).toMatch(/HTML/i);
    }
  });

  it('rejects a size that deviates more than 20% from the expected size', () => {
    expect(() =>
      checkModelFile({
        filename: 'onnx/decoder.onnx',
        size: 500,
        expectedSizeBytes: 1000,
        head: new Uint8Array([0x08]),
      }),
    ).toThrow(/size/i);
  });

  it('accepts a size within 20% of the expected size', () => {
    expect(() =>
      checkModelFile({
        filename: 'onnx/decoder.onnx',
        size: 900,
        expectedSizeBytes: 1000,
        head: new Uint8Array([0x08]),
      }),
    ).not.toThrow();
  });

  it('skips the size check when expectedSizeBytes is 0', () => {
    expect(() =>
      checkModelFile({
        filename: 'onnx/decoder.onnx',
        size: 12345,
        expectedSizeBytes: 0,
        head: new Uint8Array([0x08]),
      }),
    ).not.toThrow();
  });

  it('accepts a WASM file with a valid magic number', () => {
    expect(() =>
      checkModelFile({
        filename: 'runtime.wasm',
        size: 100,
        expectedSizeBytes: 100,
        head: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
      }),
    ).not.toThrow();
  });

  it('rejects a WASM file with a bad magic number', () => {
    expect(() =>
      checkModelFile({
        filename: 'runtime.wasm',
        size: 100,
        expectedSizeBytes: 100,
        head: new Uint8Array([0x00, 0x00, 0x00, 0x00]),
      }),
    ).toThrow(/WASM/i);
  });

  it('rejects an ONNX file missing the protobuf prefix', () => {
    expect(() =>
      checkModelFile({
        filename: 'model.onnx',
        size: 100,
        expectedSizeBytes: 100,
        head: new Uint8Array([0xff, 0x00, 0x00, 0x00]),
      }),
    ).toThrow(/ONNX/i);
  });

  it('rejects a JSON file whose text is not parseable', () => {
    expect(() =>
      checkModelFile({
        filename: 'config.json',
        size: 10,
        expectedSizeBytes: 10,
        head: new Uint8Array([0x7b]), // '{'
        text: '{ not valid json',
      }),
    ).toThrow(/JSON/i);
  });

  it('accepts a JSON file whose text parses', () => {
    expect(() =>
      checkModelFile({
        filename: 'config.json',
        size: 10,
        expectedSizeBytes: 10,
        head: new Uint8Array([0x7b]),
        text: '{"ok": true}',
      }),
    ).not.toThrow();
  });
});
