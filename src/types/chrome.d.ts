// Type definitions for Chrome extension API
interface ChromeTab {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
  windowId?: number;
}

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
  tabs?: {
    query(queryInfo: { active?: boolean; currentWindow?: boolean }, callback: (tabs: ChromeTab[]) => void): void;
    query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<ChromeTab[]>;
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

// Declare chrome as a global variable
declare const chrome: Chrome | undefined;
