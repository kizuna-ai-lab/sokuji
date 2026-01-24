# Sokuji Evaluation Framework

This directory contains test cases and infrastructure for evaluating AI model translation quality in Sokuji.

## Directory Structure

```
evals/
├── test-cases/          # Test case definitions (JSON)
│   └── ja-en-realtime.json
├── audio/               # Test audio files
│   └── (audio files for testing)
├── instructions/        # System instruction overrides (.md files)
│   ├── strict-translator.md
│   ├── casual-interpreter.md
│   └── technical-translator.md
├── results/             # Test results (not version controlled)
│   └── YYYY-MM-DD/      # Organized by date
│       ├── original/    # Results using test case's instruction
│       └── {instruction}/ # Results using override instruction
├── schemas/             # JSON Schema definitions
│   ├── test-case.schema.json
│   └── test-result.schema.json
└── README.md            # This file
```

## Purpose

This evaluation infrastructure supports:

1. **Instruction Debugging** - Test different system instructions to optimize translation quality
2. **Parameter Tuning** - Experiment with temperature, VAD settings, and other parameters
3. **Quality Regression** - Track translation quality over time and model versions
4. **Future Automation** - Foundation for automated CI/CD testing

## Test Case Format

Test cases are defined in JSON format following the schema in `schemas/test-case.schema.json`.

### Key Components

- **provider**: AI provider to test (openai, gemini, palabra_ai, kizuna_ai, openai_compatible)
- **config**: Model configuration including system instruction, temperature, voice settings
- **inputs**: List of test inputs (audio files or text)
- **evaluation**: LLM-as-Judge configuration for quality assessment

### Example Test Case

```json
{
  "id": "realtime-ja-en-001",
  "name": "Japanese to English Realtime Translation",
  "provider": "openai",
  "config": {
    "model": "gpt-4o-realtime-preview-2024-12-17",
    "systemInstruction": "You are a professional interpreter...",
    "temperature": 0.6
  },
  "inputs": [
    {
      "id": "text-001",
      "type": "text",
      "textContent": "今日の会議は何時からですか？",
      "sourceLanguage": "ja",
      "targetLanguage": "en",
      "expectedTranscription": "What time does today's meeting start?"
    }
  ],
  "evaluation": {
    "type": "llm-judge",
    "judgeConfig": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "scoringRubric": {
        "accuracy": { "weight": 0.4, "description": "Semantic accuracy" },
        "naturalness": { "weight": 0.3, "description": "Natural fluency" }
      }
    },
    "passThreshold": 0.7
  }
}
```

## Evaluation: LLM-as-Judge

We use another LLM (typically GPT-4o-mini) to evaluate translation quality. This approach:

- **Scales well** - Can evaluate many translations quickly
- **Consistent** - Same rubric applied uniformly
- **Flexible** - Easy to adjust scoring dimensions

### Scoring Dimensions

| Dimension | Weight | Description |
|-----------|--------|-------------|
| accuracy | 0.4 | Does it accurately convey the original meaning? |
| naturalness | 0.3 | Is the target language fluent and natural? |
| formality | 0.2 | Does the register/formality match appropriately? |
| completeness | 0.1 | Is all information preserved without additions? |

## Test Results

Results are stored in the `results/` directory, organized by date. This directory is **not version controlled** to avoid bloating the repository with large amounts of test data.

### Result Format

Results follow the schema in `schemas/test-result.schema.json` and include:

- Actual translation outputs
- Latency measurements
- Token usage statistics
- LLM Judge evaluation scores
- Environment information

## Running Evaluations

The evaluation runner is implemented as a Node.js CLI tool using `tsx`.

### Prerequisites

Set up required environment variables (or create a `.env` file in the project root):

```bash
# Required: At least one API key
OPENAI_API_KEY=sk-...

# Optional: Additional providers
GEMINI_API_KEY=...
PALABRA_API_KEY=...
KIZUNA_API_KEY=...

# Optional: LLM Judge configuration (defaults to OpenAI GPT-4o-mini)
JUDGE_PROVIDER=openai
JUDGE_MODEL=gpt-4o-mini
```

### Commands

