# LLM 服务层

## 架构

```
runLLMStream(stage, system, user, onToken, options)
    ↓
getConfigForStage(stage)  →  根据阶段获取 provider 配置
    ↓
runLLMStreamWithConfig(config, system, user, onToken, options)
    ↓
switch(config.apiStyle) {
  'openai-compatible'     → runOpenAICompatibleStream()
  'anthropic-messages'    → runAnthropicMessagesStream()
  'gemini-generate-content' → runGeminiStream()  (含模型 fallback)
  'local-relay'           → runLocalRelayStream()
}
    ↓
retryFetch() → 指数退避重试（429/500/502/503）
    ↓
handleResponse() → SSE 流 / JSON / 文本
    ↓
consumeEventStream() → 60 秒超时检测 + onToken 回调
```

## Provider 预设

**代码位置**: `src/services/providers.ts`

| Provider | apiStyle | 默认模型 | 备注 |
|----------|---------|---------|------|
| DeepSeek | openai-compatible | deepseek-chat | 性价比写作 |
| OpenAI | openai-compatible | gpt-4o | 稳定输出 |
| Gemini | gemini-generate-content | gemini-2.5-pro | 含模型自动 fallback |
| Grok | openai-compatible | grok-2-latest | 快速脑暴 |

## 阶段模型分配

**默认配置** (`DEFAULT_STAGE_ASSIGNMENTS`):
```
outline  → OpenAI
chapter  → Gemini (默认 gemini-3.1-pro 覆盖)
review   → Gemini
marketing → OpenAI
```

**模型覆盖**: `DEFAULT_STAGE_MODEL_OVERRIDES` 中 chapter 默认为 `gemini-3.1-pro`

用户可在"阶段模型"页面自定义覆盖，存储在 localStorage。

## Prompt 编译函数

| 函数 | 用途 | 关键上下文 |
|------|------|-----------|
| `compileOutlinePrompt()` | 大纲生成 | 例文 + 背景 + 人物 + 模板 Skill |
| `compileOutlineRevisionPrompt()` | 大纲修订 | 已有大纲 + 审查反馈 + 例文 |
| `compileChapterPrompt()` | 章节生成 | 大纲 + 前章 + StoryMemory + Skills |
| `compileLogicReviewPrompt()` | 逻辑审查 | 正文 + 大纲 + StoryMemory + 背景 |
| `compileBlurbPrompt()` | 简介 | 大纲 + 前 3 章 + 背景 + 人物 |
| `compileTitlePrompt()` | 书名 | 大纲 + 类型 |
| `compileCoverPrompt()` | 封面 | 大纲 + 类型 + 背景 + 人物 |
| `compileStoryMemoryExtractionPrompt()` | 记忆提取 | 正文 + 前一轮记忆 |
| `validateOutlineAgainstChecklist()` | 大纲验证 | 大纲 + 10 项清单 + 模板 + 背景 + 人物 + 例文 |

## 重试机制

**代码位置**: `src/utils/retryWithBackoff.ts`

- 默认 maxRetries=3，baseDelayMs=1000（指数退避 1/2/4 秒 + 10% jitter）
- 仅重试: 429/500/502/503
- 不重试: 401/403/404、LLM_PAUSED_ERROR、网络断开
- 集成位置: 每个 `run*Stream` 函数的 `fetch()` 调用外层

## 流式超时

**代码位置**: `consumeEventStream()` in `llm.ts`

- 60 秒无 token 返回 → 抛出超时错误
- 实现: `Promise.race` 包裹 `reader.read()` + setTimeout

## Token 管理

**代码位置**: `src/utils/tokenEstimator.ts`

- `estimateTokens(text)`: CJK ×1.5 tokens/字，英文 ×0.25 tokens/word，+10% 余量
- `getModelContextWindow(model)`: 已知模型映射表，默认 32K
- `trimPromptToFit(text, maxTokens)`: 按句号/换行二分截断

**CJK 正则**: `/[一-鿿㐀-䶿]/`（基本区 + 扩展 A，不含 B）
