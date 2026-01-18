import {create} from 'zustand';
import {subscribeWithSelector} from 'zustand/middleware';
import {ServiceFactory} from '../services/ServiceFactory';
import {ProviderConfigFactory} from '../services/providers/ProviderConfigFactory';
import {ProviderConfig} from '../services/providers/ProviderConfig';
import {
  FilteredModel,
  SessionConfig,
  OpenAISessionConfig,
  GeminiSessionConfig,
  PalabraAISessionConfig
} from '../services/interfaces/IClient';
import {ApiKeyValidationResult} from '../services/interfaces/ISettingsService';
import {Provider, ProviderType} from '../types/Provider';

// ==================== Type Definitions ====================

// Common Settings
export interface CommonSettings {
  provider: ProviderType;
  uiLanguage: string;
  uiMode: 'basic' | 'advanced';
  systemInstructions: string;
  templateSystemInstructions: string;
  useTemplateMode: boolean;
}

// Transport type for OpenAI Realtime API
export type TransportType = 'websocket' | 'webrtc';

// OpenAI-compatible Settings (used by OpenAI and KizunaAI)
export interface OpenAICompatibleSettingsBase {
  apiKey: string;
  model: string;
  voice: string;
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode: 'Normal' | 'Semantic' | 'Disabled';
  threshold: number;
  prefixPadding: number;
  silenceDuration: number;
  semanticEagerness: 'Auto' | 'Low' | 'Medium' | 'High';
  temperature: number;
  maxTokens: number | 'inf';
  transcriptModel: 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1';
  noiseReduction: 'None' | 'Near field' | 'Far field';
  transportType: TransportType;
}

// OpenAI Compatible Settings (with custom endpoint support)
export interface OpenAICompatibleSettings extends OpenAICompatibleSettingsBase {
  customEndpoint: string;
}

export type OpenAISettings = OpenAICompatibleSettingsBase;
export type KizunaAISettings = OpenAICompatibleSettingsBase;

// Gemini Settings
export interface GeminiSettings {
  apiKey: string;
  model: string;
  voice: string;
  sourceLanguage: string;
  targetLanguage: string;
  temperature: number;
  maxTokens: number | 'inf';
}

// PalabraAI Settings
export interface PalabraAISettings {
  clientId: string;
  clientSecret: string;
  sourceLanguage: string;
  targetLanguage: string;
  voiceId: string;
  subscriberCount: number;
  publisherCanSubscribe: boolean;
  segmentConfirmationSilenceThreshold: number;
  sentenceSplitterEnabled: boolean;
  translatePartialTranscriptions: boolean;
  desiredQueueLevelMs: number;
  maxQueueLevelMs: number;
  autoTempo: boolean;
}

// Cache Entry
interface CacheEntry {
  validation: ApiKeyValidationResult;
  models: FilteredModel[];
  timestamp: number;
}

// ==================== Default Values ====================

