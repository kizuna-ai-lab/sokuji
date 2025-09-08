/**
 * Performance configuration for audio processing
 */

// Check if we're in production environment
const isProduction = process.env.NODE_ENV === 'production';

// Debug logging configuration
export const DEBUG_CONFIG = {
  // Disable verbose logging in production
  ENABLE_AUDIO_CHUNK_LOGGING: !isProduction,
  AUDIO_CHUNK_LOG_INTERVAL: isProduction ? 5000 : 500, // Log less frequently in production
  
  ENABLE_PROCESSOR_LOGGING: !isProduction,
  PROCESSOR_LOG_INTERVAL: isProduction ? 10000 : 1000,
  
  ENABLE_VERBOSE_LOGGING: !isProduction,
};

// Performance optimization settings
export const PERFORMANCE_CONFIG = {
  // Audio buffer sizes
  SCRIPT_PROCESSOR_BUFFER_SIZE: 16384, // Larger buffer = less CPU usage
  AUDIO_WORKLET_BUFFER_SIZE: 512, // Optimal for AudioWorklet
  
  // Streaming buffer thresholds
  MIN_STREAMING_BUFFER_SECONDS: 0.15, // 150ms minimum buffer
  FLUSH_TIMEOUT_MS: 150, // Increased from 100ms
  
  // Echo cancellation settings
  PASSTHROUGH_DELAY_MS: 50,
  MIN_PASSTHROUGH_VOLUME: 0.01,
  
  // Chunk processing
  PCM_CONVERSION_CHUNK_SIZE: 256,
  BASE64_CHUNK_SIZE: 0x8000, // 32KB chunks
};

// Audio constraints profiles
export const AUDIO_CONSTRAINT_PROFILES = {
  // High quality mode (default)
  HIGH_QUALITY: {
    echoCancellation: true,
    echoCancellationType: 'system',
    noiseSuppression: true,
    autoGainControl: true,
    suppressLocalAudioPlayback: true,
    googEchoCancellation: true,
    googNoiseSuppression: true,
    googAutoGainControl: true,
    googHighpassFilter: true,
    googTypingNoiseDetection: true,
    googAudioMirroring: false,
  },
  
  // Performance mode (reduced processing)
  PERFORMANCE: {
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: true,
    suppressLocalAudioPlayback: true,
    googEchoCancellation: true,
    googNoiseSuppression: false,
    googAutoGainControl: true,
    googHighpassFilter: false,
    googTypingNoiseDetection: false,
    googAudioMirroring: false,
  },
  
  // Minimal mode (lowest CPU usage)
  MINIMAL: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    suppressLocalAudioPlayback: false,
  },
};