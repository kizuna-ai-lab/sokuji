(function() {
    console.log('[Sokuji Injected] Script running in page context');
    
    // Store the original methods before anyone else can access them
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
    
    // Define virtual device information (fixed values)
    const VIRTUAL_DEVICE_ID = 'virtual-audio-device-sokuji';
    const VIRTUAL_DEVICE_LABEL = 'Sokuji Audio (Virtual)';
    
    // Store audio context and stream
    let audioContext = null;
    let audioSource = null;
    let audioDestination = null;
    let cachedAudioStream = null;
    let sokujiAudioStreamInfo = null;
    
    // Listen for messages from content script
    window.addEventListener('message', (event) => {
        // Ensure message is from our window
        if (event.source !== window) return;
        
        // Check message type
        if (event.data && event.data.type === 'sokuji-audio-stream-data') {
            console.log('[Sokuji Injected] Received Sokuji audio stream data');
            
            if (event.data.success) {
                sokujiAudioStreamInfo = event.data.streamInfo;
                console.log('[Sokuji Injected] Sokuji audio stream info stored successfully', sokujiAudioStreamInfo);
            } else {
                console.error('[Sokuji Injected] Failed to receive Sokuji audio stream data:', event.data.error);
            }
        }
    });
    
    // Request Sokuji audio stream data
    const requestSokujiAudioStream = () => {
        console.log('[Sokuji Injected] Requesting Sokuji audio stream data');
        window.postMessage({
            type: 'sokuji-request-audio-data'
        }, '*');
        
        // Return a Promise, waiting for audio stream data
        return new Promise((resolve, reject) => {
            // Check if we already have audio stream data
            if (sokujiAudioStreamInfo) {
                resolve(sokujiAudioStreamInfo);
                return;
            }
            
            // Set up a listener to wait for audio stream data
            const messageListener = (event) => {
                // Ensure message is from our window
                if (event.source !== window) return;
                
                // Check message type
                if (event.data && event.data.type === 'sokuji-audio-stream-data') {
                    // Remove listener
                    window.removeEventListener('message', messageListener);
                    
                    if (event.data.success) {
                        sokujiAudioStreamInfo = event.data.streamInfo;
                        resolve(sokujiAudioStreamInfo);
                    } else {
                        reject(new Error(event.data.error || 'Failed to get Sokuji audio stream data'));
                    }
                }
            };
            
            // Add message listener
            window.addEventListener('message', messageListener);
            
            // Set timeout
            setTimeout(() => {
                window.removeEventListener('message', messageListener);
                reject(new Error('Timeout waiting for Sokuji audio stream data'));
            }, 5000);
        });
    };
    
    // Create audio stream for virtual device
    const createAudioStream = async () => {
        try {
            if (cachedAudioStream) {
                console.log('[Sokuji Injected] Using cached audio stream');
                return cachedAudioStream;
            }
            
            // Try to get Sokuji audio stream info
            try {
                await requestSokujiAudioStream();
                console.log('[Sokuji Injected] Received Sokuji audio stream info, using it for virtual device');
                
                // Create audio context
                if (!audioContext) {
                    audioContext = new AudioContext();
                }
                
                // Create a new MediaStream to simulate Sokuji's audio stream
                // Note: We can't directly get the original MediaStream object, only its metadata
                // So we create a new audio stream and use an oscillator as the actual audio source
                
                // Create oscillator as audio source
                const oscillator = audioContext.createOscillator();
                oscillator.type = 'sine'; // Sine wave
                oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4 tone
                
                // Create gain node to control volume
                const gainNode = audioContext.createGain();
                gainNode.gain.value = 0.5; // Set volume to half
                
                // Create media stream destination
                audioDestination = audioContext.createMediaStreamDestination();
                
                // Connect nodes
                oscillator.connect(gainNode);
                gainNode.connect(audioDestination);
                
                // Start playback
                oscillator.start();
                
                // Save stream for reuse
                cachedAudioStream = audioDestination.stream;
                
                console.log('[Sokuji Injected] Created audio stream for Sokuji virtual device with', 
                    cachedAudioStream.getAudioTracks().length, 'audio tracks');
                    
                return cachedAudioStream;
            } catch (error) {
                console.error('[Sokuji Injected] Error creating audio stream:', error);
                
                // Create a fallback tone if Sokuji stream fails
                console.log('[Sokuji Injected] Creating fallback tone');
                
                // Create audio context
                if (!audioContext) {
                    audioContext = new AudioContext();
                }
                
                // Create oscillator as audio source
                const oscillator = audioContext.createOscillator();
                oscillator.type = 'sine'; // Sine wave
                oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4 tone
                
                // Create gain node to control volume
                const gainNode = audioContext.createGain();
                gainNode.gain.value = 0.5; // Set volume to half
                
                // Create media stream destination
                audioDestination = audioContext.createMediaStreamDestination();
                
                // Connect nodes
                oscillator.connect(gainNode);
                gainNode.connect(audioDestination);
                
                // Start playback
                oscillator.start();
                
                // Save stream for reuse
                cachedAudioStream = audioDestination.stream;
                
                console.log('[Sokuji Injected] Created fallback audio stream with', 
                    cachedAudioStream.getAudioTracks().length, 'audio tracks');
                    
                return cachedAudioStream;
            }
        } catch (error) {
            console.error('[Sokuji Injected] Error creating audio stream:', error);
            throw error;
        }
    };
    
    // Override the enumerateDevices method
    navigator.mediaDevices.enumerateDevices = async function() {
        console.log('[Sokuji Injected] Enumerating devices (intercepted)');
        
        try {
            // Get original devices
            const originalDevices = await originalEnumerateDevices.apply(this, arguments);
            
            // Add virtual device (always add)
            const virtualDevice = {
                deviceId: VIRTUAL_DEVICE_ID,
                groupId: 'sokuji-virtual-devices',
                kind: 'audioinput',
                label: VIRTUAL_DEVICE_LABEL
            };
            
            console.log('[Sokuji Injected] Adding virtual device to list');
            return [...originalDevices, virtualDevice];
        } catch (error) {
            console.error('[Sokuji Injected] Error in enumerateDevices:', error);
            // Return original results on error
            return await originalEnumerateDevices.apply(this, arguments);
        }
    };
    
    // Override getUserMedia to intercept audio requests
    navigator.mediaDevices.getUserMedia = async function(constraints) {
        console.log('[Sokuji Injected] getUserMedia intercepted', constraints);
        
        try {
            // Check if audio is requested and our virtual device is specified
            if (constraints && 
                constraints.audio && 
                constraints.audio.deviceId && 
                constraints.audio.deviceId.exact === VIRTUAL_DEVICE_ID) {
                
                console.log('[Sokuji Injected] Virtual device requested, creating audio stream');
                
                // Create audio stream directly
                try {
                    const stream = await createAudioStream();
                    console.log('[Sokuji Injected] Audio stream created successfully');
                    return stream;
                } catch (error) {
                    console.error('[Sokuji Injected] Failed to create audio stream:', error);
                    throw new Error('Failed to create audio stream: ' + error.message);
                }
            } else {
                // If not requesting our virtual device, use original method
                console.log('[Sokuji Injected] Not our virtual device, using original getUserMedia');
                return await originalGetUserMedia.apply(this, arguments);
            }
        } catch (error) {
            console.error('[Sokuji Injected] Error in getUserMedia:', error);
            // Use original method on error
            return await originalGetUserMedia.apply(this, arguments);
        }
    };
    
    // Initialize by requesting Sokuji audio stream
    requestSokujiAudioStream().catch(error => {
        console.warn('[Sokuji Injected] Initial Sokuji audio stream request failed:', error);
    });
    
    console.log('[Sokuji Injected] Navigator methods successfully overridden');
})();
