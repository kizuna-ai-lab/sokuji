/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_ENABLE_KIZUNA_AI?: string;
  readonly VITE_ENABLE_PALABRA_AI?: string;
  readonly VITE_ENABLE_VOLCENGINE_ST?: string;
  readonly VITE_ENABLE_VOLCENGINE_AST2?: string;
  readonly VITE_TTS_WS_BASE?: string;
  readonly BUILD_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
} 