/**
 * Audio Loader - Loads audio files (WAV, FLAC) and converts to PCM16 format
 *
 * OpenAI Realtime API requires:
 * - Format: PCM16 (signed 16-bit little-endian)
 * - Sample rate: 24000 Hz
 * - Channels: 1 (mono)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import type { AudioData, RunnerConfig } from '../types.js';

const TARGET_SAMPLE_RATE = 24000;
const TARGET_CHANNELS = 1;
const TARGET_BIT_DEPTH = 16;

/**
 * Audio loader class
 */
export class AudioLoader {
  private config: RunnerConfig;

  constructor(config: RunnerConfig) {
    this.config = config;
  }

  /**
   * Load an audio file and convert to PCM16 format
   */
  async loadAudio(relativePath: string): Promise<AudioData> {
    const absolutePath = resolve(this.config.audioDir, '..', relativePath);

    if (!existsSync(absolutePath)) {
      throw new Error(`Audio file not found: ${absolutePath}`);
    }

    const extension = absolutePath.toLowerCase().split('.').pop();

    switch (extension) {
      case 'wav':
        return this.loadWav(absolutePath);
      case 'flac':
        return this.loadFlac(absolutePath);
      default:
        throw new Error(`Unsupported audio format: ${extension}`);
    }
  }

  /**
   * Load a WAV file
   */
  private loadWav(filePath: string): AudioData {
    const buffer = readFileSync(filePath);

    // Parse WAV header
    const header = this.parseWavHeader(buffer);

    // Extract audio data
    const audioDataStart = 44; // Standard WAV header size
    const audioBuffer = buffer.slice(audioDataStart);

    // Convert to Int16Array
    let samples: Int16Array;
    if (header.bitDepth === 16) {
      samples = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2);
    } else if (header.bitDepth === 8) {
      // Convert 8-bit unsigned to 16-bit signed
      samples = new Int16Array(audioBuffer.length);
      for (let i = 0; i < audioBuffer.length; i++) {
        samples[i] = (audioBuffer[i] - 128) * 256;
      }
    } else if (header.bitDepth === 32) {
      // Convert 32-bit float to 16-bit signed
      const float32 = new Float32Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 4);
      samples = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        samples[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
      }
    } else {
      throw new Error(`Unsupported bit depth: ${header.bitDepth}`);
    }

    // Convert to mono if needed
    if (header.channels > 1) {
      samples = this.convertToMono(samples, header.channels);
    }

    // Resample if needed
    if (header.sampleRate !== TARGET_SAMPLE_RATE) {
      samples = this.resample(samples, header.sampleRate, TARGET_SAMPLE_RATE);
    }

    const duration = samples.length / TARGET_SAMPLE_RATE;

    return {
      sampleRate: TARGET_SAMPLE_RATE,
      channels: TARGET_CHANNELS,
      bitDepth: TARGET_BIT_DEPTH,
      samples,
      duration,
    };
  }

  /**
   * Parse WAV file header
   */
  private parseWavHeader(buffer: Buffer): {
    sampleRate: number;
    channels: number;
    bitDepth: number;
  } {
    // Check RIFF header
    const riff = buffer.toString('ascii', 0, 4);
    if (riff !== 'RIFF') {
      throw new Error('Invalid WAV file: missing RIFF header');
    }

    const wave = buffer.toString('ascii', 8, 12);
    if (wave !== 'WAVE') {
      throw new Error('Invalid WAV file: missing WAVE format');
    }

    // Find fmt chunk
    let offset = 12;
    while (offset < buffer.length - 8) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);

      if (chunkId === 'fmt ') {
        const channels = buffer.readUInt16LE(offset + 10);
        const sampleRate = buffer.readUInt32LE(offset + 12);
        const bitDepth = buffer.readUInt16LE(offset + 22);
        return { sampleRate, channels, bitDepth };
      }

      offset += 8 + chunkSize;
    }

    throw new Error('Invalid WAV file: fmt chunk not found');
  }

  /**
   * Load a FLAC file using ffmpeg
   */
  private loadFlac(filePath: string): AudioData {
    // Check if ffmpeg is available
    try {
      execSync('ffmpeg -version', { stdio: 'pipe' });
    } catch {
      throw new Error('ffmpeg is required to decode FLAC files. Please install ffmpeg.');
    }

    // Use ffmpeg to convert FLAC to raw PCM
    const ffmpegCmd = [
      'ffmpeg',
      '-i', `"${filePath}"`,
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-ar', TARGET_SAMPLE_RATE.toString(),
      '-ac', TARGET_CHANNELS.toString(),
      '-',
    ].join(' ');

    try {
      const output = execSync(ffmpegCmd, {
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const samples = new Int16Array(output.buffer, output.byteOffset, output.length / 2);
      const duration = samples.length / TARGET_SAMPLE_RATE;

      return {
        sampleRate: TARGET_SAMPLE_RATE,
        channels: TARGET_CHANNELS,
        bitDepth: TARGET_BIT_DEPTH,
        samples,
        duration,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to decode FLAC file: ${errorMessage}`);
    }
  }

  /**
   * Convert stereo/multi-channel audio to mono
   */
  private convertToMono(samples: Int16Array, channels: number): Int16Array {
    const monoLength = Math.floor(samples.length / channels);
    const mono = new Int16Array(monoLength);

    for (let i = 0; i < monoLength; i++) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        sum += samples[i * channels + ch];
      }
      mono[i] = Math.round(sum / channels);
    }

    return mono;
  }

  /**
   * Resample audio to target sample rate using linear interpolation
   */
  private resample(samples: Int16Array, fromRate: number, toRate: number): Int16Array {
    const ratio = fromRate / toRate;
    const outputLength = Math.floor(samples.length / ratio);
    const output = new Int16Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1);
      const t = srcIndex - srcIndexFloor;

      // Linear interpolation
      output[i] = Math.round(samples[srcIndexFloor] * (1 - t) + samples[srcIndexCeil] * t);
    }

    return output;
  }

  /**
   * Convert audio data to base64 encoded string (for API transmission)
   */
  toBase64(audioData: AudioData): string {
    const buffer = Buffer.from(audioData.samples.buffer);
    return buffer.toString('base64');
  }

  /**
   * Get audio duration in seconds
   */
  getDuration(audioData: AudioData): number {
    return audioData.duration;
  }

  /**
   * Split audio into chunks for streaming
   */
  splitIntoChunks(audioData: AudioData, chunkDurationMs: number = 100): Int16Array[] {
    const samplesPerChunk = Math.floor((audioData.sampleRate * chunkDurationMs) / 1000);
    const chunks: Int16Array[] = [];

    for (let i = 0; i < audioData.samples.length; i += samplesPerChunk) {
      const chunkEnd = Math.min(i + samplesPerChunk, audioData.samples.length);
      chunks.push(audioData.samples.slice(i, chunkEnd));
    }

    return chunks;
  }
}
