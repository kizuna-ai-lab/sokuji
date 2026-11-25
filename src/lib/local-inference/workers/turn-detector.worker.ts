/**
 * The turn detector worker: one leg's audio in, the leg's turns out. It runs Silero VAD (the model
 * file silero_vad_v5.onnx) and Smart Turn's gate inside TurnDetectorCore, and the segments go to the
 * recognizer on the `output` port (or, for a recognizer that holds the audio itself, the leg's audio with
 * start/end/cancel marks between its samples). The main thread hears only `speech_start` and the leg's one
 * failure (DetectorLeg). Under manual turns Silero is not loaded at all.
 *
 * Failures: Silero failing to load fails init with `turn_detection_unavailable`, before `ready`;
 * Smart Turn missing, failing or late is not a failure here: the leg keeps Normal (turn-gate).
 */
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-all';
import { SileroInput, SILERO_INPUT_SAMPLES } from './_shared/silero-input';
import { VAD_SAMPLE_RATE } from './_shared/max-speech-frames';
import { openTurnLink, type TurnLink } from './_shared/turn-gate';
import { DetectorLeg } from './_shared/turn-detector-leg';
import type { DetectorInbound, DetectorInitMessage, DetectorOutbound, RecognizerTaken } from './_shared/turn-detector-protocol';

interface VadSession {
  session: InferenceSession;
  /** Combined LSTM state: [2, 1, 128] */
  state: Tensor;
  /** The last 64 samples Silero reads each frame behind */
  input: SileroInput;
}

let vadSession: VadSession | null = null;
let leg: DetectorLeg | null = null;
let turnLink: TurnLink | null = null;
let output: MessagePort | null = null;

const post = (msg: DetectorOutbound) => (self as any).postMessage(msg);

/** Silero's speech probability for one 512-sample frame. */
async function vadInfer(frame: Float32Array): Promise<number> {
  if (!vadSession) return 0;
  const input = new Tensor('float32', vadSession.input.next(frame), [1, SILERO_INPUT_SAMPLES]);
  const sr = new Tensor('int64', BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]), []);
  const result = await vadSession.session.run({ input, sr, state: vadSession.state });
  vadSession.state = result.stateN as Tensor;
  return (result.output as Tensor).data[0] as number;
}

/** Back to silence: called by the FrameProcessor whenever it resets. */
function vadResetStates() {
  if (!vadSession) return;
  vadSession.state = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  vadSession.input.reset();
}

async function initVad(vadModelUrl: string): Promise<void> {
  const session = await InferenceSession.create(vadModelUrl, { executionProviders: ['wasm'] });
  vadSession = {
    session,
    state: new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]),
    input: new SileroInput(),
  };
}

async function handleInit(msg: DetectorInitMessage): Promise<void> {
  const startTime = performance.now();
  try {
    // Before any InferenceSession.
    if (msg.ortWasmBaseUrl && ortEnv?.wasm) ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
  } catch { /* the default paths stand */ }

  if (msg.turns === 'auto') {
    try {
      await initVad(msg.vadModelUrl);
    } catch (err) {
      msg.output.close();
      msg.turnPort?.close();
      post({ type: 'error', error: err instanceof Error ? err.message : String(err), code: 'turn_detection_unavailable' });
      return;
    }
  }

  output = msg.output;
  const port = msg.output;
  port.onmessage = (e: MessageEvent) => {
    const data = e.data as RecognizerTaken;
    if (data?.type === 'taken') leg?.taken(data);
  };
  leg = new DetectorLeg({
    core: {
      turns: msg.turns,
      vad: msg.vad,
      limit: msg.limit,
      infer: vadInfer,
      resetModel: vadResetStates,
      smart: (p) => (turnLink = openTurnLink(msg.turnPort, msg.vad, p)),
    },
    delivery: msg.delivery,
    post: (out, transfer) => port.postMessage(out, transfer),
    notify: (notice) => post(notice),
  });
  // Nothing opened it (manual turns, or no Smart Turn settings): it would only sit open.
  if (!turnLink) msg.turnPort?.close();
  post({ type: 'ready', loadTimeMs: performance.now() - startTime });
}

function handleDispose(): void {
  turnLink?.close();
  turnLink = null;
  if (output) {
    output.onmessage = null;
    output.close();
    output = null;
  }
  leg = null;
  const session = vadSession;
  vadSession = null;
  void session?.session.release?.();
}

self.onmessage = async (e: MessageEvent<DetectorInbound>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      try {
        await handleInit(msg);
      } catch (err) {
        post({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      }
      break;
    case 'audio':
      leg?.push(msg.pcm);
      break;
    case 'begin':
      leg?.begin(msg.press);
      break;
    case 'drain':
      leg?.drain(msg.press);
      break;
    case 'cancel':
      leg?.cancel(msg.press);
      break;
    case 'stop':
      leg?.stop(msg.epoch);
      break;
    case 'dispose':
      handleDispose();
      break;
  }
};
