/**
 * CLI command parsing for AI Model Testing Framework
 */

import type { CLIOptions, TestProvider } from './types.js';

interface ParsedCommand {
  command: 'run' | 'list' | 'validate';
  options: CLIOptions;
}

const HELP_TEXT = `
AI Model Test Runner

Usage:
  npm run ai-test                     Run all tests
  npm run ai-test -- list             List available test cases
  npm run ai-test -- validate         Validate test case schemas
  npm run ai-test -- [options]        Run tests with options

Options:
  --case <id>           Run specific test case by ID
  --provider <name>     Filter by provider (openai, gemini, etc.)
  --tag <tag>           Filter by tag
  --skip-evaluation     Skip LLM evaluation (only record outputs)
  --verbose             Enable verbose output
  --output-dir <path>   Custom output directory for results
  -h, --help            Show this help message

Examples:
  npm run ai-test -- --case regression-meta-commentary-001
  npm run ai-test -- --provider openai
  npm run ai-test -- --tag regression
  npm run ai-test -- --tag regression --skip-evaluation
  npm run ai-test -- list
  npm run ai-test -- validate

Environment Variables:
  OPENAI_API_KEY        OpenAI API key
  GEMINI_API_KEY        Google Gemini API key
  PALABRA_API_KEY       Palabra AI API key
  KIZUNA_API_KEY        Kizuna AI API key
  JUDGE_PROVIDER        LLM judge provider (default: openai)
  JUDGE_MODEL           LLM judge model (default: gpt-4o)
  VERBOSE               Enable verbose mode (true/false)
`;

/**
 * Parse command line arguments
 */
export function parseArgs(args: string[]): ParsedCommand {
  const options: CLIOptions = {};
  let command: 'run' | 'list' | 'validate' = 'run';

  // Check for help flag first
  if (args.includes('-h') || args.includes('--help')) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  // Check for command (list, validate)
  const commandIndex = args.findIndex(arg => arg === 'list' || arg === 'validate');
  if (commandIndex !== -1) {
    command = args[commandIndex] as 'list' | 'validate';
    args = [...args.slice(0, commandIndex), ...args.slice(commandIndex + 1)];
  }

  // Parse remaining arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--case':
        if (!nextArg || nextArg.startsWith('-')) {
          console.error('Error: --case requires a test case ID');
          process.exit(1);
        }
        options.case = nextArg;
        i++;
        break;

      case '--provider':
        if (!nextArg || nextArg.startsWith('-')) {
          console.error('Error: --provider requires a provider name');
          process.exit(1);
        }
        options.provider = nextArg as TestProvider;
        i++;
        break;

      case '--tag':
        if (!nextArg || nextArg.startsWith('-')) {
          console.error('Error: --tag requires a tag name');
          process.exit(1);
        }
        options.tag = nextArg;
        i++;
        break;

      case '--skip-evaluation':
        options.skipEvaluation = true;
        break;

      case '--verbose':
        options.verbose = true;
        break;

      case '--output-dir':
        if (!nextArg || nextArg.startsWith('-')) {
          console.error('Error: --output-dir requires a path');
          process.exit(1);
        }
        options.outputDir = nextArg;
        i++;
        break;

      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          console.log('Use --help for available options');
          process.exit(1);
        }
        break;
    }
  }

  return { command, options };
}

/**
 * Print help text
 */
export function printHelp(): void {
  console.log(HELP_TEXT);
}

/**
 * Print version
 */
export function printVersion(version: string): void {
  console.log(`AI Model Test Runner v${version}`);
}

/**
 * Format duration for display
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Format score as percentage
 */
export function formatScore(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

/**
 * Print colored status
 */
export function printStatus(status: string, message: string): void {
  const colors: Record<string, string> = {
    passed: '\x1b[32m',   // Green
    failed: '\x1b[31m',   // Red
    error: '\x1b[31m',    // Red
    skipped: '\x1b[33m',  // Yellow
    warning: '\x1b[33m',  // Yellow
    running: '\x1b[36m',  // Cyan
    info: '\x1b[34m',     // Blue
    reset: '\x1b[0m',
  };

  const color = colors[status] || colors.reset;
  console.log(`${color}[${status.toUpperCase()}]${colors.reset} ${message}`);
}

/**
 * Print a separator line
 */
export function printSeparator(char = '─', length = 60): void {
  console.log(char.repeat(length));
}

/**
 * Print test case summary
 */
export function printTestCaseSummary(testCase: { id: string; name: string; provider: string; tags?: string[] }): void {
  console.log(`\nTest Case: ${testCase.name}`);
  console.log(`  ID:       ${testCase.id}`);
  console.log(`  Provider: ${testCase.provider}`);
  if (testCase.tags && testCase.tags.length > 0) {
    console.log(`  Tags:     ${testCase.tags.join(', ')}`);
  }
}

/**
 * Print final summary
 */
export function printFinalSummary(results: { passed: number; failed: number; errors: number; skipped: number; duration: number }): void {
  printSeparator('═');
  console.log('\nTest Summary:');
  console.log(`  Passed:   ${results.passed}`);
  console.log(`  Failed:   ${results.failed}`);
  console.log(`  Errors:   ${results.errors}`);
  console.log(`  Skipped:  ${results.skipped}`);
  console.log(`  Total:    ${results.passed + results.failed + results.errors + results.skipped}`);
  console.log(`  Duration: ${formatDuration(results.duration)}`);
  printSeparator('═');

  // Set exit code based on results
  if (results.failed > 0 || results.errors > 0) {
    process.exitCode = 1;
  }
}
