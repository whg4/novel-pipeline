import {
  APIConfig,
  Chapter,
  LLMConnectionTestResult,
  LLMProviderId,
  OutlineChecklistKey,
  OutlineValidationResult,
  StageRole,
  StageAssignments,
} from '../types';
import { createConfigForProvider, getProviderPreset, normalizeLegacyProvider, normalizeModelForProvider } from './providers';

const STORAGE_KEY = 'novel_pipeline_api_config'; // 旧版单一全局配置（用于迁移）
const PROVIDER_CONFIGS_KEY = 'novel_pipeline_provider_configs'; // 每供应商独立配置
const STAGE_ASSIGN_KEY = 'novel_pipeline_stage_assignments'; // 阶段→供应商指派
const STAGE_MODEL_OVERRIDES_KEY = 'novel_pipeline_stage_model_overrides'; // 阶段→模型名覆盖

const DEFAULT_CONFIG: APIConfig = createConfigForProvider('deepseek');

// 默认阶段指派：大纲→OpenAI、正文→Gemini、逻辑审查→Gemini、营销→OpenAI
const DEFAULT_STAGE_ASSIGNMENTS: StageAssignments = {
  outline: 'openai',
  chapter: 'gemini',
  review: 'gemini',
  marketing: 'openai',
};

type StreamTokenHandler = (text: string) => void;

export const LLM_PAUSED_ERROR = '__PAUSED__';

export interface LLMStreamOptions {
  signal?: AbortSignal;
  shouldPause?: () => boolean;
}

export interface OutlineChecklistPromptItem {
  key: OutlineChecklistKey;
  title: string;
}

function normalizeConfig(input?: Partial<APIConfig> | null): APIConfig {
  if (!input) return DEFAULT_CONFIG;

  const provider = normalizeLegacyProvider(input.provider);
  const preset = getProviderPreset(provider);

  return {
    provider,
    apiStyle: input.apiStyle ?? preset.apiStyle,
    apiKey: input.apiKey ?? '',
    baseUrl: input.baseUrl || preset.defaultBaseUrl,
    model: normalizeModelForProvider(provider, input.model),
    temperature: Number.isFinite(input.temperature) ? Number(input.temperature) : DEFAULT_CONFIG.temperature,
    extraHeaders: input.extraHeaders ?? {},
  };
}

export function getAPIConfig(): APIConfig {
  const json = localStorage.getItem(STORAGE_KEY);
  if (json) {
    try {
      return normalizeConfig(JSON.parse(json));
    } catch {
      return DEFAULT_CONFIG;
    }
  }
  return DEFAULT_CONFIG;
}

export function saveAPIConfig(config: APIConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeConfig(config)));
}

// ----------------------------------------------------
// 多供应商独立配置存储（每个供应商单独保存 Key/BaseURL/Model 等）
// ----------------------------------------------------
type ProviderConfigMap = Partial<Record<LLMProviderId, APIConfig>>;

function readProviderConfigs(): ProviderConfigMap {
  const json = localStorage.getItem(PROVIDER_CONFIGS_KEY);
  if (json) {
    try {
      return JSON.parse(json) as ProviderConfigMap;
    } catch {
      return {};
    }
  }
  return {};
}

// 一次性迁移：把旧版单一全局配置塞进对应供应商槽位
function migrateLegacyConfig(map: ProviderConfigMap): ProviderConfigMap {
  if (Object.keys(map).length > 0) return map;
  const legacy = localStorage.getItem(STORAGE_KEY);
  if (legacy) {
    try {
      const parsed = normalizeConfig(JSON.parse(legacy));
      const migrated: ProviderConfigMap = { [parsed.provider]: parsed };
      localStorage.setItem(PROVIDER_CONFIGS_KEY, JSON.stringify(migrated));
      return migrated;
    } catch {
      return map;
    }
  }
  return map;
}

export function getProviderConfigs(): ProviderConfigMap {
  return migrateLegacyConfig(readProviderConfigs());
}

// 获取某供应商已保存的配置；未保存过则返回该供应商默认配置
export function getProviderConfig(provider: LLMProviderId): APIConfig {
  const map = getProviderConfigs();
  const saved = map[provider];
  if (saved) return normalizeConfig(saved);
  return createConfigForProvider(provider);
}

