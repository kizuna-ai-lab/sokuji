// ==UserScript==
// @name         Sokuji Google Meet Integration
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Integrate Sokuji interpreter with Google Meet
// @author       You
// @match        https://meet.google.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    console.log('[Sokuji] Content script initialized at document-start');
    
    // Inject the injected-script.js as early as possible
    function injectExternalScript() {
        try {
            console.log('[Sokuji] Attempting to inject external script');
            
            // Create script element
            const scriptElement = document.createElement('script');
            
            // Get script URL
            const scriptURL = chrome.runtime.getURL('content/injected-script.js');
            
            // Set script element src attribute
            scriptElement.src = scriptURL;
            
            // Add to page
            document.documentElement.appendChild(scriptElement);
            
            // Remove script element after loading
            scriptElement.onload = function() {
                console.log('[Sokuji] Script loaded successfully');
                scriptElement.remove();
            };
            
            scriptElement.onerror = function(error) {
                console.error('[Sokuji] Failed to load script:', error);
            };
        } catch (e) {
            console.error('[Sokuji] Error during script injection:', e);
        }
    }
    
    // Add Sokuji fullpage iframe to the page
    function addSokujiIframe() {
        try {
            // Check if iframe already exists
            if (document.getElementById('sokuji-iframe-container')) {
                return;
            }
            
            console.log('[Sokuji] Adding fullpage iframe to Google Meet');
            
            // Create container for the iframe
            const container = document.createElement('div');
            container.id = 'sokuji-iframe-container';
            container.style.position = 'fixed';
            container.style.top = '0';
            container.style.right = '0';
            container.style.width = '350px';
            container.style.height = '100%';
            container.style.zIndex = '9999';
            container.style.boxShadow = '-2px 0 10px rgba(0, 0, 0, 0.2)';
            container.style.transition = 'transform 0.3s ease-in-out';
            container.style.transform = 'translateX(350px)'; // Start hidden
            
            // Create toggle button
            const toggleButton = document.createElement('div');
            toggleButton.id = 'sokuji-toggle-button';
            toggleButton.style.position = 'absolute';
            toggleButton.style.left = '-40px';
            toggleButton.style.top = '50%';
            toggleButton.style.transform = 'translateY(-50%)';
            toggleButton.style.width = '40px';
            toggleButton.style.height = '80px';
            toggleButton.style.backgroundColor = '#4285f4';
            toggleButton.style.borderRadius = '8px 0 0 8px';
            toggleButton.style.cursor = 'pointer';
            toggleButton.style.display = 'flex';
            toggleButton.style.justifyContent = 'center';
            toggleButton.style.alignItems = 'center';
            toggleButton.style.color = 'white';
            toggleButton.style.fontWeight = 'bold';
            toggleButton.style.boxShadow = '-2px 0 5px rgba(0, 0, 0, 0.2)';
            toggleButton.innerHTML = '<div style="transform: rotate(-90deg); white-space: nowrap;">Sokuji</div>';
            
            // Create iframe
            const iframe = document.createElement('iframe');
            iframe.id = 'sokuji-iframe';
            iframe.src = chrome.runtime.getURL('fullpage.html');
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            iframe.style.backgroundColor = 'white';
            
            // Add required permissions for microphone access
            iframe.allow = 'microphone; camera';
            
            // Add toggle functionality
            toggleButton.addEventListener('click', function() {
                const isVisible = container.style.transform === 'translateX(0px)';
                container.style.transform = isVisible ? 'translateX(350px)' : 'translateX(0px)';
            });
            
            // Append elements
            container.appendChild(toggleButton);
            container.appendChild(iframe);
            document.body.appendChild(container);
            
            console.log('[Sokuji] Fullpage iframe added successfully');
        } catch (e) {
            console.error('[Sokuji] Error adding fullpage iframe:', e);
        }
    }
    
    // Ensure script is injected at the earliest possible time
    if (document.documentElement) {
        injectExternalScript();
    } else {
        // This rarely happens, but just in case
        console.log('[Sokuji] Document not ready, waiting for documentElement');
        new MutationObserver((mutations, observer) => {
            if (document.documentElement) {
                console.log('[Sokuji] Document now ready for injection');
                injectExternalScript();
                observer.disconnect();
            }
        }).observe(document, { childList: true, subtree: true });
    }
    
    // Add the iframe when the DOM is fully loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(addSokujiIframe, 1000);
        });
    } else {
        setTimeout(addSokujiIframe, 1000);
    }
    
    // Also add the iframe when the meeting UI is fully loaded
    // This is a backup in case the DOMContentLoaded event has already fired
    window.addEventListener('load', () => {
        setTimeout(addSokujiIframe, 2000);
    });
    
    // Listen for messages from the injected script
    window.addEventListener('message', async (event) => {
        // Ensure message is from our window
        if (event.source !== window) return;
        
        // Check message type
        if (event.data && event.data.type === 'sokuji-request-audio-data') {
            console.log('[Sokuji] Received request for audio stream from injected script');
            
            try {
                // Create a simple audio context to send back
                const audioContext = new AudioContext();
                
                // Create oscillator as audio source
                const oscillator = audioContext.createOscillator();
                oscillator.type = 'sine'; // Sine wave
                oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4 tone
                
                // Create gain node to control volume
                const gainNode = audioContext.createGain();
                gainNode.gain.value = 0.5; // Set volume to half
                
                // Create media stream destination
                const audioDestination = audioContext.createMediaStreamDestination();
                
                // Connect nodes
                oscillator.connect(gainNode);
                gainNode.connect(audioDestination);
                
                // Start playback
                oscillator.start();
                
                // Get the audio stream
                const audioStream = audioDestination.stream;
                
                // Send audio stream info back to injected script
                window.postMessage({
                    type: 'sokuji-audio-stream-data',
                    success: true,
                    streamInfo: {
                        id: audioStream.id,
                        active: audioStream.active,
                        trackCount: audioStream.getAudioTracks().length,
                        tracks: audioStream.getAudioTracks().map(track => ({
                            id: track.id,
                            kind: track.kind,
                            label: track.label,
                            enabled: track.enabled,
                            readyState: track.readyState
                        }))
                    }
                }, '*');
                
                console.log('[Sokuji] Audio stream data sent to injected script');
            } catch (error) {
                console.error('[Sokuji] Error preparing audio stream data:', error);
                window.postMessage({
                    type: 'sokuji-audio-stream-data',
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                }, '*');
            }
        }
    });
    
    console.log('[Sokuji] Content script setup completed');
})();