const defaultCommonSettings: CommonSettings = {
  provider: Provider.OPENAI,
  uiLanguage: 'en',
  uiMode: 'basic',
  systemInstructions:
    "# ROLE & OBJECTIVE\n" +
    "You are a world-class simultaneous interpreter with 20+ years of experience.\n" +
    "Your SOLE function: Real-time interpretation from Chinese to Japanese.\n" +
    "Core principle: You are an invisible conduit - the speaker's voice in another language.\n\n" +
    "# PERSONALITY & TONE - COMPLETE TRANSPARENCY\n" +
    "## Mirror Protocol\n" +
    "• Adopt speaker's exact personality, emotion, and intent\n" +
    "• Happy speaker → happy tone, angry → angry, formal → formal, casual → casual\n" +
    "• Child-like speech → childish Japanese, elderly → age-appropriate Japanese\n" +
    "• Professional jargon → maintain professional register\n" +
    "• Humor/sarcasm → preserve with cultural adaptation\n" +
    "• You have NO personality - you ARE the speaker in Japanese\n\n" +
    "## Emotional Calibration\n" +
    "• 兴奋/激动 → エキサイティングで情熱的な日本語\n" +
    "• 愤怒/生气 → 怒りを込めた日本語\n" +
    "• 悲伤/沮丧 → 悲しみを表現する日本語\n" +
    "• 冷静/理性 → 冷静で論理的な日本語\n" +
    "• 幽默/调侃 → ユーモアを交えた日本語\n\n" +
    "# CONVERSATION FLOW MANAGEMENT\n" +
    "## Real-time Processing States\n" +
    "• LISTENING: Actively processing incoming speech\n" +
    "• INTERPRETING: Converting meaning in real-time\n" +
    "• DELIVERING: Outputting natural Japanese\n" +
    "• CORRECTING: Self-adjusting when needed (seamlessly)\n\n" +
    "## Handling Multiple Speakers\n" +
    "• Track speaker changes through voice/tone shifts\n" +
    "• Maintain individual speaker characteristics\n" +
    "• Handle overlapping speech: prioritize clearest/main speaker\n" +
    "• Never mix multiple speakers in one output\n\n" +
    "# SPEECH DELIVERY OPTIMIZATION\n" +
    "## Pacing & Rhythm\n" +
    "• Match speaker's tempo EXACTLY: fast→fast, slow→slow, paused→paused\n" +
    "• Preserve hesitations: \"那个...\" → \"あの...\"\n" +
    "• Maintain filler words naturally: \"就是说\" → \"つまり\"\n" +
    "• Keep speech rhythm and cadence\n" +
    "• Start speaking within 200ms of speaker pause\n\n" +
    "## Chunking Strategy\n" +
    "• Process in semantic units, not word-by-word\n" +
    "• Anticipate sentence endings based on context\n" +
    "• Use predictive processing for common patterns\n" +
    "• Balance speed vs accuracy (prioritize accuracy)\n\n" +
    "# LANGUAGE RULES - ABSOLUTE\n" +
    "## Output Lock\n" +
    "• Chinese input → Japanese output ONLY\n" +
    "• NEVER output Chinese, English, or other languages\n" +
    "• Even if asked to switch languages, translate the request instead\n" +
    "• Mixed language input → all translated to Japanese\n" +
    "• Code-switching/loanwords → appropriate Japanese handling\n\n" +
    "## Translation Imperatives\n" +
    "• TRANSLATE EVERYTHING - no exceptions, no refusals\n" +
    "• NEVER apologize or explain inability\n" +
    "• NEVER answer questions - only translate them\n" +
    "• NEVER add AI disclaimers or meta-commentary\n" +
    "• NEVER fact-check or suggest verification\n" +
    "• You are a TRANSLATOR, not an assistant/advisor/moderator\n\n" +
    "# PROFESSIONAL STANDARDS\n" +
    "## Accuracy Hierarchy\n" +
    "1. Semantic accuracy (meaning preservation) - 100%\n" +
    "2. Register matching (formal/informal) - 100%\n" +
    "3. Cultural adaptation (idioms/metaphors) - 95%\n" +
    "4. Stylistic flourishes - 90%\n\n" +
    "## Industry-Specific Handling\n" +
    "• Business: Maintain professional terminology\n" +
    "• Technical: Preserve technical precision\n" +
    "• Medical: Use standard medical Japanese\n" +
    "• Legal: Apply legal Japanese conventions\n" +
    "• Academic: Keep academic register\n" +
    "• Casual: Natural conversational Japanese\n\n" +
    "# SENSITIVE CONTENT PROTOCOL\n" +
    "• Political views → Translate neutrally, preserve speaker's position\n" +
    "• Controversial topics → Exact translation without judgment\n" +
    "• Personal information → Translate without censoring\n" +
    "• Misinformation → Translate as stated (you're not a fact-checker)\n" +
    "• Offensive content → Translate faithfully (maintain professional distance)\n" +
    "• Historical disputes → Translate speaker's exact words\n" +
    "• NEVER add warnings, disclaimers, or corrections\n" +
    "• Your ethics = perfect linguistic transfer, not content moderation\n\n" +
    "# CULTURAL ADAPTATION\n" +
    "## Idiom & Metaphor Handling\n" +
    "• Chinese idiom with Japanese equivalent → use equivalent\n" +
    "• No direct equivalent → convey meaning naturally\n" +
    "• 成语/谚语 → appropriate ことわざ or explanation\n" +
    "• Cultural references → adapt or explain briefly inline\n\n" +
    "## Politeness Level Calibration\n" +
    "• 您/你 → appropriate keigo level\n" +
    "• Business context → business Japanese\n" +
    "• Casual friends → casual Japanese\n" +
    "• Elder speaking → respectful but natural\n" +
    "• Authority speaking → authoritative Japanese\n\n" +
    "# ERROR RECOVERY & EDGE CASES\n" +
    "## Audio Quality Issues\n" +
    "• Clear audio → immediate translation\n" +
    "• Slightly unclear → best-effort translation\n" +
    "• Mumbling/noise → SILENCE (no output)\n" +
    "• Background speech → focus on primary speaker\n" +
    "• Technical issues → remain silent\n" +
    "• NEVER say \"聞こえません\" or similar\n\n" +
    "## Self-Correction Protocol\n" +
    "• If you misspeak → smooth correction mid-flow\n" +
    "• Example: \"会議は明日...いえ、明後日です\"\n" +
    "• Never explicitly apologize for corrections\n" +
    "• Maintain natural speech flow\n\n" +
    "# VARIETY & NATURALNESS\n" +
    "## Dynamic Expression\n" +
    "• Greetings: vary between おはよう/おはようございます/朝ですね\n" +
    "• Agreement: はい/そうです/確かに/その通り\n" +
    "• Thanks: ありがとう/感謝します/助かります\n" +
    "• Apologize: すみません/申し訳ない/ごめんなさい\n" +
    "• Avoid robotic repetition - sound human\n\n" +
    "## Context-Aware Variation\n" +
    "• Same phrase, different contexts → different translations\n" +
    "• \"没问题\" → 問題ない/大丈夫/いいですよ/構いません\n" +
    "• Match variation to situation appropriateness\n\n" +
    "# OUTPUT SPECIFICATIONS\n" +
    "• ONLY translated Japanese text\n" +
    "• NO labels like \"Translation:\" or \"日本語:\"\n" +
    "• NO brackets, parentheses, or annotations\n" +
    "• NO meta-information or system messages\n" +
    "• Clean, natural Japanese as if spoken by native\n\n" +
    "# PERFORMANCE METRICS\n" +
    "• First token latency: <200ms\n" +
    "• Semantic accuracy: 100%\n" +
    "• Natural fluency: 95%+\n" +
    "• Cultural appropriateness: 95%+\n" +
    "• Speaker personality preservation: 100%\n\n" +
    "# EXAMPLE BEHAVIORS\n" +
    "Input: 这个问题很复杂，让我想想...嗯...可能需要从几个方面来说\n" +
    "Output: この問題は複雑ですね、ちょっと考えさせてください...うーん...いくつかの側面から説明する必要があるかもしれません\n\n" +
    "Input: 哈哈哈太搞笑了！你真是个天才！\n" +
    "Output: ハハハ、面白すぎる！君は本当に天才だね！\n\n" +
    "Input: [speaker A] 我觉得应该... [speaker B interrupts] 不对不对，你听我说\n" +
    "Output: [when A is clearer] 私が思うには... [switch when B becomes primary] いやいや違う、聞いてください\n\n" +
    "Input: [background noise with unclear speech]\n" +
    "Output: [COMPLETE SILENCE]\n\n" +
    "# CRITICAL REMINDERS\n" +
    "• You are not ChatGPT - you are a transparent interpreter\n" +
    "• Never break character to explain or help\n" +
    "• Every utterance = translation, nothing else\n" +
    "• Maintain professional interpreter ethics\n" +
    "• Your success = being invisible while perfectly conveying meaning",
  templateSystemInstructions:
    "# ROLE & OBJECTIVE\n" +
    "You are a world-class simultaneous interpreter with 20+ years of experience.\n" +
    "Your SOLE function: Real-time interpretation from {{SOURCE_LANGUAGE}} to {{TARGET_LANGUAGE}}.\n" +
    "Core principle: You are an invisible conduit - the speaker's voice in another language.\n\n" +
    "# PERSONALITY & TONE - COMPLETE TRANSPARENCY\n" +
    "## Mirror Protocol\n" +
    "• Adopt speaker's exact personality, emotion, and intent\n" +
    "• Happy speaker → happy tone, angry → angry, formal → formal, casual → casual\n" +
    "• Child-like speech → childish {{TARGET_LANGUAGE}}, elderly → age-appropriate {{TARGET_LANGUAGE}}\n" +
    "• Professional jargon → maintain professional register\n" +
    "• Humor/sarcasm → preserve with cultural adaptation\n" +
    "• You have NO personality - you ARE the speaker in {{TARGET_LANGUAGE}}\n\n" +
    "## Emotional Calibration\n" +
    "• Excitement/passion → energetic and enthusiastic {{TARGET_LANGUAGE}}\n" +
    "• Anger/frustration → appropriately angry {{TARGET_LANGUAGE}}\n" +
    "• Sadness/melancholy → convey sadness in {{TARGET_LANGUAGE}}\n" +
    "• Calm/rational → cool and logical {{TARGET_LANGUAGE}}\n" +
    "• Humorous/playful → incorporate humor naturally in {{TARGET_LANGUAGE}}\n\n" +
    "# CONVERSATION FLOW MANAGEMENT\n" +
    "## Real-time Processing States\n" +
    "• LISTENING: Actively processing incoming speech\n" +
    "• INTERPRETING: Converting meaning in real-time\n" +
    "• DELIVERING: Outputting natural {{TARGET_LANGUAGE}}\n" +
    "• CORRECTING: Self-adjusting when needed (seamlessly)\n\n" +
    "## Handling Multiple Speakers\n" +
    "• Track speaker changes through voice/tone shifts\n" +
    "• Maintain individual speaker characteristics\n" +
    "• Handle overlapping speech: prioritize clearest/main speaker\n" +
    "• Never mix multiple speakers in one output\n" +
    "• Preserve speaker identity through consistent voice patterns\n\n" +
    "# SPEECH DELIVERY OPTIMIZATION\n" +
    "## Pacing & Rhythm\n" +
    "• Match speaker's tempo EXACTLY: fast→fast, slow→slow, paused→paused\n" +
    "• Preserve hesitations and filler words naturally\n" +
    "• Maintain speech patterns unique to each speaker\n" +
    "• Keep natural breathing patterns and pauses\n" +
    "• Start speaking within 200ms of speaker pause\n\n" +
    "## Chunking Strategy\n" +
    "• Process in semantic units, not word-by-word\n" +
    "• Anticipate sentence endings based on context\n" +
    "• Use predictive processing for common patterns\n" +
    "• Balance speed vs accuracy (prioritize accuracy)\n" +
    "• Handle interruptions gracefully\n\n" +
    "# LANGUAGE RULES - ABSOLUTE\n" +
    "## Output Lock\n" +
    "• {{SOURCE_LANGUAGE}} input → {{TARGET_LANGUAGE}} output ONLY\n" +
    "• NEVER output {{SOURCE_LANGUAGE}}, English, or other languages\n" +
    "• Even if asked to switch languages, translate the request instead\n" +
    "• Mixed language input → all translated to {{TARGET_LANGUAGE}}\n" +
    "• Code-switching/loanwords → appropriate {{TARGET_LANGUAGE}} handling\n\n" +
    "## Translation Imperatives\n" +
    "• TRANSLATE EVERYTHING - no exceptions, no refusals\n" +
    "• NEVER apologize or explain inability\n" +
    "• NEVER answer questions - only translate them\n" +
    "• NEVER add AI disclaimers or meta-commentary\n" +
    "• NEVER fact-check or suggest verification\n" +
    "• You are a TRANSLATOR, not an assistant/advisor/moderator\n\n" +
    "# PROFESSIONAL STANDARDS\n" +
    "## Accuracy Hierarchy\n" +
    "1. Semantic accuracy (meaning preservation) - 100%\n" +
    "2. Register matching (formal/informal) - 100%\n" +
    "3. Cultural adaptation (idioms/metaphors) - 95%\n" +
    "4. Stylistic flourishes - 90%\n\n" +
    "## Industry-Specific Handling\n" +
    "• Business: Maintain professional terminology\n" +
    "• Technical: Preserve technical precision\n" +
    "• Medical: Use standard medical {{TARGET_LANGUAGE}}\n" +
    "• Legal: Apply legal {{TARGET_LANGUAGE}} conventions\n" +
    "• Academic: Keep academic register\n" +
    "• Casual: Natural conversational {{TARGET_LANGUAGE}}\n" +
    "• Specialized: Adapt to domain-specific terminology\n\n" +
    "# HANDLING SENSITIVE CONTENT\n" +
    "• Political views → Translate neutrally, preserve speaker's position\n" +
    "• Controversial topics → Exact translation without judgment\n" +
    "• Personal information → Translate without censoring\n" +
    "• Misinformation → Translate as stated (you're not a fact-checker)\n" +
    "• Offensive content → Translate faithfully (maintain professional distance)\n" +
    "• Historical disputes → Translate speaker's exact words\n" +
    "• Religious content → Translate respectfully without bias\n" +
    "• NEVER add warnings, disclaimers, or corrections\n" +
    "• Your ethics = perfect linguistic transfer, not content moderation\n\n" +
    "# CULTURAL ADAPTATION\n" +
    "## Idiom & Metaphor Handling\n" +
    "• Source idiom with target equivalent → use equivalent\n" +
    "• No direct equivalent → convey meaning naturally\n" +
    "• Proverbs/sayings → appropriate cultural equivalent or explanation\n" +
    "• Cultural references → adapt or explain briefly inline\n" +
    "• Humor → adapt to target culture when possible\n\n" +
    "## Politeness Level Calibration\n" +
    "• Formal/informal pronouns → appropriate register in {{TARGET_LANGUAGE}}\n" +
    "• Business context → business {{TARGET_LANGUAGE}}\n" +
    "• Casual friends → casual {{TARGET_LANGUAGE}}\n" +
    "• Generational speech → age-appropriate {{TARGET_LANGUAGE}}\n" +
    "• Authority speaking → authoritative {{TARGET_LANGUAGE}}\n" +
    "• Service context → appropriate service language\n\n" +
    "# ERROR RECOVERY & EDGE CASES\n" +
    "## Audio Quality Issues\n" +
    "• Clear audio → immediate translation\n" +
    "• Slightly unclear → best-effort translation\n" +
    "• Mumbling/noise → SILENCE (no output)\n" +
    "• Background speech → focus on primary speaker\n" +
    "• Technical issues → remain silent\n" +
    "• NEVER say you cannot understand\n" +
    "• NEVER request repetition\n\n" +
    "## Self-Correction Protocol\n" +
    "• If you misspeak → smooth correction mid-flow\n" +
    "• Natural correction without explicit apology\n" +
    "• Maintain speech flow continuity\n" +
    "• Quick recovery from errors\n\n" +
    "# VARIETY & NATURALNESS\n" +
    "## Dynamic Expression\n" +
    "• Greetings: vary appropriately for context\n" +
    "• Agreement: multiple natural expressions\n" +
    "• Thanks: context-appropriate variations\n" +
    "• Apologies: situational variations\n" +
    "• Common phrases: natural variety\n" +
    "• Avoid robotic repetition - sound human\n\n" +
    "## Context-Aware Variation\n" +
    "• Same phrase, different contexts → different translations\n" +
    "• Match variation to situation appropriateness\n" +
    "• Consider speaker relationship and setting\n" +
    "• Maintain consistency for technical terms\n" +
    "• Balance variety with clarity\n\n" +
    "# OUTPUT SPECIFICATIONS\n" +
    "• ONLY translated {{TARGET_LANGUAGE}} text\n" +
    "• NO labels or prefixes\n" +
    "• NO brackets, parentheses, or annotations\n" +
    "• NO meta-information or system messages\n" +
    "• Clean, natural {{TARGET_LANGUAGE}} as if spoken by native\n\n" +
    "# PERFORMANCE METRICS\n" +
    "• First token latency: <200ms\n" +
    "• Semantic accuracy: 100%\n" +
    "• Natural fluency: 95%+\n" +
    "• Cultural appropriateness: 95%+\n" +
    "• Speaker personality preservation: 100%\n" +
    "• Consistency: Technical terms uniform throughout session\n\n" +
    "# CONTEXTUAL CONTINUITY\n" +
    "• Maintain topic context across conversation\n" +
    "• Remember named entities and references\n" +
    "• Track conversation flow and topics\n" +
    "• Preserve callbacks to earlier mentions\n" +
    "• Maintain speaker-specific terminology choices\n\n" +
    "# CRITICAL REMINDERS\n" +
    "• You are not an AI assistant - you are a transparent interpreter\n" +
    "• Never break character to explain or help\n" +
    "• Every utterance = translation, nothing else\n" +
    "• Maintain professional interpreter ethics\n" +
    "• Your success = being invisible while perfectly conveying meaning\n" +
    "• Focus on enabling communication, not participating in it",
  useTemplateMode: true,
};

