/**
 * Test Runner - Main orchestrator for AI model testing
 */

import { TestCaseLoader } from './TestCaseLoader.js';
import { TestExecutor } from './TestExecutor.js';
import { ResultWriter } from './ResultWriter.js';
import { LLMJudge } from '../evaluation/LLMJudge.js';
import { isProviderSupported } from '../clients/NodeClientFactory.js';
import type {
  TestCase,
  TestResult,
  RunnerConfig,
  CLIOptions,
  TestStatus,
} from '../types.js';
import {
  printStatus,
  printTestCaseSummary,
  printFinalSummary,
  printSeparator,
  formatDuration,
  formatScore,
} from '../cli.js';

/**
 * Test run summary
 */
interface RunSummary {
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  duration: number;
}

/**
 * Test runner class
 */
export class TestRunner {
  private config: RunnerConfig;
  private loader: TestCaseLoader;
  private executor: TestExecutor;
  private writer: ResultWriter;
  private judge: LLMJudge;

  constructor(config: RunnerConfig, options: CLIOptions = {}) {
    this.config = config;
    this.loader = new TestCaseLoader(config);
    this.executor = new TestExecutor(config);
    this.writer = new ResultWriter(config, options.outputDir);
    this.judge = new LLMJudge(config);
  }

  /**
   * Run all tests matching the given options
   */
  async runAll(options: CLIOptions = {}): Promise<RunSummary> {
    const startTime = Date.now();
    const summary: RunSummary = {
      passed: 0,
      failed: 0,
      errors: 0,
      skipped: 0,
      duration: 0,
    };

    // Load and filter test cases
    let testCases: TestCase[];
    try {
      const allTestCases = this.loader.loadAllTestCases();
      testCases = this.loader.filterTestCases(allTestCases, options);
    } catch (error) {
      printStatus('error', `Failed to load test cases: ${error}`);
      summary.errors = 1;
      return summary;
    }

    if (testCases.length === 0) {
      printStatus('info', 'No test cases match the given criteria');
      return summary;
    }

    printStatus('info', `Found ${testCases.length} test case(s) to run`);
    printSeparator();

    // Run each test case
    for (const testCase of testCases) {
      const result = await this.runTestCase(testCase, options);

      switch (result.status) {
        case 'passed':
          summary.passed++;
          break;
        case 'failed':
          summary.failed++;
          break;
        case 'error':
          summary.errors++;
          break;
        case 'skipped':
          summary.skipped++;
          break;
      }
    }

    summary.duration = Date.now() - startTime;

    // Print final summary
    printFinalSummary(summary);

    return summary;
  }

  /**
   * Run a single test case
   */
  async runTestCase(testCase: TestCase, options: CLIOptions = {}): Promise<TestResult> {
    printTestCaseSummary(testCase);

    // Check if provider is supported
    if (!isProviderSupported(testCase.provider)) {
      printStatus('skipped', `Provider not supported: ${testCase.provider}`);
      const result = this.writer.createResult(testCase.id, 'skipped', {
        outputs: [],
      });
      this.writer.writeResult(result);
      return result;
    }

    const startTime = Date.now();

    try {
      // Execute the test
      printStatus('running', 'Executing test...');
      const executionResult = await this.executor.execute(testCase);

      // Check for execution errors
      if (executionResult.error) {
        throw executionResult.error;
      }

      // Evaluate with LLM Judge (unless skipped)
      let evaluation: TestResult['evaluation'];
      if (!options.skipEvaluation) {
        printStatus('running', 'Evaluating with LLM Judge...');
        try {
          evaluation = await this.judge.evaluate(testCase, executionResult.outputs);
        } catch (error) {
          printStatus('error', `LLM evaluation failed: ${error}`);
          // Continue without evaluation
        }
      }

      // Determine test status
      const evalResult = this.executor.evaluateResult(
        executionResult.outputs,
        testCase,
        evaluation
      );

      const status: TestStatus = evalResult.passed ? 'passed' : 'failed';
      const duration = Date.now() - startTime;

      // Create and write result
      const result = this.writer.createResult(testCase.id, status, {
        duration,
        config: testCase.config,
        outputs: executionResult.outputs,
        evaluation,
      });

      const resultPath = this.writer.writeResult(result);

      // Print result
      if (status === 'passed') {
        printStatus('passed', `Test passed in ${formatDuration(duration)}`);
      } else {
        printStatus('failed', `Test failed: ${evalResult.reason || 'Unknown reason'}`);
      }

      if (evaluation?.overallScore !== undefined) {
        console.log(`  Score: ${formatScore(evaluation.overallScore)}`);
        if (evaluation.dimensionScores) {
          for (const [dim, score] of Object.entries(evaluation.dimensionScores)) {
            console.log(`    ${dim}: ${formatScore(score)}`);
          }
        }
      }

      console.log(`  Result: ${resultPath}`);
      printSeparator();

      return result;
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const duration = Date.now() - startTime;

      printStatus('error', `Test error: ${errorObj.message}`);

      const result = this.writer.createResult(testCase.id, 'error', {
        duration,
        config: testCase.config,
        outputs: [],
        error: {
          message: errorObj.message,
          stack: errorObj.stack,
        },
      });

      this.writer.writeResult(result);
      printSeparator();

      return result;
    }
  }

  /**
   * List available test cases
   */
  listTestCases(): void {
    const testCases = this.loader.listTestCases();

    if (testCases.length === 0) {
      printStatus('info', 'No test cases found');
      return;
    }

    console.log('\nAvailable Test Cases:');
    printSeparator();

    for (const tc of testCases) {
      console.log(`\n  ID:       ${tc.id}`);
      console.log(`  Name:     ${tc.name}`);
      console.log(`  Provider: ${tc.provider}`);
      console.log(`  Tags:     ${tc.tags.length > 0 ? tc.tags.join(', ') : '(none)'}`);
      console.log(`  Inputs:   ${tc.inputCount}`);
    }

    printSeparator();
    console.log(`\nTotal: ${testCases.length} test case(s)`);

    // Show available providers and tags
    const providers = this.loader.getProviders();
    const tags = this.loader.getTags();

    console.log(`\nProviders: ${providers.join(', ')}`);
    console.log(`Tags: ${tags.length > 0 ? tags.join(', ') : '(none)'}`);
  }

  /**
   * Validate all test cases
   */
  validateTestCases(): boolean {
    const results = this.loader.validateAllTestCases();

    console.log('\nTest Case Validation Results:');
    printSeparator();

    let allValid = true;

    for (const result of results) {
      if (result.valid) {
        printStatus('passed', result.file);
      } else {
        allValid = false;
        printStatus('failed', result.file);
        for (const error of result.errors) {
          console.log(`    ${error}`);
        }
      }
    }

    printSeparator();

    if (allValid) {
      printStatus('passed', `All ${results.length} test case(s) are valid`);
    } else {
      const invalidCount = results.filter(r => !r.valid).length;
      printStatus('failed', `${invalidCount} of ${results.length} test case(s) are invalid`);
    }

    return allValid;
  }
}
