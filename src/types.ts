export interface Project {
  id?: number;
  title: string;
  genre: string; // 'classic-wolf' | 'female-slap' | 'general'
  background: string;
  characters: string;
  rawExample: string; // The reference/example draft to imitate
  outline: string; // Generated outline
  createdAt: number;
}

export interface Chapter {
  id?: number;
  projectId: number;
  chapterNumber: number;
  title: string;
  outlineSection: string; // Reference outline text for this chapter
  content: string; // Main draft
  preChaptersEndHook?: string; // Text to stitch together
  logicCheckLog?: string; // Standardized check output
  isCompleted: boolean;
  versionHistory: { content: string; timestamp: number }[];
  lastEdited: number;
}

export interface Skill {
  key: string; // e.g. "degrease", "wolf", "logic-check"
  name: string;
  content: string;
  category: 'workflow' | 'template' | 'rule' | 'logic_check' | 'blurb';
  description: string;
}

export type LLMProviderId =
  | 'openai'
  | 'deepseek'
  | 'anthropic'
  | 'gemini'
  | 'grok'
  | 'openrouter'
  | 'custom-openai'
  | 'custom-anthropic'
  | 'local-relay';

export type LLMApiStyle =
  | 'openai-compatible'
  | 'anthropic-messages'
  | 'gemini-generate-content'
  | 'local-relay';

export interface ProviderPreset {
  id: LLMProviderId;
  name: string;
  shortName: string;
  apiStyle: LLMApiStyle;
  defaultBaseUrl: string;
  defaultModel: string;
  modelSuggestions: string[];
  description: string;
  helpText: string;
  directBrowserSupport: 'supported' | 'proxy-recommended' | 'relay-only';
}

export interface APIConfig {
  provider: LLMProviderId;
  apiStyle: LLMApiStyle;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  extraHeaders?: Record<string, string>;
}

export interface LLMConnectionTestResult {
  ok: boolean;
  providerName: string;
  model: string;
  message: string;
  detail?: string;
}
