import { OpenAISessionConfig, ResponseConfig } from '../interfaces/IClient';

export interface OpenAIRealtimeSessionBuildResult {
  session: Record<string, any>;
  turnDetectionDisabled: boolean;
}

export interface OpenAIRealtimeSessionBuildOptions {
  /**
   * Initial session creation should fall back to Alloy when no voice is set.
   * Partial session updates must disable this so they preserve the server's
   * current voice instead of silently resetting it.
   */
  includeDefaultVoice?: boolean;
}

/**
 * Build the GA Realtime session shape shared by the WebSocket and WebRTC
 * transports. Keeping this in one place prevents transport fallback from
 * silently changing session settings such as the selected voice.
 */
export function buildOpenAIRealtimeSession(
  config: OpenAISessionConfig,
  options: OpenAIRealtimeSessionBuildOptions = {}
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
  const outputVoice = config.voice || (options.includeDefaultVoice === false ? undefined : 'alloy');
  if (!config.textOnly && outputVoice) {
    audio.output = {
      voice: outputVoice
    };
  }

  if (config.turnDetection) {
    if (config.turnDetection.type === 'none') {
      audioInput.turn_detection = null;
      turnDetectionDisabled = true;
    } else {
      const turnDetection: Record<string, any> = {
        type: config.turnDetection.type,
        create_response: config.turnDetection.createResponse ?? true,
        interrupt_response: config.turnDetection.interruptResponse ?? false
      };

      if (config.turnDetection.type === 'server_vad') {
        if (config.turnDetection.threshold !== undefined) {
          turnDetection.threshold = config.turnDetection.threshold;
        }
        if (config.turnDetection.prefixPadding !== undefined) {
          turnDetection.prefix_padding_ms = Math.round(config.turnDetection.prefixPadding * 1000);
        }
        if (config.turnDetection.silenceDuration !== undefined) {
          turnDetection.silence_duration_ms = Math.round(config.turnDetection.silenceDuration * 1000);
        }
      } else if (config.turnDetection.eagerness) {
        turnDetection.eagerness = config.turnDetection.eagerness.toLowerCase();
      }

      audioInput.turn_detection = turnDetection;
    }
  }

  if (config.inputAudioTranscription?.model) {
    audioInput.transcription = {
      model: config.inputAudioTranscription.model
    };
  }

  if (config.inputAudioNoiseReduction?.type) {
    audioInput.noise_reduction = {
      type: config.inputAudioNoiseReduction.type
    };
  }

  if (Object.keys(audioInput).length > 0) {
    audio.input = audioInput;
  }

  if (Object.keys(audio).length > 0) {
    session.audio = audio;
  }

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
