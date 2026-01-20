/**
 * Instruction Loader - Loads system instruction overrides from .md files
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve, basename, extname } from 'path';
import type { RunnerConfig, CLIOptions } from '../types.js';

/**
 * Instruction data returned when loading an override
 */
export interface InstructionData {
  name: string;     // Name identifier (e.g., 'strict-translator')
  content: string;  // Full instruction content
}

/**
 * Instruction loader class for managing system instruction overrides
 */
export class InstructionLoader {
  private config: RunnerConfig;

  constructor(config: RunnerConfig) {
    this.config = config;
  }

  /**
   * Load instruction by name (without .md extension)
   * Looks in evals/instructions/<name>.md
   */
  loadInstruction(name: string): string {
    const filePath = resolve(this.config.instructionsDir, `${name}.md`);

    if (!existsSync(filePath)) {
      throw new Error(
        `Instruction file not found: ${filePath}\n` +
        `Available instructions: ${this.listInstructions().join(', ') || '(none)'}`
      );
    }

    return this.readInstructionFile(filePath);
  }

  /**
   * Load instruction from arbitrary file path
   */
  loadInstructionFromFile(filePath: string): string {
    // Resolve relative paths from current working directory
    const resolvedPath = resolve(process.cwd(), filePath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`Instruction file not found: ${resolvedPath}`);
    }

    return this.readInstructionFile(resolvedPath);
  }

  /**
   * List available instruction names (without .md extension)
   */
  listInstructions(): string[] {
    if (!existsSync(this.config.instructionsDir)) {
      return [];
    }

    try {
      const files = readdirSync(this.config.instructionsDir);
      return files
        .filter(file => extname(file).toLowerCase() === '.md')
        .map(file => basename(file, '.md'))
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * Check if instruction override is requested in CLI options
   */
  hasInstructionOverride(options: CLIOptions): boolean {
    return !!(options.instruction || options.instructionFile);
  }

  /**
   * Get instruction name and content from CLI options
   * Returns null if no override is specified
   */
  getInstructionFromOptions(options: CLIOptions): InstructionData | null {
    // --instruction-file takes precedence if both are specified
    if (options.instructionFile) {
      const content = this.loadInstructionFromFile(options.instructionFile);
      // Extract name from filename (without extension)
      const name = basename(options.instructionFile, extname(options.instructionFile));
      return { name, content };
    }

    if (options.instruction) {
      const content = this.loadInstruction(options.instruction);
      return { name: options.instruction, content };
    }

    return null;
  }

  /**
   * Read and validate instruction file content
   */
  private readInstructionFile(filePath: string): string {
    const content = readFileSync(filePath, 'utf-8').trim();

    if (!content) {
      throw new Error(`Instruction file is empty: ${filePath}`);
    }

    return content;
  }

  /**
   * Ensure the instructions directory exists
   */
  ensureInstructionsDir(): boolean {
    return existsSync(this.config.instructionsDir);
  }
}
