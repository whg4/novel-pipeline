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
import { retryWithBackoff } from '../utils/retryWithBackoff';
import { estimateTokens, trimPromptToFit } from '../utils/tokenEstimator';

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

export const OUTLINE_CHECKLIST_ITEMS: OutlineChecklistPromptItem[] = [
  { key: 'a_rhythm', title: '节奏对齐（与参考原文分镜/事件密度一一对应）' },
  { key: 'b_no_jargon', title: '无术语注解（不出现括号内解释、专业词汇说明）' },
  { key: 'c_differences', title: '差异标注（与参考原文的替换点明确标记）' },
  { key: 'd_payback', title: '伏笔回收（每个伏笔有明确回收章节）' },
  { key: 'e_motives', title: '角色动机一致（无突兀行为转变）' },
  { key: 'f_logic_time', title: '时间线逻辑（无时间矛盾）' },
  { key: 'g_transition', title: '章节衔接（末尾钩子→下一章开头无缝）' },
  { key: 'h_item_consistency', title: '道具一致性（获取/使用/消失有闭环）' },
  { key: 'i_no_pose', title: '无上帝视角（不出现"他不知道的是"等越界叙述）' },
  { key: 'j_cliffhangers', title: '章末悬念（每章结尾有钩子）' },
];

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

  /**
   * 带重试的 fetch 封装
   * 仅在网络层失败（429/500/502/503）时重试，不重试鉴权错误或用户暂停
   */
  async function retryFetch(
    url: string,
    init: RequestInit,
    options?: LLMStreamOptions,
  ): Promise<Response> {
    return retryWithBackoff(
      async () => {
        const response = await fetch(url, init);
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`接口请求失败（${response.status}）：${text || response.statusText}`);
        }
        return response;
      },
      {
        maxRetries: 3,
        baseDelayMs: 1000,
        signal: options?.signal,
      },
    );
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
    'X-Title': 'Novel Pipeline Studio',
    ...(config.extraHeaders ?? {}),
  };
  const body = JSON.stringify({
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: config.temperature,
    stream: true,
  });

  const response = await retryFetch(url, { method: 'POST', signal: options?.signal, headers, body }, options);
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
    ...(config.extraHeaders ?? {}),
  };
  const body = JSON.stringify({
    model: config.model,
    max_tokens: 65536,
    temperature: config.temperature,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userPrompt },
    ],
    stream: true,
  });

  const response = await retryFetch(url, { method: 'POST', signal: options?.signal, headers, body }, options);
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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(config.extraHeaders ?? {}),
    };
    const body = JSON.stringify({
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
    });

    let response: Response;
    try {
      response = await retryFetch(url, { method: 'POST', signal: options?.signal, headers, body }, options);
    } catch (e: any) {
      // 404 on model name is not retryable — fall through to next model
      if (/404/.test(e.message) && /not found|NOT_FOUND|not supported/i.test(e.message)) {
        modelNotFoundError = e.message;
        continue;
      }
      throw e;
    }

    return handleResponse(response, onToken, extractGeminiText, options);
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    ...(config.extraHeaders ?? {}),
  };
  const body = JSON.stringify({
    provider: config.provider,
    model: config.model,
    systemPrompt,
    userPrompt,
    temperature: config.temperature,
    stream: true,
  });

  const response = await retryFetch(config.baseUrl, { method: 'POST', signal: options?.signal, headers, body }, options);
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
  slapSkill?: string,
  extraSkillKeys: string[] = [],
  extraSkillText = '',
  allSkills: { key: string; content: string }[] = []
): { system: string; user: string } {
  const extraSkillContents = extraSkillKeys
    .map(k => allSkills.find(s => s.key === k)?.content || '')
    .filter(Boolean);

  const system = `你是一位精通网文创作的资深编辑，专门进行仿写大纲生成。严格遵循以下规则。

--- 大纲输出格式模板 ---
${templateSkill}
${wolfSkill ? `\n--- 欧美狼人世界设定 ---\n${wolfSkill}` : ''}${slapSkill ? `\n--- 大女主打脸闭环技法 ---\n${slapSkill}` : ''}${extraSkillContents.length > 0 ? `\n--- 补充 Skill ---\n${extraSkillContents.join('\n\n')}` : ''}${extraSkillText ? `\n--- 临时补充 Skill ---\n${extraSkillText}` : ''}`;

  const user = `《例文》是例文。我需要你根据《大纲skill》生成仿写例文的大纲。${wolfSkill ? '此小说是欧美狼人背景，无玄幻魔法元素，参照《欧美狼人skill》。' : ''}

--- 项目背景 ---
${background || '未填写'}

--- 人物设定 ---
${characters || '未填写'}

--- 参考例文 ---
${example}

${validationFeedback ? `--- 修改建议（请根据以下建议调整大纲）---\n${validationFeedback}\n` : ''}请生成完整的仿写大纲。
`;

  return { system, user };
}

