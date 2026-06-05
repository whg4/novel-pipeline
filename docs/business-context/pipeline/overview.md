# 创作流水线 — 自动流水线流程

## 端到端流程

```
用户创建项目（例文+背景+人物+题材）
    ↓
大纲生成（compileOutlinePrompt）
    ↓
大纲结构化验证（validateAgainstChecklist, 10 项，最多 3 轮）
    ↓
章节同步（syncOutlineChaptersToDb, 解析 ### 第 N 章）
    ↓
逐章生成（compileChapterPrompt + StoryMemory + 前章末尾 1000 字）
    ↓
逻辑审查（compileLogicReviewPrompt, 结构化 JSON）
    ↓ 审查失败 → 自动重写（最多 2 轮，仅时间线/人物冲突触发）
营销生成（Blurb → Title → Cover，串行）
    ↓
完成
```

**代码位置**: `src/hooks/useAutoPipeline.ts` — `handleRunAutoPipeline()`

## 8 个阶段 (AutoPipelinePhase)

| 阶段 | 说明 | LLM 调用 | Provider |
|------|------|---------|----------|
| `outline` | 生成大纲 | compileOutlinePrompt | outline 阶段指派 |
| `sync` | 章节同步 | 无（纯解析） | — |
| `chapter` | 逐章生成正文 | compileChapterPrompt | chapter 阶段指派 |
| `review` | 逻辑审查 | compileLogicReviewPrompt | review 阶段指派 |
| `blurb` | 生成简介 | compileBlurbPrompt | marketing 阶段指派 |
| `title` | 生成书名 | compileTitlePrompt | marketing 阶段指派 |
| `cover` | 生成封面提示词 | compileCoverPrompt | marketing 阶段指派 |
| `done` | 完成 | — | — |

阶段顺序由 `AUTO_PHASE_ORDER` 对象定义，数值越小越先执行。

## 暂停/恢复机制

**原理**: AbortController + localStorage 恢复状态

1. 用户点击暂停 → `autoPauseRef.current = true`
2. `checkPause()` 检测到标记后 throw `LLM_PAUSED_ERROR`
3. catch 块将 `autoState.partialText` 保存到 DB + localStorage
4. 用户点击继续 → 从 localStorage 读取 `AutoPipelineResumeState`
5. 恢复到中断的阶段/章节，从 `partialText` 之后继续

**恢复状态结构** (`AutoPipelineResumeState`):
```typescript
{
  phase: AutoPipelinePhase;
  currentOutline: string;      // 当前大纲（可能不完整）
  outlineAttempt: number;      // 大纲验证轮次
  validationFeedback: string;  // 验证失败反馈
  chapterIndex: number;        // 当前章节索引
  chapterId?: number;          // 当前章节 DB ID
  partialText: string;         // 中断时的部分文本
  totalSteps: number;          // 总步数（用于进度条）
}
```

**关键细节**:
- 恢复时从 DB 重新读取 `currentProject` 和 `storyMemory`（不信任 localStorage 中的旧数据）
- 章节恢复：如果 `chapterId` 匹配当前查看的章节，同步更新 UI 的 `editingContent`

## 状态驱动 Tab 切换

```typescript
// PipelineView.tsx
if (!hasOutline) → 'outline' Tab
else if (allChaptersComplete) → 'marketing' Tab
else → 'drafting' Tab
```

用户手动切换 Tab 后不再自动干预（`userManuallySwitched` 标记）。

## 引导卡片

Pipeline 顶部根据状态显示不同引导：
- 无大纲 → 蓝色"第一步"卡片
- 有大纲无正文 → 绿色"第二步"卡片
- 部分完成 → 橙色"进行中"卡片
