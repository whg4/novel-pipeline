/**
 * Token 估算与 Prompt 裁剪工具
 *
 * 策略：CJK 字符约 1.5 tokens/字，英文按空格分词约 0.25 tokens/word，
 * 再加 10% 安全余量。用于在拼装 Prompt 前判断是否需要裁剪上下文。
 */

// ---- 已知模型 context window 映射 ----
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4.1': 1_047_576,
  'gpt-4.1-mini': 1_047_576,
  'gpt-4.1-nano': 1_047_576,
  'o3': 200_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,
  'gemini-2.5-pro': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'gemini-2.0-flash': 1_048_576,
  'gemini-2.0-flash-lite': 1_048_576,
  'deepseek-chat': 65_536,
  'deepseek-reasoner': 65_536,
  'grok-2': 131_072,
  'grok-3': 131_072,
};

const DEFAULT_CONTEXT_WINDOW = 32_000;

// 匹配 CJK 统一表意文字（基本区 + 扩展 A）
const CJK_REGEX = /[一-鿿㐀-䶿]/;

/**
 * 估算文本的 token 数量
 * - CJK 字符：~1.5 tokens/字
 * - 非 CJK：按空格分词，~0.25 tokens/word
 * - 加 10% 安全余量
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let cjkCount = 0;
  let nonCjkText = '';

  for (const char of text) {
    if (CJK_REGEX.test(char)) {
      cjkCount++;
    } else {
      nonCjkText += char;
    }
  }

  const nonCjkWords = nonCjkText.split(/\s+/).filter(w => w.length > 0).length;
  const rawEstimate = cjkCount * 1.5 + nonCjkWords * 0.25;

  // 10% 安全余量 + 基础开销（system message wrapper 等）
  return Math.ceil(rawEstimate * 1.1) + 20;
}

/**
 * 获取模型的 context window 大小
 */
export function getModelContextWindow(model: string): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW;

  const normalized = model.toLowerCase().trim();

  // 精确匹配
  if (MODEL_CONTEXT_WINDOWS[normalized]) return MODEL_CONTEXT_WINDOWS[normalized];

  // 模糊匹配（去掉厂商前缀，如 "openai/gpt-4o" → "gpt-4o"）
  const withoutPrefix = normalized.includes('/') ? normalized.split('/').pop()! : normalized;
  if (MODEL_CONTEXT_WINDOWS[withoutPrefix]) return MODEL_CONTEXT_WINDOWS[withoutPrefix];

  // 前缀匹配（如 "gpt-4o-2024-08-06" 匹配 "gpt-4o"）
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (withoutPrefix.startsWith(key)) return value;
  }

  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * 将文本裁剪到指定 token 预算内
 * 优先在句子边界（句号、问号、感叹号、换行）处截断
 */
export function trimPromptToFit(text: string, maxTokens: number): string {
  if (!text || estimateTokens(text) <= maxTokens) return text;

  // 二分查找合适的截断点
  let lo = 0;
  let hi = text.length;
  let bestCut = hi;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = text.slice(0, mid);

    if (estimateTokens(candidate) <= maxTokens) {
      bestCut = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (bestCut >= text.length) return text;

  // 在 bestCut 附近寻找句子边界
  const searchWindow = text.slice(Math.max(0, bestCut - 200), bestCut);
  const sentenceBreaks = /[。！？\n]/g;
  let lastBreak = -1;
  let match: RegExpExecArray | null;
  while ((match = sentenceBreaks.exec(searchWindow)) !== null) {
    lastBreak = Math.max(0, bestCut - 200) + match.index + match[0].length;
  }

  // 使用句子边界（如果在合理范围内），否则用二分结果
  const cutPoint = lastBreak > bestCut - 200 && lastBreak <= bestCut
    ? lastBreak
    : bestCut;

  return text.slice(0, cutPoint).trimEnd();
}
