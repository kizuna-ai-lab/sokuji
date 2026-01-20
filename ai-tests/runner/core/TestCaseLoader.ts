/**
 * Test Case Loader - Loads and validates test cases from JSON files
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { TestCase, RunnerConfig, TestProvider, CLIOptions } from '../types.js';

/**
 * Test case loader class
 */
export class TestCaseLoader {
  private config: RunnerConfig;
  private ajv: Ajv;
  private schema: object | null = null;

  constructor(config: RunnerConfig) {
    this.config = config;
    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(this.ajv);
    this.loadSchema();
  }

  /**
   * Load the test case JSON schema
   */
  private loadSchema(): void {
    const schemaPath = resolve(this.config.schemasDir, 'test-case.schema.json');
    if (existsSync(schemaPath)) {
      try {
        this.schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
      } catch (error) {
        console.warn(`Warning: Failed to load schema: ${error}`);
      }
    }
  }

  /**
   * Validate a test case against the schema
   */
  validateTestCase(testCase: unknown): { valid: boolean; errors: string[] } {
    if (!this.schema) {
      return { valid: true, errors: [] }; // Skip validation if schema not available
    }

    const validate = this.ajv.compile(this.schema);
    const valid = validate(testCase);

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
   * Load a single test case from a file
   */
  loadTestCase(filePath: string): TestCase {
    if (!existsSync(filePath)) {
      throw new Error(`Test case file not found: ${filePath}`);
    }

    const content = readFileSync(filePath, 'utf-8');
    const testCase = JSON.parse(content);

    const validation = this.validateTestCase(testCase);
    if (!validation.valid) {
      throw new Error(`Invalid test case ${filePath}:\n  ${validation.errors.join('\n  ')}`);
    }

    return testCase as TestCase;
  }

  /**
   * Load all test cases from the test cases directory
   */
  loadAllTestCases(): TestCase[] {
    const testCases: TestCase[] = [];
    const files = readdirSync(this.config.testCasesDir);

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = join(this.config.testCasesDir, file);
        try {
          const testCase = this.loadTestCase(filePath);
          testCases.push(testCase);
        } catch (error) {
          if (this.config.verbose) {
            console.error(`Error loading ${file}: ${error}`);
          }
        }
      }
    }

    // Sort by ID for consistent ordering
    testCases.sort((a, b) => a.id.localeCompare(b.id));

    return testCases;
  }

  /**
   * Filter test cases based on CLI options
   */
  filterTestCases(testCases: TestCase[], options: CLIOptions): TestCase[] {
    let filtered = [...testCases];

    // Filter by specific case ID
    if (options.case) {
      filtered = filtered.filter(tc => tc.id === options.case);
      if (filtered.length === 0) {
        throw new Error(`Test case not found: ${options.case}`);
      }
    }

    // Filter by provider
    if (options.provider) {
      filtered = filtered.filter(tc => tc.provider === options.provider);
    }

    // Filter by tag
    if (options.tag) {
      filtered = filtered.filter(tc => tc.tags?.includes(options.tag!));
    }

    return filtered;
  }

  /**
   * Get list of available test cases (for list command)
   */
  listTestCases(): Array<{
    id: string;
    name: string;
    provider: TestProvider;
    tags: string[];
    inputCount: number;
  }> {
    const testCases = this.loadAllTestCases();

    return testCases.map(tc => ({
      id: tc.id,
      name: tc.name,
      provider: tc.provider,
      tags: tc.tags || [],
      inputCount: tc.inputs.length,
    }));
  }

  /**
   * Validate all test cases (for validate command)
   */
  validateAllTestCases(): Array<{
    file: string;
    valid: boolean;
    errors: string[];
  }> {
    const results: Array<{ file: string; valid: boolean; errors: string[] }> = [];
    const files = readdirSync(this.config.testCasesDir);

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = join(this.config.testCasesDir, file);
        try {
          const content = readFileSync(filePath, 'utf-8');
          const testCase = JSON.parse(content);
          const validation = this.validateTestCase(testCase);
          results.push({
            file,
            valid: validation.valid,
            errors: validation.errors,
          });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          results.push({
            file,
            valid: false,
            errors: [`Parse error: ${errorMessage}`],
          });
        }
      }
    }

    return results;
  }

  /**
   * Get unique providers from all test cases
   */
  getProviders(): TestProvider[] {
    const testCases = this.loadAllTestCases();
    const providers = new Set(testCases.map(tc => tc.provider));
    return Array.from(providers);
  }

  /**
   * Get unique tags from all test cases
   */
  getTags(): string[] {
    const testCases = this.loadAllTestCases();
    const tags = new Set<string>();
    for (const tc of testCases) {
      if (tc.tags) {
        for (const tag of tc.tags) {
          tags.add(tag);
        }
      }
    }
    return Array.from(tags).sort();
  }
}
