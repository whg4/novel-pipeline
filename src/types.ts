export interface StoryMemory {
  characterStates: string;      // 当前角色状态（已知关系、立场、能力、物品持有）
  openForeshadowing: string;    // 未收伏笔（已埋设但未揭示的线索）
  keyEvents: string;            // 关键事件摘要（影响后续剧情走向的重大事件）
  /** 结构化时间线：按章节记录关键事件 */
  timeline: { chapter: number; event: string }[];
  /** 结构化伏笔追踪 */
  foreshadowingList: { text: string; status: 'planted' | 'resolved' | 'abandoned'; chapter?: number }[];
  /** 每章摘要（1-2句），用于跨章节上下文 */
  chapterSummaries: { chapter: number; summary: string }[];
  /** 已分析到第几章（用于检测记忆是否过时） */
  chaptersAnalyzed: number;
  /** 上次提取是否成功 */
  lastExtractionSuccess: boolean;
  updatedAt: number;
}

export interface LogicReviewResult {
  timeline: { passed: boolean; detail: string };
  location: { passed: boolean; detail: string };
  props: { passed: boolean; detail: string };
  characters: { passed: boolean; detail: string };
  emotionHook: { passed: boolean; detail: string };
  outlineFidelity?: { passed: boolean; detail: string };
  memoryConsistency?: { passed: boolean; detail: string };
  summary: string;
}

export interface Project {
  id?: number;
  title: string;
  genre: string; // 'classic-wolf' | 'female-slap' | 'general'
  background: string;
  characters: string;
  rawExample: string; // The reference/example draft to imitate
  outline: string; // Generated outline
  outlineValidationStatus?: 'pending' | 'valid' | 'invalid';
  outlineValidationResult?: OutlineValidationResult;
  outlineValidationUpdatedAt?: number;
  createdAt: number;
  titleCandidates?: string; // LLM 生成的书名候选
  coverPrompt?: string;    // LLM 生成的封面提示词
  storyMemory?: StoryMemory; // 跨章节故事记忆（角色状态/伏笔/关键事件）
}

export type OutlineChecklistKey =
  | 'a_rhythm'
  | 'b_no_jargon'
  | 'c_differences'
  | 'd_payback'
  | 'e_motives'
  | 'f_logic_time'
  | 'g_transition'
  | 'h_item_consistency'
  | 'i_no_pose'
  | 'j_cliffhangers';

export interface OutlineChecklistItemResult {
  key: OutlineChecklistKey;
  passed: boolean;
  reason: string;
}

export interface OutlineValidationResult {
  passed: boolean;
  attempt: number;
  summary: string;
  failedItems: OutlineChecklistKey[];
  items: OutlineChecklistItemResult[];
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
  regenerationPrompt?: string; // User-supplied rewrite instructions for this chapter
  extraSkillKeys?: string[];   // Additional skill keys injected into this chapter's prompt
  extraSkillText?: string;     // Uploaded/pasted temporary skill content for this chapter
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
  extraHeaders?: Record<string, string>;
}

// 工作流阶段：大纲 / 正文 / 逻辑审查 / 营销（简介+书名+封面）
export type StageRole = 'outline' | 'chapter' | 'review' | 'marketing';

// 每个阶段指派到哪个供应商
export interface StageAssignments {
  outline: LLMProviderId;
  chapter: LLMProviderId;
  review: LLMProviderId;
  marketing: LLMProviderId;
}

export interface ChatMessage {
  id?: number;
  projectId: number;
  scope: 'outline' | 'chapter';
  chapterId?: number;
  role: 'user' | 'assistant';
  kind?: 'outline' | 'review' | 'chapter' | 'logic-review';
  content: string;
  createdAt: number;
}

export interface LLMConnectionTestResult {
  ok: boolean;
  providerName: string;
  model: string;
  message: string;
  detail?: string;
}
