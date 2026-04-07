// Offscreen document for tab audio capture
// This document is NOT cross-origin isolated, which allows getUserMedia tab capture to succeed.
// The cross_origin_embedder_policy / cross_origin_opener_policy in manifest.json applies to
// the side panel but offscreen documents run without inherited COI headers.
//
// Audio pipeline:
//   getUserMedia(chromeMediaSource: tab) → AudioWorklet (PCM16) → port → background → side panel

/* global chrome */

let audioContext = null;
let mediaStream = null;
let audioWorkletNode = null;
let scriptProcessorNode = null;
let mediaStreamSource = null;
let dummyGain = null;
let capturedTabId = null;

// Persistent port to background service worker for PCM data relay
let bgPort = null;

function connectToBackground() {
  if (bgPort) return bgPort;
  bgPort = chrome.runtime.connect({ name: 'offscreen-pcm' });
  bgPort.onDisconnect.addListener(() => {
    bgPort = null;
  });
  return bgPort;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_START_CAPTURE') {
    startCapture(message.tabId, message.streamId, message.outputDeviceId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error('[Offscreen] Error starting capture:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // async response
  }

  if (message.type === 'OFFSCREEN_STOP_CAPTURE') {
    stopCapture()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }
});

async function startCapture(tabId, streamId, outputDeviceId) {
  // Stop any prior capture before starting a new one
  await stopCapture();

  capturedTabId = tabId;
  const port = connectToBackground();

  console.info(
    '[Offscreen] Starting tab audio capture, crossOriginIsolated:',
    typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : 'unknown'
  );
  console.info('[Offscreen] Calling getUserMedia with streamId:', streamId);

  // getUserMedia with chromeMediaSource:'tab' works here because this document
  // is NOT cross-origin isolated (offscreen documents don't inherit the manifest COOP/COEP).
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // Chrome-specific tab capture constraint
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  console.info('[Offscreen] getUserMedia succeeded, setting up AudioContext');

  audioContext = new AudioContext({ sampleRate: 24000 });
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  // Restore the muted tab audio by routing to the output device.
  // Chrome's tabCapture silences the captured tab; we restore it here.
  if (outputDeviceId && 'setSinkId' in audioContext) {
    try {
      // @ts-ignore setSinkId is Chrome-specific
      await audioContext.setSinkId(outputDeviceId);
      console.info('[Offscreen] Set output device:', outputDeviceId);
    } catch (err) {
      console.warn('[Offscreen] Failed to set output device, using default:', err);
    }
  }

  mediaStreamSource = audioContext.createMediaStreamSource(mediaStream);

  // Passthrough: re-route tab audio to speakers (tabCapture would otherwise silence the tab)
  mediaStreamSource.connect(audioContext.destination);

  try {
    // Preferred: AudioWorklet for low-overhead PCM processing
    const workletUrl = chrome.runtime.getURL('worklets/audio-recorder-worklet-processor.js');
    await audioContext.audioWorklet.addModule(workletUrl);

    audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-recorder-processor');
    audioWorkletNode.port.onmessage = (event) => {
      if (event.data.type === 'audioData') {
        // Transfer the ArrayBuffer (zero-copy) to the background service worker
        const buffer = event.data.pcmData.buffer;
        port.postMessage({ type: 'PCM_DATA', tabId: capturedTabId, buffer }, [buffer]);
      }
    };

    mediaStreamSource.connect(audioWorkletNode);

    // Dummy gain keeps the worklet alive without producing audible output
    dummyGain = audioContext.createGain();
    dummyGain.gain.value = 0;
    audioWorkletNode.connect(dummyGain);
    dummyGain.connect(audioContext.destination);

    // Signal the worklet to start recording
    audioWorkletNode.port.postMessage({ type: 'start' });

    console.info('[Offscreen] AudioWorklet setup complete');
  } catch (err) {
    console.warn('[Offscreen] AudioWorklet failed, falling back to ScriptProcessor:', err);
    setupScriptProcessor(port);
  }
}

function setupScriptProcessor(port) {
  const BUFFER_SIZE = 4096;
  scriptProcessorNode = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
  scriptProcessorNode.onaudioprocess = (event) => {
    const inputData = event.inputBuffer.getChannelData(0);
    const pcmData = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcmData[i] = s < 0 ? s * 32768 : s * 32767;
    }
    // slice() creates a detached copy so we can transfer it
    const buffer = pcmData.buffer.slice(0);
    port.postMessage({ type: 'PCM_DATA', tabId: capturedTabId, buffer }, [buffer]);
  };

  mediaStreamSource.connect(scriptProcessorNode);
  // ScriptProcessor requires connection to destination to process audio
  scriptProcessorNode.connect(audioContext.destination);
}

async function stopCapture() {
  if (audioWorkletNode) {
    try {
      audioWorkletNode.port.postMessage({ type: 'stop' });
      audioWorkletNode.disconnect();
      audioWorkletNode.port.close();
    } catch (_) { /* ignore */ }
    audioWorkletNode = null;
  }

  if (scriptProcessorNode) {
    try { scriptProcessorNode.disconnect(); } catch (_) { /* ignore */ }
    scriptProcessorNode = null;
  }

  if (dummyGain) {
    try { dummyGain.disconnect(); } catch (_) { /* ignore */ }
    dummyGain = null;
  }

  if (mediaStreamSource) {
    try { mediaStreamSource.disconnect(); } catch (_) { /* ignore */ }
    mediaStreamSource = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  if (audioContext && audioContext.state !== 'closed') {
    try { await audioContext.close(); } catch (_) { /* ignore */ }
    audioContext = null;
  }

  capturedTabId = null;
  console.info('[Offscreen] Tab audio capture stopped');
}
