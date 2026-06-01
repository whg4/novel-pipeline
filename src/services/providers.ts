import type { APIConfig, LLMProviderId, ProviderPreset } from "../types";

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    shortName: "DeepSeek",
    apiStyle: "openai-compatible",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    modelSuggestions: ["deepseek-chat", "deepseek-reasoner"],
    description: "适合大纲推理、长文本拆解和性价比写作。",
    helpText:
      "DeepSeek 使用 OpenAI-compatible Chat Completions 格式，通常可以直接填 key 调用。",
    directBrowserSupport: "supported",
  },
  {
    id: "openai",
    name: "OpenAI",
    shortName: "OpenAI",
    apiStyle: "openai-compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    modelSuggestions: [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-5",
      "o3",
      "o4-mini",
    ],
    description: "适合稳定输出、大纲规划、简介和封面提示词。",
    helpText:
      "OpenAI 使用标准 /chat/completions 接口。浏览器直连可能受网络或 CORS 影响，可通过代理转发。",
    directBrowserSupport: "proxy-recommended",
  },
  // {
  //   id: "anthropic",
  //   name: "Anthropic Claude",
  //   shortName: "Claude",
  //   apiStyle: "anthropic-messages",
  //   defaultBaseUrl: "https://api.anthropic.com/v1",
  //   defaultModel: "claude-3-5-sonnet-latest",
  //   modelSuggestions: [
  //     "claude-3-5-sonnet-latest",
  //     "claude-3-5-haiku-latest",
  //     "claude-3-opus-latest",
  //   ],
  //   description: "适合正文润色、人物心理节制和长篇连续写作。",
  //   helpText:
  //     "这里接入的是 Anthropic Claude API。Claude Code 本地 CLI 需要后续通过本地 relay 接入，网页不能直接调用本机 CLI。",
  //   directBrowserSupport: "proxy-recommended",
  // },
  {
    id: "gemini",
    name: "Google Gemini",
    shortName: "Gemini",
    apiStyle: "gemini-generate-content",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-pro",
    modelSuggestions: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-3.1-pro",
    ],
    description: "适合大纲结构、资料整理和多轮内容扩写。",
    helpText:
      "Gemini 默认走官方 generateContent/streamGenerateContent 接口，API key 会作为请求参数发送。",
    directBrowserSupport: "supported",
  },
  {
    id: "grok",
    name: "xAI Grok",
    shortName: "Grok",
    apiStyle: "openai-compatible",
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-2-latest",
    modelSuggestions: ["grok-2-latest", "grok-beta"],
    description: "适合快速脑暴、反转点和不拘一格的爽点变体。",
    helpText:
      "xAI API 基本兼容 OpenAI Chat Completions，模型名称仍可手动调整。",
    directBrowserSupport: "proxy-recommended",
  },
  // {
  //   id: "openrouter",
  //   name: "OpenRouter",
  //   shortName: "OpenRouter",
  //   apiStyle: "openai-compatible",
  //   defaultBaseUrl: "https://openrouter.ai/api/v1",
  //   defaultModel: "anthropic/claude-3.5-sonnet",
  //   modelSuggestions: [
  //     "anthropic/claude-3.5-sonnet",
  //     "openai/gpt-4o",
  //     "deepseek/deepseek-chat",
  //     "google/gemini-pro",
  //   ],
  //   description: "一个 key 路由多个模型，适合快速比较不同模型效果。",
  //   helpText:
  //     "OpenRouter 使用 OpenAI-compatible 格式；模型名称通常带供应商前缀，例如 anthropic/claude-3.5-sonnet。",
  //   directBrowserSupport: "proxy-recommended",
  // },
  // {
  //   id: 'custom-openai',
  //   name: '自定义 OpenAI 兼容接口',
  //   shortName: '自定义 OpenAI',
  //   apiStyle: 'openai-compatible',
  //   defaultBaseUrl: 'https://your-proxy.example.com/v1',
  //   defaultModel: 'custom-model',
  //   modelSuggestions: ['custom-model'],
  //   description: '用于第三方代理、公司内网模型或本地 OpenAI-compatible 服务。',
  //   helpText: '接口需要兼容 /chat/completions，并返回 OpenAI 风格 streaming 或普通 JSON。',
  //   directBrowserSupport: 'proxy-recommended',
  // },
  // {
  //   id: 'custom-anthropic',
  //   name: '自定义 Claude 兼容接口',
  //   shortName: '自定义 Claude',
  //   apiStyle: 'anthropic-messages',
  //   defaultBaseUrl: 'https://your-claude-proxy.example.com/v1',
  //   defaultModel: 'claude-compatible-model',
  //   modelSuggestions: ['claude-compatible-model'],
  //   description: '用于代理后的 Anthropic Messages API 或 Claude 兼容服务。',
  //   helpText: '接口需要兼容 /messages，并支持 Anthropic Messages API 格式。',
  //   directBrowserSupport: 'proxy-recommended',
  // },
  // {
  //   id: 'local-relay',
  //   name: '本地 Relay / Claude Code',
  //   shortName: '本地 Relay',
  //   apiStyle: 'local-relay',
  //   defaultBaseUrl: 'http://localhost:8787/api/generate',
  //   defaultModel: 'claude-code',
  //   modelSuggestions: ['claude-code', 'local-model'],
  //   description: '预留给本地 Node relay、Claude Code CLI 或私有模型服务。',
  //   helpText: '网页不能直接调用 Claude Code CLI，需要本地 relay 接收请求后再调用 CLI 或本地 SDK。',
  //   directBrowserSupport: 'relay-only',
  // },
];

export const DEFAULT_PROVIDER_ID: LLMProviderId = "deepseek";

export function getProviderPreset(providerId: LLMProviderId): ProviderPreset {
  return (
    PROVIDER_PRESETS.find((provider) => provider.id === providerId) ??
    PROVIDER_PRESETS[0]
  );
}

export function normalizeLegacyProvider(
  provider: string | undefined,
): LLMProviderId {
  if (provider === "custom") return "custom-openai";
  if (PROVIDER_PRESETS.some((preset) => preset.id === provider))
    return provider as LLMProviderId;
  return DEFAULT_PROVIDER_ID;
}

export function createConfigForProvider(
  providerId: LLMProviderId,
  current?: Partial<APIConfig>,
): APIConfig {
  const preset = getProviderPreset(providerId);

  return {
    provider: preset.id,
    apiStyle: preset.apiStyle,
    apiKey: current?.apiKey ?? "",
    baseUrl: preset.defaultBaseUrl,
    model: preset.defaultModel,
    temperature: current?.temperature ?? 0.7,
    extraHeaders: current?.extraHeaders ?? {},
  };
}

export function normalizeModelForProvider(
  providerId: LLMProviderId,
  model: string | undefined,
): string {
  const preset = getProviderPreset(providerId);
  const normalizedModel = (model || preset.defaultModel)
    .trim()
    .replace(/^models\//, "");

  if (providerId !== "gemini") return normalizedModel || preset.defaultModel;

  return normalizedModel || preset.defaultModel;
}
