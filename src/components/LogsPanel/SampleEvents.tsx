import { useEffect } from 'react';
import { useLog } from '../../contexts/LogContext';

// Sample client events
const clientEvents = [
  {
    "event_id": "event_123",
    "type": "session.update",
    "session": {
      "modalities": ["text", "audio"],
      "instructions": "You are a helpful assistant.",
      "voice": "sage",
      "input_audio_format": "pcm16",
      "output_audio_format": "pcm16",
      "input_audio_transcription": {
        "model": "whisper-1"
      },
      "turn_detection": {
        "type": "server_vad",
        "threshold": 0.5,
        "prefix_padding_ms": 300,
        "silence_duration_ms": 500,
        "create_response": true
      },
      "tools": [
        {
          "type": "function",
          "name": "get_weather",
          "description": "Get the current weather...",
          "parameters": {
            "type": "object",
            "properties": {
              "location": { "type": "string" }
            },
            "required": ["location"]
          }
        }
      ],
      "tool_choice": "auto",
      "temperature": 0.8,
      "max_response_output_tokens": "inf"
    }
  },
  {
    "event_id": "event_456",
    "type": "input_audio_buffer.append",
    "audio": "Base64EncodedAudioData"
  },
  {
    "event_id": "event_789",
    "type": "input_audio_buffer.commit"
  },
  {
    "event_id": "event_012",
    "type": "input_audio_buffer.clear"
  },
  {
    "event_id": "event_345",
    "type": "conversation.item.create",
    "previous_item_id": null,
    "item": {
      "id": "msg_001",
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Hello, how are you?"
        }
      ]
    }
  },
  {
    "event_id": "event_234",
    "type": "response.create",
    "response": {
      "modalities": ["text", "audio"],
      "instructions": "Please assist the user.",
      "voice": "sage",
      "output_audio_format": "pcm16",
      "tools": [
        {
          "type": "function",
          "name": "calculate_sum",
          "description": "Calculates the sum of two numbers.",
          "parameters": {
            "type": "object",
            "properties": {
              "a": { "type": "number" },
              "b": { "type": "number" }
            },
            "required": ["a", "b"]
          }
        }
      ],
      "tool_choice": "auto",
      "temperature": 0.8,
      "max_output_tokens": 1024
    }
  },
  {
    "event_id": "event_567",
    "type": "response.cancel"
  }
];

// Sample server events
const serverEvents = [
  {
    "event_id": "event_890",
    "type": "error",
    "error": {
      "type": "invalid_request_error",
      "code": "invalid_event",
      "message": "The 'type' field is missing.",
      "param": null,
      "event_id": "event_567"
    }
  },
  {
    "event_id": "event_1234",
    "type": "session.created",
    "session": {
      "id": "sess_001",
      "object": "realtime.session",
      "model": "gpt-4o-realtime-preview",
      "modalities": ["text", "audio"],
      "instructions": "...model instructions here...",
      "voice": "sage",
      "input_audio_format": "pcm16",
      "output_audio_format": "pcm16",
      "input_audio_transcription": null,
      "turn_detection": {
        "type": "server_vad",
        "threshold": 0.5,
        "prefix_padding_ms": 300,
        "silence_duration_ms": 200
      },
      "tools": [],
      "tool_choice": "auto",
      "temperature": 0.8,
      "max_response_output_tokens": "inf"
    }
  },
  {
    "event_id": "event_5678",
    "type": "session.updated",
    "session": {
      "id": "sess_001",
      "object": "realtime.session",
      "model": "gpt-4o-realtime-preview",
      "modalities": ["text"],
      "instructions": "New instructions",
      "voice": "sage",
      "input_audio_format": "pcm16",
      "output_audio_format": "pcm16",
      "input_audio_transcription": {
        "model": "whisper-1"
      },
      "turn_detection": null,
      "tools": [],
      "tool_choice": "none",
      "temperature": 0.7,
      "max_response_output_tokens": 200
    }
  }
];

const SampleEvents: React.FC = () => {
  const { addRealtimeEvent } = useLog();

  useEffect(() => {
    // Add a small delay to make sure the logs panel is ready
    const timer = setTimeout(() => {
      // Add client events
      clientEvents.forEach((event, index) => {
        setTimeout(() => {
          addRealtimeEvent(event, 'client', event.type);
        }, index * 100); // Add each event with a small delay
      });

      // Add server events with a delay after client events
      setTimeout(() => {
        serverEvents.forEach((event, index) => {
          setTimeout(() => {
            addRealtimeEvent(event, 'server', event.type);
          }, index * 100); // Add each event with a small delay
        });
      }, clientEvents.length * 100 + 500); // Start after client events with additional delay
    }, 500);

    return () => clearTimeout(timer);
  }, [addRealtimeEvent]);

  return null; // This component doesn't render anything
};

export default SampleEvents;