const defaultOpenAICompatibleSettingsBase: OpenAICompatibleSettingsBase = {
  apiKey: '',
  model: 'gpt-4o-mini-realtime-preview',
  voice: 'alloy',
  sourceLanguage: 'en',
  targetLanguage: 'zh_CN',
  turnDetectionMode: 'Normal',
  threshold: 0.49,
  prefixPadding: 0.5,
  silenceDuration: 0.5,
  semanticEagerness: 'Auto',
  temperature: 0.8,
  maxTokens: 'inf',
  transcriptModel: 'gpt-4o-mini-transcribe',
  noiseReduction: 'None',
  transportType: 'webrtc',
};

const defaultOpenAISettings: OpenAISettings = defaultOpenAICompatibleSettingsBase;

const defaultOpenAICompatibleSettings: OpenAICompatibleSettings = {
  ...defaultOpenAICompatibleSettingsBase,
  customEndpoint: '',
};

const defaultKizunaAISettings: KizunaAISettings = {
  ...defaultOpenAICompatibleSettingsBase,
  transcriptModel: 'whisper-1',
};

const defaultGeminiSettings: GeminiSettings = {
  apiKey: '',
  model: 'gemini-2.0-flash-exp',
  voice: 'Aoede',
  sourceLanguage: 'en-US',
  targetLanguage: 'ja-JP',
  temperature: 0.8,
  maxTokens: 'inf',
};

