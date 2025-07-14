/**
 * Modern Passthrough system with echo cancellation safety
 * Implements buffered and delayed passthrough to prevent immediate feedback loops
 * @class
 */
export class ModernPassthrough {
  /**
   * Create a new ModernPassthrough instance
   * @param {{bufferDelay?: number, maxBufferSize?: number}} [options]
   */
  constructor({ bufferDelay = 50, maxBufferSize = 10 } = {}) {
    this.enabled = false;
    this.volume = 0.2;
    this.bufferDelay = bufferDelay; // ms delay between chunks
    this.maxBufferSize = maxBufferSize; // maximum buffered chunks
    
    // Audio processing
    this.audioBuffer = [];
    this.isProcessing = false;
    this.processingTimeout = null;
    
    // Player reference
    this.player = null;
    
    // Statistics
    this.stats = {
      totalChunks: 0,
      droppedChunks: 0,
      avgDelay: 0
    };
  }

  /**
   * Initialize with a ModernAudioPlayer
   * @param {import('./ModernAudioPlayer.js').ModernAudioPlayer} player
   */
  initialize(player) {
    this.player = player;
    this.log('ModernPassthrough initialized');
  }

  /**
   * Enable or disable passthrough
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    
    if (!enabled) {
      this.clearBuffer();
    }
    
    this.log(`Passthrough ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Set passthrough volume
   * @param {number} volume Volume level (0.0 to 1.0)
   */
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.log(`Passthrough volume set to: ${this.volume}`);
  }

  /**
   * Add audio data to passthrough buffer
   * @param {Int16Array|ArrayBuffer} pcmData
   */
  addToPassthroughBuffer(pcmData) {
    if (!this.enabled || !this.player) {
      return;
    }

    // Convert to Int16Array if needed
    let audioData;
    if (pcmData instanceof Int16Array) {
      audioData = pcmData;
    } else if (pcmData instanceof ArrayBuffer) {
      audioData = new Int16Array(pcmData);
    } else {
      console.warn('[Sokuji] [ModernPassthrough] Invalid PCM data type');
      return;
    }

    // Skip empty data
    if (audioData.length === 0) {
      return;
    }

    // Prevent buffer overflow
    if (this.audioBuffer.length >= this.maxBufferSize) {
      // Drop oldest chunk
      this.audioBuffer.shift();
      this.stats.droppedChunks++;
      this.log(`Buffer full, dropped chunk. Total dropped: ${this.stats.droppedChunks}`);
    }

    // Add to buffer with timestamp
    this.audioBuffer.push({
      data: audioData,
      timestamp: Date.now()
    });

    this.stats.totalChunks++;

    // Start processing if not already active
    if (!this.isProcessing) {
      this.scheduleProcessing();
    }
  }

  /**
   * Schedule buffered playback with delay
   * @private
   */
  scheduleProcessing() {
    if (this.isProcessing || this.audioBuffer.length === 0) {
      return;
    }

    this.isProcessing = true;

    this.processingTimeout = setTimeout(() => {
      this.processNextChunk();
    }, this.bufferDelay);
  }

  /**
   * Process next chunk in buffer
   * @private
   */
  processNextChunk() {
    if (this.audioBuffer.length === 0 || !this.enabled) {
      this.isProcessing = false;
      return;
    }

    const chunk = this.audioBuffer.shift();
    
    try {
      // Calculate actual delay
      const actualDelay = Date.now() - chunk.timestamp;
      this.updateAverageDelay(actualDelay);

      // Play the chunk using the player's passthrough method
      this.player.playPassthrough(chunk.data, this.volume);
      
      this.log(`Played passthrough chunk with ${actualDelay}ms delay`);
    } catch (error) {
      console.error('[Sokuji] [ModernPassthrough] Error playing chunk:', error);
    }

    // Continue processing if more chunks available
    this.isProcessing = false;
    
    if (this.audioBuffer.length > 0) {
      this.scheduleProcessing();
    }
  }

  /**
   * Update average delay statistics
   * @private
   * @param {number} delay
   */
  updateAverageDelay(delay) {
    // Simple moving average
    this.stats.avgDelay = (this.stats.avgDelay * 0.9) + (delay * 0.1);
  }

  /**
   * Clear audio buffer
   */
  clearBuffer() {
    this.audioBuffer = [];
    
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }
    
    this.isProcessing = false;
    this.log('Audio buffer cleared');
  }

  /**
   * Get passthrough statistics
   * @returns {{totalChunks: number, droppedChunks: number, avgDelay: number, bufferSize: number}}
   */
  getStats() {
    return {
      ...this.stats,
      bufferSize: this.audioBuffer.length
    };
  }

  /**
   * Set buffer delay
   * @param {number} delay Delay in milliseconds
   */
  setBufferDelay(delay) {
    this.bufferDelay = Math.max(10, Math.min(500, delay)); // 10ms to 500ms
    this.log(`Buffer delay set to: ${this.bufferDelay}ms`);
  }

  /**
   * Set maximum buffer size
   * @param {number} size Maximum number of chunks to buffer
   */
  setMaxBufferSize(size) {
    this.maxBufferSize = Math.max(1, Math.min(50, size)); // 1 to 50 chunks
    
    // Trim current buffer if needed
    while (this.audioBuffer.length > this.maxBufferSize) {
      this.audioBuffer.shift();
      this.stats.droppedChunks++;
    }
    
    this.log(`Max buffer size set to: ${this.maxBufferSize}`);
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalChunks: 0,
      droppedChunks: 0,
      avgDelay: 0
    };
    this.log('Statistics reset');
  }

  /**
   * Check if passthrough is currently active
   * @returns {boolean}
   */
  isActive() {
    return this.enabled && this.isProcessing;
  }

  /**
   * Get current buffer utilization
   * @returns {number} Buffer utilization percentage (0-100)
   */
  getBufferUtilization() {
    return Math.round((this.audioBuffer.length / this.maxBufferSize) * 100);
  }

  /**
   * Advanced: Play immediate passthrough (bypass buffer)
   * Use only when buffer is not needed (e.g., testing)
   * @param {Int16Array} pcmData
   * @param {number} [volume]
   */
  playImmediate(pcmData, volume = this.volume) {
    if (!this.enabled || !this.player) {
      return;
    }

    this.log('Playing immediate passthrough (bypassing buffer)');
    this.player.playPassthrough(pcmData, volume);
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.clearBuffer();
    this.enabled = false;
    this.player = null;
    this.log('ModernPassthrough cleaned up');
  }

  /**
   * Log debug information
   * @private
   * @param {...any} args
   */
  log(...args) {
    console.log('[Sokuji] [ModernPassthrough]', ...args);
  }

  /**
   * Configure passthrough for different use cases
   * @param {"low-latency"|"balanced"|"quality"} mode
   */
  setMode(mode) {
    switch (mode) {
      case 'low-latency':
        this.setBufferDelay(10);
        this.setMaxBufferSize(3);
        this.log('Set to low-latency mode');
        break;
      
      case 'balanced':
        this.setBufferDelay(50);
        this.setMaxBufferSize(10);
        this.log('Set to balanced mode');
        break;
      
      case 'quality':
        this.setBufferDelay(100);
        this.setMaxBufferSize(20);
        this.log('Set to quality mode');
        break;
      
      default:
        console.warn('[Sokuji] [ModernPassthrough] Unknown mode:', mode);
    }
  }
}

// Make available globally for compatibility
globalThis.ModernPassthrough = ModernPassthrough;