/**
 * LLM Judge - Evaluates translation quality using LLM-as-Judge approach
 */

import type {
  TestCase,
  OutputResult,
  TestResult,
  RunnerConfig,
  ScoringDimension,
} from '../types.js';

/**
 * LLM Judge evaluation response
 */
interface JudgeResponse {
  scores: Record<string, number>;
  overallScore: number;
  explanation: string;
  isRegression?: boolean;
}

/**
 * Default evaluation system prompt
 */
const DEFAULT_SYSTEM_PROMPT = `You are an expert evaluator for translation quality.
Evaluate the actual output against the expected translation.

Output your evaluation in JSON format:
{
  "scores": {
    "accuracy": <0-1, semantic accuracy of translation>,
    "fluency": <0-1, naturalness of the output>,
    "completeness": <0-1, whether all content was translated>
  },
  "overallScore": <weighted average of scores>,
  "explanation": "<brief explanation of your evaluation>"
}`;

/**
 * LLM Judge class
 */
export class LLMJudge {
  private config: RunnerConfig;
  private apiKey: string | undefined;

  constructor(config: RunnerConfig) {
    this.config = config;
    // Select API key based on configured judge provider, with fallback to alternate provider
    const provider = config.judge.provider;
    if (provider === 'openai') {
      this.apiKey = config.apiKeys.openai || config.apiKeys.gemini;
    } else if (provider === 'gemini') {
      this.apiKey = config.apiKeys.gemini || config.apiKeys.openai;
    } else {
      this.apiKey = config.apiKeys.openai || config.apiKeys.gemini;
    }
  }

  /**
   * Evaluate a test case's outputs
   */
  async evaluate(
    testCase: TestCase,
    outputs: OutputResult[]
  ): Promise<TestResult['evaluation']> {
    if (!this.apiKey) {
      throw new Error('No API key available for LLM Judge');
    }

    const judgeConfig = testCase.evaluation.judgeConfig;
    const model = judgeConfig.model || this.config.judge.model;
    const systemPrompt = judgeConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT;

    // Build evaluation prompt
    const evaluationPrompt = this.buildEvaluationPrompt(testCase, outputs, systemPrompt);

    // Call the LLM
    const response = await this.callLLM(model, evaluationPrompt);

    // Parse and validate the response
    const judgeResponse = this.parseResponse(response);

    // Calculate weighted overall score if rubric provided
    let overallScore = judgeResponse.overallScore;
    if (judgeConfig.scoringRubric && Object.keys(judgeConfig.scoringRubric).length > 0) {
      overallScore = this.calculateWeightedScore(
        judgeResponse.scores,
        judgeConfig.scoringRubric
      );
    }

    // Determine if passed
    const passThreshold = testCase.evaluation.passThreshold || 0.7;
    const passed = overallScore >= passThreshold;

    return {
      overallScore,
      passed,
      dimensionScores: judgeResponse.scores,
      judgeResponse: response,
      notes: judgeResponse.explanation,
    };
  }

