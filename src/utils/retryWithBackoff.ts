/**
 * 指数退避重试工具
 *
 * 仅对可重试的网络错误（429 限流、5xx 服务端错误）执行重试，
 * 不重试鉴权失败 (401/403)、资源不存在 (404)、用户主动暂停等。
 */

import { LLM_PAUSED_ERROR } from '../services/llm';

export interface RetryOptions {
  /** 最大重试次数（不含首次调用），默认 3 */
  maxRetries?: number;
  /** 基础延迟毫秒数，默认 1000。实际延迟 = baseDelayMs × 2^(attempt-1) */
  baseDelayMs?: number;
  /** 自定义判断是否应重试。返回 true 则重试，false 则立即抛出 */
  shouldRetry?: (error: Error) => boolean;
  /** 用于中止重试的 AbortSignal */
  signal?: AbortSignal;
}

/** 判断错误信息中是否包含可重试的 HTTP 状态码 */
function isRetryableHttpError(message: string): boolean {
  return /429|500|502|503|504/.test(message);
}

/** 默认的重试判断逻辑 */
function defaultShouldRetry(error: Error, signal?: AbortSignal): boolean {
  // 用户主动暂停/中止 → 不重试
  if (error.message === LLM_PAUSED_ERROR) return false;
  if (signal?.aborted) return false;

  // 鉴权/权限错误 → 不重试
  if (/401|403/.test(error.message)) return false;

  // 资源不存在 → 不重试
  if (/404/.test(error.message)) return false;

  // 网络断开 → 不重试
  if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) return false;

  // 限流和服务端错误 → 重试
  return isRetryableHttpError(error.message);
}

/**
 * 执行带指数退避的重试
 *
 * @param fn 要执行的异步函数
 * @param options 重试配置
 * @returns fn 的返回值
 * @throws fn 抛出的最后一个错误（所有重试均失败后）
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    shouldRetry,
    signal,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 在每次尝试前检查是否已中止
    if (signal?.aborted) {
      throw new Error(LLM_PAUSED_ERROR);
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const retryable = shouldRetry
        ? shouldRetry(lastError)
        : defaultShouldRetry(lastError, signal);

      // 最后一次尝试或不可重试的错误 → 直接抛出
      if (attempt >= maxRetries || !retryable) {
        throw lastError;
      }

      // 指数退避等待
      const delay = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * delay * 0.1; // 10% jitter
      await new Promise(resolve => setTimeout(resolve, delay + jitter));
    }
  }

  // TypeScript 确定性：此分支不可达，但满足类型检查
  throw lastError ?? new Error('重试失败');
}
