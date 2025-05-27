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

  // Virtual device info
  const VIRTUAL_MIC_ID = 'sokuji-virtual-microphone';
  const VIRTUAL_MIC_LABEL = 'Sokuji Virtual Microphone';
  
  // Audio configuration
  const SAMPLE_RATE = 24000; // Match Sokuji's sample rate
  const CHANNEL_COUNT = 1;
  
  // Create MediaStreamTrackGenerator for audio
  let trackGenerator = null;
  let audioWriter = null;
  let virtualStream = null;
  let isActive = false;
  let previouslyActive = false; // Track if virtual mic was previously active
  
  // Audio chunk buffering system
  const chunkBuffers = new Map(); // Map of trackId -> Map of chunkIndex -> chunk data
  
  // Batch queue system for each trackId
  const batchQueues = new Map(); // Map of trackId -> Array of batches to be played
  const isProcessingBatch = new Map(); // Map of trackId -> boolean indicating if a batch is being processed
  
  // Initialize the track generator
  function initializeTrackGenerator() {
    try {
      // If the track generator exists, check if it's still valid or needs recreation
      if (trackGenerator && audioWriter) {
        // Check if writer is valid
        if (!isWriterValid()) {
          console.warn('[Sokuji] [VirtualMic] Writer is not valid, reinitializing track generator');
          // Clean up existing resources
          trackGenerator = null;
          audioWriter = null;
          virtualStream = null;
        } else {
          console.debug('[Sokuji] [VirtualMic] Track generator already exists and is valid');
          return;
        }
      }

      // Create the track generator
      trackGenerator = new window.MediaStreamTrackGenerator({ kind: 'audio' });
      
      // Create a writer for the track
      audioWriter = trackGenerator.writable.getWriter();
      
      // Create a MediaStream with the generator track
      virtualStream = new MediaStream([trackGenerator]);
      
      isActive = true;
      console.info('[Sokuji] [VirtualMic] Track generator initialized');
    } catch (error) {
      console.error('[Sokuji] [VirtualMic] Error initializing track generator:', error);
      // Reset state on error
      trackGenerator = null;
      audioWriter = null;
      virtualStream = null;
      isActive = false;
    }
  }

  // Check if the writer is valid
  function isWriterValid() {
    console.debug('[Sokuji] [VirtualMic] Checking if writer is valid', { audioWriter });
    // WritableStreamDefaultWriter.closed is a Promise, not a boolean
    // Instead, check if the writer exists and if it has an active lock on its stream
    return audioWriter && audioWriter.desiredSize !== null;
  }

  // Add a chunk to the buffer and process if all chunks are received
  function addChunkToBuffer(pcmData, metadata) {
    // Check if writer is valid, reinitialize if not
    if (!isActive || !isWriterValid()) {
      console.warn('[Sokuji] [VirtualMic] Writer not valid, attempting to reinitialize');
      initializeTrackGenerator();
      
      // If still not active after reinitialization, abort
      if (!isActive || !isWriterValid()) {
        console.error('[Sokuji] [VirtualMic] Failed to reinitialize track generator, cannot process audio', { isActive, isWriterValid: isWriterValid() });
        return;
      }
    }
    
    const { trackId = 'default', chunkIndex, totalChunks, sampleRate } = metadata;
    
    // Single chunk - process immediately if no chunk info
    if (chunkIndex === undefined || totalChunks === undefined) {
      console.debug('[Sokuji] [VirtualMic] Processing single chunk directly');
      
      // For single chunks, we still want to queue them if this trackId has a queue
      if (batchQueues.has(trackId) && batchQueues.get(trackId).length > 0) {
        console.debug(`[Sokuji] [VirtualMic] Adding single chunk to queue for track ${trackId}`);
        queueBatchForProcessing(pcmData, trackId, sampleRate || SAMPLE_RATE);
      } else {
        processAndWriteAudioData(pcmData, sampleRate || SAMPLE_RATE);
      }
      return;
    }
    
    console.debug(`[Sokuji] [VirtualMic] Buffering chunk ${chunkIndex + 1}/${totalChunks} for track ${trackId}`);
    
    // Get or create track buffer
    if (!chunkBuffers.has(trackId)) {
      chunkBuffers.set(trackId, new Map());
    }
    const trackBuffer = chunkBuffers.get(trackId);
    
    // Store this chunk
    trackBuffer.set(chunkIndex, {
      data: pcmData,
      sampleRate: sampleRate || SAMPLE_RATE
    });
    
    // Check if we have all chunks for this batch
    if (trackBuffer.size === totalChunks) {
      console.info(`[Sokuji] [VirtualMic] All ${totalChunks} chunks received for track ${trackId}, adding to queue...`);
      
      // Add this complete batch to the queue
      const batch = assembleBatch(trackId, totalChunks);
      
      // Process the batch (will queue it if another batch is already playing)
      processOrQueueBatch(batch);
      
      // Clear the buffer for this track to prepare for the next batch
      chunkBuffers.delete(trackId);
    } else {
      console.debug(`[Sokuji] [VirtualMic] Waiting for more chunks: ${trackBuffer.size}/${totalChunks} received`);
    }
  }
  
  // Assemble a batch from chunks
  function assembleBatch(trackId, totalChunks) {
    const trackBuffer = chunkBuffers.get(trackId);
    if (!trackBuffer || trackBuffer.size < totalChunks) {
      console.error(`[Sokuji] [VirtualMic] Cannot assemble incomplete batch: ${trackBuffer?.size || 0}/${totalChunks}`);
      return null;
    }
    
    // Determine total length of all chunks
    let totalLength = 0;
    for (let i = 0; i < totalChunks; i++) {
      if (!trackBuffer.has(i)) {
        console.error(`[Sokuji] [VirtualMic] Missing chunk ${i} for track ${trackId}`);
        return null;
      }
      totalLength += trackBuffer.get(i).data.length;
    }
    
    // Create a single combined buffer
    const combinedData = new Int16Array(totalLength);
    let offset = 0;
    
    // Fill the combined buffer with all chunks in order
    for (let i = 0; i < totalChunks; i++) {
      const chunk = trackBuffer.get(i);
      combinedData.set(chunk.data, offset);
      offset += chunk.data.length;
    }
    
    // Use sample rate from first chunk
    const sampleRate = trackBuffer.get(0).sampleRate;
    
    // Return assembled batch
    console.info(`[Sokuji] [VirtualMic] Assembled batch: ${totalLength} samples for track ${trackId}`);
    return {
      data: combinedData,
      sampleRate,
      trackId,
      durationMs: (combinedData.length / sampleRate) * 1000 // Calculate duration in milliseconds
    };
  }

  // Queue a single PCM chunk as a batch
  function queueBatchForProcessing(pcmData, trackId, sampleRate) {
    const batch = {
      data: pcmData,
      sampleRate,
      trackId,
      durationMs: (pcmData.length / sampleRate) * 1000 // Calculate duration in milliseconds
    };
    
    processOrQueueBatch(batch);
  }

  // Process or queue a batch depending on current state
  function processOrQueueBatch(batch) {
    if (!batch) return;
    
    const { trackId } = batch;
    
    // Initialize batch queue for this track if it doesn't exist
    if (!batchQueues.has(trackId)) {
      batchQueues.set(trackId, []);
    }
    
    // Add this batch to the queue
    batchQueues.get(trackId).push(batch);
    console.debug(`[Sokuji] [VirtualMic] Added batch to queue for track ${trackId}. Queue length: ${batchQueues.get(trackId).length}`);
    
    // If we're not currently processing a batch for this track, start processing
    if (!isProcessingBatch.get(trackId)) {
      processNextBatchInQueue(trackId);
    } else {
      console.debug(`[Sokuji] [VirtualMic] Already processing a batch for track ${trackId}, queued for later`);
    }
  }

  // Process the next batch in the queue for a track
  function processNextBatchInQueue(trackId) {
    // Get the queue for this track
    const queue = batchQueues.get(trackId);
    if (!queue || queue.length === 0) {
      console.debug(`[Sokuji] [VirtualMic] No batches in queue for track ${trackId}`);
      isProcessingBatch.set(trackId, false);
      return;
    }
    
    // Mark as processing
    isProcessingBatch.set(trackId, true);
    
    // Get the next batch from the queue
    const nextBatch = queue.shift();
    console.debug(`[Sokuji] [VirtualMic] Processing next batch for track ${trackId}. Remaining in queue: ${queue.length}`);
    
    // Process this batch
    processAndWriteAudioData(nextBatch.data, nextBatch.sampleRate)
      .then(actualDurationMs => {
        console.info(`[Sokuji] [VirtualMic] Batch for track ${trackId} completed. Duration: ${actualDurationMs}ms`);
        
        // Wait until this batch is fully played before processing the next one
        setTimeout(() => {
          processNextBatchInQueue(trackId);
        }, 1); // Small additional delay for safety
      })
      .catch(error => {
        console.error(`[Sokuji] [VirtualMic] Error processing batch for track ${trackId}:`, error);
        // Continue with the next batch even if there was an error
        setTimeout(() => {
          processNextBatchInQueue(trackId);
        }, 100);
      });
  }

  // Process PCM data and write to the track
  async function processAndWriteAudioData(pcmData, sampleRate) {
    // Check if writer is valid, attempt to reinitialize if not
    if (!isActive || !isWriterValid()) {
      console.warn('[Sokuji] [VirtualMic] Writer not valid in processAndWriteAudioData, attempting to reinitialize');
      initializeTrackGenerator();
      
      // If still not valid after reinitialization, abort
      if (!isActive || !isWriterValid()) {
        console.error('[Sokuji] [VirtualMic] Failed to reinitialize track generator, cannot process audio');
        return 0;
      }
    }

    try {
      // Convert Int16Array to Float32Array (expected by Web Audio API)
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768.0; // Ensure floating point division
      }

      // --- BEGIN DIAGNOSTIC LOGS ---
      let minVal = floatData.length > 0 ? floatData[0] : 0;
      let maxVal = floatData.length > 0 ? floatData[0] : 0;
      let hasNaN = false;
      let nanIndex = -1;
      for (let k = 0; k < floatData.length; k++) {
        if (isNaN(floatData[k])) {
          hasNaN = true;
          nanIndex = k;
          break;
        }
        if (floatData[k] < minVal) minVal = floatData[k];
        if (floatData[k] > maxVal) maxVal = floatData[k];
      }
      console.debug(`[Sokuji] [VirtualMic] floatData stats: length=${floatData.length}, min=${minVal}, max=${maxVal}, hasNaN=${hasNaN}${hasNaN ? ` at index ${nanIndex} (pcmData[${nanIndex}]=${pcmData[nanIndex]})` : ''}`);
      
      if (hasNaN) {
        console.error("[Sokuji] [VirtualMic] FATAL: floatData contains NaN values! Aborting write.");
        return 0; // Do not attempt to write if NaN
      }
      // Strict check for range. Values exactly -1.0 or 1.0 are fine.
      if (maxVal > 1.0 || minVal < -1.0) {
        console.warn(`[Sokuji] [VirtualMic] WARNING: floatData values (min: ${minVal}, max: ${maxVal}) are outside strict [-1.0, 1.0] range!`);
      }
      console.debug('[Sokuji] [VirtualMic] Creating AudioData with sampleRate:', sampleRate);
      // --- END DIAGNOSTIC LOGS ---

      const framesPerChunk = sampleRate * 1; // 1 second of audio per chunk
      let currentTimestampUs = performance.now() * 1000; // Initial timestamp in microseconds

      console.info(`[Sokuji] [VirtualMic] Starting to write ${floatData.length} frames in chunks of ${framesPerChunk} frames using setTimeout.`);

      let currentFrameIndex = 0;
      let chunkCount = 0;
      let totalDurationMs = 0;

      return new Promise((resolve, reject) => {
        function writeNextChunk() {
          if (currentFrameIndex >= floatData.length) {
            console.info('[Sokuji] [VirtualMic] All audio data chunks written successfully via setTimeout.');
            resolve(totalDurationMs);
            return;
          }

          const chunkEnd = Math.min(currentFrameIndex + framesPerChunk, floatData.length);
          const chunkFloatData = floatData.slice(currentFrameIndex, chunkEnd);
          const numberOfFramesInChunk = chunkFloatData.length;

          if (numberOfFramesInChunk === 0) {
            console.debug('[Sokuji] [VirtualMic] Skipping empty chunk in setTimeout.');
            currentFrameIndex += framesPerChunk; // Advance index even if chunk was empty
            writeNextChunk(); // Immediately try next chunk
            return;
          }

          // Create AudioData object
          const audioDataChunk = new window.AudioData({
            format: 'f32',
            sampleRate: sampleRate,
            numberOfFrames: numberOfFramesInChunk,
            numberOfChannels: CHANNEL_COUNT,
            timestamp: currentTimestampUs,
            data: chunkFloatData
          });

          chunkCount++;
          console.debug(`[Sokuji] [VirtualMic] Writing chunk ${chunkCount}: ${numberOfFramesInChunk} frames, timestamp: ${currentTimestampUs / 1000} ms`);
          
          const chunkDurationUs = (numberOfFramesInChunk / sampleRate) * 1000000;
          const chunkDurationMs = chunkDurationUs / 1000;
          const delayMs = chunkDurationMs;

          audioWriter.write(audioDataChunk).then(() => {
            console.debug(`[Sokuji] [VirtualMic] Successfully wrote chunk ${chunkCount}.`);
            
            currentTimestampUs += chunkDurationUs;
            currentFrameIndex += numberOfFramesInChunk; // More precise advancement
            
            totalDurationMs += chunkDurationMs;

            setTimeout(writeNextChunk, delayMs);
          }).catch(error => {
            console.warn(`[Sokuji] [VirtualMic] Error writing chunk ${chunkCount}:`, error);
            currentFrameIndex += numberOfFramesInChunk; // Advance to next chunk even on error
            setTimeout(writeNextChunk, delayMs); // Continue with next chunk after delay
            reject(error); // Reject the promise with the error
          });
        }

        writeNextChunk(); // Start the process
      });
    } catch (error) {
      console.error('[Sokuji] [VirtualMic] Error in processAndWriteAudioData:', error);
      return 0;
    }
  }

  // Cleanup resources when virtual microphone is no longer needed
  function cleanup() {
    console.info('[Sokuji] [VirtualMic] Cleaning up virtual microphone resources');
    
    // Store that we were previously active
    previouslyActive = isActive;
    isActive = false;
    
    // Close the writer if it exists
    if (audioWriter) {
      try {
        // Only release the lock if it's still valid
        if (audioWriter.desiredSize !== null) {
          audioWriter.releaseLock();
        }
      } catch (e) {
        console.warn('[Sokuji] [VirtualMic] Error releasing writer lock:', e);
      }
    }
    
    // We don't null out the objects here to allow for potential reuse,
    // but mark the mic as inactive so it will be reinitialized next time
  }

  // Override enumerateDevices to include our virtual microphone
  navigator.mediaDevices.enumerateDevices = async function() {
    console.info('[Sokuji] [VirtualMic] enumerateDevices called');
    // Get real devices
    const devices = await originalEnumerateDevices();
    
    // Check if our virtual device is already in the list
    const virtualDeviceExists = devices.some(device => 
      device.deviceId === VIRTUAL_MIC_ID && device.kind === 'audioinput'
    );
    
    // If not, add our virtual microphone
    if (!virtualDeviceExists) {
      devices.push({
        deviceId: VIRTUAL_MIC_ID,
        kind: 'audioinput',
        label: VIRTUAL_MIC_LABEL,
        groupId: ''
      });
    }
    
    return devices;
  };

  // Override getUserMedia to intercept requests for our virtual microphone
  navigator.mediaDevices.getUserMedia = async function(constraints) {
    console.info('[Sokuji] [VirtualMic] getUserMedia called with constraints:', constraints);
    // If no audio constraints or explicitly not requesting our virtual mic, use original method
    if (!constraints.audio || 
        (constraints.audio.deviceId && 
         constraints.audio.deviceId.exact !== VIRTUAL_MIC_ID &&
         constraints.audio.deviceId !== VIRTUAL_MIC_ID)) {
        
        // If we were previously using the virtual mic but now switching to a different one,
        // clean up virtual mic resources
        if (isActive && constraints.audio) {
          console.info('[Sokuji] [VirtualMic] Switching from virtual mic to different device, cleaning up');
          cleanup();
        }
      
      return originalGetUserMedia(constraints);
    }
    
    // If constraints specifically request our virtual microphone
    if (constraints.audio && 
        ((constraints.audio.deviceId && 
          (constraints.audio.deviceId.exact === VIRTUAL_MIC_ID || 
           constraints.audio.deviceId === VIRTUAL_MIC_ID)) || 
         constraints.audio === true)) {
      
      // Initialize our virtual microphone if not already done
      // If we're returning to the virtual mic after using a different one,
      // force reinitialization by resetting resources
      if (previouslyActive && !isActive) {
        console.info('[Sokuji] [VirtualMic] Returning to virtual mic after using a different one, reinitializing');
        trackGenerator = null;
        audioWriter = null;
        virtualStream = null;
      }
      
      initializeTrackGenerator();
      
      // Return our virtual stream
      console.info('[Sokuji] [VirtualMic] Returning virtual microphone stream');
      return virtualStream;
    }
    
    // For any other case, use the original getUserMedia
    return originalGetUserMedia(constraints);
  };

  // Listen for messages from content script
  window.addEventListener('message', function(event) {
    // Only process messages from our own window
    if (event.source !== window) return;
    
    // Support for legacy AUDIO_CHUNK format
    if (event.data && event.data.type === 'AUDIO_CHUNK' && event.data.source === 'SOKUJI_AUDIO_BRIDGE') {
      const { data } = event.data;
      
      // Create Int16Array from the channelData if available
      let pcmData;
      if (data && data.channelData && Array.isArray(data.channelData[0])) {
        pcmData = new Int16Array(data.channelData[0]);
      } else {
        console.error('[Sokuji] [VirtualMic] Invalid audio data format received');
        return;
      }
      
      // Add chunk to buffer for processing
      addChunkToBuffer(pcmData, {
        chunkIndex: data.chunkIndex,
        totalChunks: data.totalChunks,
        sampleRate: data.sampleRate || SAMPLE_RATE,
        trackId: data.trackId || 'default'
      });
    }
    
    // Support for new PCM_DATA format
    if (event.data && event.data.type === 'PCM_DATA') {
      // Create Int16Array from the pcmData
      let pcmData;
      if (event.data.pcmData && Array.isArray(event.data.pcmData)) {
        pcmData = new Int16Array(event.data.pcmData);
      } else {
        console.error('[Sokuji] [VirtualMic] Invalid PCM data format received');
        return;
      }
      
      // Add chunk to buffer for processing
      addChunkToBuffer(pcmData, {
        chunkIndex: event.data.chunkIndex,
        totalChunks: event.data.totalChunks,
        sampleRate: event.data.sampleRate || SAMPLE_RATE,
        trackId: event.data.trackId || 'default'
      });
      
      console.debug(`[Sokuji] [VirtualMic] Received PCM_DATA chunk ${event.data.chunkIndex + 1}/${event.data.totalChunks}`);
    }
    
    // Handle state change messages
    if (event.data && event.data.type === 'VIRTUAL_MIC_STATE') {
      if (event.data.enabled) {
        // Initialize our virtual microphone if not already done
        if (!isActive || !isWriterValid()) {
          console.info('[Sokuji] [VirtualMic] Virtual microphone enabled, initializing or reinitializing');
          trackGenerator = null; // Force reinitialization
          audioWriter = null;
          virtualStream = null;
          initializeTrackGenerator();
        } else {
          console.debug('[Sokuji] [VirtualMic] Virtual microphone already enabled and valid');
        }
      } else {
        // Handle disabling by cleaning up resources
        console.info('[Sokuji] [VirtualMic] Virtual microphone disabled');
        cleanup();
      }
    }
  });

  // Expose methods for debugging and external access
  window.sokujiVirtualMic = {
    isActive: () => isActive,
    addChunkToBuffer,
    processAndWriteAudioData,
    getTrackGenerator: () => trackGenerator,
    getVirtualStream: () => virtualStream,
    getDeviceId: () => VIRTUAL_MIC_ID,
    getBatchQueueStatus: () => {
      const status = {};
      batchQueues.forEach((queue, trackId) => {
        status[trackId] = {
          queueLength: queue.length,
          isProcessing: isProcessingBatch.get(trackId) || false
        };
      });
      return status;
    }
  };

  console.info('[Sokuji] [VirtualMic] Virtual microphone successfully initialized');
})();
