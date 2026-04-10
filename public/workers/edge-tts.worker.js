/**
 * Edge TTS Worker — Pure MP3 decoder (classic Web Worker, not ES module).
 *
 * WebSocket connection to Bing TTS is handled by the main thread (platform-specific:
 * Electron uses IPC to main process with Node.js `ws`; Extension uses
 * declarativeNetRequest to inject required headers). This worker only receives
 * MP3 chunks and decodes them to PCM Float32Array.
 *
 * Protocol:
 *   Main → Worker:
 *     { type: 'init' }
 *     { type: 'decode-start' }
 *     { type: 'decode-chunk', mp3Data: ArrayBuffer }
 *     { type: 'decode-end', generationTimeMs: number }
 *     { type: 'dispose' }
 *
 *   Worker → Main:
 *     { type: 'ready', numSpeakers: 0, sampleRate: 24000, loadTimeMs: number }
 *     { type: 'audio-chunk', samples: Float32Array, sampleRate: number }
 *     { type: 'audio-done', generationTimeMs: number }
 *     { type: 'status', message: string }
 *     { type: 'error', error: string }
 *     { type: 'disposed' }
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

var decoder = null;
var isReady = false;

// ── Handler functions ─────────────────────────────────────────────────────────

async function handleInit() {
  var startTime = Date.now();
  try {
    self.postMessage({ type: 'status', message: 'Loading MP3 decoder...' });

    // Load the mpg123-decoder UMD bundle.
    // mpg123-decoder.min.js must be present in public/workers/.
    importScripts('./mpg123-decoder.min.js');

    // UMD bundle exports to self["mpg123-decoder"].MPEGDecoder
    var MPEGDecoder = self['mpg123-decoder'].MPEGDecoder;
    decoder = new MPEGDecoder();
    await decoder.ready;

    isReady = true;
    var loadTimeMs = Date.now() - startTime;
    self.postMessage({ type: 'ready', numSpeakers: 0, sampleRate: 24000, loadTimeMs: loadTimeMs });
  } catch (err) {
    self.postMessage({ type: 'error', error: 'Init failed: ' + (err && err.message ? err.message : String(err)) });
  }
}

function handleDecodeStart() {
  if (!isReady || !decoder) {
    self.postMessage({ type: 'error', error: 'Worker not ready — call init first' });
    return;
  }
  decoder.reset();
}

function handleDecodeChunk(msg) {
  if (!isReady || !decoder) {
    self.postMessage({ type: 'error', error: 'Worker not ready' });
    return;
  }
  try {
    var mp3Data = new Uint8Array(msg.mp3Data);
    var decoded = decoder.decode(mp3Data);
    if (decoded.samplesDecoded > 0) {
      var samples = decoded.channelData[0];
      var sampleRate = decoded.sampleRate || 24000;
      var transferSamples = new Float32Array(samples);
      self.postMessage(
        { type: 'audio-chunk', samples: transferSamples, sampleRate: sampleRate },
        [transferSamples.buffer]
      );
    }
  } catch (err) {
    console.warn('[EdgeTTS Decoder] decode error:', err);
    self.postMessage({ type: 'error', error: 'Decode error: ' + (err && err.message ? err.message : String(err)) });
  }
}

function handleDecodeEnd(msg) {
  self.postMessage({ type: 'audio-done', generationTimeMs: msg.generationTimeMs || 0 });
}

function handleDispose() {
  try {
    if (decoder) {
      decoder.free();
      decoder = null;
    }
    isReady = false;
    self.postMessage({ type: 'disposed' });
  } catch (err) {
    self.postMessage({ type: 'error', error: 'Dispose failed: ' + (err && err.message ? err.message : String(err)) });
  }
}

// ── Message dispatcher ────────────────────────────────────────────────────────

self.onmessage = function(event) {
  var msg = event.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'init': handleInit(); break;
    case 'decode-start': handleDecodeStart(); break;
    case 'decode-chunk': handleDecodeChunk(msg); break;
    case 'decode-end': handleDecodeEnd(msg); break;
    case 'dispose': handleDispose(); break;
    default: self.postMessage({ type: 'error', error: 'Unknown message type: ' + msg.type });
  }
};