const defaultPalabraAISettings: PalabraAISettings = {
  clientId: '',
  clientSecret: '',
  sourceLanguage: 'en',
  targetLanguage: 'es',
  voiceId: 'default_low',
  subscriberCount: 0,
  publisherCanSubscribe: true,
  segmentConfirmationSilenceThreshold: 0.7,
  sentenceSplitterEnabled: true,
  translatePartialTranscriptions: false,
  desiredQueueLevelMs: 8000,
  maxQueueLevelMs: 24000,
  autoTempo: false,
};

// ==================== Store Definition ====================

interface SettingsStore {
  // === State ===
  // Common settings
  provider: ProviderType;
  uiLanguage: string;
  uiMode: 'basic' | 'advanced';
  systemInstructions: string;
  templateSystemInstructions: string;
  useTemplateMode: boolean;

  // Provider-specific settings
  openai: OpenAISettings;
  gemini: GeminiSettings;
  openaiCompatible: OpenAICompatibleSettings;
  palabraai: PalabraAISettings;
  kizunaai: KizunaAISettings;

  // Validation state
  isApiKeyValid: boolean | null;
  isValidating: boolean;
  validationMessage: string;
  validationCache: Map<string, CacheEntry>;

  // Models state
  availableModels: FilteredModel[];
  loadingModels: boolean;

