/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_ENABLE_KIZUNA_AI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
} 