  /**
   * Build the evaluation prompt
   */
  private buildEvaluationPrompt(
    testCase: TestCase,
    outputs: OutputResult[],
    systemPrompt: string
  ): string {
    const parts: string[] = [systemPrompt, '\n\n---\n\n'];

    parts.push('## Test Case Information\n');
    parts.push(`Name: ${testCase.name}\n`);
    if (testCase.description) {
      parts.push(`Description: ${testCase.description}\n`);
    }
    parts.push('\n');

    // Add scoring rubric if available
    const rubric = testCase.evaluation.judgeConfig.scoringRubric;
    if (rubric && Object.keys(rubric).length > 0) {
      parts.push('## Scoring Rubric\n');
      for (const [dimension, config] of Object.entries(rubric)) {
        parts.push(`- **${dimension}** (weight: ${config.weight}): ${config.description}\n`);
      }
      parts.push('\n');
    }

    parts.push('## Evaluation Items\n\n');

    for (const output of outputs) {
      const input = testCase.inputs.find(i => i.id === output.inputId);
      if (!input) continue;

      parts.push(`### Input: ${output.inputId}\n\n`);

      // Source content
      if (input.textContent) {
        parts.push(`**Source Text (${input.sourceLanguage || 'unknown'}):**\n`);
        parts.push(`\`\`\`\n${input.textContent}\n\`\`\`\n\n`);
      } else if (output.inputTranscription) {
        parts.push(`**Transcribed Input (${input.sourceLanguage || 'unknown'}):**\n`);
        parts.push(`\`\`\`\n${output.inputTranscription}\n\`\`\`\n\n`);
      }

      // Expected output
      if (output.expectedTranscription) {
        parts.push(`**Expected Output (${input.targetLanguage || 'unknown'}):**\n`);
        parts.push(`\`\`\`\n${output.expectedTranscription}\n\`\`\`\n\n`);
      }

      // Actual output
      parts.push(`**Actual Output:**\n`);
      parts.push(`\`\`\`\n${output.outputTranscription || '(no output)'}\n\`\`\`\n\n`);

      // Context if available
      if (input.context) {
        parts.push('**Context:**\n');
        if (input.context.domain) {
          parts.push(`- Domain: ${input.context.domain}\n`);
        }
        if (input.context.formality) {
          parts.push(`- Formality: ${input.context.formality}\n`);
        }
        if (input.context.speakerInfo) {
          parts.push(`- Speaker: ${input.context.speakerInfo}\n`);
        }
        if (input.context.bugDescription) {
          parts.push(`- Bug Description: ${input.context.bugDescription}\n`);
        }
        parts.push('\n');
      }

      parts.push('---\n\n');
    }

    parts.push('Please evaluate the actual outputs and provide your assessment in JSON format.\n');

    return parts.join('');
  }

  /**
   * Call the LLM API
   */
  private async callLLM(model: string, prompt: string): Promise<string> {
    const provider = this.config.judge.provider;

    if (provider === 'openai') {
      return this.callOpenAI(model, prompt);
    } else if (provider === 'gemini') {
      return this.callGemini(model, prompt);
    } else {
      throw new Error(`Unsupported judge provider: ${provider}`);
    }
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAI(model: string, prompt: string): Promise<string> {
    const apiKey = this.config.apiKeys.openai;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent evaluations
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  /**
   * Call Gemini API
   */
  private async callGemini(model: string, prompt: string): Promise<string> {
    const apiKey = this.config.apiKeys.gemini;
    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Gemini API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  /**
   * Parse the LLM response
   */
  private parseResponse(response: string): JudgeResponse {
    try {
      // Try to extract JSON from the response
      let jsonStr = response;

      // Handle markdown code blocks
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr.trim());

      // Validate required fields
      if (typeof parsed.scores !== 'object') {
        throw new Error('Missing scores object');
      }

      // Ensure overallScore exists
      if (typeof parsed.overallScore !== 'number') {
        // Calculate from scores if not provided
        const scores = Object.values(parsed.scores) as number[];
        parsed.overallScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      }

      return {
        scores: parsed.scores,
        overallScore: parsed.overallScore,
        explanation: parsed.explanation || '',
        isRegression: parsed.isRegression,
      };
    } catch (error) {
      console.error('Failed to parse LLM response:', error);
      console.error('Response:', response);

      // Return a default failed evaluation
      return {
        scores: {},
        overallScore: 0,
        explanation: 'Failed to parse evaluation response',
      };
    }
  }

  /**
   * Calculate weighted overall score
   */
  private calculateWeightedScore(
    scores: Record<string, number>,
    rubric: Record<string, ScoringDimension>
  ): number {
    let totalWeight = 0;
    let weightedSum = 0;

    for (const [dimension, config] of Object.entries(rubric)) {
      const score = scores[dimension];
      if (score !== undefined) {
        weightedSum += score * config.weight;
        totalWeight += config.weight;
      }
    }

    if (totalWeight === 0) {
      return 0;
    }

    return weightedSum / totalWeight;
  }
}
