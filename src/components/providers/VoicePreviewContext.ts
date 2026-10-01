import { createContext } from 'react';
import type { PreviewPort } from '../../lib/provider/types';

/**
 * The voice-preview route a provider's `Settings` hands its voice library
 * (Stage 2 Soniox, choice 13). Null — no provider of it — and the library
 * plays on its own `AudioContext`, as the old settings UI does.
 */
export const VoicePreviewContext = createContext<PreviewPort | null>(null);
