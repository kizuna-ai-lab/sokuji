(function() {
    console.log('[Audio Replacer Injected] Script running in page context');
    
    // Store the original methods before anyone else can access them
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
    
    // 定义虚拟设备信息（固定值）
    const VIRTUAL_DEVICE_ID = 'virtual-audio-device-sokuji';
    const VIRTUAL_DEVICE_LABEL = 'Sokuji Audio File (Virtual) (test-tone.mp3)';
    
    // 存储音频上下文和流
    let audioContext = null;
    let audioSource = null;
    let audioDestination = null;
    let cachedAudioStream = null;
    let audioData = null;
    
    // 监听来自内容脚本的消息
    window.addEventListener('message', (event) => {
        // 确保消息来自我们的页面
        if (event.source !== window) return;
        
        // 检查消息类型
        if (event.data && event.data.type === 'audio-replacer-audio-data') {
            console.log('[Audio Replacer Injected] Received audio data from content script');
            
            if (event.data.success) {
                audioData = event.data.audioData;
                console.log('[Audio Replacer Injected] Audio data stored successfully');
            } else {
                console.error('[Audio Replacer Injected] Failed to receive audio data:', event.data.error);
            }
        }
    });
    
    // 请求音频数据
    const requestAudioData = () => {
        console.log('[Audio Replacer Injected] Requesting audio data from content script');
        window.postMessage({
            type: 'audio-replacer-request-audio-data'
        }, '*');
        
        // 返回一个 Promise，等待音频数据
        return new Promise((resolve, reject) => {
            // 检查是否已经有音频数据
            if (audioData) {
                resolve(audioData);
                return;
            }
            
            // 设置一个监听器等待音频数据
            const messageListener = (event) => {
                // 确保消息来自我们的页面
                if (event.source !== window) return;
                
                // 检查消息类型
                if (event.data && event.data.type === 'audio-replacer-audio-data') {
                    // 移除监听器
                    window.removeEventListener('message', messageListener);
                    
                    if (event.data.success) {
                        audioData = event.data.audioData;
                        resolve(audioData);
                    } else {
                        reject(new Error(event.data.error || 'Failed to get audio data'));
                    }
                }
            };
            
            // 添加消息监听器
            window.addEventListener('message', messageListener);
            
            // 设置超时
            setTimeout(() => {
                window.removeEventListener('message', messageListener);
                reject(new Error('Timeout waiting for audio data'));
            }, 5000);
        });
    };
    
    // 创建循环播放的音频流，使用内容脚本提供的音频数据
    const createLoopedAudioStream = async () => {
        try {
            if (cachedAudioStream) {
                console.log('[Audio Replacer Injected] Using cached audio stream');
                return cachedAudioStream;
            }
            
            // 创建音频上下文
            if (!audioContext) {
                audioContext = new AudioContext();
            }
            
            // 如果没有音频数据，请求它
            if (!audioData) {
                try {
                    audioData = await requestAudioData();
                } catch (error) {
                    console.warn('[Audio Replacer Injected] Failed to get audio data:', error);
                    // 继续执行，将使用后备音频
                }
            }
            
            // 检查是否有音频数据
            if (audioData) {
                console.log('[Audio Replacer Injected] Using audio data from content script');
                
                // 创建新的 AudioBuffer
                const buffer = audioContext.createBuffer(
                    audioData.numberOfChannels,
                    audioData.sampleRate * audioData.duration,
                    audioData.sampleRate
                );
                
                // 填充 AudioBuffer 的每个通道
                for (let i = 0; i < audioData.numberOfChannels; i++) {
                    const channelBuffer = buffer.getChannelData(i);
                    const channelData = audioData.channelData[i];
                    
                    // 将数据复制到通道缓冲区
                    for (let j = 0; j < channelData.length; j++) {
                        channelBuffer[j] = channelData[j];
                    }
                }
                
                // 创建音频源并设置缓冲区
                audioSource = audioContext.createBufferSource();
                audioSource.buffer = buffer;
                audioSource.loop = true;
                
                // 创建增益节点控制音量
                const gainNode = audioContext.createGain();
                gainNode.gain.value = 1.0; // 全音量
                
                // 创建媒体流目标
                audioDestination = audioContext.createMediaStreamDestination();
                
                // 连接节点
                audioSource.connect(gainNode);
                gainNode.connect(audioDestination);
                
                // 开始播放
                audioSource.start();
                
                // 保存流以便重用
                cachedAudioStream = audioDestination.stream;
                
                console.log('[Audio Replacer Injected] Created audio stream with MP3 data,', 
                    cachedAudioStream.getAudioTracks().length, 'audio tracks');
                    
                return cachedAudioStream;
            } else {
                // 如果没有音频数据，创建一个基本的音调作为后备
                console.log('[Audio Replacer Injected] No audio data available, creating fallback tone');
                
                // 创建振荡器作为音频源（这将播放一个音调）
                const oscillator = audioContext.createOscillator();
                oscillator.type = 'sine'; // 正弦波
                oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4 音调
                
                // 创建增益节点控制音量
                const gainNode = audioContext.createGain();
                gainNode.gain.value = 0.5; // 设置音量为一半
                
                // 创建媒体流目标
                audioDestination = audioContext.createMediaStreamDestination();
                
                // 连接节点
                oscillator.connect(gainNode);
                gainNode.connect(audioDestination);
                
                // 开始播放
                oscillator.start();
                
                // 保存流以便重用
                cachedAudioStream = audioDestination.stream;
                
                console.log('[Audio Replacer Injected] Created fallback audio stream with', 
                    cachedAudioStream.getAudioTracks().length, 'audio tracks');
                    
                return cachedAudioStream;
            }
        } catch (error) {
            console.error('[Audio Replacer Injected] Error creating audio stream:', error);
            throw error;
        }
    };
    
    // Override the enumerateDevices method
    navigator.mediaDevices.enumerateDevices = async function() {
        console.log('[Audio Replacer Injected] Enumerating devices (intercepted)');
        
        try {
            // Get original devices
            const originalDevices = await originalEnumerateDevices.apply(this, arguments);
            
            // 添加虚拟设备（始终添加）
            const virtualDevice = {
                deviceId: VIRTUAL_DEVICE_ID,
                groupId: 'sokuji-virtual-devices',
                kind: 'audioinput',
                label: VIRTUAL_DEVICE_LABEL
            };
            
            console.log('[Audio Replacer Injected] Adding virtual device to list');
            return [...originalDevices, virtualDevice];
        } catch (error) {
            console.error('[Audio Replacer Injected] Error in enumerateDevices:', error);
            // 出错时返回原始结果
            return await originalEnumerateDevices.apply(this, arguments);
        }
    };
    
    // Override getUserMedia to intercept audio requests
    navigator.mediaDevices.getUserMedia = async function(constraints) {
        console.log('[Audio Replacer Injected] getUserMedia intercepted', constraints);
        
        try {
            // 检查是否请求了音频，以及是否指定了我们的虚拟设备
            if (constraints && 
                constraints.audio && 
                constraints.audio.deviceId && 
                constraints.audio.deviceId.exact === VIRTUAL_DEVICE_ID) {
                
                console.log('[Audio Replacer Injected] Virtual device requested, creating audio stream');
                
                // 直接创建音频流
                try {
                    const stream = await createLoopedAudioStream();
                    console.log('[Audio Replacer Injected] Audio stream created successfully');
                    return stream;
                } catch (error) {
                    console.error('[Audio Replacer Injected] Failed to create audio stream:', error);
                    throw new Error('Failed to create audio stream: ' + error.message);
                }
            } else {
                // 如果不是请求我们的虚拟设备，使用原始方法
                console.log('[Audio Replacer Injected] Not our virtual device, using original getUserMedia');
                return await originalGetUserMedia.apply(this, arguments);
            }
        } catch (error) {
            console.error('[Audio Replacer Injected] Error in getUserMedia:', error);
            // 出错时使用原始方法
            return await originalGetUserMedia.apply(this, arguments);
        }
    };
    
    // 初始化时请求音频数据
    requestAudioData().catch(error => {
        console.warn('[Audio Replacer Injected] Initial audio data request failed:', error);
    });
    
    console.log('[Audio Replacer Injected] Navigator methods successfully overridden');
})();
