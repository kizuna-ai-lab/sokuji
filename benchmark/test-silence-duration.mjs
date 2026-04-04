/**
 * Minimal reproduction for silenceDurationMs bug in Gemini Live API.
 *
 * Audio: speech(3.85s) + silence(2s) + speech(3.85s)
 *
 * Expected:
 *   silenceDurationMs=100  → 2s gap > 100ms  → split into 2 turns (2 inputTranscriptions)
 *   silenceDurationMs=3000 → 2s gap < 3000ms → NO split, 1 turn (1 inputTranscription with both segments)
 *
 * Actual: both produce the same split behavior → parameter is ignored.
 *
 * Usage:
 *   GEMINI_API_KEY=<key> GEMINI_MODEL=<model> node benchmark/test-silence-duration.mjs [silenceDurationMs]
 */

import { GoogleGenAI, Modality, StartSensitivity, EndSensitivity, TurnCoverage } from '@google/genai';
import { readFileSync } from 'fs';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Set GEMINI_API_KEY env var');
  process.exit(1);
}

const silenceDurationMs = parseInt(process.argv[2] || '3000', 10);
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-native-audio-dialog';
console.log(`\n=== Testing silenceDurationMs = ${silenceDurationMs} ===`);
console.log(`=== Model: ${MODEL} ===\n`);

const ai = new GoogleGenAI({ apiKey: API_KEY });

// Load real speech WAV (skip 44-byte header to get raw PCM)
const wavPath = process.env.WAV_FILE || 'benchmark/test-speech-silence-speech.wav';
const wavBuf = readFileSync(wavPath);
const pcmData = wavBuf.subarray(44);
const sampleRate = 24000;
console.log(`Loaded ${wavPath}: ${(pcmData.length / 2 / sampleRate).toFixed(2)}s at ${sampleRate}Hz`);
console.log(`Structure: speech(3.85s) + silence(2s) + speech(3.85s)\n`);

async function run() {
  const config = {
    responseModalities: [Modality.AUDIO],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: {
      // Try TURN_INCLUDES_ONLY_ACTIVITY (2.5 default) vs 3.1 default (TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO)
      turnCoverage: process.env.TURN_COVERAGE === 'all'
        ? TurnCoverage.TURN_INCLUDES_ALL_INPUT
        : process.env.TURN_COVERAGE === 'audio_video'
          ? TurnCoverage.TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO
          : TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
        endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
        silenceDurationMs,
        prefixPaddingMs: 100,
      },
    },
  };

  console.log('realtimeInputConfig:', JSON.stringify(config.realtimeInputConfig, null, 2));
  console.log('\nConnecting...');

  let turnCount = 0;
  let allAudioSent = false;

  const session = await ai.live.connect({
    model: MODEL,
    config,
    callbacks: {
      onopen() {
        console.log('Session opened');
      },
      onmessage(msg) {
        if (msg.setupComplete) {
          console.log('Setup complete\n');
          sendAudio();
        }

        if (msg.serverContent) {
          if (msg.serverContent.inputTranscription) {
            console.log(`[${elapsed()}] 📝 inputTranscription: "${msg.serverContent.inputTranscription.text}"`);
          }
          if (msg.serverContent.outputTranscription) {
            // just accumulate, don't spam
          }
          if ('turnComplete' in msg.serverContent) {
            turnCount++;
            console.log(`[${elapsed()}] ✅ turnComplete #${turnCount}`);

            // Wait for more turns or timeout
            if (allAudioSent) {
              // Give 5 more seconds for potential second turn after all audio sent
              setTimeout(() => {
                printResult();
                session.close();
                process.exit(0);
              }, 8000);
            }
          }
        }
      },
      onerror(e) {
        console.error('Error:', e.message);
      },
      onclose(e) {
        console.log('Session closed:', e.code, e.reason);
        if (turnCount > 0) {
          printResult();
        }
      },
    },
  });

  const startTime = Date.now();
  function elapsed() {
    return `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
  }

  function printResult() {
    console.log(`\n========== RESULT ==========`);
    console.log(`silenceDurationMs setting: ${silenceDurationMs} ms`);
    console.log(`Silence gap in audio     : 2000 ms`);
    console.log(`Total turns detected     : ${turnCount}`);
    console.log(`---`);
    if (silenceDurationMs <= 2000) {
      console.log(`Expected: 2 turns (2000ms gap > ${silenceDurationMs}ms threshold → should split)`);
    } else {
      console.log(`Expected: 1 turn  (2000ms gap < ${silenceDurationMs}ms threshold → should NOT split)`);
    }
    console.log(`Actual  : ${turnCount} turn(s)`);
    const expectedTurns = silenceDurationMs <= 2000 ? 2 : 1;
    console.log(`Match   : ${turnCount === expectedTurns ? 'YES ✓' : 'NO ✗ — silenceDurationMs not respected!'}`);
    console.log(`============================\n`);
  }

  function sendAudio() {
    const chunkSize = sampleRate * 2 * 0.1; // 100ms chunks
    let offset = 0;

    console.log(`[${elapsed()}] Sending ${(pcmData.length / 2 / sampleRate).toFixed(1)}s of audio...\n`);

    const interval = setInterval(() => {
      if (offset >= pcmData.length) {
        clearInterval(interval);
        allAudioSent = true;
        console.log(`\n[${elapsed()}] All audio sent. Streaming silence, waiting for remaining turns...`);

        // Keep sending silence
        const silenceChunk = Buffer.alloc(chunkSize);
        let silenceCount = 0;
        const silenceInterval = setInterval(() => {
          session.sendRealtimeInput({
            audio: {
              data: silenceChunk.toString('base64'),
              mimeType: `audio/pcm;rate=${sampleRate}`,
            },
          });
          silenceCount++;
          if (silenceCount > 150) { // 15 seconds max
            clearInterval(silenceInterval);
          }
        }, 100);

        // Safety timeout
        setTimeout(() => {
          clearInterval(silenceInterval);
          console.log(`\nTimeout after 25s.`);
          printResult();
          session.close();
          process.exit(1);
        }, 25000);

        return;
      }

      const end = Math.min(offset + chunkSize, pcmData.length);
      const chunk = pcmData.subarray(offset, end);
      session.sendRealtimeInput({
        audio: {
          data: Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('base64'),
          mimeType: `audio/pcm;rate=${sampleRate}`,
        },
      });
      offset = end;
    }, 100);
  }
}

run().catch(console.error);
