// Type definitions for the Electron app

export interface AppConfig {
  model: string;
  transcriptModel: string;
  noiseReduction: string;
  turnDetection: {
    mode: 'Normal' | 'Semantic' | 'Disabled';
    threshold?: number;
    prefixPadding?: number;
    silenceDuration?: number;
    semanticEagerness?: 'Auto' | 'Low' | 'Medium' | 'High';
  };
  modelConfig: {
    temperature: number;
    maxTokens: number;
  };
  systemInstructions: string;
}