// 仅保存当前供应商的配置（Key 各自独立，互不覆盖）
export function saveProviderConfig(config: APIConfig) {
  const normalized = normalizeConfig(config);
  const map = getProviderConfigs();
  map[normalized.provider] = normalized;
  localStorage.setItem(PROVIDER_CONFIGS_KEY, JSON.stringify(map));
}

// ----------------------------------------------------
// 阶段→供应商指派
// ----------------------------------------------------
export function getStageAssignments(): StageAssignments {
  const json = localStorage.getItem(STAGE_ASSIGN_KEY);
  if (json) {
    try {
      const parsed = JSON.parse(json) as Partial<StageAssignments>;
      return { ...DEFAULT_STAGE_ASSIGNMENTS, ...parsed };
    } catch {
      return DEFAULT_STAGE_ASSIGNMENTS;
    }
  }
  return DEFAULT_STAGE_ASSIGNMENTS;
}

export function saveStageAssignments(assignments: StageAssignments) {
  localStorage.setItem(STAGE_ASSIGN_KEY, JSON.stringify(assignments));
}

type StageModelOverrides = Partial<Record<StageRole, string>>;

export function getStageModelOverrides(): StageModelOverrides {
  const json = localStorage.getItem(STAGE_MODEL_OVERRIDES_KEY);
  if (json) {
    try {
      return JSON.parse(json) as StageModelOverrides;
    } catch {
      return {};
    }
  }
  return {};
}

export function saveStageModelOverride(stage: StageRole, model: string) {
  const overrides = getStageModelOverrides();
  const normalizedModel = model.trim();
  if (normalizedModel) {
    overrides[stage] = normalizedModel;
  } else {
    delete overrides[stage];
  }
  localStorage.setItem(STAGE_MODEL_OVERRIDES_KEY, JSON.stringify(overrides));
}

// 取某阶段实际生效的模型配置
export function getConfigForStage(stage: StageRole): APIConfig {
  const assignments = getStageAssignments();
  const provider = assignments[stage];
  const config = getProviderConfig(provider);
  const modelOverride = getStageModelOverrides()[stage];
  return modelOverride ? { ...config, model: normalizeModelForProvider(provider, modelOverride) } : config;
}

function buildUrl(baseUrl: string, suffix: string): string {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  if (normalizedBase.endsWith(suffix)) return normalizedBase;
  return `${normalizedBase}${suffix}`;
}

function extractOpenAIText(payload: unknown): string {
  const data = payload as any;
  return data?.choices?.[0]?.delta?.content
    ?? data?.choices?.[0]?.message?.content
    ?? data?.choices?.[0]?.text
    ?? '';
}

function extractAnthropicText(payload: unknown): string {
  const data = payload as any;
  return data?.delta?.text
    ?? data?.content_block?.text
    ?? data?.content?.map?.((part: any) => part?.text || '').join('')
    ?? '';
}

function extractGeminiText(payload: unknown): string {
  const data = payload as any;
  return data?.candidates?.[0]?.content?.parts?.map?.((part: any) => part?.text || '').join('')
    ?? data?.candidates?.[0]?.content?.parts?.[0]?.text
    ?? '';
}

function extractRelayText(payload: unknown): string {
  const data = payload as any;
  return data?.text ?? data?.token ?? data?.delta ?? data?.content ?? extractOpenAIText(payload) ?? '';
}

async function consumeEventStream(
  response: Response,
  onToken: StreamTokenHandler,
  extractor: (payload: unknown) => string,
  options?: LLMStreamOptions,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('浏览器无法读取模型返回流。');

  const decoder = new TextDecoder('utf-8');
  let fullText = '';
  let buffer = '';

  while (true) {
    assertStreamActive(options);
    const { done, value } = await reader.read();
    assertStreamActive(options);
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const cleanLine = line.trim();
      if (!cleanLine || cleanLine.startsWith('event:')) continue;
      if (cleanLine === 'data: [DONE]') continue;

      const jsonText = cleanLine.startsWith('data: ') ? cleanLine.slice(6) : cleanLine;
      try {
        const parsed = JSON.parse(jsonText);
        const chunk = extractor(parsed);
        if (chunk) {
          fullText += chunk;
          onToken(chunk);
        }
      } catch {
        // Some relay streams include heartbeat or partial chunks. Ignore safely.
      }
    }
  }

  return fullText;
}

