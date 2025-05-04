// Type definitions for Chrome extension API
interface Chrome {
  runtime: {
    getURL(path: string): string;
    id?: string;
    lastError?: {
      message?: string;
    };
    sendMessage(message: any, callback?: (response: any) => void): void;
    onMessage: {
      addListener(callback: (message: any, sender: any, sendResponse: (response?: any) => void) => void): void;
      removeListener(callback: (message: any, sender: any, sendResponse: (response?: any) => void) => void): void;
    };
  };
  storage: {
    sync: {
      get(keys: string | string[] | object | null, callback: (items: any) => void): void;
      set(items: object, callback?: () => void): void;
      remove(keys: string | string[], callback?: () => void): void;
      clear(callback?: () => void): void;
    };
    local: {
      get(keys: string | string[] | object | null, callback: (items: any) => void): void;
      set(items: object, callback?: () => void): void;
      remove(keys: string | string[], callback?: () => void): void;
      clear(callback?: () => void): void;
    };
  };
}

interface Window {
  chrome?: Chrome;
}
