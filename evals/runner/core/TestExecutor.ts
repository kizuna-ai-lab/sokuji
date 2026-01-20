/**
 * Test Executor - Executes individual test cases
 *
 * Uses the openai-realtime-api library's conversation.item.completed event
 * to correctly handle cancelled responses (e.g., when server_vad detects
 * new speech and cancels in-progress responses).
 */

import { NodeOpenAIClient, type NodeClientEventHandlers } from '../clients/NodeOpenAIClient.js';
import { AudioLoader } from '../audio/AudioLoader.js';
import { createClient, isProviderSupported } from '../clients/NodeClientFactory.js';
import type {
  TestCase,
  TestInput,
  OutputResult,
  RunnerConfig,
  TestResult,
  LatencyMeasurement,
  TokenUsage,
  ConversationItem,
} from '../types.js';
import { printStatus } from '../cli.js';

/**
 * Execution result for a single input
 */
interface InputExecutionResult {
  inputId: string;
  inputTranscription?: string;
  outputTranscription?: string;
  expectedTranscription?: string;
  latency: LatencyMeasurement;
  tokenUsage?: TokenUsage;
  rawEvents: Record<string, unknown>[];
  error?: Error;
}

/**
 * Test executor class
 */
export class TestExecutor {
  private config: RunnerConfig;
  private audioLoader: AudioLoader;

  constructor(config: RunnerConfig) {
    this.config = config;
    this.audioLoader = new AudioLoader(config);
  }

  /**
   * Execute a test case
   */
  async execute(testCase: TestCase): Promise<{
    outputs: OutputResult[];
    duration: number;
    error?: Error;
    tokenUsage?: TokenUsage;
  }> {
    const startTime = Date.now();
    const outputs: OutputResult[] = [];
    let totalTokenUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };

    // Check if provider is supported
    if (!isProviderSupported(testCase.provider)) {
      throw new Error(`Provider not supported for testing: ${testCase.provider}`);
    }

    // Create client
    const client = createClient(testCase.provider, this.config) as NodeOpenAIClient;

    try {
      // Connect to the API
      if (this.config.verbose) {
        printStatus('running', `Connecting to ${testCase.provider}...`);
      }

      await client.connect(testCase.config);

      if (this.config.verbose) {
        printStatus('info', 'Connected successfully');
      }

      // Execute each input with retry logic for audio inputs
      const MAX_RETRIES = 3;
      const RETRY_DELAYS = [1000, 2000, 3000]; // Increasing delays between retries

      for (const input of testCase.inputs) {
        if (this.config.verbose) {
          printStatus('running', `Processing input: ${input.id}`);
        }

        let lastError: Error | null = null;
        let result: InputExecutionResult | null = null;

        // Retry loop for handling intermittent errors
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          // Small delay before each attempt to let server state settle
          if (input.type === 'audio') {
            await this.delay(100);
          }

          try {
            result = await this.executeInput(client, input, testCase);
            lastError = null;
            break; // Success, exit retry loop
          } catch (error) {
            lastError = error as Error;

            // Check if this is a retryable "buffer too small" error
            const isBufferError = lastError.message?.includes('buffer too small');

            if (isBufferError && attempt < MAX_RETRIES) {
              const retryDelay = RETRY_DELAYS[attempt];
              if (this.config.verbose) {
                printStatus('warning', `Audio buffer error, retrying (${attempt + 1}/${MAX_RETRIES}) after ${retryDelay}ms...`);
              }
              await this.delay(retryDelay);
              continue;
            }

            // Non-retryable error or max retries reached
            break;
          }
        }

        if (result) {
          outputs.push({
            inputId: result.inputId,
            inputTranscription: result.inputTranscription,
            outputTranscription: result.outputTranscription,
            expectedTranscription: result.expectedTranscription,
            latency: result.latency,
            tokenUsage: result.tokenUsage,
            rawEvents: result.rawEvents,
          });

          // Accumulate token usage
          if (result.tokenUsage) {
            totalTokenUsage.inputTokens! += result.tokenUsage.inputTokens || 0;
            totalTokenUsage.outputTokens! += result.tokenUsage.outputTokens || 0;
            totalTokenUsage.totalTokens! += result.tokenUsage.totalTokens || 0;
          }

          if (this.config.verbose) {
            printStatus('info', `Output: ${result.outputTranscription?.substring(0, 100)}...`);
          }
        } else {
          console.error(`Error processing input ${input.id}:`, lastError);
          outputs.push({
            inputId: input.id,
            expectedTranscription: input.expectedTranscription,
            latency: { total: Date.now() - startTime },
            rawEvents: [],
          });
        }

        // Wait between inputs to ensure previous response is fully processed
        await this.delay(2000);
      }

