/**
 * The generated protobuf codec in its home (F18): the messages this provider
 * speaks round-trip through it.
 */
import { describe, it, expect } from 'vitest';
import { data as moved } from './proto/ast2-proto.js';

const { TranslateRequest, TranslateResponse } = moved.speech.ast;
const Type = moved.speech.event.Type;

describe("Doubao AST 2.0's codec (F18)", () => {
  it('names its events both ways', () => {
    expect(Type.StartSession).toBe(100);
    expect(Type.SessionStarted).toBe(150);
    expect(Type.TranslationSubtitleEnd).toBe(655);
    expect((Type as unknown as Record<number, string>)[352]).toBe('TTSResponse');
  });

  it('round-trips a StartSession', () => {
    const bytes = TranslateRequest.encode({
      requestMeta: { Endpoint: 'volc.service_type.10053', SessionID: 's1', ConnectionID: 'c1', Sequence: 0 },
      event: Type.StartSession,
      sourceAudio: { format: 'pcm', rate: 16000, bits: 16, channel: 1 },
      request: { mode: 's2t', sourceLanguage: 'zh', targetLanguage: 'en', corpus: { boostingTableId: 'hot-1' } },
    }).finish();
    const back = TranslateRequest.decode(bytes);
    expect(back.event).toBe(Type.StartSession);
    expect(back.requestMeta).toMatchObject({ Endpoint: 'volc.service_type.10053', SessionID: 's1', ConnectionID: 'c1' });
    expect(back.sourceAudio).toMatchObject({ format: 'pcm', rate: 16000, bits: 16, channel: 1 });
    expect(back.request).toMatchObject({ mode: 's2t', sourceLanguage: 'zh', targetLanguage: 'en', corpus: { boostingTableId: 'hot-1' } });
  });

  it('round-trips a subtitle and a spoken chunk', () => {
    const subtitle = TranslateResponse.decode(TranslateResponse.encode({
      responseMeta: { SessionID: 's1', Sequence: 3, StatusCode: 20000000 },
      event: Type.SourceSubtitleResponse,
      text: '你好',
      startTime: 10,
      endTime: 900,
    }).finish());
    expect(subtitle).toMatchObject({ event: Type.SourceSubtitleResponse, text: '你好', startTime: 10, endTime: 900 });
    expect(subtitle.responseMeta).toMatchObject({ SessionID: 's1', Sequence: 3, StatusCode: 20000000 });

    const chunk = TranslateResponse.decode(TranslateResponse.encode({ event: Type.TTSResponse, data: new Uint8Array([1, 2, 3]) }).finish());
    expect(Array.from(chunk.data)).toEqual([1, 2, 3]);
  });
});
