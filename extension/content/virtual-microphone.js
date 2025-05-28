/**
 * Virtual Microphone implementation
 * This script overrides the mediaDevices API to provide a virtual microphone
 * that can receive PCM data from the side panel.
 */

(function() {
  console.info('[Sokuji] [VirtualMic] Virtual Microphone script loaded');

  // Store original mediaDevices methods
  const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  // Virtual device configuration
  const VIRTUAL_MIC_ID = 'sokuji-virtual-microphone';
  const VIRTUAL_MIC_LABEL = 'Sokuji Virtual Microphone';
  const SAMPLE_RATE = 24000;
  const CHANNEL_COUNT = 1;
  
  // Playback configuration
  const MIN_BATCH_SIZE = SAMPLE_RATE * 0.1; // 100ms minimum batch size
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
  let chunkBuffer = new Map(); // Temporary storage for incomplete batches: trackId -> {chunks, totalChunks, sampleRate}
  
  /**
   * Initialize the virtual microphone
   */
  function initializeVirtualMic() {
    if (trackGenerator && audioWriter && isWriterValid()) {
      console.debug('[Sokuji] [VirtualMic] Virtual microphone already initialized');
      return true;
    }
    
    try {
      console.info('[Sokuji] [VirtualMic] Initializing virtual microphone');
      
      trackGenerator = new window.MediaStreamTrackGenerator({ kind: 'audio' });
      audioWriter = trackGenerator.writable.getWriter();
      virtualStream = new MediaStream([trackGenerator]);
      
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
    return audioWriter && audioWriter.desiredSize !== null;
  }
  
  /**
   * Add audio data to the system
   */
  function addAudioData(pcmData, metadata = {}) {
    const { chunkIndex, totalChunks, sampleRate = SAMPLE_RATE, trackId = 'default' } = metadata;
    
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
      console.debug('[Sokuji] [VirtualMic] Adding single audio chunk to playback queue');
      addBatchToQueue({
        data: floatData,
        sampleRate: sampleRate
      });
      return;
    }
    
    // Handle multi-chunk batch
    console.debug(`[Sokuji] [VirtualMic] Received chunk ${chunkIndex + 1}/${totalChunks} for track ${trackId}`);
    
    // Initialize buffer for this track if needed
    if (!chunkBuffer.has(trackId)) {
      chunkBuffer.set(trackId, {
        chunks: new Map(),
        totalChunks: totalChunks,
        sampleRate: sampleRate
      });
    }
    
    const buffer = chunkBuffer.get(trackId);
    buffer.chunks.set(chunkIndex, floatData);
    
    // Check if we have all chunks for this batch
    if (buffer.chunks.size === buffer.totalChunks) {
      console.info(`[Sokuji] [VirtualMic] Complete batch received for track ${trackId} (${buffer.totalChunks} chunks)`);
      
      // Assemble complete batch
      const completeBatch = assembleCompleteBatch(trackId);
      if (completeBatch) {
        addBatchToQueue(completeBatch);
      }
      
      // Clean up buffer
      chunkBuffer.delete(trackId);
    }
  }
  
  /**
   * Assemble a complete batch from chunks
   */
  function assembleCompleteBatch(trackId) {
    const buffer = chunkBuffer.get(trackId);
    if (!buffer || buffer.chunks.size < buffer.totalChunks) {
      console.error(`[Sokuji] [VirtualMic] Cannot assemble incomplete batch for track ${trackId}`);
      return null;
    }
    
    // Calculate total length
    let totalLength = 0;
    for (let i = 0; i < buffer.totalChunks; i++) {
      const chunk = buffer.chunks.get(i);
      if (!chunk) {
        console.error(`[Sokuji] [VirtualMic] Missing chunk ${i} for track ${trackId}`);
        return null;
      }
      totalLength += chunk.length;
    }
    
    // Combine all chunks in order
    const combinedData = new Float32Array(totalLength);
    let offset = 0;
    for (let i = 0; i < buffer.totalChunks; i++) {
      const chunk = buffer.chunks.get(i);
      combinedData.set(chunk, offset);
      offset += chunk.length;
    }
    
    console.info(`[Sokuji] [VirtualMic] Assembled batch: ${totalLength} samples for track ${trackId}`);
    return {
      data: combinedData,
      sampleRate: buffer.sampleRate
    };
  }
  
  /**
   * Add a complete batch to the playback queue
   */
  function addBatchToQueue(batch) {
    playbackQueue.push(batch);
    console.debug(`[Sokuji] [VirtualMic] Added batch to queue. Queue length: ${playbackQueue.length}`);
    
    // Start playback if not already playing
    if (!isPlaying) {
      startPlayback();
    }
  }
  
  /**
   * Start the playback process
   */
  function startPlayback() {
    if (isPlaying || playbackQueue.length === 0) {
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
    if (playbackQueue.length === 0) {
      console.debug('[Sokuji] [VirtualMic] Playback queue empty, stopping playback');
      isPlaying = false;
      return;
    }
    
    try {
      // Collect batches from queue to create an optimal-sized playback chunk
      const batchesToPlay = collectBatchesForPlayback();
      
      if (batchesToPlay.length === 0) {
        console.debug('[Sokuji] [VirtualMic] No batches collected, stopping playback');
        isPlaying = false;
        return;
      }
      
      // Combine collected batches into a single audio data
      const combinedBatch = combineBatches(batchesToPlay);

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
      console.error('[Sokuji] [VirtualMic] Error in playback process:', error);
      // Continue with next batch after a short delay
      setTimeout(() => {
        processNextPlaybackBatch();
      }, 100);
    }
  }
  
  /**
   * Collect batches from queue for optimal playback
   */
  function collectBatchesForPlayback() {
    const batches = [];
    let totalSamples = 0;
    let targetSampleRate = SAMPLE_RATE;
    
    // Take batches until we reach optimal size or queue is empty
    while (playbackQueue.length > 0) {
      const nextBatch = playbackQueue[0]; // Peek at next batch without removing it
      
      // Check if adding this batch would exceed the maximum size
      if (totalSamples + nextBatch.data.length > MAX_BATCH_SIZE) {
        console.debug(`[Sokuji] [VirtualMic] Next batch would exceed max size (${totalSamples + nextBatch.data.length} > ${MAX_BATCH_SIZE}), slicing batch`);
        
        // Calculate how many samples we can take from this batch
        const remainingSamples = MAX_BATCH_SIZE - totalSamples;
        
        // Remove the batch from the queue
        playbackQueue.shift();
        
        // Create a batch with just the portion we can use
        const slicedData = nextBatch.data.slice(0, remainingSamples);
        console.debug(`[Sokuji] [VirtualMic] Sliced batch to ${slicedData.length} samples`);
        batches.push({
          data: slicedData,
          sampleRate: nextBatch.sampleRate
        });
        
        // Put the remainder back in the queue for next time
        const remainderData = nextBatch.data.slice(remainingSamples);
        if (remainderData.length > 0) {
          playbackQueue.unshift({
            data: remainderData,
            sampleRate: nextBatch.sampleRate
          });
        }
        
        totalSamples += slicedData.length;
        targetSampleRate = nextBatch.sampleRate;
        break; // We've reached max size, so exit the loop
      }
      
      // Safe to add this batch
      const batch = playbackQueue.shift();
      batches.push(batch);
      totalSamples += batch.data.length;
      targetSampleRate = batch.sampleRate; // Use the sample rate of the last batch
    }
    
    // Only proceed if we have minimum batch size or this is the last data available
    if (totalSamples >= MIN_BATCH_SIZE || playbackQueue.length === 0) {
      const durationMs = (totalSamples / targetSampleRate) * 1000;
      console.debug(`[Sokuji] [VirtualMic] Collected ${batches.length} batches (${totalSamples} samples, ${durationMs.toFixed(1)}ms) for playback`);
      return batches;
    } else {
      // Put batches back and wait for more data
      batches.reverse().forEach(batch => playbackQueue.unshift(batch));
      console.debug(`[Sokuji] [VirtualMic] Not enough data for playback (${totalSamples} < ${MIN_BATCH_SIZE}), waiting for more`);
      return [];
    }
  }
  
  /**
   * Combine multiple batches into a single batch
   */
  function combineBatches(batches) {
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
    
    // Clear queues and buffers
    playbackQueue.length = 0;
    chunkBuffer.clear();
    
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
  
  // Override enumerateDevices to include virtual microphone
  navigator.mediaDevices.enumerateDevices = async function() {
    console.debug('[Sokuji] [VirtualMic] enumerateDevices called');
    
    const devices = await originalEnumerateDevices();
    
    // Add virtual microphone if not already present
    const hasVirtualMic = devices.some(device => 
      device.deviceId === VIRTUAL_MIC_ID && device.kind === 'audioinput'
    );
    
    if (!hasVirtualMic) {
      devices.push({
        deviceId: VIRTUAL_MIC_ID,
        kind: 'audioinput',
        label: VIRTUAL_MIC_LABEL,
        groupId: ''
      });
    }
    
    return devices;
  };
  
  // Override getUserMedia to handle virtual microphone requests
  navigator.mediaDevices.getUserMedia = async function(constraints) {
    console.debug('[Sokuji] [VirtualMic] getUserMedia called', constraints);
    
    // Check if requesting virtual microphone
    const isRequestingVirtualMic = constraints?.audio && (
      constraints.audio === true ||
      constraints.audio.deviceId === VIRTUAL_MIC_ID ||
      constraints.audio.deviceId?.exact === VIRTUAL_MIC_ID
    );
    
    if (isRequestingVirtualMic) {
      console.info('[Sokuji] [VirtualMic] Providing virtual microphone stream');
      
      if (!initializeVirtualMic()) {
        throw new Error('Failed to initialize virtual microphone');
      }
      
      return virtualStream;
    }
    
    // For other requests, clean up virtual mic if active
    if (isActive && constraints?.audio) {
      console.info('[Sokuji] [VirtualMic] Switching away from virtual microphone');
      cleanup();
    }
    
    return originalGetUserMedia(constraints);
  };
  
  // Set up message listener
  window.addEventListener('message', handleMessage);
  
  // Expose API for debugging
  window.sokujiVirtualMic = {
    isActive: () => isActive,
    isPlaying: () => isPlaying,
    getQueueLength: () => playbackQueue.length,
    getBufferedTracks: () => Array.from(chunkBuffer.keys()),
    getDeviceId: () => VIRTUAL_MIC_ID,
    getVirtualStream: () => virtualStream,
    addAudioData,
    cleanup,
    reinitialize: initializeVirtualMic
  };
  
  console.info('[Sokuji] [VirtualMic] Virtual microphone setup complete');
})();
