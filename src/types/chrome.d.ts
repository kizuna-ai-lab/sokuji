// Type definitions for Chrome extension API
interface Chrome {
  runtime: {
    getURL(path: string): string;
    id?: string;
  };
}

interface Window {
  chrome?: Chrome;
}
