// ==UserScript==
// @name         Google Meet Audio Replacer
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Replace Google Meet microphone input with a looped audio file
// @author       You
// @match        https://meet.google.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    console.log('[Audio Replacer] Content script initialized at document-start');
    
    // 确保尽可能早地注入脚本
    function injectExternalScript() {
        try {
            console.log('[Audio Replacer] Attempting to inject external script');
            
            // 创建script元素
            const scriptElement = document.createElement('script');
            
            // 直接获取脚本URL
            const scriptURL = chrome.runtime.getURL('content/injected-script.js');
            
            // 设置script元素的src属性
            scriptElement.src = scriptURL;
            
            // 添加到页面
            document.documentElement.appendChild(scriptElement);
            
            // 注入完成后移除script元素
            scriptElement.onload = function() {
                console.log('[Audio Replacer] Script loaded successfully');
                scriptElement.remove();
            };
            
            scriptElement.onerror = function(error) {
                console.error('[Audio Replacer] Failed to load script:', error);
            };
        } catch (e) {
            console.error('[Audio Replacer] Error during script injection:', e);
        }
    }
    
    // 确保在最早可能的时机注入脚本
    if (document.documentElement) {
        injectExternalScript();
    } else {
        // 这种情况极少发生，但以防万一
        console.log('[Audio Replacer] Document not ready, waiting for documentElement');
        new MutationObserver((mutations, observer) => {
            if (document.documentElement) {
                console.log('[Audio Replacer] Document now ready for injection');
                injectExternalScript();
                observer.disconnect();
            }
        }).observe(document, { childList: true, subtree: true });
    }
    
    // Create shared variables accessible to all functions
    let audioContext;
    let audioSource;
    let audioDestination;
    let audioBuffer;
    let lastSelectedFile = null; // Store the last selected file
    
    // Function declarations to be used across the script
    let promptForAudioFile; 
    let createLoopedAudioSource; 
    let loadAudioFromFile;
    let loadDefaultAudioFile;
    
    // Initialize the functions needed for audio processing
    async function initFunctions() {
        // 加载默认音频文件 (assets/test-tone.mp3)
        loadDefaultAudioFile = async function() {
            try {
                console.log('[Audio Replacer] Loading default audio file: assets/test-tone.mp3');
                
                if (!audioContext) {
                    audioContext = new AudioContext();
                }
                
                // 获取默认音频文件URL
                const audioURL = chrome.runtime.getURL('assets/test-tone.mp3');
                
                // 使用fetch获取音频文件
                const response = await fetch(audioURL);
                if (!response.ok) {
                    throw new Error(`Failed to fetch default audio: ${response.status} ${response.statusText}`);
                }
                
                // 获取音频数据
                const arrayBuffer = await response.arrayBuffer();
                
                // 解码音频数据
                audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                
                // 设置虚拟文件对象，用于显示
                lastSelectedFile = {
                    name: 'test-tone.mp3',
                    type: 'audio/mp3',
                    size: arrayBuffer.byteLength
                };
                
                // 更新UI (如果已经加载)
                const statusEl = document.getElementById('audio-replacer-status');
                if (statusEl) {
                    statusEl.textContent = `Status: Ready (Active) - Using ${lastSelectedFile.name}`;
                }
                
                console.log('[Audio Replacer] Default audio file loaded successfully');
                return true;
            } catch (error) {
                console.error('[Audio Replacer] Error loading default audio file:', error);
                return false;
            }
        };
        
        // Function to load audio from a file
        loadAudioFromFile = async function(file) {
            try {
                if (!audioContext) {
                    audioContext = new AudioContext();
                }

                const reader = new FileReader();
                return new Promise((resolve, reject) => {
                    reader.onload = async (e) => {
                        try {
                            audioBuffer = await audioContext.decodeAudioData(e.target.result);
                            console.log('[Audio Replacer] Audio file loaded successfully');
                            resolve(true);
                        } catch (error) {
                            console.error('[Audio Replacer] Failed to decode audio file:', error);
                            reject(error);
                        }
                    };
                    reader.onerror = reject;
                    reader.readAsArrayBuffer(file);
                });
            } catch (error) {
                console.error('[Audio Replacer] Failed to load audio file:', error);
                return false;
            }
        };

        // Function to prompt user to select an audio file
        promptForAudioFile = async function() {
            return new Promise((resolve) => {
                // We need to create this in response to a user action
                // due to browser security restrictions
                const overlay = document.createElement('div');
                overlay.style.position = 'fixed';
                overlay.style.top = '0';
                overlay.style.left = '0';
                overlay.style.width = '100%';
                overlay.style.height = '100%';
                overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
                overlay.style.zIndex = '10000';
                overlay.style.display = 'flex';
                overlay.style.justifyContent = 'center';
                overlay.style.alignItems = 'center';
                overlay.style.flexDirection = 'column';

                const promptBox = document.createElement('div');
                promptBox.style.backgroundColor = 'white';
                promptBox.style.padding = '20px';
                promptBox.style.borderRadius = '8px';
                promptBox.style.maxWidth = '400px';
                promptBox.style.textAlign = 'center';

                const heading = document.createElement('h3');
                heading.textContent = 'Select Audio File for Microphone Replacement';
                heading.style.marginTop = '0';
                heading.style.color = '#333';

                const description = document.createElement('p');
                description.textContent = 'Please select an audio file that will be played as your microphone input.';
                description.style.color = '#666';

                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = 'audio/*';
                fileInput.style.display = 'block';
                fileInput.style.margin = '15px auto';

                const selectButton = document.createElement('button');
                selectButton.textContent = 'Select File';
                selectButton.style.padding = '8px 16px';
                selectButton.style.backgroundColor = '#4285f4';
                selectButton.style.color = 'white';
                selectButton.style.border = 'none';
                selectButton.style.borderRadius = '4px';
                selectButton.style.cursor = 'pointer';
                selectButton.style.marginRight = '10px';

                const cancelButton = document.createElement('button');
                cancelButton.textContent = 'Cancel';
                cancelButton.style.padding = '8px 16px';
                cancelButton.style.backgroundColor = '#f44336';
                cancelButton.style.color = 'white';
                cancelButton.style.border = 'none';
                cancelButton.style.borderRadius = '4px';
                cancelButton.style.cursor = 'pointer';

                // Event handlers
                fileInput.onchange = (event) => {
                    if (event.target.files.length > 0) {
                        lastSelectedFile = event.target.files[0];
                        selectButton.textContent = `Use "${lastSelectedFile.name}"`;
                        selectButton.style.backgroundColor = '#0f9d58';
                    }
                };

                selectButton.onclick = async () => {
                    document.body.removeChild(overlay);

                    if (lastSelectedFile) {
                        try {
                            await loadAudioFromFile(lastSelectedFile);
                            resolve(true);
                        } catch (error) {
                            console.error('[Audio Replacer] Error loading selected file:', error);
                            resolve(false);
                        }
                    } else if (fileInput.files.length > 0) {
                        try {
                            const file = fileInput.files[0];
                            await loadAudioFromFile(file);
                            resolve(true);
                        } catch (error) {
                            console.error('[Audio Replacer] Error loading selected file:', error);
                            resolve(false);
                        }
                    } else {
                        resolve(false);
                    }
                };

                cancelButton.onclick = () => {
                    document.body.removeChild(overlay);
                    resolve(false);
                };

                // Assemble the UI
                promptBox.appendChild(heading);
                promptBox.appendChild(description);
                promptBox.appendChild(fileInput);

                const buttonContainer = document.createElement('div');
                buttonContainer.style.marginTop = '15px';
                buttonContainer.appendChild(selectButton);
                buttonContainer.appendChild(cancelButton);

                promptBox.appendChild(buttonContainer);
                overlay.appendChild(promptBox);
                document.body.appendChild(overlay);
            });
        };

        // Function to create a looped audio source
        createLoopedAudioSource = function() {
            if (!audioBuffer || !audioContext) {
                console.error('[Audio Replacer] Audio not loaded yet');
                return null;
            }

            try {
                console.log('[Audio Replacer] Creating looped audio source');

                // Stop any existing audio source
                if (audioSource) {
                    audioSource.stop();
                    audioSource = null;
                }

                // Create source and destination
                audioSource = audioContext.createBufferSource();
                audioSource.buffer = audioBuffer;
                audioSource.loop = true;

                // Create a gain node to control volume
                const gainNode = audioContext.createGain();
                gainNode.gain.value = 1.0; // Full volume

                // Connect the nodes
                audioSource.connect(gainNode);

                // Create the media stream destination
                audioDestination = audioContext.createMediaStreamDestination();
                gainNode.connect(audioDestination);

                // Start the audio source
                audioSource.start();

                console.log('[Audio Replacer] Audio source created and started');
                console.log('[Audio Replacer] Audio tracks in stream:', audioDestination.stream.getAudioTracks().length);

                return audioDestination.stream;
            } catch (error) {
                console.error('[Audio Replacer] Error creating audio source:', error);
                return null;
            }
        };
    }
    
    // 监听来自注入脚本的消息
    window.addEventListener('message', async (event) => {
        // 确保消息来自我们的页面
        if (event.source !== window) return;
        
        // 检查消息类型
        if (event.data && event.data.type === 'audio-replacer-request-audio-data') {
            console.log('[Audio Replacer] Received request for audio data from injected script');
            
            try {
                // 初始化函数
                await initFunctions();
                
                // 加载默认音频
                if (!audioBuffer) {
                    const defaultLoaded = await loadDefaultAudioFile();
                    if (!defaultLoaded) {
                        console.warn('[Audio Replacer] Failed to load default audio');
                        window.postMessage({
                            type: 'audio-replacer-audio-data',
                            success: false,
                            error: 'Failed to load audio file'
                        }, '*');
                        return;
                    }
                }
                
                if (audioBuffer) {
                    console.log('[Audio Replacer] Preparing audio data to send to injected script');
                    
                    // 将音频缓冲区数据转换为数组，以便可以通过 postMessage 传递
                    const audioData = {
                        numberOfChannels: audioBuffer.numberOfChannels,
                        sampleRate: audioBuffer.sampleRate,
                        duration: audioBuffer.duration,
                        channelData: []
                    };
                    
                    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
                        const channelArray = audioBuffer.getChannelData(i);
                        // 创建一个新的数组来存储通道数据
                        audioData.channelData.push(Array.from(channelArray));
                    }
                    
                    // 使用 postMessage 将音频数据发送给注入脚本
                    window.postMessage({
                        type: 'audio-replacer-audio-data',
                        success: true,
                        audioData: audioData
                    }, '*');
                    
                    console.log('[Audio Replacer] Audio data sent to injected script');
                } else {
                    console.warn('[Audio Replacer] No audio buffer available');
                    window.postMessage({
                        type: 'audio-replacer-audio-data',
                        success: false,
                        error: 'No audio buffer available'
                    }, '*');
                }
            } catch (error) {
                console.error('[Audio Replacer] Error preparing audio data:', error);
                window.postMessage({
                    type: 'audio-replacer-audio-data',
                    success: false,
                    error: error.message
                }, '*');
            }
        }
    });
    
    // Add a UI control panel to the page
    function addControlPanel() {
        try {
            // Check if panel already exists
            if (document.getElementById('audio-replacer-panel')) {
                return;
            }
            
            // Create the panel
            const panel = document.createElement('div');
            panel.id = 'audio-replacer-panel';
            panel.style.position = 'fixed';
            panel.style.bottom = '10px';
            panel.style.right = '10px';
            panel.style.width = '200px';
            panel.style.zIndex = '9999';
            panel.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            panel.style.color = 'white';
            panel.style.padding = '10px';
            panel.style.borderRadius = '5px';
            panel.style.fontFamily = 'Arial, sans-serif';
            panel.style.fontSize = '14px';

            const title = document.createElement('div');
            title.textContent = 'Audio Replacer';
            title.style.fontWeight = 'bold';
            title.style.marginBottom = '5px';
            panel.appendChild(title);

            const status = document.createElement('div');
            status.id = 'audio-replacer-status';
            status.textContent = 'Status: Active';
            status.style.marginBottom = '5px';
            panel.appendChild(status);
            
            // Add device info
            const deviceInfo = document.createElement('div');
            deviceInfo.id = 'audio-replacer-device-info';
            deviceInfo.textContent = 'Virtual Device: "Sokuji Audio File (Virtual) (test-tone.mp3)"';
            deviceInfo.style.fontSize = '12px';
            deviceInfo.style.marginBottom = '5px';
            deviceInfo.style.color = '#aaa';
            panel.appendChild(deviceInfo);
            
            // Add usage instructions
            const instructions = document.createElement('div');
            instructions.style.fontSize = '12px';
            instructions.style.marginTop = '10px';
            instructions.style.color = '#aaa';
            instructions.innerHTML = 'Using default audio file.<br>Select the virtual device in Meet settings to use it.';
            panel.appendChild(instructions);
            
            // Add the panel to the page
            document.body.appendChild(panel);
            
            console.log('[Audio Replacer] Control panel added to page');
        } catch (error) {
            console.error('[Audio Replacer] Error adding control panel:', error);
        }
    }

    // Initialize UI when the document is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(addControlPanel, 1000);
        });
    } else {
        // Page already loaded
        setTimeout(addControlPanel, 1000);
    }
})();
