import { OpenAISessionConfig, ResponseConfig } from '../interfaces/IClient';

export interface OpenAIRealtimeSessionBuildResult {
  session: Record<string, any>;
  turnDetectionDisabled: boolean;
}

export interface OpenAIRealtimeSessionUpdateBuildResult {
  session: Record<string, any>;
  turnDetectionDisabled?: boolean;
}

function buildTurnDetectionPayload(
  turnDetection: NonNullable<OpenAISessionConfig['turnDetection']>
): { payload: Record<string, any> | null; disabled: boolean } {
  if (turnDetection.type === 'none') {
    return { payload: null, disabled: true };
  }

  const payload: Record<string, any> = {
    type: turnDetection.type,
    create_response: turnDetection.createResponse ?? true,
    interrupt_response: turnDetection.interruptResponse ?? false
  };

  if (turnDetection.type === 'server_vad') {
    if (turnDetection.threshold !== undefined) {
      payload.threshold = turnDetection.threshold;
    }
    if (turnDetection.prefixPadding !== undefined) {
      payload.prefix_padding_ms = Math.round(turnDetection.prefixPadding * 1000);
    }
    if (turnDetection.silenceDuration !== undefined) {
      payload.silence_duration_ms = Math.round(turnDetection.silenceDuration * 1000);
    }
  } else if (turnDetection.eagerness) {
    payload.eagerness = turnDetection.eagerness.toLowerCase();
  }

  return { payload, disabled: false };
}

function attachAudioConfig(
  session: Record<string, any>,
  audio: Record<string, any>,
  audioInput: Record<string, any>
): void {
  if (Object.keys(audioInput).length > 0) {
    audio.input = audioInput;
  }
  if (Object.keys(audio).length > 0) {
    session.audio = audio;
  }
}

/**
 * Build the GA Realtime session shape shared by the WebSocket and WebRTC
 * transports. Keeping this in one place prevents transport fallback from
 * silently changing session settings such as the selected voice.
 */
export function buildOpenAIRealtimeSession(
  config: OpenAISessionConfig
): OpenAIRealtimeSessionBuildResult {
  const session: Record<string, any> = {
    type: 'realtime',
    output_modalities: config.textOnly ? ['text'] : ['audio'],
    instructions: config.instructions,
    max_output_tokens: config.maxTokens === 'inf' ? 'inf' : config.maxTokens,
    tool_choice: 'none',
    tools: []
  };

  const audio: Record<string, any> = {};
  const audioInput: Record<string, any> = {};
  let turnDetectionDisabled = false;

  // Voice is nested under audio.output in the GA protocol. This must be sent
  // before the first audio response because the API locks the voice afterward.
  if (!config.textOnly) {
    audio.output = {
      voice: config.voice || 'alloy'
    };
  }

  if (config.turnDetection) {
    const { payload, disabled } = buildTurnDetectionPayload(config.turnDetection);
    audioInput.turn_detection = payload;
    turnDetectionDisabled = disabled;
  }

  if (config.inputAudioTranscription?.model) {
    // Forwarded whole: the language / keyword hints are already gated per
    // model by buildInputAudioTranscription, and dropping them here would
    // silently undo that work.
    audioInput.transcription = { ...config.inputAudioTranscription };
  }

  if (config.inputAudioNoiseReduction?.type) {
    audioInput.noise_reduction = {
      type: config.inputAudioNoiseReduction.type
    };
  }

  attachAudioConfig(session, audio, audioInput);

  if (config.model?.startsWith('gpt-realtime-2') && config.reasoningEffort) {
    session.reasoning = { effort: config.reasoningEffort };
  }

  return { session, turnDetectionDisabled };
}

/**
 * Build a sparse GA session.update payload. Only explicitly supplied settings
 * are emitted so a runtime update cannot reset unrelated server state.
 *
 * As of 2026-08 nothing in the app calls updateSession() on the OpenAI
 * realtime clients, so this sparse path is exercised by unit tests only and
 * has never run against a live session. A future caller should also know the
 * GA API locks the voice after the first audio output: supplying `voice` in
 * a mid-session update will surface a server error event.
 */
export function buildOpenAIRealtimeSessionUpdate(
  config: Partial<OpenAISessionConfig>
): OpenAIRealtimeSessionUpdateBuildResult {
  const session: Record<string, any> = { type: 'realtime' };
  const audio: Record<string, any> = {};
  const audioInput: Record<string, any> = {};
  let turnDetectionDisabled: boolean | undefined;

  if (config.textOnly !== undefined) {
    session.output_modalities = config.textOnly ? ['text'] : ['audio'];
  }
  if (config.instructions !== undefined) {
    session.instructions = config.instructions;
  }
  if (config.maxTokens !== undefined) {
    session.max_output_tokens = config.maxTokens === 'inf' ? 'inf' : config.maxTokens;
  }

  if (config.voice !== undefined && config.textOnly !== true) {
    audio.output = { voice: config.voice };
  }

  if (config.turnDetection !== undefined) {
    const { payload, disabled } = buildTurnDetectionPayload(config.turnDetection);
    audioInput.turn_detection = payload;
    turnDetectionDisabled = disabled;
  }

  if (config.inputAudioTranscription?.model) {
    // Forwarded whole: the language / keyword hints are already gated per
    // model by buildInputAudioTranscription, and dropping them here would
    // silently undo that work.
    audioInput.transcription = { ...config.inputAudioTranscription };
  }

  if (config.inputAudioNoiseReduction?.type) {
    audioInput.noise_reduction = {
      type: config.inputAudioNoiseReduction.type
    };
  }

  attachAudioConfig(session, audio, audioInput);

  if (config.model?.startsWith('gpt-realtime-2') && config.reasoningEffort) {
    session.reasoning = { effort: config.reasoningEffort };
  }

  return { session, turnDetectionDisabled };
}

/** Build the multipart request used by POST /v1/realtime/calls. */
export function buildOpenAIRealtimeCallForm(
  sdp: string,
  config: OpenAISessionConfig
): FormData {
  const { session } = buildOpenAIRealtimeSession(config);
  const form = new FormData();
  form.set('sdp', sdp);
  form.set('session', JSON.stringify({
    ...session,
    model: config.model
  }));
  return form;
}

/** Build the GA response.create shape shared by both Realtime transports. */
export function buildOpenAIRealtimeResponseEvent(
  config?: ResponseConfig
): Record<string, any> {
  if (!config) {
    return { type: 'response.create' };
  }

  const response: Record<string, any> = {};
  if (config.instructions) response.instructions = config.instructions;
  if (config.conversation) response.conversation = config.conversation;
  if (config.modalities) response.output_modalities = config.modalities;
  if (config.metadata) response.metadata = config.metadata;

  return {
    type: 'response.create',
    response
  };
}
