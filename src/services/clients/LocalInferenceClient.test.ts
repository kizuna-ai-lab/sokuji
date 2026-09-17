import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';

vi.mock('../../locales', () => ({ default: { t: (key: string) => key } }));

// Shared mutable state the mock factories below close over. vi.mock factories
// are hoisted above regular imports, so anything they reference must be
// created through vi.hoisted() rather than a plain top-level const.
const hoisted = vi.hoisted(() => ({
  manifestEntries: new Map<string, { type: 'asr' | 'asr-stream'; asrEngine?: string }>(),
  streamingInstances: [] as any[],
  offlineInstances: [] as any[],
}));

vi.mock('../../lib/local-inference/modelManifest', () => ({
  getManifestEntry: (id: string) => hoisted.manifestEntries.get(id),
}));

vi.mock('../../lib/local-inference/engine/StreamingAsrEngine', () => {
  class FakeStreamingAsrEngine {
    onResult: any = null;
    onPartialResult: any = null;
    onSpeechStart: any = null;
    onError: any = null;
    init = vi.fn().mockResolvedValue({ loadTimeMs: 1 });
    dispose = vi.fn();
    feedAudio = vi.fn();
    flush = vi.fn();
    constructor() { hoisted.streamingInstances.push(this); }
  }
  return { StreamingAsrEngine: FakeStreamingAsrEngine };
});

vi.mock('../../lib/local-inference/engine/AsrEngine', () => {
  class FakeAsrEngine {
    onResult: any = null;
    onPartialResult: any = null;
    onSpeechStart: any = null;
    onError: any = null;
    init = vi.fn().mockResolvedValue({ loadTimeMs: 1 });
    dispose = vi.fn();
    feedAudio = vi.fn();
    flush = vi.fn();
    constructor() { hoisted.offlineInstances.push(this); }
  }
  return { AsrEngine: FakeAsrEngine };
});

vi.mock('../../lib/local-inference/engine/TranslationEngine', () => {
  class FakeTranslationEngine {
    init = vi.fn().mockResolvedValue({ loadTimeMs: 1, device: 'cpu' });
    translate = vi.fn().mockResolvedValue({ translatedText: 'T', inferenceTimeMs: 1 });
    dispose = vi.fn();
  }
  return { TranslationEngine: FakeTranslationEngine };
});

vi.mock('../../lib/local-inference/engine/TtsEngine', () => {
  class FakeTtsEngine {
    init = vi.fn();
    generate = vi.fn();
    generateStream = vi.fn();
    dispose = vi.fn();
    get numSpeakers() { return 0; }
    get sampleRate() { return 0; }
  }
  return { TtsEngine: FakeTtsEngine };
});

import { LocalInferenceClient } from './LocalInferenceClient';

function setManifest(entries: Record<string, { type: 'asr' | 'asr-stream'; asrEngine?: string }>) {
  hoisted.manifestEntries.clear();
  for (const [id, entry] of Object.entries(entries)) hoisted.manifestEntries.set(id, entry);
}

function fakeRuntime(enabled = true): SegmentationRuntime {
  return { enabled, punctuate: vi.fn(async () => null) };
}

function makeClient(options: { segmentation?: SegmentationRuntime | null; sentencesPerChunk?: number } = {}) {
  return new LocalInferenceClient(options);
}

/** Let any already-scheduled async pipeline work (processQueue's deferred
 *  continuation past its `await`) settle before asserting on it. */
async function settle() {
  await new Promise((r) => setTimeout(r, 0));
}

const STREAM_CONFIG: any = {
  provider: 'local_inference', model: 'local', sourceLanguage: 'en', targetLanguage: 'ja',
  asrModelId: 'stream-model', ttsSpeakerId: 0, ttsSpeed: 1.0,
};

const OFFLINE_CONFIG: any = {
  provider: 'local_inference', model: 'local', sourceLanguage: 'en', targetLanguage: 'ja',
  asrModelId: 'offline-model', ttsSpeakerId: 0, ttsSpeed: 1.0,
};