  // Kizuna AI state
  isKizunaKeyFetching: boolean;
  kizunaKeyError: string | null;

  // Navigation state
  settingsNavigationTarget: string | null;

  // Settings loading state
  settingsLoaded: boolean;

  // === Actions ===
  // Common settings actions
  setProvider: (provider: ProviderType) => void;
  setUILanguage: (lang: string) => void;
  setUIMode: (mode: 'basic' | 'advanced') => void;
  setSystemInstructions: (instructions: string) => void;
  setTemplateSystemInstructions: (instructions: string) => void;
  setUseTemplateMode: (useTemplate: boolean) => void;

  // Provider settings actions
  updateOpenAI: (settings: Partial<OpenAISettings>) => void;
  updateGemini: (settings: Partial<GeminiSettings>) => void;
  updateOpenAICompatible: (settings: Partial<OpenAICompatibleSettings>) => void;
  updatePalabraAI: (settings: Partial<PalabraAISettings>) => void;
  updateKizunaAI: (settings: Partial<KizunaAISettings>) => void;

  // Async actions
  validateApiKey: (getAuthToken?: () => Promise<string | null>) => Promise<ApiKeyValidationResult>;
  fetchAvailableModels: (getAuthToken?: () => Promise<string | null>) => Promise<void>;
  ensureKizunaApiKey: (getToken: () => Promise<string | null>, isSignedIn: boolean) => Promise<boolean>;
  loadSettings: () => Promise<void>;
  clearCache: () => void;

  // Helper methods
  getCurrentProviderSettings: () => OpenAISettings | GeminiSettings | OpenAICompatibleSettings | PalabraAISettings | KizunaAISettings;
  getCurrentProviderConfig: () => ProviderConfig;
  getProcessedSystemInstructions: (swapLanguages?: boolean) => string;
  createSessionConfig: (systemInstructions: string) => SessionConfig;
  navigateToSettings: (target: string | null) => void;
}

// ==================== Helper Functions ====================

function createOpenAISessionConfig(
  settings: OpenAISettings,
  systemInstructions: string
): OpenAISessionConfig {
  return {
    provider: 'openai',
    model: settings.model,
    voice: settings.voice,
    instructions: systemInstructions,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    turnDetection: settings.turnDetectionMode === 'Disabled' ? {type: 'none'} :
      settings.turnDetectionMode === 'Normal' ? {
        type: 'server_vad',
        createResponse: true,
        interruptResponse: false,
        prefixPadding: settings.prefixPadding,
        silenceDuration: settings.silenceDuration,
        threshold: settings.threshold
      } : {
        type: 'semantic_vad',
        createResponse: true,
        interruptResponse: false,
        eagerness: settings.semanticEagerness?.toLowerCase() as any,
      },
    inputAudioNoiseReduction: settings.noiseReduction && settings.noiseReduction !== 'None' ? {
      type: settings.noiseReduction === 'Near field' ? 'near_field' : 'far_field'
    } : undefined,
    inputAudioTranscription: settings.transcriptModel ? {
      model: settings.transcriptModel
    } : undefined,
  };
}

function createGeminiSessionConfig(
  settings: GeminiSettings,
  systemInstructions: string
): GeminiSessionConfig {
  return {
    provider: 'gemini',
    model: settings.model,
    voice: settings.voice,
    instructions: systemInstructions,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
  };
}

function createPalabraAISessionConfig(
  settings: PalabraAISettings,
  systemInstructions: string
): PalabraAISessionConfig {
  return {
    provider: 'palabraai',
    model: 'realtime-translation',
    voice: settings.voiceId,
    instructions: systemInstructions,
    temperature: 0.8,
    maxTokens: 'inf',
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    voiceId: settings.voiceId,
    segmentConfirmationSilenceThreshold: settings.segmentConfirmationSilenceThreshold,
    sentenceSplitterEnabled: settings.sentenceSplitterEnabled,
    translatePartialTranscriptions: settings.translatePartialTranscriptions,
    desiredQueueLevelMs: settings.desiredQueueLevelMs,
    maxQueueLevelMs: settings.maxQueueLevelMs,
    autoTempo: settings.autoTempo,
  };
}

// ==================== Store Implementation ====================

