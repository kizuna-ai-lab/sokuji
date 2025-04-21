interface ElectronAPI {
  send: (channel: string, data?: any) => void;
  receive: (channel: string, func: (...args: any[]) => void) => void;
  invoke: (channel: string, data?: any) => Promise<any>;
  config: {
    get: (key: string, defaultValue?: any) => Promise<any>;
    set: (key: string, value: any) => Promise<{ success: boolean; error?: string }>;
    getPath: () => Promise<{ configDir: string; configFile: string }>;
  };
  openai: {
    generateToken: (options?: { 
      model?: string; 
      voice?: string; 
      turnDetectionMode?: 'Normal' | 'Semantic' | 'Disabled';
      threshold?: number;
      prefixPadding?: number;
      silenceDuration?: number;
      semanticEagerness?: 'Auto' | 'Low' | 'Medium' | 'High';
      temperature?: number;
      maxTokens?: number;
      transcriptModel?: 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1';
      noiseReduction?: 'None' | 'Near field' | 'Far field';
      systemInstructions?: string;
    }) => Promise<{ 
      success: boolean; 
      data?: any; 
      error?: string 
    }>;
    validateApiKey: (apiKey: string) => Promise<{
      success: boolean;
      valid: boolean;
      models?: any[];
      allModels?: any[];
      error?: string;
    }>;
  };
}

declare interface Window {
  electron: ElectronAPI;
}