describe('LocalInferenceClient sentence segmentation', () => {
  beforeEach(() => {
    hoisted.manifestEntries.clear();
    hoisted.streamingInstances.length = 0;
    hoisted.offlineInstances.length = 0;
  });

  it('a long streaming utterance seals every N sentences and enqueues jobs in order', async () => {
    setManifest({ 'stream-model': { type: 'asr-stream', asrEngine: 'sensevoice' } });
    const runtime = fakeRuntime(true);
    const client = makeClient({ segmentation: runtime, sentencesPerChunk: 1 });

    const items: Array<{ role: string; status: string; text?: string }> = [];
    client.setEventHandlers({
      onConversationUpdated: ({ item }) => items.push({ role: item.role, status: item.status, text: item.formatted?.transcript }),
    });
    await client.connect(STREAM_CONFIG);

    const jobSpy = vi.spyOn(client as any, 'processPipelineJob');
    const engine = hoisted.streamingInstances[0];

    // A streaming ASR's onPartialResult delivers the CUMULATIVE hypothesis
    // for the whole utterance so far, not a delta (confirmed against
    // sherpa-onnx-streaming-asr.worker.js — getResult() only resets on
    // endpoint). Each step below reveals one more sentence's worth of
    // right-context for the previous sentence end.
    const raw1 = 'Sentence one is done. Sentence two begins';
    engine.onPartialResult(raw1);
    await settle();
    // Job 1 has already been dispatched (recorded) before partial 2 is even
    // fed below — the queue is drained per-seal, not batched at the end.
    expect(jobSpy.mock.calls.length).toBe(1);

    const raw2 = 'Sentence one is done. Sentence two begins now yes. Sentence three starts';
    engine.onPartialResult(raw2);
    await settle();
    expect(jobSpy.mock.calls.length).toBe(2);

    const raw3 = 'Sentence one is done. Sentence two begins now yes. Sentence three starts and ends well. Tail padding here';
    engine.onPartialResult(raw3);
    await settle();
    expect(jobSpy.mock.calls.length).toBe(3);

    const jobTexts = jobSpy.mock.calls.map((c) => (c[0] as any).text.trim());
    expect(jobTexts).toEqual([
      'Sentence one is done.',
      'Sentence two begins now yes.',
      'Sentence three starts and ends well.',
    ]);

    const completedUser = items.filter((i) => i.role === 'user' && i.status === 'completed');
    expect(completedUser.map((i) => i.text!.trim())).toEqual([
      'Sentence one is done.',
      'Sentence two begins now yes.',
      'Sentence three starts and ends well.',
    ]);
  });

  it('an offline final of six sentences gives two items and two jobs at N=3', async () => {
    setManifest({ 'offline-model': { type: 'asr', asrEngine: 'whisper' } });
    const runtime = fakeRuntime(true);
    const client = makeClient({ segmentation: runtime, sentencesPerChunk: 3 });
    const items: Array<{ role: string; status: string; text?: string }> = [];
    client.setEventHandlers({
      onConversationUpdated: ({ item }) => items.push({ role: item.role, status: item.status, text: item.formatted?.transcript }),
    });
    await client.connect(OFFLINE_CONFIG);
    const jobSpy = vi.spyOn(client as any, 'processPipelineJob');

    const sixSentences = 'One is done. Two is done. Three is done. Four is done. Five is done. Six is done and finished well.';
    (client as any).handleAsrResult(sixSentences);
    await settle();

    expect(jobSpy.mock.calls.length).toBe(2);
    const jobTexts = jobSpy.mock.calls.map((c) => (c[0] as any).text.trim());
    expect(jobTexts[0]).toBe('One is done. Two is done. Three is done.');
    expect(jobTexts[1]).toBe('Four is done. Five is done. Six is done and finished well.');

    const completedUser = items.filter((i) => i.role === 'user' && i.status === 'completed');
    expect(completedUser.length).toBe(2);
  });

  it('a short utterance still gives exactly one item and one job', async () => {
    setManifest({ 'offline-model': { type: 'asr', asrEngine: 'whisper' } });
    const runtime = fakeRuntime(true);
    const client = makeClient({ segmentation: runtime, sentencesPerChunk: 3 });
    const items: Array<{ role: string; status: string; text?: string }> = [];
    client.setEventHandlers({
      onConversationUpdated: ({ item }) => items.push({ role: item.role, status: item.status, text: item.formatted?.transcript }),
    });
    await client.connect(OFFLINE_CONFIG);
    const jobSpy = vi.spyOn(client as any, 'processPipelineJob');

    (client as any).handleAsrResult('Just one short sentence.');
    await settle();

    expect(jobSpy.mock.calls.length).toBe(1);
    expect((jobSpy.mock.calls[0][0] as any).text.trim()).toBe('Just one short sentence.');
    const completedUser = items.filter((i) => i.role === 'user' && i.status === 'completed');
    expect(completedUser.length).toBe(1);
  });

  it('with no runtime the client behaves exactly as today', async () => {
    setManifest({ 'stream-model': { type: 'asr-stream', asrEngine: 'sensevoice' } });
    const client = makeClient({}); // options.segmentation left undefined
    const items: Array<{ role: string; status: string; id: string }> = [];
    client.setEventHandlers({
      onConversationUpdated: ({ item }) => items.push({ role: item.role, status: item.status, id: item.id }),
    });
    await client.connect(STREAM_CONFIG);
    const jobSpy = vi.spyOn(client as any, 'processPipelineJob');
    const engine = hoisted.streamingInstances[0];

    const fullText = 'One is done. Two is done. Three is done and finished well.';
    engine.onPartialResult(fullText);
    engine.onResult({ text: fullText, durationMs: 10, recognitionTimeMs: 5 });
    await settle();

    // No runtime at all: exactly one user item (the growing partial
    // finalized by the result) and one job — today's behaviour, regardless
    // of how many sentences the text actually contains.
    expect(jobSpy.mock.calls.length).toBe(1);
    const userItems = items.filter((i) => i.role === 'user');
    expect(new Set(userItems.map((i) => i.id)).size).toBe(1); // same item reused throughout
    expect(userItems.filter((i) => i.status === 'completed').length).toBe(1);
  });

  it('with a disabled runtime the client behaves exactly as today', async () => {
    setManifest({ 'stream-model': { type: 'asr-stream', asrEngine: 'sensevoice' } });
    const runtime = fakeRuntime(false);
    const client = makeClient({ segmentation: runtime, sentencesPerChunk: 1 });
    const items: Array<{ role: string; status: string; id: string }> = [];
    client.setEventHandlers({
      onConversationUpdated: ({ item }) => items.push({ role: item.role, status: item.status, id: item.id }),
    });
    await client.connect(STREAM_CONFIG);
    const jobSpy = vi.spyOn(client as any, 'processPipelineJob');
    const engine = hoisted.streamingInstances[0];

    const fullText = 'One is done. Two is done. Three is done and finished well.';
    engine.onPartialResult(fullText);
    engine.onResult({ text: fullText, durationMs: 10, recognitionTimeMs: 5 });
    await settle();

    expect(jobSpy.mock.calls.length).toBe(1); // disabled: no mid-utterance seals
    const userItems = items.filter((i) => i.role === 'user');
    expect(new Set(userItems.map((i) => i.id)).size).toBe(1);
    expect(userItems.filter((i) => i.status === 'completed').length).toBe(1);
    expect(runtime.punctuate).not.toHaveBeenCalled();
  });

  it('AST mode never creates a stream', async () => {
    setManifest({ 'granite-model': { type: 'asr', asrEngine: 'granite-speech' } });
    const runtime = fakeRuntime(true);
    const client = makeClient({ segmentation: runtime, sentencesPerChunk: 1 });
    const items: Array<{ role: string; status: string; text?: string }> = [];
    client.setEventHandlers({
      onConversationUpdated: ({ item }) => items.push({ role: item.role, status: item.status, text: item.formatted?.transcript }),
    });
    await client.connect({ ...OFFLINE_CONFIG, asrModelId: 'granite-model', translationModelId: 'granite-model' });
    const jobSpy = vi.spyOn(client as any, 'processPipelineJob');

    (client as any).handleAsrResult('Sentence one. Sentence two. Sentence three and more.');
    await settle();

    expect(runtime.punctuate).not.toHaveBeenCalled();
    expect(jobSpy.mock.calls.length).toBe(1);
    const completedUser = items.filter((i) => i.role === 'user' && i.status === 'completed');
    expect(completedUser.length).toBe(1);
    // AST mode shows a placeholder, not the (already-translated) ASR text.
    expect(completedUser[0].text).toBe('mainPanel.speechDetected');
  });

  it('the ASR timing rides only the final job', async () => {
    setManifest({ 'stream-model': { type: 'asr-stream', asrEngine: 'sensevoice' } });
    const runtime = fakeRuntime(true);
    const client = makeClient({ segmentation: runtime, sentencesPerChunk: 1 });
    client.setEventHandlers({});
    await client.connect(STREAM_CONFIG);
    const jobSpy = vi.spyOn(client as any, 'processPipelineJob');
    const engine = hoisted.streamingInstances[0];

    // One mid-utterance seal from a partial (no timing yet)...
    engine.onPartialResult('First sentence done. Second begins');
    await settle();
    expect(jobSpy.mock.calls.length).toBe(1);

    // ...then the final closes the utterance, carrying timing.
    engine.onResult({ text: 'First sentence done. Second begins and ends well.', durationMs: 42, recognitionTimeMs: 7 });
    await settle();

    expect(jobSpy.mock.calls.length).toBe(2);
    expect((jobSpy.mock.calls[0][0] as any).asrTiming).toBeUndefined();
    expect((jobSpy.mock.calls[1][0] as any).asrTiming).toEqual({ durationMs: 42, recognitionTimeMs: 7 });
  });

  it('the ASR timing still rides only the final chunk when one offline update() seals >=2N sentences by itself', async () => {
    // evaluate() loops over full N-sentence groups within a single update()
    // call, so a >=2N-sentence offline final can seal more than once before
    // end() ever runs. pendingAsrTiming must not be visible to those earlier,
    // update()-only seals — only the one end() emits for the true tail.
    setManifest({ 'offline-model': { type: 'asr', asrEngine: 'whisper' } });
    const runtime = fakeRuntime(true);
    const client = makeClient({ segmentation: runtime, sentencesPerChunk: 3 });
    client.setEventHandlers({});
    await client.connect(OFFLINE_CONFIG);
    const jobSpy = vi.spyOn(client as any, 'processPipelineJob');

    const sixSentences = 'One is done. Two is done. Three is done. Four is done. Five is done. Six is done and finished well.';
    (client as any).handleAsrResult(sixSentences, { durationMs: 99, recognitionTimeMs: 11 });
    await settle();

    expect(jobSpy.mock.calls.length).toBe(2);
    expect((jobSpy.mock.calls[0][0] as any).asrTiming).toBeUndefined();
    expect((jobSpy.mock.calls[1][0] as any).asrTiming).toEqual({ durationMs: 99, recognitionTimeMs: 11 });
  });

  it('advances the raw cursor by what the stream actually consumed, not by the sealed (punctuated) text length', async () => {
    // On the model path, SentenceStream.applyResult() seals the PUNCTUATED
    // output while only advancing the raw tail to where that output's
    // skeleton maps back onto the raw input (SentenceStream.ts). Those two
    // lengths differ by exactly the marks the model inserted. Advancing the
    // client's own cursor by the sealed text's length (rather than by what
    // was actually consumed) drifts it forward by one character per inserted
    // mark, silently deleting that many real characters from the next chunk
    // every time. Only a runtime that actually inserts a mark can catch
    // this — every other case in this file uses a no-op punctuate, so the
    // rule path (which seals exact raw prefixes) never exposes the drift.
    setManifest({ 'stream-model': { type: 'asr-stream', asrEngine: 'sensevoice' } });

    // 50 unpunctuated characters — long enough to clear the N=1 English gate
    // (gateChars('en', 1) === 50) and short enough to stay inside the
    // model's MAX_MODEL_CHARS=300 window, so `dropped` is 0 and this stays
    // easy to reason about by hand.
    const digits = '0123456789'.repeat(5);
    expect(digits.length).toBe(50);
    // Model inserts one period 10 characters before the end — leaving
    // exactly 10 (>=8) skeleton characters of right context, the minimum
    // SentenceStream's hasRightContext requires to count it.
    const cut = digits.length - 10; // 40
    const runtime: SegmentationRuntime = {
      enabled: true,
      async punctuate(_lang: string, text: string) {
        const out = `${text.slice(0, cut)}.${text.slice(cut)}`;
        return { text: out, sentenceEnds: [cut + 1], breakpoints: [cut + 1], model: 'edge-punct-en' as const };
      },
    };
    const client = makeClient({ segmentation: runtime, sentencesPerChunk: 1 });
    client.setEventHandlers({});
    await client.connect(STREAM_CONFIG);
    const jobSpy = vi.spyOn(client as any, 'processPipelineJob');
    const engine = hoisted.streamingInstances[0];

    engine.onPartialResult(digits);
    await settle(); // the model call is async — let it resolve and seal

    expect(jobSpy.mock.calls.length).toBe(1);
    // The bug: sealUserChunk used to advance by the SEALED text's length
    // (cut + 1, counting the inserted period) instead of the raw consumed
    // length (cut). Assert the corrected cursor directly.
    expect((client as any).sealedChars).toBe(cut);

    // A short, still-unpunctuated tail — kept under the 50-char gate so no
    // second model round is needed — becomes the final chunk.
    const tail = 'ZremainderNoPeriodHere';
    engine.onResult({ text: digits + tail, durationMs: 5, recognitionTimeMs: 1 });
    await settle();

    expect(jobSpy.mock.calls.length).toBe(2);
    const firstSealed = (jobSpy.mock.calls[0][0] as any).text as string;
    const secondSealed = (jobSpy.mock.calls[1][0] as any).text as string;
    // With the bug, one raw character (digits[cut]) is silently dropped at
    // the seam between the two chunks. Stripping the model's own inserted
    // mark from the first chunk and concatenating must reconstruct the
    // original raw text exactly, character for character.
    expect(firstSealed.replace(/\.$/, '') + secondSealed).toBe(digits + tail);
  });

  it('a final that is shorter than sealedChars restarts the cursor instead of blanking the open bubble', async () => {
    // Some engines produce the final as a canonical re-decode rather than
    // reusing the accumulated partial text (voxtral-3b-webgpu.worker.ts
    // documents this fallback), so it can come back shorter than what
    // partials already sealed. Slicing by a cursor that no longer applies
    // must not feed the stream an empty string — that would blank the open
    // bubble via onPending('') and then end() would never seal an empty
    // tail, stranding it in_progress with nothing translated.
    setManifest({ 'stream-model': { type: 'asr-stream', asrEngine: 'sensevoice' } });
    const runtime = fakeRuntime(true);
    const client = makeClient({ segmentation: runtime, sentencesPerChunk: 1 });
    const items: Array<{ role: string; status: string; text?: string }> = [];
    client.setEventHandlers({
      onConversationUpdated: ({ item }) => items.push({ role: item.role, status: item.status, text: item.formatted?.transcript }),
    });
    await client.connect(STREAM_CONFIG);
    const jobSpy = vi.spyOn(client as any, 'processPipelineJob');
    const engine = hoisted.streamingInstances[0];

    // Seals "First sentence done." — sealedChars becomes 20.
    engine.onPartialResult('First sentence done. Second begins');
    await settle();
    expect(jobSpy.mock.calls.length).toBe(1);
    expect((client as any).sealedChars).toBe('First sentence done.'.length);

    // A short final, shorter than sealedChars — text.slice(sealedChars) would be ''.
    const shortFinal = 'Hi.';
    expect(shortFinal.length).toBeLessThan((client as any).sealedChars);
    engine.onResult({ text: shortFinal, durationMs: 1, recognitionTimeMs: 1 });
    await settle();

    // The short final still becomes its own completed item and job — not a
    // blanked, permanently in_progress bubble. Checked against final state
    // (not the historical event log, which legitimately passes through
    // in_progress on the way to completed — see the earlier "no two
    // in_progress at once" case).
    expect(jobSpy.mock.calls.length).toBe(2);
    expect((jobSpy.mock.calls[1][0] as any).text).toBe(shortFinal);
    const finalUserItems = client.getConversationItems().filter((i) => i.role === 'user');
    expect(finalUserItems.some((i) => i.status === 'in_progress')).toBe(false);
    expect(finalUserItems.map((i) => i.formatted?.transcript)).toEqual([
      'First sentence done.',
      shortFinal,
    ]);
  });

  it('a seal completes the in-progress item rather than creating a second in-progress one', async () => {
    setManifest({ 'stream-model': { type: 'asr-stream', asrEngine: 'sensevoice' } });
    const runtime = fakeRuntime(true);
    const client = makeClient({ segmentation: runtime, sentencesPerChunk: 1 });
    const inProgressCounts: number[] = [];
    client.setEventHandlers({
      onConversationUpdated: () => {
        const inProgress = client.getConversationItems().filter((i) => i.role === 'user' && i.status === 'in_progress');
        inProgressCounts.push(inProgress.length);
      },
    });
    await client.connect(STREAM_CONFIG);
    const engine = hoisted.streamingInstances[0];

    engine.onPartialResult('Grow');
    engine.onPartialResult('Growing more');
    engine.onPartialResult('First sentence done. Second begins'); // triggers a seal mid-partial
    engine.onPartialResult('First sentence done. Second begins and grows');
    await settle();

    expect(inProgressCounts.length).toBeGreaterThan(0);
    expect(inProgressCounts.every((n) => n <= 1)).toBe(true);
  });
});