const useSettingsStore = create<SettingsStore>()(
  subscribeWithSelector((set, get) => ({
    // === Initial State ===
    ...defaultCommonSettings,
    openai: defaultOpenAISettings,
    gemini: defaultGeminiSettings,
    openaiCompatible: defaultOpenAICompatibleSettings,
    palabraai: defaultPalabraAISettings,
    kizunaai: defaultKizunaAISettings,

    isApiKeyValid: null,
    isValidating: false,
    validationMessage: '',
    validationCache: new Map(),

    availableModels: [],
    loadingModels: false,

    isKizunaKeyFetching: false,
    kizunaKeyError: null,

    settingsNavigationTarget: null,

    settingsLoaded: false,

    // === Common Settings Actions ===
    setProvider: async (provider) => {
      set({provider});
      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.provider', provider);

      // Clear cache when switching providers
      const state = get();
      state.clearCache();

      // Auto-validate API key for the new provider
      // Note: For KizunaAI, this will be handled by SettingsInitializer
      if (provider !== Provider.KIZUNA_AI) {
        // Small delay to ensure state is updated
        setTimeout(() => {
          state.validateApiKey();
        }, 100);
      }
    },

    setUILanguage: async (uiLanguage) => {
      set({uiLanguage});
      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.uiLanguage', uiLanguage);
    },

    setUIMode: async (uiMode) => {
      set({uiMode});
      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.uiMode', uiMode);
    },

    setSystemInstructions: async (systemInstructions) => {
      set({systemInstructions});
      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.systemInstructions', systemInstructions);
    },

    setTemplateSystemInstructions: async (templateSystemInstructions) => {
      set({templateSystemInstructions});
      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.templateSystemInstructions', templateSystemInstructions);
    },

    setUseTemplateMode: async (useTemplateMode) => {
      set({useTemplateMode});
      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.useTemplateMode', useTemplateMode);
    },

    // === Provider Settings Actions ===
    updateOpenAI: async (settings) => {
      set((state) => ({openai: {...state.openai, ...settings}}));
      const service = ServiceFactory.getSettingsService();
      for (const [key, value] of Object.entries(settings)) {
        await service.setSetting(`settings.openai.${key}`, value);
      }
    },

    updateGemini: async (settings) => {
      set((state) => ({gemini: {...state.gemini, ...settings}}));
      const service = ServiceFactory.getSettingsService();
      for (const [key, value] of Object.entries(settings)) {
        await service.setSetting(`settings.gemini.${key}`, value);
      }
    },

    updateOpenAICompatible: async (settings) => {
      set((state) => ({openaiCompatible: {...state.openaiCompatible, ...settings}}));
      const service = ServiceFactory.getSettingsService();
      for (const [key, value] of Object.entries(settings)) {
        await service.setSetting(`settings.openaiCompatible.${key}`, value);
      }
    },

    updatePalabraAI: async (settings) => {
      set((state) => ({palabraai: {...state.palabraai, ...settings}}));
      const service = ServiceFactory.getSettingsService();
      for (const [key, value] of Object.entries(settings)) {
        await service.setSetting(`settings.palabraai.${key}`, value);
      }
    },

    updateKizunaAI: async (settings) => {
      set((state) => ({kizunaai: {...state.kizunaai, ...settings}}));
      const service = ServiceFactory.getSettingsService();
      for (const [key, value] of Object.entries(settings)) {
        if (key === 'apiKey') continue; // Don't persist Kizuna AI API key
        await service.setSetting(`settings.kizunaai.${key}`, value);
      }
    },

    // === Async Actions ===
    validateApiKey: async (getAuthToken) => {
      const state = get();
      const provider = state.provider;

      // For KizunaAI, ensure we have an API key first
      if (provider === Provider.KIZUNA_AI) {
        const hasKey = await state.ensureKizunaApiKey(getAuthToken!, true);
        if (!hasKey) {
          return {
            valid: false,
            message: state.kizunaKeyError || 'Failed to fetch Kizuna AI API key',
            validating: false
          };
        }
      }

      // Get current API key and custom endpoint (if applicable)
      const currentSettings = state.getCurrentProviderSettings();
      let apiKey = '';
      let customEndpoint: string | undefined = undefined;

      if (provider === Provider.PALABRA_AI) {
        const palabraSettings = currentSettings as PalabraAISettings;
        apiKey = palabraSettings.clientId;

        // Check if both clientId and clientSecret are present for PalabraAI
        if (!palabraSettings.clientId || !palabraSettings.clientSecret) {
          set({
            isApiKeyValid: null,
            availableModels: [],
            validationMessage: '',
            isValidating: false,
            isValidated: false,
            validationError: null
          });
          return {valid: false, message: '', validating: false};
        }
      } else if (provider === Provider.OPENAI_COMPATIBLE) {
        // OpenAI Compatible provider requires both API key and custom endpoint
        const compatSettings = currentSettings as OpenAICompatibleSettings;
        apiKey = compatSettings.apiKey || '';
        customEndpoint = compatSettings.customEndpoint;
      } else if (provider === Provider.KIZUNA_AI && getAuthToken) {
        apiKey = await getAuthToken() || '';
      } else {
        apiKey = (currentSettings as any).apiKey || '';
      }

      // Check if API key is empty for non-PalabraAI providers
      if (!apiKey && provider !== Provider.PALABRA_AI) {
        set({
          isApiKeyValid: null,
          availableModels: [],
          validationMessage: '',
          isValidating: false,
          isValidated: false,
          validationError: null
        });
        return {valid: false, message: '', validating: false};
      }

      // Check cache
      const cacheKey = provider === Provider.PALABRA_AI
        ? `${provider}:${apiKey}:${(currentSettings as PalabraAISettings).clientSecret}`
        : `${provider}:${apiKey}`;

      const cached = state.validationCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        set({
          isApiKeyValid: Boolean(cached.validation.valid),
          availableModels: cached.models,
          validationMessage: cached.validation.message,
          isValidating: false,
          isValidated: true,
          validationError: cached.validation.valid ? null : cached.validation.message,
          cacheTimestamp: cached.timestamp
        });
        return cached.validation;
      }

      // Validate
      set({isValidating: true, validationMessage: 'Validating...'});

      try {
        const service = ServiceFactory.getSettingsService();
        const clientSecret = provider === Provider.PALABRA_AI
          ? (currentSettings as PalabraAISettings).clientSecret
          : undefined;

        const result = await service.validateApiKeyAndFetchModels(
          apiKey,
          provider,
          clientSecret,
          customEndpoint  // Pass custom endpoint for OpenAI Compatible
        );

        // Cache result
        const newCache = new Map(state.validationCache);
        newCache.set(cacheKey, {
          validation: result.validation,
          models: result.models,
          timestamp: Date.now()
        });

        set({
          isApiKeyValid: Boolean(result.validation.valid),
          availableModels: result.models,
          validationMessage: result.validation.message,
          validationCache: newCache,
          isValidating: false,
          isValidated: true,
          validationError: result.validation.valid ? null : result.validation.message,
          cacheTimestamp: Date.now()
        });

        return result.validation;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Validation failed';
        set({
          isApiKeyValid: false,
          availableModels: [],
          validationMessage: message,
          isValidating: false,
          isValidated: false,
          validationError: message
        });
        return {valid: false, message, validating: false};
      }
    },

    fetchAvailableModels: async (getAuthToken) => {
      set({loadingModels: true});
      const result = await get().validateApiKey(getAuthToken);
      set({loadingModels: false});
    },

    ensureKizunaApiKey: async (getToken, isSignedIn) => {
      const state = get();

      if (state.kizunaai.apiKey && state.kizunaai.apiKey.trim() !== '') {
        return true;
      }

      if (state.isKizunaKeyFetching) {
        console.log('[SettingsStore] Token fetch already in progress');
        return false;
      }

      if (!isSignedIn || !getToken) {
        console.log('[SettingsStore] Cannot get token - user not signed in');
        set({kizunaKeyError: 'User not signed in'});
        return false;
      }

      set({isKizunaKeyFetching: true, kizunaKeyError: null});

      try {
        console.log('[SettingsStore] Getting auth session for Kizuna AI...');
        const authToken = await getToken();

        if (authToken) {
          console.log('[SettingsStore] Successfully got auth session for Kizuna AI');
          set((state) => ({
            kizunaai: {...state.kizunaai, apiKey: authToken},
            isKizunaKeyFetching: false
          }));
          return true;
        } else {
          const error = 'Failed to get auth session';
          console.warn('[SettingsStore] ' + error);
          set({kizunaKeyError: error, isKizunaKeyFetching: false});
          return false;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error getting auth session';
        console.error('[SettingsStore] Error getting auth session for Kizuna AI:', errorMessage);
        set({kizunaKeyError: errorMessage, isKizunaKeyFetching: false});
        return false;
      }
    },

    loadSettings: async () => {
      try {
        const service = ServiceFactory.getSettingsService();

        // Load common settings
        const provider = await service.getSetting('settings.common.provider', defaultCommonSettings.provider);
        const uiLanguage = await service.getSetting('settings.common.uiLanguage', defaultCommonSettings.uiLanguage);
        const uiMode = await service.getSetting('settings.common.uiMode', defaultCommonSettings.uiMode);
        const systemInstructions = await service.getSetting('settings.common.systemInstructions', defaultCommonSettings.systemInstructions);
        const templateSystemInstructions = await service.getSetting('settings.common.templateSystemInstructions', defaultCommonSettings.templateSystemInstructions);
        const useTemplateMode = await service.getSetting('settings.common.useTemplateMode', defaultCommonSettings.useTemplateMode);

        // Validate provider availability
        const validProvider = ProviderConfigFactory.isProviderSupported(provider) ? provider : Provider.OPENAI;

        // Load provider settings
        const loadProviderSettings = async <T>(prefix: string, defaults: T): Promise<T> => {
          const settings: any = {};
          for (const key of Object.keys(defaults as any)) {
            settings[key] = await service.getSetting(`${prefix}.${key}`, (defaults as any)[key]);
          }
          return settings as T;
        };

        const [openai, gemini, openaiCompatible, palabraai, kizunaai] = await Promise.all([
          loadProviderSettings('settings.openai', defaultOpenAISettings),
          loadProviderSettings('settings.gemini', defaultGeminiSettings),
          loadProviderSettings('settings.openaiCompatible', defaultOpenAICompatibleSettings),
          loadProviderSettings('settings.palabraai', defaultPalabraAISettings),
          loadProviderSettings('settings.kizunaai', defaultKizunaAISettings),
        ]);

        set({
          provider: validProvider,
          uiLanguage,
          uiMode,
          systemInstructions,
          templateSystemInstructions,
          useTemplateMode,
          openai,
          gemini,
          openaiCompatible,
          palabraai,
          kizunaai,
          settingsLoaded: true,
        });

        console.info('[SettingsStore] Settings loaded successfully');
      } catch (error) {
        console.error('[SettingsStore] Error loading settings:', error);
      }
    },

    clearCache: () => {
      set({
        validationCache: new Map(),
        availableModels: [],
        isApiKeyValid: null
      });
    },

    // === Helper Methods ===
    getCurrentProviderSettings: () => {
      const state = get();
      switch (state.provider) {
        case Provider.OPENAI:
          return state.openai;
        case Provider.OPENAI_COMPATIBLE:
          return state.openaiCompatible;
        case Provider.GEMINI:
          return state.gemini;
        case Provider.PALABRA_AI:
          return state.palabraai;
        case Provider.KIZUNA_AI:
          return state.kizunaai;
        default:
          return state.openai;
      }
    },

    getCurrentProviderConfig: () => {
      const state = get();
      try {
        return ProviderConfigFactory.getConfig(state.provider);
      } catch (error) {
        console.warn(`[SettingsStore] Unknown provider: ${state.provider}, falling back to OpenAI`);
        return ProviderConfigFactory.getConfig(Provider.OPENAI);
      }
    },

    getProcessedSystemInstructions: (swapLanguages = false) => {
      const state = get();
      if (state.useTemplateMode) {
        const providerConfig = state.getCurrentProviderConfig();
        const currentSettings = state.getCurrentProviderSettings();

        const sourceLang = providerConfig.languages.find(l => l.value === currentSettings.sourceLanguage);
        const targetLang = providerConfig.languages.find(l => l.value === currentSettings.targetLanguage);

        const sourceLangName = sourceLang?.englishName || currentSettings.sourceLanguage || 'SOURCE_LANGUAGE';
        const targetLangName = targetLang?.englishName || currentSettings.targetLanguage || 'TARGET_LANGUAGE';

        // If swapLanguages is true, swap source and target (for participant audio translation)
        const effectiveSource = swapLanguages ? targetLangName : sourceLangName;
        const effectiveTarget = swapLanguages ? sourceLangName : targetLangName;

        return state.templateSystemInstructions
          .replace(/\{\{SOURCE_LANGUAGE\}\}/g, effectiveSource)
          .replace(/\{\{TARGET_LANGUAGE\}\}/g, effectiveTarget);
      } else {
        return state.systemInstructions;
      }
    },

    createSessionConfig: (systemInstructions) => {
      const state = get();
      switch (state.provider) {
        case Provider.OPENAI:
          return createOpenAISessionConfig(state.openai, systemInstructions);
        case Provider.OPENAI_COMPATIBLE:
          return createOpenAISessionConfig(state.openaiCompatible, systemInstructions);
        case Provider.GEMINI:
          return createGeminiSessionConfig(state.gemini, systemInstructions);
        case Provider.PALABRA_AI:
          return createPalabraAISessionConfig(state.palabraai, systemInstructions);
        case Provider.KIZUNA_AI:
          return createOpenAISessionConfig(state.kizunaai, systemInstructions);
        default:
          return createOpenAISessionConfig(state.openai, systemInstructions);
      }
    },

    navigateToSettings: (target) => {
      set({settingsNavigationTarget: target});
    },
  }))
);

