/**
 * Virtual Microphone implementation
 * This script overrides the mediaDevices API to provide a virtual microphone
 * that can receive PCM data from the side panel.
 * 
 * Features:
 * - Regular audio tracks: queued and played in order
 * - Immediate audio tracks: separate queue that plays simultaneously with regular tracks
 *   (use trackId='immediate' to mark as immediate track)
 * - Audio mixing: immediate and regular tracks are mixed together for simultaneous playback
 * - Chunked audio support for both regular and immediate tracks
 * - Device emulator integration for virtual device registration
 */

(function() {
  console.info('[Sokuji] [VirtualMic] Virtual Microphone script loaded');

  // No need to store original methods when using device emulator

  // Virtual device configuration
  const VIRTUAL_MIC_ID = 'sokuji-virtual-microphone';
  const VIRTUAL_MIC_LABEL = 'Sokuji Virtual Microphone';
  const VIRTUAL_MIC_GROUP_ID = 'sokuji-device-group';
  const SAMPLE_RATE = 24000;
  const CHANNEL_COUNT = 1;
  
  // Playback configuration
  const MIN_BATCH_SIZE = SAMPLE_RATE * 0.02; // 20ms minimum batch size
  const MAX_BATCH_SIZE = SAMPLE_RATE * 2; // 10s maximum batch size
  
  // Virtual microphone state
  let trackGenerator = null;
  let audioWriter = null;
  let virtualStream = null;
  let isActive = false;
  
  // Audio processing state
  let audioTimestamp = 0; // Internal timestamp counter (microseconds)
  let isPlaying = false;
  let playbackQueue = []; // Queue of complete audio batches ready for playback
  let immediateQueue = []; // Queue for immediate tracks that bypass regular queue
  let isPlayingImmediate = false; // Separate playing state for immediate tracks
  let chunkBuffer = new Map(); // Temporary storage for incomplete batches: trackId -> {chunks, totalChunks, sampleRate}
  let immediateChunkBuffer = new Map(); // Temporary storage for immediate track chunks
  
  // No longer need createVirtualMicrophoneInfo as device-emulator handles device creation
  
  /**
   * Initialize the virtual microphone
   */
  function initializeVirtualMic() {
    if (trackGenerator && audioWriter && isWriterValid()) {
      console.debug('[Sokuji] [VirtualMic] Virtual microphone already initialized');
      if (!virtualStream.active) {
        console.debug('[Sokuji] [VirtualMic] Virtual microphone is not active, reinitializing');
        cleanup();
      } else {
        console.debug('[Sokuji] [VirtualMic] Virtual microphone is active, returning true');
        return true;
      }
    }

    try {
      console.info('[Sokuji] [VirtualMic] Initializing virtual microphone');
      
      trackGenerator = new window.MediaStreamTrackGenerator({ kind: 'audio' });
      audioWriter = trackGenerator.writable.getWriter();
      virtualStream = new MediaStream([trackGenerator]);
      
      // Set the deviceId in the MediaStreamTrack
      if (trackGenerator.id) {
        // Use the existing id if available
        console.debug(`[Sokuji] [VirtualMic] Using existing track ID: ${trackGenerator.id}`);
      } else {
        // Try to set custom ID or properties if possible
        try {
          Object.defineProperty(trackGenerator, 'id', { value: VIRTUAL_MIC_ID });
        } catch (e) {
          console.debug('[Sokuji] [VirtualMic] Could not set custom track ID', e);
        }
      }
      
      // Set track label if possible
      try {
        Object.defineProperty(trackGenerator, 'label', { value: VIRTUAL_MIC_LABEL });
      } catch (e) {
        console.debug('[Sokuji] [VirtualMic] Could not set track label', e);
      }
      
      isActive = true;
      audioTimestamp = performance.now() * 1000; // Reset timestamp to current time in microseconds
      
      console.info('[Sokuji] [VirtualMic] Virtual microphone initialized successfully');
      return true;
    } catch (error) {
      console.error('[Sokuji] [VirtualMic] Failed to initialize virtual microphone:', error);
      cleanup();
      return false;
    }
  }
  
  /**
   * Check if audio writer is valid
   */
  function isWriterValid() {
    return audioWriter && audioWriter.desiredSize !== null && virtualStream.active;
  }
  
  /**
   * Add audio data to the system
   */
  function addAudioData(pcmData, metadata = {}) {
    const { chunkIndex, totalChunks, sampleRate = SAMPLE_RATE, trackId = 'default' } = metadata;
    
    // Determine if this is an immediate track based on trackId
    const immediate = trackId === 'immediate';
    
    if (!pcmData || pcmData.length === 0) {
      console.warn('[Sokuji] [VirtualMic] Received empty audio data');
      return;
    }
    
    // Convert Int16Array to Float32Array and clamp values
    const floatData = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      floatData[i] = Math.max(-1.0, Math.min(1.0, pcmData[i] / 32768.0));
    }
    
    // Handle single chunk (no chunking info)
    if (chunkIndex === undefined || totalChunks === undefined) {
      console.debug(`[Sokuji] [VirtualMic] Adding single audio chunk to ${immediate ? 'immediate' : 'regular'} playback queue (trackId: ${trackId})`);
      addBatchToQueue({
        data: floatData,
        sampleRate: sampleRate
      }, immediate);
      return;
    }
    
    // Handle multi-chunk batch
    console.debug(`[Sokuji] [VirtualMic] Received ${immediate ? 'immediate' : 'regular'} chunk ${chunkIndex + 1}/${totalChunks} for track ${trackId}`);
    
    // Choose appropriate buffer based on immediate flag
    const bufferMap = immediate ? immediateChunkBuffer : chunkBuffer;
    
    // Initialize buffer for this track if needed
    if (!bufferMap.has(trackId)) {
      bufferMap.set(trackId, {
        chunks: new Map(),
        totalChunks: totalChunks,
        sampleRate: sampleRate
      });
    }
    
    const buffer = bufferMap.get(trackId);
    buffer.chunks.set(chunkIndex, floatData);
    
    // Check if we have all chunks for this batch
    if (buffer.chunks.size === buffer.totalChunks) {
      console.info(`[Sokuji] [VirtualMic] Complete ${immediate ? 'immediate' : 'regular'} batch received for track ${trackId} (${buffer.totalChunks} chunks)`);
      
      // Assemble complete batch
      const completeBatch = assembleCompleteBatch(trackId, immediate);
      if (completeBatch) {
        addBatchToQueue(completeBatch, immediate);
      }
      
      // Clean up buffer
      bufferMap.delete(trackId);
    }
  }
  
  /**
   * Assemble a complete batch from chunks
   */
  function assembleCompleteBatch(trackId, immediate = false) {
    const buffer = immediate ? immediateChunkBuffer : chunkBuffer;
    if (!buffer.has(trackId)) {
      console.error(`[Sokuji] [VirtualMic] Cannot assemble incomplete batch for track ${trackId} (buffer not found)`);
      return null;
    }
    
    const bufferData = buffer.get(trackId);
    if (!bufferData || bufferData.chunks.size < bufferData.totalChunks) {
      console.error(`[Sokuji] [VirtualMic] Cannot assemble incomplete batch for track ${trackId}`);
      return null;
    }
    
    // Calculate total length
    let totalLength = 0;
    for (let i = 0; i < bufferData.totalChunks; i++) {
      const chunk = bufferData.chunks.get(i);
      if (!chunk) {
        console.error(`[Sokuji] [VirtualMic] Missing chunk ${i} for track ${trackId}`);
        return null;
      }
      totalLength += chunk.length;
    }
    
    // Combine all chunks in order
    const combinedData = new Float32Array(totalLength);
    let offset = 0;
    for (let i = 0; i < bufferData.totalChunks; i++) {
      const chunk = bufferData.chunks.get(i);
      combinedData.set(chunk, offset);
      offset += chunk.length;
    }
    
    console.debug(`[Sokuji] [VirtualMic] Assembled batch: ${totalLength} samples for track ${trackId}`);
    return {
      data: combinedData,
      sampleRate: bufferData.sampleRate
    };
  }
  
  /**
   * Add a complete batch to the playback queue
   */
  function addBatchToQueue(batch, immediate = false) {
    if (immediate) {
      immediateQueue.push(batch);
      console.debug(`[Sokuji] [VirtualMic] Added immediate batch to queue. Queue length: ${immediateQueue.length}`);
    } else {
      playbackQueue.push(batch);
      console.debug(`[Sokuji] [VirtualMic] Added batch to queue. Queue length: ${playbackQueue.length}`);
    }
    
    // Start playback if not already playing (both queues can trigger playback)
    if (!isPlaying) {
      startPlayback();
    }
  }
  
  /**
   * Start the playback process
   */
  function startPlayback() {
    if (isPlaying || (immediateQueue.length === 0 && playbackQueue.length === 0)) {
      return;
    }
    
    if (!isActive || !isWriterValid()) {
      if (!initializeVirtualMic()) {
        console.error('[Sokuji] [VirtualMic] Cannot start playback - virtual mic not ready');
        return;
      }
    }
    
    isPlaying = true;
    console.debug('[Sokuji] [VirtualMic] Starting playback process');
    
    processNextPlaybackBatch();
  }
  
  /**
   * Process the next batch(es) for playback
   */
  async function processNextPlaybackBatch() {
    if (!isPlaying) {
      return;
    }
    
    // If queue is empty, stop playback
    if (immediateQueue.length === 0 && playbackQueue.length === 0) {
      console.debug('[Sokuji] [VirtualMic] Playback queue empty, stopping playback');
      isPlaying = false;
      return;
    }
    
    try {
      // Collect batches from both queues for mixing
      const batchData = collectBatchesForPlayback();
      
      if (!batchData) {
        console.debug('[Sokuji] [VirtualMic] No batches collected, stopping playback');
        isPlaying = false;
        return;
      }
      
      // Mix audio from both queues
      const { immediateBatches, regularBatches, maxSamples, targetSampleRate } = batchData;
      const combinedBatch = mixAudioBatches(immediateBatches, regularBatches, maxSamples, targetSampleRate);

      // // Check if the batch contains silent data
      // const silenceThreshold = 0.0001; // Threshold for detecting silence
      // let isSilent = true;
      // let silentSections = [];
      // let currentSection = null;
      
      // // Analyze the data for silent sections
      // for (let i = 0; i < combinedBatch.data.length; i++) {
      //   const amplitude = Math.abs(combinedBatch.data[i]);
      //   const isSampleSilent = amplitude < silenceThreshold;
        
      //   if (isSampleSilent) {
      //     if (currentSection === null) {
      //       currentSection = {
      //         start: i,
      //         end: i
      //       };
      //     } else {
      //       currentSection.end = i;
      //     }
      //   } else {
      //     isSilent = false;
      //     if (currentSection !== null) {
      //       silentSections.push(currentSection);
      //       currentSection = null;
      //     }
      //   }
      // }
      
      // // Capture the last section if it exists
      // if (currentSection !== null) {
      //   silentSections.push(currentSection);
      // }
      
      // // Calculate statistics
      // const totalSamples = combinedBatch.data.length;
      // const silentSamples = silentSections.reduce((total, section) => 
      //   total + (section.end - section.start + 1), 0);
      // const silentPercentage = (silentSamples / totalSamples) * 100;
      // const durationSeconds = totalSamples / combinedBatch.sampleRate;
      
      // console.debug(`[Sokuji] [VirtualMic] Audio analysis: ${silentSections.length} silent sections, ${silentPercentage.toFixed(2)}% silent`);
      
      // // Log more detailed information about large silent sections
      // const largeThresholdSeconds = 0.5; // Sections longer than 0.5s are considered large
      // const largeThresholdSamples = largeThresholdSeconds * combinedBatch.sampleRate;
      
      // const largeSilentSections = silentSections.filter(section => 
      //   (section.end - section.start) > largeThresholdSamples);
      
      // if (largeSilentSections.length > 0) {
      //   console.warn(`[Sokuji] [VirtualMic] Found ${largeSilentSections.length} large silent sections`);
        
      //   largeSilentSections.forEach((section, index) => {
      //     const startTimeSeconds = section.start / combinedBatch.sampleRate;
      //     const endTimeSeconds = section.end / combinedBatch.sampleRate;
      //     const durationSeconds = (section.end - section.start) / combinedBatch.sampleRate;
          
      //     console.warn(`[Sokuji] [VirtualMic] Silent section #${index + 1}: ${startTimeSeconds.toFixed(2)}s - ${endTimeSeconds.toFixed(2)}s (${durationSeconds.toFixed(2)}s long)`);
      //   });
      // }
      
      // if (isSilent) {
      //   console.warn(`[Sokuji] [VirtualMic] WARNING: Entire batch of ${durationSeconds.toFixed(2)}s is silent!`);
      // }
      
      // Play the combined batch
      const playbackDurationMs = await playAudioBatch(combinedBatch);
      
      console.debug(`[Sokuji] [VirtualMic] Played batch of ${combinedBatch.data.length} samples, duration: ${playbackDurationMs}ms`);
      
      // Schedule next playback after current batch finishes
      setTimeout(() => {
        processNextPlaybackBatch();
      }, playbackDurationMs);
      
    } catch (error) {
      // Check if this is the specific stream closed error we want to suppress
      const isStreamClosedError = error.name === 'InvalidStateError' && 
        error.message && error.message.includes('Stream closed');
      
      if (!isStreamClosedError) {
        console.error('[Sokuji] [VirtualMic] Error in playback process:', error);
      }
      
      // Continue with next batch after a short delay
      setTimeout(() => {
        processNextPlaybackBatch();
      }, 100);
    }
  }
  
  /**
   * Collect batches from both queues for mixed playback
   */
  function collectBatchesForPlayback() {
    const immediateBatches = [];
    const regularBatches = [];
    let targetSampleRate = SAMPLE_RATE;
    let maxSamples = 0;
    
    // Collect from immediate queue
    let immediateSamples = 0;
    while (immediateQueue.length > 0 && immediateSamples < MAX_BATCH_SIZE) {
      const nextBatch = immediateQueue[0];
      
      if (immediateSamples + nextBatch.data.length > MAX_BATCH_SIZE) {
        // Slice the batch to fit
        const remainingSamples = MAX_BATCH_SIZE - immediateSamples;
        const batch = immediateQueue.shift();
        const slicedData = batch.data.slice(0, remainingSamples);
        
        immediateBatches.push({
          data: slicedData,
          sampleRate: batch.sampleRate
        });
        
        // Put remainder back
        const remainderData = batch.data.slice(remainingSamples);
        if (remainderData.length > 0) {
          immediateQueue.unshift({
            data: remainderData,
            sampleRate: batch.sampleRate
          });
        }
        
        immediateSamples += slicedData.length;
        targetSampleRate = batch.sampleRate;
        break;
      }
      
      const batch = immediateQueue.shift();
      immediateBatches.push(batch);
      immediateSamples += batch.data.length;
      targetSampleRate = batch.sampleRate;
    }
    
    // Collect from regular queue
    let regularSamples = 0;
    while (playbackQueue.length > 0 && regularSamples < MAX_BATCH_SIZE) {
      const nextBatch = playbackQueue[0];
      
      if (regularSamples + nextBatch.data.length > MAX_BATCH_SIZE) {
        // Slice the batch to fit
        const remainingSamples = MAX_BATCH_SIZE - regularSamples;
        const batch = playbackQueue.shift();
        const slicedData = batch.data.slice(0, remainingSamples);
        
        regularBatches.push({
          data: slicedData,
          sampleRate: batch.sampleRate
        });
        
        // Put remainder back
        const remainderData = batch.data.slice(remainingSamples);
        if (remainderData.length > 0) {
          playbackQueue.unshift({
            data: remainderData,
            sampleRate: batch.sampleRate
          });
        }
        
        regularSamples += slicedData.length;
        targetSampleRate = batch.sampleRate;
        break;
      }
      
      const batch = playbackQueue.shift();
      regularBatches.push(batch);
      regularSamples += batch.data.length;
      targetSampleRate = batch.sampleRate;
    }
    
    // Determine the length for mixing (use the longer one)
    maxSamples = Math.max(immediateSamples, regularSamples);
    
    // Only proceed if we have minimum batch size or this is the last data available
    const hasMoreData = immediateQueue.length > 0 || playbackQueue.length > 0;
    if (maxSamples >= MIN_BATCH_SIZE || !hasMoreData) {
      const durationMs = (maxSamples / targetSampleRate) * 1000;
      console.debug(`[Sokuji] [VirtualMic] Collected batches for mixing: immediate=${immediateBatches.length} (${immediateSamples} samples), regular=${regularBatches.length} (${regularSamples} samples), mixed=${maxSamples} samples, ${durationMs.toFixed(1)}ms`);
      
      return {
        immediateBatches,
        regularBatches,
        maxSamples,
        targetSampleRate
      };
    } else {
      // Put batches back and wait for more data
      immediateBatches.reverse().forEach(batch => immediateQueue.unshift(batch));
      regularBatches.reverse().forEach(batch => playbackQueue.unshift(batch));
      console.debug(`[Sokuji] [VirtualMic] Not enough data for playback (${maxSamples} < ${MIN_BATCH_SIZE}), waiting for more`);
      return null;
    }
  }
  
  /**
   * Combine batches from the same queue into a single continuous batch
   */
  function combineBatchesFromQueue(batches) {
    if (batches.length === 0) {
      return null;
    }
    
    if (batches.length === 1) {
      return batches[0];
    }
    
    // Calculate total length
    const totalLength = batches.reduce((sum, batch) => sum + batch.data.length, 0);
    const sampleRate = batches[batches.length - 1].sampleRate; // Use sample rate from last batch
    
    // Combine data
    const combinedData = new Float32Array(totalLength);
    let offset = 0;
    for (const batch of batches) {
      combinedData.set(batch.data, offset);
      offset += batch.data.length;
    }
    
    return {
      data: combinedData,
      sampleRate: sampleRate
    };
  }

  /**
   * Mix audio from immediate and regular queues
   */
  function mixAudioBatches(immediateBatches, regularBatches, maxSamples, targetSampleRate) {
    // Combine batches from each queue
    const immediateAudio = combineBatchesFromQueue(immediateBatches);
    const regularAudio = combineBatchesFromQueue(regularBatches);
    
    // Create output buffer
    const mixedData = new Float32Array(maxSamples);
    
    // Mix immediate audio
    if (immediateAudio) {
      const immediateLength = Math.min(immediateAudio.data.length, maxSamples);
      for (let i = 0; i < immediateLength; i++) {
        mixedData[i] += immediateAudio.data[i];
      }
      console.debug(`[Sokuji] [VirtualMic] Mixed immediate audio: ${immediateLength} samples`);
    }
    
    // Mix regular audio
    if (regularAudio) {
      const regularLength = Math.min(regularAudio.data.length, maxSamples);
      for (let i = 0; i < regularLength; i++) {
        mixedData[i] += regularAudio.data[i];
      }
      console.debug(`[Sokuji] [VirtualMic] Mixed regular audio: ${regularLength} samples`);
    }
    
    // Apply soft clipping to prevent distortion from mixing
    for (let i = 0; i < maxSamples; i++) {
      if (mixedData[i] > 1.0) {
        mixedData[i] = 1.0;
      } else if (mixedData[i] < -1.0) {
        mixedData[i] = -1.0;
      }
    }
    
    return {
      data: mixedData,
      sampleRate: targetSampleRate
    };
  }
  
  /**
   * Play a single audio batch
   */
  async function playAudioBatch(batch) {
    const { data, sampleRate } = batch;
    
    // Create AudioData
    const audioData = new window.AudioData({
      format: 'f32',
      sampleRate: sampleRate,
      numberOfFrames: data.length,
      numberOfChannels: CHANNEL_COUNT,
      timestamp: audioTimestamp,
      data: data
    });
    
    // Write to stream (this starts playback immediately)
    await audioWriter.write(audioData);
    
    // Update timestamp for next audio data
    const durationUs = (data.length / sampleRate) * 1000000;
    audioTimestamp += durationUs;
    
    // Return playback duration in milliseconds
    return (data.length / sampleRate) * 1000;
  }
  
  /**
   * Clean up virtual microphone resources
   */
  function cleanup() {
    console.info('[Sokuji] [VirtualMic] Cleaning up virtual microphone');
    
    isActive = false;
    isPlaying = false;
    isPlayingImmediate = false;
    
    // Clear queues and buffers
    playbackQueue.length = 0;
    immediateQueue.length = 0;
    chunkBuffer.clear();
    immediateChunkBuffer.clear();
    
    // Release writer
    if (audioWriter) {
      try {
        if (audioWriter.desiredSize !== null) {
          audioWriter.releaseLock();
        }
      } catch (error) {
        console.warn('[Sokuji] [VirtualMic] Error releasing writer lock:', error);
      }
      audioWriter = null;
    }
    
    // Clear other resources
    trackGenerator = null;
    virtualStream = null;
    audioTimestamp = 0;
  }
  
  /**
   * Handle incoming messages
   */
  function handleMessage(event) {
    if (event.source !== window) return;
    
    const { type, data } = event.data || {};
    if (type === 'PCM_DATA') {
      const { pcmData, sampleRate, chunkIndex, totalChunks, trackId } = event.data;
      
      if (!pcmData || !Array.isArray(pcmData)) {
        console.error('[Sokuji] [VirtualMic] Invalid PCM data received');
        return;
      }
      
      const pcmArray = new Int16Array(pcmData);
      addAudioData(pcmArray, { chunkIndex, totalChunks, sampleRate, trackId });
    }
  }
  
  // Virtual device state
  let virtualDeviceId = null;
  
  /**
   * Wait for device emulator to be loaded
   */
  function waitForDeviceEmulator() {
    return new Promise((resolve, reject) => {
      // Check if device emulator is already loaded
      if (navigator.mediaDevices && typeof navigator.mediaDevices.addEmulatedDevice === 'function') {
        console.info('[Sokuji] [VirtualMic] Device emulator already available');
        resolve();
        return;
      }
      
      // Listen for the device emulator loaded event
      const handleDeviceEmulatorLoaded = () => {
        console.info('[Sokuji] [VirtualMic] Device emulator loaded event received');
        window.removeEventListener('dyte.deviceEmulatorLoaded', handleDeviceEmulatorLoaded);
        resolve();
      };
      
      window.addEventListener('dyte.deviceEmulatorLoaded', handleDeviceEmulatorLoaded);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        window.removeEventListener('dyte.deviceEmulatorLoaded', handleDeviceEmulatorLoaded);
        reject(new Error('Device emulator did not load within 10 seconds'));
      }, 10000);
    });
  }
  
  /**
   * Register virtual microphone with device emulator
   */
  async function registerVirtualDevice() {
    if (virtualDeviceId) {
      console.debug('[Sokuji] [VirtualMic] Virtual device already registered');
      return;
    }
    
    try {
      // Wait for device emulator to be available
      await waitForDeviceEmulator();
      
      // Ensure virtual microphone is initialized
      if (!initializeVirtualMic()) {
        throw new Error('Failed to initialize virtual microphone');
      }
      // Register the virtual device using device emulator
      virtualDeviceId = await navigator.mediaDevices.addEmulatedDevice('audioinput', undefined, {
        stream: virtualStream,
        label: VIRTUAL_MIC_LABEL,
        deviceId: VIRTUAL_MIC_ID,
        groupId: VIRTUAL_MIC_GROUP_ID
      });
      // virtualDeviceId = await navigator.mediaDevices.addEmulatedDevice('audioinput');
      
      console.info(`[Sokuji] [VirtualMic] Virtual microphone registered with device ID: ${virtualDeviceId}`);
      
    } catch (error) {
      console.error('[Sokuji] [VirtualMic] Failed to register virtual device:', error);
    }
  }
  
  // Set up message listener
  window.addEventListener('message', handleMessage);
  
  // Listen for device emulator loaded event and register virtual device
  window.addEventListener('dyte.deviceEmulatorLoaded', () => {
    console.info('[Sokuji] [VirtualMic] Device emulator loaded, registering virtual microphone...');
    registerVirtualDevice();
  });
  
  // Check if device emulator is already loaded
  if (navigator.mediaDevices && typeof navigator.mediaDevices.addEmulatedDevice === 'function') {
    console.info('[Sokuji] [VirtualMic] Device emulator already available, registering virtual microphone...');
    registerVirtualDevice();
  }
  
  // Expose API for debugging
  window.sokujiVirtualMic = {
    isActive: () => isActive,
    isPlaying: () => isPlaying,
    isPlayingImmediate: () => isPlayingImmediate,
    getQueueLength: () => playbackQueue.length,
    getImmediateQueueLength: () => immediateQueue.length,
    getTotalQueueLength: () => playbackQueue.length + immediateQueue.length,
    getBufferedTracks: () => Array.from(chunkBuffer.keys()),
    getBufferedImmediateTracks: () => Array.from(immediateChunkBuffer.keys()),
    getAllBufferedTracks: () => Array.from(chunkBuffer.keys()).concat(Array.from(immediateChunkBuffer.keys())),
    getDeviceId: () => virtualDeviceId,
    getVirtualStream: () => virtualStream,
    addAudioData,
    cleanup,
    reinitialize: initializeVirtualMic,
    registerDevice: registerVirtualDevice
  };
  
  console.info('[Sokuji] [VirtualMic] Virtual microphone setup complete (Device Emulator version)');
})();
