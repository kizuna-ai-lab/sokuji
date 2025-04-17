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
    }) => Promise<{ 
      success: boolean; 
      data?: any; 
      error?: string 
    }>;
  };
}

declare interface Window {
  electron: ElectronAPI;
}