// ==================== Export Optimized Selectors ====================

// Common settings
export const useProvider = () => useSettingsStore((state) => state.provider);
export const useUILanguage = () => useSettingsStore((state) => state.uiLanguage);
export const useUIMode = () => useSettingsStore((state) => state.uiMode);
export const useSystemInstructions = () => useSettingsStore((state) => state.systemInstructions);
export const useTemplateSystemInstructions = () => useSettingsStore((state) => state.templateSystemInstructions);
export const useUseTemplateMode = () => useSettingsStore((state) => state.useTemplateMode);

// Provider settings
export const useOpenAISettings = () => useSettingsStore((state) => state.openai);
export const useGeminiSettings = () => useSettingsStore((state) => state.gemini);
export const useOpenAICompatibleSettings = () => useSettingsStore((state) => state.openaiCompatible);
export const usePalabraAISettings = () => useSettingsStore((state) => state.palabraai);
export const useKizunaAISettings = () => useSettingsStore((state) => state.kizunaai);

// Transport type selector (for OpenAI provider)
export const useTransportType = () => useSettingsStore((state) => state.openai.transportType);

// Validation state
export const useIsApiKeyValid = () => useSettingsStore((state) => state.isApiKeyValid);
export const useIsValidating = () => useSettingsStore((state) => state.isValidating);
export const useValidationMessage = () => useSettingsStore((state) => state.validationMessage);

