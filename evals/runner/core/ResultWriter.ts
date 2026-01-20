/**
 * Result Writer - Writes test results to JSON files
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { TestResult, RunnerConfig } from '../types.js';
import { getAppVersion } from '../config.js';

/**
 * Result writer class
 */
export class ResultWriter {
  private config: RunnerConfig;
  private ajv: Ajv;
  private schema: object | null = null;
  private outputDir: string;
  private instructionName: string | undefined;

  constructor(config: RunnerConfig, customOutputDir?: string, instructionName?: string) {
    this.config = config;
    this.instructionName = instructionName;
    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(this.ajv);
    this.loadSchema();

    // Set up output directory
    if (customOutputDir) {
      this.outputDir = customOutputDir;
    } else {
      // Use date-based directory structure: results/YYYY-MM-DD/
      const today = new Date().toISOString().split('T')[0];
      let baseDir = resolve(this.config.resultsDir, today);

      // Add instruction subdirectory if instruction override is specified
      if (instructionName) {
        // Sanitize instruction name for use as directory name
        const sanitizedInstructionName = instructionName
          .replace(/[/\\]/g, '-')
          .replace(/\.\./g, '-')
          .replace(/[\x00-\x1f\x7f]/g, '')
          .trim();
        this.outputDir = resolve(baseDir, sanitizedInstructionName);
      } else {
        // Use 'original' subdirectory when no instruction override
        this.outputDir = resolve(baseDir, 'original');
      }
    }

    // Ensure output directory exists
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Load the test result JSON schema
   */
  private loadSchema(): void {
    const schemaPath = resolve(this.config.schemasDir, 'test-result.schema.json');
    if (existsSync(schemaPath)) {
      try {
        this.schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
      } catch (error) {
        console.warn(`Warning: Failed to load result schema: ${error}`);
      }
    }
  }

  /**
   * Validate a test result against the schema
   */
  validateResult(result: TestResult): { valid: boolean; errors: string[] } {
    if (!this.schema) {
      return { valid: true, errors: [] }; // Skip validation if schema not available
    }

    const validate = this.ajv.compile(this.schema);
    const valid = validate(result);

    if (valid) {
      return { valid: true, errors: [] };
    }

    const errors = (validate.errors || []).map(err => {
      const path = err.instancePath || '/';
      return `${path}: ${err.message}`;
    });

    return { valid: false, errors };
  }

  /**
   * Generate a unique run ID
   */
  generateRunId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `run_${timestamp}_${random}`;
  }

  /**
   * Get environment information
   */
  getEnvironmentInfo(): { platform: string; nodeVersion: string; appVersion: string } {
    return {
      platform: process.platform,
      nodeVersion: process.version,
      appVersion: getAppVersion(),
    };
  }

  /**
   * Sanitize a test case ID to prevent path traversal attacks
   */
  private sanitizeTestCaseId(testCaseId: string): string {
    // Remove path separators, null bytes, and control characters
    // Replace unsafe characters with '-'
    let sanitized = testCaseId
      .replace(/[/\\]/g, '-')          // Path separators
      .replace(/\x00/g, '')            // Null bytes
      .replace(/[\x00-\x1f\x7f]/g, '') // Control characters
      .replace(/\.\./g, '-')           // Directory traversal sequences
      .trim();

    // Ensure non-empty result
    if (!sanitized) {
      sanitized = this.generateRunId();
    }

    return sanitized;
  }

  /**
   * Write a test result to a file
   */
  writeResult(result: TestResult): string {
    // Validate the result
    const validation = this.validateResult(result);
    if (!validation.valid) {
      console.warn(`Warning: Result validation failed:\n  ${validation.errors.join('\n  ')}`);
    }

    // Sanitize testCaseId to prevent path traversal
    const sanitizedTestCaseId = this.sanitizeTestCaseId(result.testCaseId);

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${sanitizedTestCaseId}_${timestamp}.json`;
    const filePath = join(this.outputDir, filename);

    // Write to file
    writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');

    if (this.config.verbose) {
      console.log(`Result written to: ${filePath}`);
    }

    return filePath;
  }

  /**
   * Create a test result object
   */
  createResult(
    testCaseId: string,
    status: 'passed' | 'failed' | 'error' | 'skipped',
    options: {
      duration?: number;
      config?: TestResult['config'];
      outputs?: TestResult['outputs'];
      evaluation?: TestResult['evaluation'];
      error?: TestResult['error'];
      instructionSource?: string;
    } = {}
  ): TestResult {
    const result: TestResult = {
      runId: this.generateRunId(),
      testCaseId,
      timestamp: new Date().toISOString(),
      status,
      outputs: options.outputs || [],
      environment: this.getEnvironmentInfo(),
    };

    if (options.duration !== undefined) {
      result.duration = options.duration;
    }

    if (options.config) {
      result.config = options.config;
    }

    if (options.evaluation) {
      result.evaluation = options.evaluation;
    }

    if (options.error) {
      result.error = options.error;
    }

    if (options.instructionSource) {
      result.instructionSource = options.instructionSource;
    }

    return result;
  }

  /**
   * Get the output directory path
   */
  getOutputDir(): string {
    return this.outputDir;
  }
}
