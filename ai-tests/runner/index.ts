#!/usr/bin/env node
/**
 * AI Model Test Runner - Entry Point
 *
 * CLI tool for running AI model translation quality tests.
 */

import { parseArgs, printStatus, printSeparator } from './cli.js';
import { loadConfig, validateConfig, getAppVersion } from './config.js';
import { TestRunner } from './core/TestRunner.js';

async function main(): Promise<void> {
  // Parse command line arguments
  const { command, options } = parseArgs(process.argv.slice(2));

  // Load configuration
  const config = loadConfig({ verbose: options.verbose });

  // Print header
  console.log(`\n🧪 AI Model Test Runner v${getAppVersion()}`);
  printSeparator('═');

  // Handle different commands
  switch (command) {
    case 'list': {
      const runner = new TestRunner(config, options);
      runner.listTestCases();
      break;
    }

    case 'validate': {
      const runner = new TestRunner(config, options);
      const valid = runner.validateTestCases();
      process.exitCode = valid ? 0 : 1;
      break;
    }

    case 'run':
    default: {
      // Validate configuration for run command
      const validation = validateConfig(config);
      if (!validation.valid) {
        printStatus('error', 'Configuration errors:');
        for (const error of validation.errors) {
          console.log(`  - ${error}`);
        }
        process.exitCode = 1;
        return;
      }

      // Run tests
      const runner = new TestRunner(config, options);
      const summary = await runner.runAll(options);

      // Set exit code based on results
      if (summary.failed > 0 || summary.errors > 0) {
        process.exitCode = 1;
      }
      break;
    }
  }
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exitCode = 1;
});
