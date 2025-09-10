/**
 * Token Usage Buffer
 * Batches token usage records to reduce database writes
 * Flushes automatically when buffer is full or on timer
 */

import { Env } from '../types';

export interface BufferedUsage {
  subjectType: 'user' | 'organization';
  subjectId: string;
  provider: string;
  model: string;
  endpoint?: string;
  method?: string;
  inputTokens: number;
  outputTokens: number;
  adjustedInputTokens: number;
  adjustedOutputTokens: number;
  adjustedTotalTokens: number;
  inputRatio: number;
  outputRatio: number;
  modality: string;
  sessionId?: string;
  requestId?: string;
  responseId?: string;
  eventType?: string;
  metadata?: Record<string, any>;
  timestamp: string;
  ledgerId: string;
}

export class TokenUsageBuffer {
  private buffer: BufferedUsage[] = [];
  private static readonly MAX_BUFFER_SIZE = 50; // Flush after 50 records
  private static readonly FLUSH_INTERVAL_MS = 30000; // Flush every 30 seconds
  private flushTimer?: number;
  private isProcessing = false;
  
  constructor(private env: Env) {
    // Start the flush timer
    this.startFlushTimer();
  }
  
  /**
   * Add a usage record to the buffer
   * Automatically flushes if buffer is full
   */
  async add(usage: BufferedUsage): Promise<void> {
    this.buffer.push(usage);
    
    // Flush if buffer is full
    if (this.buffer.length >= TokenUsageBuffer.MAX_BUFFER_SIZE) {
      await this.flush();
    }
  }
  
  /**
   * Flush all buffered records to the database
   */
  async flush(): Promise<void> {
    // Prevent concurrent flushes
    if (this.isProcessing || this.buffer.length === 0) {
      return;
    }
    
    this.isProcessing = true;
    const recordsToFlush = [...this.buffer];
    this.buffer = []; // Clear buffer immediately
    
    try {
      console.log(`Flushing ${recordsToFlush.length} usage records to database`);
      
      // Prepare batch insert
      const batch = recordsToFlush.map(record => {
        return this.env.DB.prepare(`
          INSERT INTO usage_logs (
            subject_type, subject_id,
            provider, model, endpoint, method,
            input_tokens, output_tokens, total_tokens,
            adjusted_input_tokens, adjusted_output_tokens, adjusted_total_tokens,
            input_ratio, output_ratio, modality,
            session_id, request_id, response_id, event_type,
            ledger_id, metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          record.subjectType,
          record.subjectId,
          record.provider,
          record.model,
          record.endpoint || null,
          record.method || null,
          record.inputTokens,
          record.outputTokens,
          record.inputTokens + record.outputTokens,
          record.adjustedInputTokens,
          record.adjustedOutputTokens,
          record.adjustedTotalTokens,
          record.inputRatio,
          record.outputRatio,
          record.modality,
          record.sessionId || null,
          record.requestId || null,
          record.responseId || null,
          record.eventType || null,
          record.ledgerId,
          JSON.stringify(record.metadata || {}),
          record.timestamp
        );
      });
      
      // Execute batch insert
      if (batch.length > 0) {
        await this.env.DB.batch(batch);
        console.log(`Successfully flushed ${batch.length} usage records`);
      }
      
    } catch (error) {
      console.error('Error flushing usage buffer:', error);
      // On error, try to restore records to buffer for retry
      // But cap the buffer size to prevent memory issues
      const remainingSpace = TokenUsageBuffer.MAX_BUFFER_SIZE - this.buffer.length;
      if (remainingSpace > 0) {
        this.buffer.push(...recordsToFlush.slice(0, remainingSpace));
      }
    } finally {
      this.isProcessing = false;
    }
  }
  
  /**
   * Start the periodic flush timer
   */
  private startFlushTimer(): void {
    // Clear existing timer if any
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    // Set up periodic flush
    this.flushTimer = setInterval(() => {
      this.flush().catch(error => {
        console.error('Error in periodic flush:', error);
      });
    }, TokenUsageBuffer.FLUSH_INTERVAL_MS) as unknown as number;
  }
  
  /**
   * Stop the flush timer and flush remaining records
   */
  async close(): Promise<void> {
    // Stop the timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    
    // Flush any remaining records
    await this.flush();
  }
  
  /**
   * Get the current buffer size
   */
  getBufferSize(): number {
    return this.buffer.length;
  }
}