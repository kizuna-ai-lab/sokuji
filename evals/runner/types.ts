/**
 * TypeScript type definitions for Evaluation Framework
 */

// Provider types (aligned with src/types/Provider.ts)
export type TestProvider = 'openai' | 'gemini' | 'palabra_ai' | 'kizuna_ai' | 'openai_compatible';

// Test case status
export type TestStatus = 'passed' | 'failed' | 'error' | 'skipped';

// Input types
export type InputType = 'audio' | 'text';

// Audio formats
export type AudioFormat = 'pcm16' | 'g711_ulaw' | 'g711_alaw';

// Turn detection types
export type TurnDetectionType = 'server_vad' | 'semantic_vad' | 'none';

/**
 * Turn detection configuration
 */
export interface TurnDetectionConfig {
  type: TurnDetectionType;
  threshold?: number;
  prefixPaddingMs?: number;
  silenceDurationMs?: number;
  eagerness?: string;
}

/**
 * Input audio transcription settings
 */
export interface InputAudioTranscription {
  model: string;
}

/**
 * Test case configuration
 */
export interface TestCaseConfig {
  model: string;
  systemInstruction?: string;
  temperature?: number;
  voice?: string;
  inputAudioFormat?: AudioFormat;
  outputAudioFormat?: AudioFormat;
  inputAudioTranscription?: InputAudioTranscription;
  turnDetection?: TurnDetectionConfig;
  additionalParams?: Record<string, unknown>;
}

/**
 * Input context information
 */
export interface InputContext {
  domain?: string;
  formality?: string;
  speakerInfo?: string;
  bugDescription?: string;
}

/**
 * Test input definition
 */
export interface TestInput {
  id: string;
  type: InputType;
  audioFile?: string;
  textContent?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  transcript?: string; // For audio inputs
  expectedTranscription?: string;
  context?: InputContext;
}

/**
 * Scoring rubric dimension
 */
export interface ScoringDimension {
  weight: number;
  description: string;
}

/**
 * LLM Judge configuration
 */
export interface JudgeConfig {
  provider?: string;
  model?: string;
  systemPrompt?: string;
  scoringRubric?: Record<string, ScoringDimension>;
}

/**
 * Evaluation configuration
 */
export interface EvaluationConfig {
  type: 'llm-judge';
  judgeConfig: JudgeConfig;
  passThreshold?: number;
}

/**
 * Test case metadata
 */
export interface TestCaseMetadata {
  createdAt?: string;
  updatedAt?: string;
  author?: string;
  version?: string;
  postmortem?: {
    incidentDate?: string;
    incidentDescription?: string;
    expectedBehavior?: string;
    actualBehavior?: string;
    rootCause?: string;
    fixApplied?: string;
  };
  audioInfo?: {
    format?: string;
    recordedBy?: string;
    notes?: string;
  };
}

/**
 * Test case definition (matches test-case.schema.json)
 */
export interface TestCase {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  provider: TestProvider;
  config: TestCaseConfig;
  inputs: TestInput[];
  evaluation: EvaluationConfig;
  metadata?: TestCaseMetadata;
}

/**
 * Latency measurements
 */
export interface LatencyMeasurement {
  firstByte?: number;
  total?: number;
}

/**
 * Token usage statistics
 */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/**
 * Output result for a single input
 */
export interface OutputResult {
  inputId: string;
  inputTranscription?: string;
  outputTranscription?: string;
  expectedTranscription?: string;
  audioResponseFile?: string;
  latency?: LatencyMeasurement;
  tokenUsage?: TokenUsage;
  rawEvents?: Record<string, unknown>[];
}

/**
 * LLM Judge evaluation result
 */
export interface EvaluationResult {
  overallScore?: number;
  passed?: boolean;
  dimensionScores?: Record<string, number>;
  judgeResponse?: string;
  notes?: string;
  error?: string;
}

/**
 * Environment information
 */
export interface EnvironmentInfo {
  platform?: string;
  nodeVersion?: string;
  appVersion?: string;
}

/**
 * Error information
 */
export interface ErrorInfo {
  message?: string;
  stack?: string;
  code?: string;
}

/**
 * Test result (matches test-result.schema.json)
 */
export interface TestResult {
  runId: string;
  testCaseId: string;
  timestamp: string;
  status: TestStatus;
  duration?: number;
  config?: TestCaseConfig;
  outputs: OutputResult[];
  evaluation?: EvaluationResult;
  environment?: EnvironmentInfo;
  error?: ErrorInfo;
  instructionSource?: string;  // Name of instruction override used (if any)
}

/**
 * CLI options
 */
export interface CLIOptions {
  case?: string;
  provider?: TestProvider;
  tag?: string;
  skipEvaluation?: boolean;
  verbose?: boolean;
  outputDir?: string;
  instruction?: string;      // Load instruction from evals/instructions/<name>.md
  instructionFile?: string;  // Load instruction from arbitrary file path
}

/**
 * Runner configuration
 */
export interface RunnerConfig {
  testCasesDir: string;
  resultsDir: string;
  audioDir: string;
  schemasDir: string;
  instructionsDir: string;  // Directory for system instruction files
  apiKeys: {
    openai?: string;
    gemini?: string;
    palabraai?: string;
    kizunaai?: string;
  };
  judge: {
    provider: string;
    model: string;
  };
  verbose: boolean;
}

/**
 * Audio data representation
 */
export interface AudioData {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  samples: Int16Array;
  duration: number; // in seconds
}

/**
 * Client conversation item (simplified from IClient)
 */
export interface ConversationItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  type: 'message' | 'function_call' | 'function_call_output' | 'error';
  status: 'in_progress' | 'completed' | 'incomplete' | 'cancelled';
  formatted?: {
    text?: string;
    transcript?: string;
    audio?: Int16Array | ArrayBuffer;
  };
  content?: Array<{
    type: string;
    text?: string;
    audio?: unknown;
    transcript?: string | null;
  }>;
}

/**
 * Test execution context
 */
export interface ExecutionContext {
  testCase: TestCase;
  config: RunnerConfig;
  startTime: number;
  outputs: OutputResult[];
  rawEvents: Record<string, unknown>[];
}
