// src/providers/nameKey.ts
//
// The translation key of a provider's name. Where the native engine is offered, the older local engine is no longer
// "This device" alone but the second of two ("This device (WASM/WebGPU)" beside "This device (Native)"); where it is
// not offered (the extension, or Local Native still flagged off), that engine keeps the name it always had.
import { presentProviders } from './registry';

export const providerNameKey = (id: string): string =>
  id === 'local_inference' && presentProviders().some((p) => p.id === 'local_native')
    ? 'providers.local_inference.nameWithNative'
    : `providers.${id}.name`;
