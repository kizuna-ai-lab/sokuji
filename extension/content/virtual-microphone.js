/**
 * Virtual Microphone implementation
 * This script overrides the mediaDevices API to provide a virtual microphone
 * that can receive PCM data from the side panel.
 */

(function() {
  console.log('[Sokuji] Virtual Microphone script loaded');

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
  
  // Audio chunk buffering system
  const chunkBuffers = new Map(); // Map of trackId -> Map of chunkIndex -> chunk data
  
  // Initialize the track generator
  function initializeTrackGenerator() {
    if (trackGenerator) return;

    try {
      // Create the track generator
      trackGenerator = new window.MediaStreamTrackGenerator({ kind: 'audio' });
      
      // Create a writer for the track
      audioWriter = trackGenerator.writable.getWriter();
      
      // Create a MediaStream with the generator track
      virtualStream = new MediaStream([trackGenerator]);
      
      isActive = true;
      console.log('[Sokuji] Track generator initialized');
    } catch (error) {
      console.error('[Sokuji] Error initializing track generator:', error);
    }
  }

  // Add a chunk to the buffer and process if all chunks are received
  function addChunkToBuffer(pcmData, metadata) {
    if (!isActive || !audioWriter) return;
    
    const { trackId = 'default', chunkIndex, totalChunks, sampleRate } = metadata;
    
    // Single chunk - process immediately if no chunk info
    if (chunkIndex === undefined || totalChunks === undefined) {
      console.log('[Sokuji] Processing single chunk directly');
      processAndWriteAudioData(pcmData, sampleRate || SAMPLE_RATE);
      return;
    }
    
    console.log(`[Sokuji] Buffering chunk ${chunkIndex + 1}/${totalChunks} for track ${trackId}`);
    
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
    
    // Check if we have all chunks for this track
    if (trackBuffer.size === totalChunks) {
      console.log(`[Sokuji] All ${totalChunks} chunks received for track ${trackId}, processing...`);
      processCompleteTrack(trackId, totalChunks);
    } else {
      console.log(`[Sokuji] Waiting for more chunks: ${trackBuffer.size}/${totalChunks} received`);
    }
  }
  
  // Process a complete track when all chunks are received
  function processCompleteTrack(trackId, totalChunks) {
    const trackBuffer = chunkBuffers.get(trackId);
    if (!trackBuffer || trackBuffer.size < totalChunks) {
      console.error(`[Sokuji] Cannot process incomplete track: ${trackBuffer?.size || 0}/${totalChunks}`);
      return;
    }
    
    // Determine total length of all chunks
    let totalLength = 0;
    for (let i = 0; i < totalChunks; i++) {
      if (!trackBuffer.has(i)) {
        console.error(`[Sokuji] Missing chunk ${i} for track ${trackId}`);
        return;
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
    
    // Process the combined data
    console.log(`[Sokuji] Processing combined data: ${totalLength} samples`);
    processAndWriteAudioData(combinedData, sampleRate);
    
    // Clear the buffer for this track
    chunkBuffers.delete(trackId);
  }
  
  // Process PCM data and write to the track
  async function processAndWriteAudioData(pcmData, sampleRate) {
    if (!isActive || !audioWriter) return;

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
        console.log(`[Sokuji] floatData stats: length=${floatData.length}, min=${minVal}, max=${maxVal}, hasNaN=${hasNaN}${hasNaN ? ` at index ${nanIndex} (pcmData[${nanIndex}]=${pcmData[nanIndex]})` : ''}`);
        
        if (hasNaN) {
            console.error("[Sokuji] FATAL: floatData contains NaN values! Aborting write.");
            return; // Do not attempt to write if NaN
        }
        // Strict check for range. Values exactly -1.0 or 1.0 are fine.
        if (maxVal > 1.0 || minVal < -1.0) {
            console.warn(`[Sokuji] WARNING: floatData values (min: ${minVal}, max: ${maxVal}) are outside strict [-1.0, 1.0] range!`);
        }
        console.log('[Sokuji] Creating AudioData with sampleRate:', sampleRate);
        // --- END DIAGNOSTIC LOGS ---

        const framesPerChunk = sampleRate * 1; // 1 second of audio per chunk
        let currentTimestampUs = performance.now() * 1000; // Initial timestamp in microseconds

        console.log(`[Sokuji] Starting to write ${floatData.length} frames in chunks of ${framesPerChunk} frames using setTimeout.`);

        let currentFrameIndex = 0;
        let chunkCount = 0;

        function writeNextChunk() {
            if (currentFrameIndex >= floatData.length) {
                console.log('[Sokuji] All audio data chunks written successfully via setTimeout.');
                return;
            }

            const chunkEnd = Math.min(currentFrameIndex + framesPerChunk, floatData.length);
            const chunkFloatData = floatData.slice(currentFrameIndex, chunkEnd);
            const numberOfFramesInChunk = chunkFloatData.length;

            if (numberOfFramesInChunk === 0) {
                console.log('[Sokuji] Skipping empty chunk in setTimeout.');
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
            console.log(`[Sokuji] Writing chunk ${chunkCount}: ${numberOfFramesInChunk} frames, timestamp: ${currentTimestampUs / 1000} ms`);
            
            audioWriter.write(audioDataChunk).then(() => {
                console.log(`[Sokuji] Successfully wrote chunk ${chunkCount}.`);
                
                const chunkDurationUs = (numberOfFramesInChunk / sampleRate) * 1000000;
                currentTimestampUs += chunkDurationUs;
                currentFrameIndex += numberOfFramesInChunk; // More precise advancement

                const delayMs = chunkDurationUs / 1000;
                setTimeout(writeNextChunk, delayMs);
            }).catch(error => {
                console.error(`[Sokuji] Error writing chunk ${chunkCount}:`, error);
                // Optionally, decide if you want to stop or try to continue
            });
        }

        writeNextChunk(); // Start the process

    } catch (error) {
        console.error('[Sokuji] Error in processAndWriteAudioData:', error);
    }
  }

  // Override enumerateDevices to include our virtual microphone
  navigator.mediaDevices.enumerateDevices = async function() {
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
    // If no audio constraints or explicitly not requesting our virtual mic, use original method
    if (!constraints.audio || 
        (constraints.audio.deviceId && 
         constraints.audio.deviceId.exact !== VIRTUAL_MIC_ID &&
         constraints.audio.deviceId !== VIRTUAL_MIC_ID)) {
      return originalGetUserMedia(constraints);
    }
    
    // If constraints specifically request our virtual microphone
    if (constraints.audio && 
        ((constraints.audio.deviceId && 
          (constraints.audio.deviceId.exact === VIRTUAL_MIC_ID || 
           constraints.audio.deviceId === VIRTUAL_MIC_ID)) || 
         constraints.audio === true)) {
      
      // Initialize our virtual microphone if not already done
      initializeTrackGenerator();
      
      // Return our virtual stream
      console.log('[Sokuji] Returning virtual microphone stream');
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
        console.error('[Sokuji] Invalid audio data format received');
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
        console.error('[Sokuji] Invalid PCM data format received');
        return;
      }
      
      // Add chunk to buffer for processing
      addChunkToBuffer(pcmData, {
        chunkIndex: event.data.chunkIndex,
        totalChunks: event.data.totalChunks,
        sampleRate: event.data.sampleRate || SAMPLE_RATE,
        trackId: event.data.trackId || 'default'
      });
      
      console.log(`[Sokuji] Received PCM_DATA chunk ${event.data.chunkIndex + 1}/${event.data.totalChunks}`);
    }
    
    // Handle state change messages
    if (event.data && event.data.type === 'VIRTUAL_MIC_STATE') {
      if (event.data.enabled) {
        // Initialize our virtual microphone if not already done
        if (!isActive) {
          initializeTrackGenerator();
        }
        console.log('[Sokuji] Virtual microphone enabled');
      } else {
        // Optionally handle disabling
        console.log('[Sokuji] Virtual microphone disabled');
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
    getDeviceId: () => VIRTUAL_MIC_ID
  };

  console.log('[Sokuji] Virtual microphone successfully initialized');
})();
