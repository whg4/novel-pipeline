import { APIConfig, Chapter, LLMConnectionTestResult } from '../types';
import { createConfigForProvider, getProviderPreset, normalizeLegacyProvider } from './providers';

const STORAGE_KEY = 'novel_pipeline_api_config';

const DEFAULT_CONFIG: APIConfig = createConfigForProvider('deepseek');

type StreamTokenHandler = (text: string) => void;

function normalizeConfig(input?: Partial<APIConfig> | null): APIConfig {
  if (!input) return DEFAULT_CONFIG;

  const provider = normalizeLegacyProvider(input.provider);
  const preset = getProviderPreset(provider);

  return {
    provider,
    apiStyle: input.apiStyle ?? preset.apiStyle,
    apiKey: input.apiKey ?? '',
    baseUrl: input.baseUrl || preset.defaultBaseUrl,
    model: input.model || preset.defaultModel,
    temperature: Number.isFinite(input.temperature) ? Number(input.temperature) : DEFAULT_CONFIG.temperature,
    maxTokens: Number.isFinite(input.maxTokens) ? Number(input.maxTokens) : DEFAULT_CONFIG.maxTokens,
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
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('浏览器无法读取模型返回流。');

  const decoder = new TextDecoder('utf-8');
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
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
): Promise<string> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`接口请求失败（${response.status}）：${text || response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream') || response.body) {
    const streamed = await consumeEventStream(response, onToken, extractor);
    if (streamed) return streamed;
  }

  const json = await response.json();
  const text = extractor(json);
  if (text) onToken(text);
  return text;
}

async function runOpenAICompatibleStream(
  config: APIConfig,
  systemPrompt: string,
  userPrompt: string,
  onToken: StreamTokenHandler,
): Promise<string> {
  const url = buildUrl(config.baseUrl, '/chat/completions');

  const response = await fetch(url, {
    method: 'POST',
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
      max_tokens: config.maxTokens,
      stream: true,
    }),
  });

  return handleResponse(response, onToken, extractOpenAIText);
}

async function runAnthropicMessagesStream(
  config: APIConfig,
  systemPrompt: string,
  userPrompt: string,
  onToken: StreamTokenHandler,
): Promise<string> {
  const url = buildUrl(config.baseUrl, '/messages');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      ...(config.extraHeaders ?? {}),
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      stream: true,
    }),
  });

  return handleResponse(response, onToken, extractAnthropicText);
}

async function runGeminiStream(
  config: APIConfig,
  systemPrompt: string,
  userPrompt: string,
  onToken: StreamTokenHandler,
): Promise<string> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const model = encodeURIComponent(config.model);
  const url = `${baseUrl}/models/${model}:streamGenerateContent?key=${encodeURIComponent(config.apiKey)}&alt=sse`;

  const response = await fetch(url, {
    method: 'POST',
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
        maxOutputTokens: config.maxTokens,
      },
    }),
  });

  return handleResponse(response, onToken, extractGeminiText);
}

async function runLocalRelayStream(
  config: APIConfig,
  systemPrompt: string,
  userPrompt: string,
  onToken: StreamTokenHandler,
): Promise<string> {
  const response = await fetch(config.baseUrl, {
    method: 'POST',
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
      maxTokens: config.maxTokens,
      stream: true,
    }),
  });

  return handleResponse(response, onToken, extractRelayText);
}

async function runLLMStreamWithConfig(
  config: APIConfig,
  systemPrompt: string,
  userPrompt: string,
  onToken: StreamTokenHandler,
): Promise<string> {
  const normalizedConfig = normalizeConfig(config);

  if (!normalizedConfig.apiKey && normalizedConfig.apiStyle !== 'local-relay') {
    throw new Error('请先在“模型连接”页面填写 API 密钥。');
  }

  switch (normalizedConfig.apiStyle) {
    case 'openai-compatible':
      return runOpenAICompatibleStream(normalizedConfig, systemPrompt, userPrompt, onToken);
    case 'anthropic-messages':
      return runAnthropicMessagesStream(normalizedConfig, systemPrompt, userPrompt, onToken);
    case 'gemini-generate-content':
      return runGeminiStream(normalizedConfig, systemPrompt, userPrompt, onToken);
    case 'local-relay':
      return runLocalRelayStream(normalizedConfig, systemPrompt, userPrompt, onToken);
    default:
      throw new Error('当前模型供应商暂未配置可用的调用适配器。');
  }
}

export async function runLLMStream(
  systemPrompt: string,
  userPrompt: string,
  onToken: StreamTokenHandler,
): Promise<string> {
  return runLLMStreamWithConfig(getAPIConfig(), systemPrompt, userPrompt, onToken);
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

// Compile final outline prompt
export function compileOutlinePrompt(
  example: string,
  background: string,
  characters: string,
  templateSkill: string
): { system: string; user: string } {
  const system = `You are a high-level creative writing AI that specializes in drafting best-selling web novel outlines. 
You must strictly follow the provided "仿写大纲输出格式模板 v3.0" rules.
Your outline structure must follow this format:
- 名词下沉 (No high-tech/AI jargon, use grounded real-world items).
- 1:1 Rhythm & Tension mapping of the reference example.
- Character lists and roles.
- Act structured chapters with explicit goals.`;

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

Generate a beautiful, comprehensive, and highly-detailed novel outline corresponding exactly to the template rules above.
`;

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
  const werewolfSkill = isWerewolf ? (skills.find(s => s.key === 'wolf_setting')?.content || '') : '';
  const femaleSlapSkill = isFemaleSlap ? (skills.find(s => s.key === 'female_slap')?.content || '') : '';

  const system = `You are an elite novelist. You are about to draft Chapter ${chapterNum} of a highly anticipated novel based on the strict outline instructions.
You must adhere 100% to the following style and mechanics rules.

--- WRITING RULE: AI去油法则 (Anti-Grease Rules) ---
${degreaseSkill}

--- CONNECTION RULES & FLOW ---
${connectSkill}

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
  const system = `You are a master of writing viral novel back-cover blurbs (简介/导语). 
Your output must follow the rules of '爆款网文简介（导语）生成 Skill v4.1'.
It should be:
- 220 to 380 characters.
- Structured into two scenes (当众退婚/切割 scene + 深夜后悔/跪求 scene).
- Include high tension lines or extreme scenes.
- Free of summaries or abstract descriptions. Ensure it's dramatic like a preview snippet.`;

  const user = `
--- BLURB DESIGN GUIDELINES ---
${blurbSkill}

--- OVERALL BOOK OUTLINE ---
${outline}

${customDraft ? `--- ACTUAL REPRESENTATIVE CHAPTER TEXTS ---\n${customDraft}` : ''}

Generate 3 alternative high-impact, click-grabbing blurbs according to the rules above.
`;

  return { system, user };
}
