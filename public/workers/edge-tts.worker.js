/**
 * Edge TTS Worker — Classic Web Worker (not ES module) for Bing TTS via WebSocket.
 *
 * Connects to Bing TTS WebSocket endpoint, receives MP3 chunks, decodes them
 * with mpg123-decoder, and streams PCM Float32Array back to the main thread.
 *
 * NOTE: mpg123-decoder UMD bundle must be copied to public/workers/ (Task 15).
 *       The importScripts path './mpg123-decoder.min.js' will be resolved then.
 *
 * Protocol:
 *   Main → Worker:
 *     { type: 'init' }
 *     { type: 'generate', text: string, voice: string, speed: number }
 *     { type: 'dispose' }
 *
 *   Worker → Main:
 *     { type: 'ready', numSpeakers: 0, sampleRate: 24000, loadTimeMs: number }
 *     { type: 'audio-chunk', samples: Float32Array, sampleRate: 24000 }
 *     { type: 'audio-done', generationTimeMs: number }
 *     { type: 'status', message: string }
 *     { type: 'error', error: string }
 *     { type: 'disposed' }
 */

'use strict';

// ── Constants (duplicated from edgeTts.ts — can't import TS in classic worker) ──

var READALOUD_BASE = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud';
var TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
var SYNTHESIS_URL = 'wss://' + READALOUD_BASE + '/edge/v1';
var CHROMIUM_FULL_VERSION = '143.0.3650.75';
var CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
var SEC_MS_GEC_VERSION = '1-' + CHROMIUM_FULL_VERSION;

var DEFAULT_VOICE = 'en-US-AvaMultilingualNeural';

// ── State ─────────────────────────────────────────────────────────────────────

var decoder = null;
var isReady = false;

// ── Helper functions ──────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString().replace(/[-:.]/g, '').slice(0, -1);
}

function makeConnectionId() {
  return crypto.randomUUID().replace(/-/g, '');
}

function makeMuid() {
  var bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(function(byte) { return byte.toString(16).padStart(2, '0'); })
    .join('')
    .toUpperCase();
}

async function makeSecMsGec() {
  var winEpoch = 11644473600;
  var secondsToNs = 1e9;
  var ticks = Date.now() / 1000;
  ticks += winEpoch;
  ticks -= ticks % 300;
  ticks *= secondsToNs / 100;
  var payload = ticks.toFixed(0) + TRUSTED_CLIENT_TOKEN;
  var digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload)
  );
  return Array.from(new Uint8Array(digest))
    .map(function(byte) { return byte.toString(16).padStart(2, '0'); })
    .join('')
    .toUpperCase();
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function removeInvalidXmlChars(text) {
  return text.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,
    ' '
  );
}

function normalizeVoiceName(voice) {
  var trimmed = voice.trim();
  var providerMatch = /^([a-z]{2,}-[A-Z]{2,})-([^:]+):.+Neural$/.exec(trimmed);
  if (providerMatch) {
    var locale = providerMatch[1];
    var baseName = providerMatch[2];
    return normalizeVoiceName(locale + '-' + baseName + 'Neural');
  }
  var shortMatch = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(trimmed);
  if (!shortMatch) return trimmed;
  var lang = shortMatch[1];
  var region = shortMatch[2];
  var name = shortMatch[3];
  if (name.includes('-')) {
    var parts = name.split('-');
    var regionSuffix = parts[0];
    var nameParts = parts.slice(1);
    region += '-' + regionSuffix;
    name = nameParts.join('-');
  }
  return 'Microsoft Server Speech Text to Speech Voice (' + lang + '-' + region + ', ' + name + ')';
}

function buildSynthesisUrl(secMsGec, connectionId) {
  var url = new URL(SYNTHESIS_URL);
  url.searchParams.set('TrustedClientToken', TRUSTED_CLIENT_TOKEN);
  url.searchParams.set('Sec-MS-GEC', secMsGec);
  url.searchParams.set('Sec-MS-GEC-Version', SEC_MS_GEC_VERSION);
  url.searchParams.set('ConnectionId', connectionId);
  return url.toString();
}

function buildSpeechConfigMessage() {
  return (
    'X-Timestamp:' + timestamp() + '\r\n' +
    'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
  );
}

function buildSsmlMessage(requestId, voice, text, speed) {
  if (speed === undefined) speed = 0;
  var rateStr = speed >= 0 ? '+' + speed + '%' : speed + '%';
  var ssml =
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    "<voice name='" + normalizeVoiceName(voice) + "'><prosody pitch='+0Hz' rate='" + rateStr + "' volume='+0%'>" +
    escapeXml(removeInvalidXmlChars(text)) +
    '</prosody></voice></speak>';

  return (
    'X-RequestId:' + requestId + '\r\n' +
    'Content-Type:application/ssml+xml\r\n' +
    'X-Timestamp:' + timestamp() + 'Z\r\n' +
    'Path:ssml\r\n\r\n' +
    ssml
  );
}