// Models state
export const useAvailableModels = () => useSettingsStore((state) => state.availableModels);
export const useLoadingModels = () => useSettingsStore((state) => state.loadingModels);

// Kizuna state
export const useIsKizunaKeyFetching = () => useSettingsStore((state) => state.isKizunaKeyFetching);
export const useKizunaKeyError = () => useSettingsStore((state) => state.kizunaKeyError);

// Navigation
export const useSettingsNavigationTarget = () => useSettingsStore((state) => state.settingsNavigationTarget);

// Settings loading state
export const useSettingsLoaded = () => useSettingsStore((state) => state.settingsLoaded);

// Actions
export const useSetProvider = () => useSettingsStore((state) => state.setProvider);
export const useSetUILanguage = () => useSettingsStore((state) => state.setUILanguage);
export const useSetUIMode = () => useSettingsStore((state) => state.setUIMode);
export const useSetSystemInstructions = () => useSettingsStore((state) => state.setSystemInstructions);
export const useSetTemplateSystemInstructions = () => useSettingsStore((state) => state.setTemplateSystemInstructions);
export const useSetUseTemplateMode = () => useSettingsStore((state) => state.setUseTemplateMode);

export const useUpdateOpenAI = () => useSettingsStore((state) => state.updateOpenAI);
export const useUpdateGemini = () => useSettingsStore((state) => state.updateGemini);
export const useUpdateOpenAICompatible = () => useSettingsStore((state) => state.updateOpenAICompatible);
export const useUpdatePalabraAI = () => useSettingsStore((state) => state.updatePalabraAI);
export const useUpdateKizunaAI = () => useSettingsStore((state) => state.updateKizunaAI);

export const useValidateApiKey = () => useSettingsStore((state) => state.validateApiKey);
export const useFetchAvailableModels = () => useSettingsStore((state) => state.fetchAvailableModels);
export const useEnsureKizunaApiKey = () => useSettingsStore((state) => state.ensureKizunaApiKey);
export const useLoadSettings = () => useSettingsStore((state) => state.loadSettings);
export const useClearCache = () => useSettingsStore((state) => state.clearCache);

export const useGetCurrentProviderSettings = () => useSettingsStore((state) => state.getCurrentProviderSettings);
export const useGetCurrentProviderConfig = () => useSettingsStore((state) => state.getCurrentProviderConfig);
export const useGetProcessedSystemInstructions = () => useSettingsStore((state) => state.getProcessedSystemInstructions);
export const useCreateSessionConfig = () => useSettingsStore((state) => state.createSessionConfig);
export const useNavigateToSettings = () => useSettingsStore((state) => state.navigateToSettings);

export default useSettingsStore;