```bash
# Run all test cases
npm run eval

# List available test cases
npm run eval:list

# Validate test case schemas
npm run eval:validate

# Run specific test case
npm run eval -- --case regression-meta-commentary-001

# Run tests by provider
npm run eval -- --provider openai

# Run tests by tag
npm run eval -- --tag regression

# Skip LLM evaluation (only record outputs)
npm run eval -- --skip-evaluation

# Enable verbose output
npm run eval -- --verbose

# Show help
npm run eval -- --help

# Override system instruction (from evals/instructions/<name>.md)
npm run eval -- --instruction strict-translator --case realtime-ja-en-001

# Override system instruction (from arbitrary file path)
npm run eval -- --instruction-file ~/my-prompt.md --case realtime-ja-en-001
```

### Runner Architecture

```
evals/runner/
├── index.ts                 # CLI entry point
├── cli.ts                   # Command line parsing
├── config.ts                # Environment configuration
├── types.ts                 # TypeScript definitions
├── core/
│   ├── TestRunner.ts        # Main orchestrator
│   ├── TestCaseLoader.ts    # Load and validate test cases
│   ├── TestExecutor.ts      # Execute individual tests
│   ├── ResultWriter.ts      # Write results to JSON
│   └── InstructionLoader.ts # Load instruction overrides
├── clients/
│   ├── NodeClientFactory.ts # Client factory
│   └── NodeOpenAIClient.ts  # OpenAI Realtime API client
├── audio/
│   └── AudioLoader.ts       # Load WAV/FLAC files
└── evaluation/
    └── LLMJudge.ts          # LLM-as-Judge evaluator
```

## System Instruction Override

The instruction override feature allows you to test the same test cases with different system instructions, enabling A/B testing of prompts.

### Usage

```bash
# Use a named instruction from evals/instructions/
npm run eval -- --instruction strict-translator --case realtime-ja-en-001

# Use an instruction from any file path
npm run eval -- --instruction-file ~/prompts/my-custom-prompt.md --case realtime-ja-en-001
```

### Creating Instructions

Create Markdown (`.md`) files in the `evals/instructions/` directory:

```markdown
# Strict Translator

You are a professional translator. Your task is to translate the input speech accurately.

## Guidelines
- Translate the exact meaning without adding or removing information
- Use natural expressions in the target language
- Do NOT add commentary or meta-remarks

## Output
Output only the translated text. No prefixes, no explanations.
```

### Result Organization

When using instruction overrides, results are organized into subdirectories:

```
results/
└── 2024-01-15/
    ├── original/               # Results without instruction override
    │   └── realtime-ja-en-001_2024-01-15T10-30-00.json
    ├── strict-translator/      # Results with --instruction strict-translator
    │   └── realtime-ja-en-001_2024-01-15T10-35-00.json
    └── casual-interpreter/     # Results with --instruction casual-interpreter
        └── realtime-ja-en-001_2024-01-15T10-40-00.json
```

The `instructionSource` field in the result JSON indicates which instruction was used:

```json
{
  "runId": "run_1705312200000_abc123",
  "testCaseId": "realtime-ja-en-001",
  "instructionSource": "strict-translator",
  ...
}
```

### Included Instructions

The framework includes sample instructions for common use cases:

| Name | Description |
|------|-------------|
| `strict-translator` | Professional translator with strict accuracy focus |
| `casual-interpreter` | Friendly interpreter with conversational style |
| `technical-translator` | Specialist for technical/software content |

## Adding Test Cases

1. Create a new JSON file in `test-cases/`
2. Follow the schema in `schemas/test-case.schema.json`
3. Add any required audio files to `audio/`
4. Validate the JSON against the schema

### Audio File Guidelines

- Format: WAV (PCM 16-bit) preferred
- Sample rate: 16kHz or 24kHz
- Naming convention: `{lang}-{description}.wav` (e.g., `ja-greeting-formal.wav`)
- Keep files under 10MB for reasonable test duration

## Schema Validation

You can validate test cases against the schema using any JSON Schema validator:

```bash
# Using ajv-cli
npx ajv validate -s schemas/test-case.schema.json -d test-cases/ja-en-realtime.json
```

## Best Practices

1. **Ground Truth** - Provide accurate expected translations as ground truth
2. **Context** - Include context information (domain, formality) for better evaluation
3. **Diversity** - Test various scenarios (formal/informal, short/long, different domains)
4. **Versioning** - Update metadata.version when modifying test cases
5. **Documentation** - Use descriptive names and descriptions for test cases
