# 营销素材生成

## 三种素材

| 素材 | Prompt 函数 | 输出 | 持久化 |
|------|------------|------|--------|
| 简介 (Blurb) | `compileBlurbPrompt()` | 3 个爆款导语（220-380 字） | 仅 React state |
| 书名 (Title) | `compileTitlePrompt()` | 8 组双语候选 | `project.titleCandidates` |
| 封面提示词 (Cover) | `compileCoverPrompt()` | 英文 DALL-E/Midjourney prompt | `project.coverPrompt` |
| 封面图片 | OpenAI `/images/generations` | 1024×1536 PNG | base64 data URL |

## Prompt 上下文

| 素材 | 上下文 |
|------|--------|
| 简介 | 大纲 + 前 3 章正文 + 项目背景 + 人物设定 + Blurb Skill |
| 书名 | 大纲 + 类型标签 + 用户自定义提示 |
| 封面 | 大纲 + 类型 + 项目背景 + 人物设定 |

## 子任务独立化

**代码位置**: `useMarketing.ts`

三个子任务各自独立状态追踪：
- `handleGenerateBlurbs(streamOptions?)`
- `handleGenerateTitlesLocal(streamOptions?)`
- `handleGenerateCoverPromptLocal(streamOptions?)`

`handleGenerateMarketingKit()` 串行调用三者，任一失败不阻塞其余。每个子任务有 `marketingStatus` 和 `marketingErrors` 状态。

## 封面图片生成

**代码位置**: `useMarketing.ts` — `handleGenerateCoverImage()`

- 使用 OpenAI `gpt-image-2` 模型
- 直接 fetch OpenAI API（不经 LLM 服务层）
- 支持 abort（通过 AbortController）
- 返回 base64 PNG 或 URL