// Compile outline revision prompt (based on existing outline + review feedback)
export function compileOutlineRevisionPrompt(
  currentOutline: string,
  reviewFeedback: string,
  background: string,
  characters: string,
  templateSkill: string,
  wolfSkill?: string,
  slapSkill?: string,
  extraSkillContents: string[] = [],
  extraSkillText = '',
): { system: string; user: string } {
  const system = `你是一位精通网文创作的资深编辑，专门进行大纲修订。你会根据审查反馈对现有大纲进行有针对性的修正，而非从头重写。
严格遵循以下规则：

--- 大纲输出格式模板 ---
${templateSkill}
${wolfSkill ? `\n--- 欧美狼人世界设定 ---\n${wolfSkill}` : ''}${slapSkill ? `\n--- 大女主打脸闭环技法 ---\n${slapSkill}` : ''}${extraSkillContents.length > 0 ? `\n--- 补充 Skill ---\n${extraSkillContents.join('\n\n')}` : ''}${extraSkillText ? `\n--- 临时补充 Skill ---\n${extraSkillText}` : ''}

【修订原则】
1. 仅针对审查反馈中指出的问题进行修正，不要大幅改动审查未提及的部分。
2. 保持原大纲的整体结构、节奏和风格。
3. 修正后的输出必须是完整大纲（不只是修改的部分）。`;

  const user = `
--- 项目背景 ---
${background || '未填写'}

--- 人物设定 ---
${characters || '未填写'}

--- 当前大纲（需要修订）---
${currentOutline}

--- 审查反馈（请根据以下问题修正大纲）---
${reviewFeedback}

请根据审查反馈修正上述大纲，输出完整的大纲全文。`;

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
export function compileChapterPrompt({
  outline,
  chapterNum,
  chapterOutline,
  previousChapters,
  skills,
  regenerationPrompt,
  extraSkillKeys = [],
  extraSkillText = '',
  maxContextTokens,
  storyMemory,
}: {
  outline: string;
  chapterNum: number;
  chapterOutline: string;
  previousChapters: Chapter[];
  skills: { key: string; content: string }[];
  regenerationPrompt?: string;
  extraSkillKeys?: string[];
  extraSkillText?: string;
  /** 最大上下文 token 数，默认 20000（约覆盖 32K 模型的 65% - 输出空间） */
  maxContextTokens?: number;
  /** 故事记忆（跨章节连续性信息） */
  storyMemory?: import('../types').StoryMemory;
}): { system: string; user: string } {
  const tokenBudget = maxContextTokens ?? 20000;
  const degreaseSkill = skills.find(s => s.key === 'degrease')?.content || '';
  const connectSkill = skills.find(s => s.key === 'connect_skills')?.content || '';
  const logicCheckSkill = skills.find(s => s.key === 'logic_check')?.content || '';
  const extraSkillContents = extraSkillKeys
    .map(k => skills.find(s => s.key === k)?.content || '')
    .filter(Boolean);

  let system = `你是一位顶级网文小说作家，即将根据大纲写第 ${chapterNum} 章。严格遵循以下规则。

《大纲》是大纲。《AI去油》是写作手法约束。《串联》是你写小说需要执行的要求。

--- 《AI去油法则》（写作手法约束）---
${degreaseSkill}

--- 《串联》（章节衔接要求）---
${connectSkill}

--- 《逻辑审查》（写作过程中内部自检，不输出到正文）---
${logicCheckSkill}
${extraSkillContents.length > 0 ? `\n--- 补充 Skill ---\n${extraSkillContents.join('\n\n')}` : ''}
${extraSkillText ? `\n--- 临时补充 Skill ---\n${extraSkillText}` : ''}

【输出规则】
1. 直接以流畅正文叙述，不要引言、不要解释。
2. 格式严格为：章节标题行 + 正文。
3. 不输出任何自检清单、逻辑审查报告或元注释。逻辑审查只作为内部自检。
4. 避免上帝视角（"他不知道的是..."）和专业术语注解。`;

  let precedingContext = '这是第 1 章，从头开始写。';
  if (previousChapters.length > 0) {
    const prev = previousChapters[previousChapters.length - 1];
    const prevText = prev.content;
    const lastPart = prevText.length > 1000 ? prevText.substring(prevText.length - 1000) : prevText;
    precedingContext = `上一章（第 ${prev.chapterNumber} 章）结尾为：\n"${lastPart}"\n\n必须从此结尾无缝衔接，保证时间、空间和情绪的连续性，不留断层。`;
  }

  const memorySection = storyMemory
    ? `\n--- 故事记忆（已发生的关键事实）---\n角色状态：${storyMemory.characterStates}\n未收伏笔：${storyMemory.openForeshadowing}\n关键事件：${storyMemory.keyEvents}\n`
    : '';

  let user = `
--- 完整大纲 ---
${outline}
${memorySection}
--- 上一章结尾（衔接参考）---
${precedingContext}

--- 第 ${chapterNum} 章大纲及事件 ---
${chapterOutline}

${regenerationPrompt?.trim() ? `--- 本章重写建议（高优先级）---\n${regenerationPrompt.trim()}\n（以上建议优先于默认生成风格，但不得违背大纲事件、角色连续性和已设定事实。）\n\n` : ''}根据上述要求，根据大纲，写小说第 ${chapterNum} 章。以"### 第 ${chapterNum} 章: [章节名]"开头，只输出标题和正文。
`;

  // ---- 上下文窗口裁剪 ----
  let totalTokens = estimateTokens(system) + estimateTokens(user);
  if (totalTokens > tokenBudget) {
    // 优先级 1：裁剪完整大纲 → 只保留当前章节大纲
    const trimmedUser = user.replace(
      /--- 完整大纲 ---\n[\s\S]*?\n--- 上一章结尾/,
      `--- 大纲（仅当前章节）---\n${chapterOutline}\n\n--- 上一章结尾`,
    );
    // 避免重复的章节大纲段：把后面紧跟的"第 X 章大纲及事件"段去掉
    user = trimmedUser.replace(/--- 第 \d+ 章大纲及事件 ---\n[\s\S]*?\n\n根据上述要求/, '\n根据上述要求');
    totalTokens = estimateTokens(system) + estimateTokens(user);
  }

  if (totalTokens > tokenBudget) {
    // 优先级 2：去掉逻辑审查 skill（最小损失）
    system = system.replace(/--- 《逻辑审查》[\s\S]*?(?=\n---|\n【输出规则】)/, '');
    totalTokens = estimateTokens(system) + estimateTokens(user);
  }

  if (totalTokens > tokenBudget) {
    // 优先级 3：截断前文上下文（从 1000 字缩至 500 字）
    user = user.replace(
      /(上一章（第 \d+ 章）结尾为：\n")[\s\S]*?("\n\n必须从此结尾无缝衔接)/,
      (_, prefix, suffix) => {
        const prev = previousChapters[previousChapters.length - 1];
        const shortened = prev.content.length > 500
          ? prev.content.substring(prev.content.length - 500)
          : prev.content;
        return `${prefix}${shortened}${suffix}`;
      },
    );
    totalTokens = estimateTokens(system) + estimateTokens(user);
  }

  if (totalTokens > tokenBudget) {
    // 优先级 4：整体裁剪 user prompt 到 token 预算
    const systemTokens = estimateTokens(system);
    const userBudget = tokenBudget - systemTokens - 200; // 预留 200 tokens 给输出格式
    user = trimPromptToFit(user, userBudget);
  }

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
  logicCheckSkill: string,
  structured = true,
): { system: string; user: string } {
  if (structured) {
    const system = `你是一位专业的小说逻辑审查编辑，严格依照《小说正文逻辑审查流程 Skill v3.2》执行审查。
你必须输出严格 JSON，不要 Markdown 包裹，不要解释文字。JSON 结构如下：
{"timeline":{"passed":true,"detail":"理由"},"location":{"passed":true,"detail":"理由"},"props":{"passed":true,"detail":"理由"},"characters":{"passed":true,"detail":"理由"},"emotionHook":{"passed":true,"detail":"理由"},"summary":"一句话总评"}
passed 只能是 boolean。detail 用中文，必须具体指出通过依据或失败原因。`;

    const user = `
--- 逻辑审查规则（Skill v3.2）---
${logicCheckSkill}

--- 需要审查的第 ${chapterNum} 章正文 ---
${chapterContent}

请逐项审查以下维度：
1. 时间线（timeline）：是否有时间矛盾
2. 地点（location）：是否有空间矛盾
3. 道具（props）：获取时间、名称一致性、材质常识
4. 人物与行为（characters）：已知信息行为悖论
5. 情感节奏（emotionHook）：章末钩子是否已设置

只输出 JSON。`;

    return { system, user };
  }

  // 非结构化格式（向后兼容）
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

/**
 * 解析逻辑审查的 JSON 输出
 * 解析失败时返回全项未通过，raw 文本作为 detail
 */
export function parseLogicReviewResult(raw: string): import('../types').LogicReviewResult {
  const fallback: import('../types').LogicReviewResult = {
    timeline: { passed: false, detail: '解析失败' },
    location: { passed: false, detail: '解析失败' },
    props: { passed: false, detail: '解析失败' },
    characters: { passed: false, detail: '解析失败' },
    emotionHook: { passed: false, detail: '解析失败' },
    summary: raw.slice(0, 200),
  };

  try {
    const jsonText = extractJsonObject(raw);
    const parsed = JSON.parse(jsonText) as any;

    const parseItem = (item: any): { passed: boolean; detail: string } => ({
      passed: Boolean(item?.passed),
      detail: typeof item?.detail === 'string' && item.detail.trim()
        ? item.detail.trim()
        : '模型未给出有效理由。',
    });

    return {
      timeline: parseItem(parsed.timeline),
      location: parseItem(parsed.location),
      props: parseItem(parsed.props),
      characters: parseItem(parsed.characters),
      emotionHook: parseItem(parsed.emotionHook),
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    };
  } catch {
    return fallback;
  }
}

// Compile story memory extraction prompt
export function compileStoryMemoryExtractionPrompt(
  chapterContent: string,
  chapterNum: number,
  previousMemory?: import('../types').StoryMemory,
): { system: string; user: string } {
  const system = `你是一位小说连续性分析专家。你的任务是从章节正文中提取关键的连续性信息，用于帮助后续章节的创作保持一致性。
你必须输出严格 JSON，不要 Markdown，不要解释。JSON 结构如下：
{"characterStates":"角色当前状态摘要","openForeshadowing":"未收伏笔清单","keyEvents":"影响后续剧情的关键事件"}
每项用简洁的中文描述，不超过 200 字。`;

  const prevSection = previousMemory
    ? `--- 之前的故事记忆 ---
角色状态：${previousMemory.characterStates}
未收伏笔：${previousMemory.openForeshadowing}
关键事件：${previousMemory.keyEvents}

请在此基础上更新（保留仍有效的信息，追加新信息，移除已解决的伏笔）。`
    : '这是第一章，从零开始提取。';

  const user = `
${prevSection}

--- 第 ${chapterNum} 章正文 ---
${chapterContent}

请提取本章的关键连续性信息并输出 JSON。`;

  return { system, user };
}

// Compile book title candidates prompt
// (storyMemory extraction prompt is above)

/**
 * 从章节正文中提取故事记忆并保存到项目
 * 可选调用，失败时静默忽略
 */
export async function extractAndSaveStoryMemory(
  projectId: number,
  chapterContent: string,
  chapterNum: number,
  previousMemory?: import('../types').StoryMemory,
): Promise<import('../types').StoryMemory | undefined> {
  try {
    const compiled = compileStoryMemoryExtractionPrompt(chapterContent, chapterNum, previousMemory);
    let raw = '';
    await runLLMStream('review', compiled.system, compiled.user, tok => { raw += tok; });

    const parsed = JSON.parse(extractJsonObject(raw)) as any;
    const memory: import('../types').StoryMemory = {
      characterStates: typeof parsed.characterStates === 'string' ? parsed.characterStates : '',
      openForeshadowing: typeof parsed.openForeshadowing === 'string' ? parsed.openForeshadowing : '',
      keyEvents: typeof parsed.keyEvents === 'string' ? parsed.keyEvents : '',
      updatedAt: Date.now(),
    };

    const { db } = await import('../db');
    await db.projects.update(projectId, { storyMemory: memory });
    return memory;
  } catch {
    // 故事记忆提取失败不影响主流程
    return undefined;
  }
}

// Compile book title candidates prompt
export function compileTitlePrompt(outline: string, customHint?: string): { system: string; user: string } {
  const system = `你是一位专精爆款网文（爽文）书名创作的专家。书名要简洁有力、带强烈情绪张力、适合在各平台传播，使用大众易懂词汇，避免生僻或高大上词汇。`;

  const customSection = customHint?.trim()
    ? `\n用户额外要求：${customHint.trim()}\n`
    : '';

  const user = `
--- 以下是本书的完整大纲 ---
${outline}
${customSection}
请根据上述大纲，生成 8 组爽文风格备选书名，每组包含：
- 中文书名（带《》）
- 对应英文书名（适合国际平台，简洁有力）
- 一句不超过 20 字的推荐理由

风格要多样，涵盖：霸气型、打脸爽型、暧昧拉扯型、悬念型。

输出格式（严格按此，不要额外说明）：
1. 《中文书名》／ English Title ——理由
2. 《中文书名》／ English Title ——理由
...（共 8 组）
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