function parseTextHeaders(message) {
  var separator = message.indexOf('\r\n\r\n');
  var headerText = separator >= 0 ? message.slice(0, separator) : message;
  var headers = {};
  var lines = headerText.split('\r\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var colonIndex = line.indexOf(':');
    if (colonIndex <= 0) continue;
    headers[line.slice(0, colonIndex)] = line.slice(colonIndex + 1).trim();
  }
  return headers;
}

function parseBinaryAudioFrame(data) {
  if (data.length < 2) throw new Error('binary websocket frame missing header length');
  var headerLength = (data[0] << 8) | data[1];
  if (data.length < 2 + headerLength) throw new Error('binary websocket frame truncated');
  var headerText = new TextDecoder().decode(data.slice(2, 2 + headerLength));
  var headers = {};
  var lines = headerText.split('\r\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var colonIndex = line.indexOf(':');
    if (colonIndex <= 0) continue;
    headers[line.slice(0, colonIndex)] = line.slice(colonIndex + 1).trim();
  }
  return { headers: headers, body: data.slice(2 + headerLength) };
}

// ── Handler functions ─────────────────────────────────────────────────────────

async function handleInit() {
  var startTime = Date.now();
  try {
    self.postMessage({ type: 'status', message: 'Loading MP3 decoder...' });

    // Load the mpg123-decoder UMD bundle.
    // NOTE: mpg123-decoder.min.js must be copied to public/workers/ (Task 15).
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

async function handleGenerate(msg) {
  if (!isReady || !decoder) {
    self.postMessage({ type: 'error', error: 'Worker not ready — call init first' });
    return;
  }

  var text = msg.text || '';
  var voice = msg.voice || DEFAULT_VOICE;
  // Convert speed multiplier (1.0 = normal) to percent offset (0 = normal)
  var speedMultiplier = (typeof msg.speed === 'number') ? msg.speed : 1.0;
  var speedPercent = Math.round((speedMultiplier - 1.0) * 100);

  var startTime = Date.now();

  try {
    // Reset decoder state before each generation
    await decoder.reset();

    var secMsGec = await makeSecMsGec();
    var connectionId = makeConnectionId();
    var requestId = makeConnectionId(); // same format — 32 hex chars
    var wsUrl = buildSynthesisUrl(secMsGec, connectionId);

    await new Promise(function(resolve, reject) {
      var ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';

      ws.onopen = function() {
        try {
          ws.send(buildSpeechConfigMessage());
          ws.send(buildSsmlMessage(requestId, voice, text, speedPercent));
        } catch (err) {
          reject(err);
        }
      };

      ws.onmessage = async function(event) {
        try {
          if (typeof event.data === 'string') {
            // Text frame — check for turn.end
            var headers = parseTextHeaders(event.data);
            var path = headers['Path'];
            if (path === 'turn.end') {
              ws.close();
            }
            // Ignore other text frames (turn.start, response, etc.)
          } else {
            // Binary frame — MP3 audio chunk
            var data = new Uint8Array(event.data);
            var frame = parseBinaryAudioFrame(data);
            if (frame.body && frame.body.length > 0) {
              var decoded = decoder.decode(frame.body);
              if (decoded.samplesDecoded > 0) {
                // Edge TTS is mono — use channelData[0]
                var samples = decoded.channelData[0];
                var sampleRate = decoded.sampleRate || 24000;
                // Transfer the buffer for zero-copy
                var transferSamples = new Float32Array(samples);
                self.postMessage(
                  { type: 'audio-chunk', samples: transferSamples, sampleRate: sampleRate },
                  [transferSamples.buffer]
                );
              }
            }
          }
        } catch (err) {
          reject(err);
        }
      };

      ws.onclose = function() {
        var generationTimeMs = Date.now() - startTime;
        resolve({ generationTimeMs: generationTimeMs });
      };

      ws.onerror = function(event) {
        reject(new Error('WebSocket error during TTS synthesis'));
      };
    }).then(function(result) {
      self.postMessage({ type: 'audio-done', generationTimeMs: result.generationTimeMs });
    });
  } catch (err) {
    self.postMessage({ type: 'error', error: 'Generate failed: ' + (err && err.message ? err.message : String(err)) });
  }
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
    case 'init':
      handleInit();
      break;
    case 'generate':
      handleGenerate(msg);
      break;
    case 'dispose':
      handleDispose();
      break;
    default:
      self.postMessage({ type: 'error', error: 'Unknown message type: ' + msg.type });
  }
};