async function handleResponse(
  response: Response,
  onToken: StreamTokenHandler,
  extractor: (payload: unknown) => string,
  options?: LLMStreamOptions,
): Promise<string> {
  assertStreamActive(options);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`接口请求失败（${response.status}）：${text || response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';

  // 明确是 SSE 流式响应
  if (contentType.includes('text/event-stream')) {
    return consumeEventStream(response, onToken, extractor, options);
  }

  // 明确是 JSON 响应（非流式）
  if (contentType.includes('application/json')) {
    const json = await response.json();
    const text = extractor(json);
    if (text) onToken(text);
    return text;
  }

  // Content-Type 未知：尝试文本读取后解析（某些代理不设置正确的 Content-Type）
  const raw = await response.text();
  // 尝试按 SSE 行格式解析
  let accumulated = '';
  for (const line of raw.split('\n')) {
    assertStreamActive(options);
    const clean = line.trim();
    if (!clean || clean === 'data: [DONE]' || clean.startsWith('event:')) continue;
    const jsonText = clean.startsWith('data: ') ? clean.slice(6) : clean;
    try {
      const parsed = JSON.parse(jsonText);
      const chunk = extractor(parsed);
      if (chunk) {
        accumulated += chunk;
        onToken(chunk);
      }
    } catch {
      // 非 JSON 行，忽略
    }
  }
  if (accumulated) return accumulated;

  // 最后回退：整体按 JSON 解析
  try {
    const json = JSON.parse(raw);
    const text = extractor(json);
    if (text) onToken(text);
    return text;
  } catch {
    // 纯文本响应
    if (raw) onToken(raw);
    return raw;
  }
}

  function assertStreamActive(options?: LLMStreamOptions) {
    if (options?.signal?.aborted || options?.shouldPause?.()) {
      throw new Error(LLM_PAUSED_ERROR);
    }
  }

  function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

async function runOpenAICompatibleStream(
  config: APIConfig,
  systemPrompt: string,
  userPrompt: string,
  onToken: StreamTokenHandler,
  options?: LLMStreamOptions,
): Promise<string> {
  const url = buildUrl(config.baseUrl, '/chat/completions');

  const response = await fetch(url, {
    method: 'POST',
    signal: options?.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'X-Title': 'Novel Pipeline Studio',
      ...(config.extraHeaders ?? {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: config.temperature,
      stream: true,
    }),
  });

  return handleResponse(response, onToken, extractOpenAIText, options);
}

async function runAnthropicMessagesStream(
  config: APIConfig,
  systemPrompt: string,
  userPrompt: string,
  onToken: StreamTokenHandler,
  options?: LLMStreamOptions,
): Promise<string> {
  const url = buildUrl(config.baseUrl, '/messages');

  const response = await fetch(url, {
    method: 'POST',
    signal: options?.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      ...(config.extraHeaders ?? {}),
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 65536,
      temperature: config.temperature,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      stream: true,
    }),
  });

  return handleResponse(response, onToken, extractAnthropicText, options);
}

async function runGeminiStream(
  config: APIConfig,
  systemPrompt: string,
  userPrompt: string,
  onToken: StreamTokenHandler,
  options?: LLMStreamOptions,
): Promise<string> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const fallbackModels = getProviderPreset('gemini').modelSuggestions;
  const modelsToTry = [config.model, ...fallbackModels].filter((model, index, models) => model && models.indexOf(model) === index);
  let modelNotFoundError = '';

  for (const modelName of modelsToTry) {
    assertStreamActive(options);
    const model = encodeURIComponent(modelName);
    const url = `${baseUrl}/models/${model}:streamGenerateContent?key=${encodeURIComponent(config.apiKey)}&alt=sse`;

    const response = await fetch(url, {
      method: 'POST',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.extraHeaders ?? {}),
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: config.temperature,
        },
      }),
    });

    if (response.ok) {
      return handleResponse(response, onToken, extractGeminiText, options);
    }

    const errorText = await response.text();
    if (response.status === 404 && /not found|NOT_FOUND|not supported for generateContent/i.test(errorText)) {
      modelNotFoundError = `接口请求失败（${response.status}）：${errorText || response.statusText}`;
      continue;
    }

    throw new Error(`接口请求失败（${response.status}）：${errorText || response.statusText}`);
  }

  throw new Error(`${modelNotFoundError || 'Gemini 模型不可用。'} 请在「阶段模型」中切换为可用模型。`);
}

async function runLocalRelayStream(
  config: APIConfig,
  systemPrompt: string,
  userPrompt: string,
  onToken: StreamTokenHandler,
  options?: LLMStreamOptions,
): Promise<string> {
  const response = await fetch(config.baseUrl, {
    method: 'POST',
    signal: options?.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      ...(config.extraHeaders ?? {}),
    },
    body: JSON.stringify({
      provider: config.provider,
      model: config.model,
      systemPrompt,
      userPrompt,
      temperature: config.temperature,
      stream: true,
    }),
  });

  return handleResponse(response, onToken, extractRelayText, options);
}

async function runLLMStreamWithConfig(
  config: APIConfig,
  systemPrompt: string,
  userPrompt: string,
  onToken: StreamTokenHandler,
  options?: LLMStreamOptions,
): Promise<string> {
  const normalizedConfig = normalizeConfig(config);

  assertStreamActive(options);

  if (!normalizedConfig.apiKey && normalizedConfig.apiStyle !== 'local-relay') {
    throw new Error('请先在“模型连接”页面填写 API 密钥。');
  }

  try {
    switch (normalizedConfig.apiStyle) {
      case 'openai-compatible':
        return runOpenAICompatibleStream(normalizedConfig, systemPrompt, userPrompt, onToken, options);
      case 'anthropic-messages':
        return runAnthropicMessagesStream(normalizedConfig, systemPrompt, userPrompt, onToken, options);
      case 'gemini-generate-content':
        return runGeminiStream(normalizedConfig, systemPrompt, userPrompt, onToken, options);
      case 'local-relay':
        return runLocalRelayStream(normalizedConfig, systemPrompt, userPrompt, onToken, options);
      default:
        throw new Error('当前模型供应商暂未配置可用的调用适配器。');
    }
  } catch (error) {
    if (options?.signal?.aborted || isAbortError(error)) {
      throw new Error(LLM_PAUSED_ERROR);
    }
    throw error;
  }
}

export async function runLLMStream(
  stage: StageRole,
  systemPrompt: string,
  userPrompt: string,
  onToken: StreamTokenHandler,
  options?: LLMStreamOptions,
): Promise<string> {
  return runLLMStreamWithConfig(getConfigForStage(stage), systemPrompt, userPrompt, onToken, options);
}

export async function testLLMConnection(config: APIConfig): Promise<LLMConnectionTestResult> {
  const normalizedConfig = normalizeConfig(config);
  const preset = getProviderPreset(normalizedConfig.provider);
  let output = '';

  try {
    await runLLMStreamWithConfig(
      normalizedConfig,
      '你是模型连接测试助手。',
      '请只回复 OK。',
      (token) => {
        output += token;
      },
    );

    return {
      ok: true,
      providerName: preset.name,
      model: normalizedConfig.model,
      message: `连接成功：${preset.name} / ${normalizedConfig.model}`,
      detail: output.trim() || '模型已返回空响应，但请求链路可达。',
    };
  } catch (error) {
    return {
      ok: false,
      providerName: preset.name,
      model: normalizedConfig.model,
      message: `连接失败：${preset.name} / ${normalizedConfig.model}`,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
}

function buildFailedValidation(
  checklistItems: OutlineChecklistPromptItem[],
  attempt: number,
  summary: string,
): OutlineValidationResult {
  return {
    passed: false,
    attempt,
    summary,
    failedItems: checklistItems.map(item => item.key),
    items: checklistItems.map(item => ({
      key: item.key,
      passed: false,
      reason: summary,
    })),
  };
}

function parseOutlineValidationResult(
  raw: string,
  checklistItems: OutlineChecklistPromptItem[],
  attempt: number,
): OutlineValidationResult {
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as any;
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

    const items = checklistItems.map(item => {
      const found = rawItems.find((candidate: any) => candidate?.key === item.key);
      return {
        key: item.key,
        passed: Boolean(found?.passed),
        reason: typeof found?.reason === 'string' && found.reason.trim()
          ? found.reason.trim()
          : '模型未给出该项的有效审查理由。',
      };
    });

    const failedItems = items.filter(item => !item.passed).map(item => item.key);

    return {
      passed: failedItems.length === 0,
      attempt,
      summary: typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : failedItems.length === 0
          ? '大纲通过全部自检项。'
          : '大纲仍有自检项未通过。',
      failedItems,
      items,
    };
  } catch {
    return buildFailedValidation(
      checklistItems,
      attempt,
      '自检模型返回格式无法解析，请重新生成或手动检查大纲。',
    );
  }
}

export async function validateOutlineAgainstChecklist(
  outline: string,
  checklistItems: OutlineChecklistPromptItem[],
  templateSkill: string,
  projectContext: { background: string; characters: string; rawExample: string },
  attempt: number,
): Promise<OutlineValidationResult> {
  const system = `你是网文仿写大纲的严格质检编辑。你只判断给定大纲是否满足自检清单，不重写大纲。
必须输出严格 JSON，不要 Markdown，不要解释文字。JSON 结构如下：
{"summary":"一句话总评","items":[{"key":"a_rhythm","passed":true,"reason":"理由"}]}
每个 checklist key 都必须出现一次。passed 只能是 boolean。reason 用中文，必须具体指出通过依据或失败原因。`;

  const checklistText = checklistItems
    .map(item => `- ${item.key}: ${item.title}`)
    .join('\n');

  const user = `
--- 仿写大纲输出模板规则 ---
${templateSkill || '未提供模板全文，请按自检清单执行。'}

--- 自检清单 ---
${checklistText}

--- 项目背景 ---
${projectContext.background || '未填写'}

--- 人物设定 ---
${projectContext.characters || '未填写'}

--- 参考原文 ---
${projectContext.rawExample || '未填写'}

--- 待审查大纲 ---
${outline}

请逐项审查：只要某项缺失、空泛、与参考节奏不对应、或证据链/时间线/道具流转不闭合，就判 false。
只输出 JSON。`;

  let raw = '';
  try {
    const returned = await runLLMStream('review', system, user, token => {
      raw += token;
    });
    return parseOutlineValidationResult(raw || returned, checklistItems, attempt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return buildFailedValidation(checklistItems, attempt, `审查模型调用失败：${msg}`);
  }
}

// Compile final outline prompt
export function compileOutlinePrompt(
  example: string,
  background: string,
  characters: string,
  templateSkill: string,
  validationFeedback?: string,
  wolfSkill?: string,
  slapSkill?: string
): { system: string; user: string } {
  const system = `You are a high-level creative writing AI that specializes in drafting best-selling web novel outlines. 
You must strictly follow the provided "仿写大纲输出格式模板 v3.0" rules.
Your outline structure must follow this format:
- 名词下沉 (No high-tech/AI jargon, use grounded real-world items).
- 1:1 Rhythm & Tension mapping of the reference example.
- Character lists and roles.
- Act structured chapters with explicit goals.${wolfSkill ? `

--- WEREWOLF WORLD SETTINGS (Classic Tribal Code) ---
${wolfSkill}` : ''}${slapSkill ? `

--- FEMALE PROTAGONIST CLIMAX / SLAPBACK (打脸闭环) ---
${slapSkill}` : ''}`;

  const user = `
--- TEMPLATE SYSTEM GUIDELINES ---
${templateSkill}

--- NEW PROJECT SPECIFICATIONS ---
- Background Setting:
${background || 'Standard background'}

- Character Settings:
${characters || 'Standard characters'}

--- REFERENCE EXAMPLE STORY (To imitate 1:1 in tension & emotion line) ---
${example}

${validationFeedback ? `--- REVISION SUGGESTIONS TO ADDRESS ---\n${validationFeedback}\n` : ''}

Generate a beautiful, comprehensive, and highly-detailed novel outline corresponding exactly to the template rules above.
`;

  return { system, user };
}

// Compile outline logic review prompt
export function compileOutlineLogicReviewPrompt(
  outline: string,
  logicCheckSkill: string
): { system: string; user: string } {
  const system = `You are a meticulous literary editor specializing in story structure and plot consistency.
You will review a novel outline and identify any logical issues, structural problems, or areas that need improvement.

--- REVIEW FRAMEWORK ---
${logicCheckSkill}`;

  const user = `Please review the following novel outline for:
1. Timeline and pacing consistency
2. Character motivation coherence
3. Plot logic and cause-effect chains
4. Foreshadowing and payoff alignment
5. Chapter structure and cliffhanger effectiveness
6. Any gaps or contradictions

For each issue found, provide a specific, actionable suggestion. Format your response as a structured review with clear sections.

--- NOVEL OUTLINE TO REVIEW ---
${outline}

Provide your review in Chinese. Be specific and actionable with each suggestion.`;

  return { system, user };
}

// Compile final chapter drafting prompt
export function compileChapterPrompt(
  outline: string,
  chapterNum: number,
  chapterOutline: string,
  previousChapters: Chapter[],
  skills: { key: string; content: string }[],
  isWerewolf: boolean,
  isFemaleSlap: boolean
): { system: string; user: string } {
  const degreaseSkill = skills.find(s => s.key === 'degrease')?.content || '';
  const connectSkill = skills.find(s => s.key === 'connect_skills')?.content || '';
  const logicCheckSkill = skills.find(s => s.key === 'logic_check')?.content || '';
  const werewolfSkill = isWerewolf ? (skills.find(s => s.key === 'wolf_setting')?.content || '') : '';
  const femaleSlapSkill = isFemaleSlap ? (skills.find(s => s.key === 'female_slap')?.content || '') : '';

  const system = `You are an elite novelist. You are about to draft Chapter ${chapterNum} of a highly anticipated novel based on the strict outline instructions.
You must adhere 100% to the following style and mechanics rules.

--- WRITING RULE: AI去油法则 (Anti-Grease Rules) ---
${degreaseSkill}

--- CONNECTION RULES & FLOW ---
${connectSkill}

${logicCheckSkill ? `\n--- 逻辑一致性规则（写作过程中随时自查，不在正文中输出）---\n${logicCheckSkill}` : ''}
${isWerewolf ? `\n--- WEREWOLF WORLD SETTINGS (Classic Tribal Code) ---\n${werewolfSkill}` : ''}
${isFemaleSlap ? `\n--- FEMALE PROTAGONIST CLIMAX / SLAPBACK (打脸闭环) ---\n${femaleSlapSkill}` : ''}

CRITICAL DIRECTIVES:
1. Write the chapter directly using clean, active verbiage, natural pacing, and sharp imagery.
2. Direct-to-draft format: Output the clean narrative text FIRST.
3. At the very end of your response, draw a clear horizontal separator "---" followed by your logical review list based on check procedures (Time, Place, Items, Behaviors).
4. Strictly avoid god-view statements ("he didn't know that...", "little did she suspect...") or professional techniques jargon in the actual narrative text.`;

  let precedingContext = 'This is Chapter 1. Start from the very beginning.';
  if (previousChapters.length > 0) {
    const prev = previousChapters[previousChapters.length - 1];
    const prevText = prev.content;
    const last300Words = prevText.length > 1000 ? prevText.substring(prevText.length - 1000) : prevText;
    precedingContext = `The previous Chapter (${prev.chapterNumber}) ended with the following action/paragraph:\n"${last300Words}"\n\nYou MUST start Chapter ${chapterNum} seamlessly from this ending, providing an immediate physical or psychological continuity, ensuring no gap in space or time.`;
  }

  const user = `
--- COMPLETE BOOK OUTLINE ---
${outline}

--- PREVIOUS CHAPTER DRAFT END-HOOK (Continuity context) ---
${precedingContext}

--- TARGET CHAPTER ${chapterNum} OUTLINE & EVENTS ---
${chapterOutline}

Write next chapter Chapter ${chapterNum} now. Begin straight in narrative form with the heading formatted exactly as: "### 第 ${chapterNum} 章: [章节名]"
`;

  return { system, user };
}

// Compile marketing info blurb prompt
export function compileBlurbPrompt(
  outline: string,
  customDraft: string,
  blurbSkill: string
): { system: string; user: string } {
  const system = `你是一位专精网文爆款简介（导语）写作的专家。必须严格遵循《爆款网文简介（导语）生成 Skill v4.1》的所有规则。
简介要求：220-380 字，包含两场戏（当众退婚/切割 + 深夜后悔/跪求），至少一句高冲突台词，不讲梗概只呈现现场片段。`;

  const user = `
--- 简介写作规则 ---
${blurbSkill}

--- 本书完整大纲 ---
${outline}

${customDraft ? `--- 代表性正文片段（前三章）---\n${customDraft}` : ''}

请根据以上规则和大纲，生成 3 个风格各异的高点击率爆款简介。
`;

  return { system, user };
}

// Compile LLM logic review prompt for a single chapter
export function compileLogicReviewPrompt(
  chapterContent: string,
  chapterNum: number,
  logicCheckSkill: string
): { system: string; user: string } {
  const system = `你是一位专业的小说逻辑审查编辑，严格依照《小说正文逻辑审查流程 Skill v3.2》执行审查。只输出格式化审查报告，不做其他说明。`;

  const user = `
--- 逻辑审查规则（Skill v3.2）---
${logicCheckSkill}

--- 需要审查的第 ${chapterNum} 章正文 ---
${chapterContent}

请严格按照以下格式输出审查报告：
【逻辑自查 - 第${chapterNum}章】
时间线：无冲突 / 有冲突（列明具体问题）
地点：无冲突 / 有冲突（列明具体问题）
道具：无冲突 / 有冲突（重点排查：获取时间、名称一致性、材质常识）
人物与行为：无冲突 / 有冲突（重点排查：已知信息行为悖论）
情感节奏：章末钩子已设置 / 未设置（说明钩子内容）
`;

  return { system, user };
}

// Compile book title candidates prompt
export function compileTitlePrompt(outline: string): { system: string; user: string } {
  const system = `你是一位专精爆款网文书名创作的专家。书名要简洁有力、带强烈情绪张力、适合在各平台传播，使用大众易懂词汇，避免生僻或高大上词汇。`;

  const user = `
--- 以下是本书的完整大纲 ---
${outline}

请根据上述大纲，生成 8 个备选书名，风格多样（含霸气型、暧昧拉扯型、悬念型），每个书名后附一句不超过 20 字的推荐理由。
输出格式：
1. 《书名》——理由
2. 《书名》——理由
...（共 8 个）
`;

  return { system, user };
}

// Compile AI image cover prompt
export function compileCoverPrompt(outline: string, genre: string): { system: string; user: string } {
  const genreLabel = genre === 'classic-wolf' ? '欧美部落狼人' : genre === 'female-slap' ? '大女主打脸爽文' : '都市爽文';

  const system = `你是一位专业的网文封面设计提示词工程师，擅长为 AI 绘图模型（DALL-E 3 / Midjourney）生成高转化率的竖版小说封面英文提示词。`;

  const user = `
--- 以下是本书的完整大纲 ---
${outline}

书籍类型：${genreLabel}

请基于大纲核心人物形象、情绪基调与高潮冲突场景，生成一段用于 AI 绘图的英文提示词。要求：
- 竖版构图，比例 7:10，适合裁剪为 700×1000
- 体现女主强势气场与核心矛盾张力
- 包含书名占位指引（如：book title text at top in stylized Chinese font）
- 风格：high quality web novel cover, cinematic lighting, dramatic atmosphere

只输出英文提示词本身，不要任何解释或前置说明。
`;

  return { system, user };
}