      return {
        outputs,
        duration: Date.now() - startTime,
        tokenUsage: totalTokenUsage,
      };
    } finally {
      // Always disconnect
      client.disconnect();
    }
  }

  /**
   * Execute a single input
   *
   * Uses onItemCompleted as the completion signal instead of onResponseDone.
   * This is critical because:
   * - onResponseDone fires for BOTH 'completed' AND 'cancelled' responses
   * - onItemCompleted ONLY fires when an item is truly completed
   *
   * When server_vad detects new speech during a response, it:
   * 1. Cancels the current response (response.done with status='cancelled')
   * 2. Creates a new response for the new speech
   * 3. The completed response fires conversation.item.completed
   *
   * By using onItemCompleted, we automatically get the correct final response.
   */
  private async executeInput(
    client: NodeOpenAIClient,
    input: TestInput,
    testCase: TestCase
  ): Promise<InputExecutionResult> {
    const rawEvents: Record<string, unknown>[] = [];
    let inputTranscription: string | undefined;
    let outputTranscription: string | undefined;
    let firstByteTime: number | undefined;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for response for input: ${input.id}`));
      }, 60000); // 60 second timeout

      // Set up event handlers
      const handlers: NodeClientEventHandlers = {
        onEvent: (event) => {
          rawEvents.push(event as Record<string, unknown>);
        },

        onInputTranscription: (_itemId, transcript) => {
          inputTranscription = transcript;
        },

        onOutputTranscription: (text) => {
          if (!firstByteTime) {
            firstByteTime = Date.now();
          }
          // Track streaming transcript (may be updated multiple times)
          outputTranscription = text;
        },

        // CRITICAL: Use onItemCompleted instead of onResponseDone
        // This only fires when an assistant item is truly completed,
        // not when a response is cancelled mid-stream
        onItemCompleted: (item: ConversationItem) => {
          clearTimeout(timeout);

          // Extract final transcription from the completed item
          const finalTranscription =
            item.formatted?.transcript ||
            item.formatted?.text ||
            outputTranscription;

          const endTime = Date.now();

          // Small delay to ensure all events have been processed
          setTimeout(() => {
            resolve({
              inputId: input.id,
              inputTranscription: inputTranscription || input.transcript || input.textContent,
              outputTranscription: finalTranscription,
              expectedTranscription: input.expectedTranscription,
              latency: {
                firstByte: firstByteTime ? firstByteTime - startTime : undefined,
                total: endTime - startTime,
              },
              rawEvents,
            });
          }, 100);
        },

        onError: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      };

      client.setEventHandlers(handlers);

      // Send input based on type
      if (input.type === 'text' && input.textContent) {
        // Text input
        client.sendTextInput(input.textContent);
        client.createResponse();
      } else if (input.type === 'audio' && input.audioFile) {
        // Audio input
        this.audioLoader.loadAudio(input.audioFile)
          .then(async (audioData) => {
            // Send audio in chunks with small delay between batches
            const chunks = this.audioLoader.splitIntoChunks(audioData, 100);
            const BATCH_SIZE = 10;

            for (let i = 0; i < chunks.length; i++) {
              client.appendInputAudio(chunks[i]);

              // Small delay every BATCH_SIZE chunks to allow server to process
              if ((i + 1) % BATCH_SIZE === 0 && i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 10));
              }
            }

            // Wait for audio to be fully sent
            await client.waitForDrain();

            // Commit audio buffer (no-op with library, but keeps API consistent)
            client.commitInputAudio();

            // With server_vad enabled, the server automatically creates responses
            // after detecting end of speech. Only call createResponse() manually
            // when turn detection is disabled ('none') to avoid conflicts.
            const turnDetectionType = testCase.config.turnDetection?.type;
            if (turnDetectionType === 'none' || !turnDetectionType) {
              client.createResponse();
            }
            // Otherwise, server_vad will trigger response automatically
          })
          .catch((error) => {
            clearTimeout(timeout);
            reject(error);
          });
      } else {
        clearTimeout(timeout);
        reject(new Error(`Invalid input configuration for: ${input.id}`));
      }
    });
  }

  /**
   * Check if test passed based on evaluation
   */
  evaluateResult(
    outputs: OutputResult[],
    testCase: TestCase,
    evaluationResult?: TestResult['evaluation']
  ): { passed: boolean; reason?: string } {
    // If we have an LLM evaluation result, use it
    if (evaluationResult?.overallScore !== undefined) {
      const threshold = testCase.evaluation.passThreshold || 0.7;
      const passed = evaluationResult.overallScore >= threshold;
      return {
        passed,
        reason: passed
          ? undefined
          : `Score ${evaluationResult.overallScore.toFixed(2)} below threshold ${threshold}`,
      };
    }

    // Basic check: ensure all inputs got outputs
    const missingOutputs = outputs.filter(o => !o.outputTranscription);
    if (missingOutputs.length > 0) {
      return {
        passed: false,
        reason: `Missing output for inputs: ${missingOutputs.map(o => o.inputId).join(', ')}`,
      };
    }

    return { passed: true };
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
