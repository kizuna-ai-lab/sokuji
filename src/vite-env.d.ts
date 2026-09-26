/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_ENABLE_KIZUNA_AI?: string;
  readonly VITE_ENABLE_LOCAL_NATIVE?: string;
  /** Comma-separated ids of the flagged providers a release offers (D19). */
  readonly VITE_ENABLED_PROVIDERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
} 