# 章节写作系统

## 章节生成流程

**代码入口**: `compileChapterPrompt()` in `src/services/llm.ts`

### Prompt 组成

| 部分 | 内容 | 来源 |
|------|------|------|
| System | 去油 Skill + 串联 Skill + 逻辑审查 Skill + 用户额外 Skill | skills table |
| User | 完整大纲 + 前章末尾 + 当前章节大纲 + 重写建议 + 故事记忆 | 各字段 |

### 上下文传递链

```
compileChapterPrompt({
  outline:          project.outline,           // 完整大纲
  chapterNum:       ch.chapterNumber,           // 章节号
  chapterOutline:   ch.outlineSection,          // 本章大纲段
  previousChapters: allChapters.slice(0, i),    // 前序章节数组
  skills:           allSkills,                  // 全部 Skill
  regenerationPrompt: ch.regenerationPrompt,    // 用户重写指令
  storyMemory:      project.storyMemory,        // 故事记忆
})
```

**前章末尾**: 只取最后一章的最后 1000 字符（中文约 500 字）

## Token 预算裁剪

**代码位置**: `compileChapterPrompt()` 内的裁剪逻辑

**预算计算**: `getModelContextWindow(model) × 0.6`（如 Gemini 2.5 Pro → 629K tokens）

**4 级裁剪策略**（按优先级）:

| 级别 | 裁剪内容 | 策略 |
|------|---------|------|
| 1 | 完整大纲 | 替换为仅当前章节大纲 |
| 2 | 逻辑审查 Skill | 从 system prompt 移除 |
| 3 | 前章末尾 | 从 1000 字缩至 500 字（用标记分割替换） |
| 4 | 整体 user prompt | `trimPromptToFit()` 截断到预算 |

**标记分割机制**: 前章末尾用 `<<<PREV_CHAPTER>>>` 和 `<<<END_PREV_CHAPTER>>>` 包裹，裁剪时用正则匹配标记而非引号（避免章节内容中的引号干扰）。

## 故事记忆 (StoryMemory)

**类型定义**: `src/types.ts`

```typescript
interface StoryMemory {
  characterStates: string;           // 角色当前状态
  openForeshadowing: string;         // 未收伏笔
  keyEvents: string;                 // 关键事件
  timeline: { chapter: number; event: string }[];           // 结构化时间线
  foreshadowingList: { text: string; status: 'planted'|'resolved'|'abandoned'; chapter?: number }[];
  updatedAt: number;
}
```

**提取流程**:
1. 章节生成成功后调用 `extractAndSaveStoryMemory(projectId, content, chapterNum, previousMemory)`
2. LLM 输出 JSON，解析后与已有记忆合并
3. 时间线自动累积（保留最近 50 条）
4. 伏笔列表追踪状态变化（planted → resolved/abandoned）

**注入 prompt**: 仅显示最近 10 条时间线 + `planted` 状态的伏笔

## 逻辑审查

**代码入口**: `compileLogicReviewPrompt()` in `src/services/llm.ts`

**上下文**（已增强）:
- 章节正文
- 章节大纲（对照参考）
- 故事记忆（已建立的事实）
- 项目背景 + 人物设定
- 逻辑检查 Skill

**结构化输出** (JSON):
```json
{
  "timeline": {"passed": true/false, "detail": "..."},
  "location": {"passed": true/false, "detail": "..."},
  "props": {"passed": true/false, "detail": "..."},
  "characters": {"passed": true/false, "detail": "..."},
  "emotionHook": {"passed": true/false, "detail": "..."},
  "summary": "一句话总评"
}
```

**解析**: `parseLogicReviewResult()` — 解析失败时返回全项未通过

## 审查驱动自动重写

**代码位置**: `useAutoPipeline.ts` 中的 review 阶段

**逻辑**:
1. 逻辑审查完成
2. 检查 `timeline` 和 `characters` 两个维度
3. 如果有失败 → 用失败项构建重写指令 → 重新生成章节 → 再次审查
4. 最多 2 轮重写
5. 其他维度（location/props/emotionHook）仅记录不触发重写

## 去油检测 (Grease Detection)

**代码位置**: `useChapterDrafting.ts` 中的 `useEffect`

**22 个检测模式**:

| 类别 | 示例模式 | 分值 |
|------|---------|------|
| 微表情套路 | 眼神一暗/眸子一暗/嘴角微微上扬/眉头微蹙 | ×1/次 |
| 身体反应 | 深吸一口气/拳头攥紧/不禁屏住呼吸 | ×1/次 |
| 修辞结构 | 仿佛...般/不仅...甚至/没有一丝犹豫 | ×1/次 |
| 高频副词 | 微微/缓缓/淡淡/悄然/竟然/居然/不禁 | ×1/次 |
| 叙事违规 | 上帝视角/强行刻薄比喻 | ×2/次 |
| 结构问题 | 连续破折号/括号注解/连续短句 | ×1-2/次 |

**评分**: 单模式最多扣 3 分，总分 ≤5 低 / 6-15 中 / >15 高

## 自动保存

**代码位置**: `useChapterDrafting.ts`

- 编辑后 2 秒 debounce 自动保存
- 从 DB 实时读取最新 `versionHistory`（避免与手动保存竞态）
- 生成中不自动保存（由生成流程自行保存）
- `lastSavedDraftRef` 避免重复保存相同内容
