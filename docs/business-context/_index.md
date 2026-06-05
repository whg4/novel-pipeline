# 业务知识索引

> 本文件是 AI 定位业务知识的入口。根据用户问题中的关键词，跳转到对应领域文档。

## 业务领域概览

| 领域 | 目录 | 核心文件 | 说明 |
|------|------|---------|------|
| [创作流水线](#创作流水线-pipeline) | `pipeline/` | `useAutoPipeline.ts` | 端到端流程编排、自动流水线、暂停恢复 |
| [大纲系统](#大纲系统-outline) | `outline/` | `useOutlineGeneration.ts` | 大纲生成、结构化验证、修订、章节同步 |
| [章节写作](#章节写作-chapter) | `chapter/` | `useChapterDrafting.ts` | 章节生成、逻辑审查、故事记忆、自动保存 |
| [营销素材](#营销素材-marketing) | `marketing/` | `useMarketing.ts` | 简介/书名/封面生成 |
| [LLM 服务](#llm-服务-llm) | `llm/` | `services/llm.ts` | Provider 管理、Prompt 编译、重试、Token |
| [数据层](#数据层-data) | `data/` | `db.ts`, `types.ts` | 数据模型、IndexedDB、导入导出 |
| [Skill 系统](#skill-系统-skill) | `skill/` | `SkillSelectorModal.tsx` | Skill 管理、选择、注入 prompt |

---

## 创作流水线 (pipeline/)

**关键词**: 自动流水线、一键全自动、暂停恢复、阶段切换、auto pipeline、phase

**核心概念**:
- **AutoPipelinePhase**: `outline → sync → chapter → review → blurb → title → cover → done` 8 个阶段
- **暂停/恢复**: 通过 AbortController + localStorage 恢复状态实现
- **状态驱动 Tab**: 根据项目进度自动切换 大纲/写作间/营销 Tab

**详细文档**:
- `pipeline/overview.md` — 自动流水线完整流程、暂停恢复机制、状态机

**代码入口**: `src/hooks/useAutoPipeline.ts` — `handleRunAutoPipeline()`

---

## 大纲系统 (outline/)

**关键词**: 大纲生成、大纲验证、大纲修订、章节同步、outline、validation、checklist

**核心概念**:
- **仿写大纲**: 基于参考例文的节奏/结构，用新背景/人物重新生成的结构化大纲
- **10 项自检清单**: `a_rhythm`(节奏)、`b_no_jargon`、`c_differences`、`d_payback`(伏笔)、`e_motives`(动机)、`f_logic_time`(时间线)、`g_transition`、`h_item_consistency`(道具)、`i_no_pose`(上帝视角)、`j_cliffhangers`(悬念)
- **结构化验证**: `validateAgainstChecklist()` 输出 JSON，每项有 `passed` + `reason`
- **修订 vs 生成**: 修订用已有大纲+审查反馈作为上下文（不重新从例文开始）

**详细文档**:
- `outline/overview.md` — 大纲生成流程、验证机制、修订逻辑、章节同步

**代码入口**:
- `compileOutlinePrompt()` — 大纲生成 prompt
- `compileOutlineRevisionPrompt()` — 大纲修订 prompt
- `validateOutlineAgainstChecklist()` — 结构化验证
- `syncOutlineChaptersToDb()` — 章节同步（解析 `### 第 N 章` 格式）

---

## 章节写作 (chapter/)

**关键词**: 章节生成、逻辑审查、故事记忆、去油、自动保存、version history、grease detection

**核心概念**:
- **故事记忆 (StoryMemory)**: 跨章节连续性信息，含角色状态、伏笔列表、关键事件时间线
- **去油检测**: 22 个 regex 模式 + 评分制（低/中/高），检测 AI 写作痕迹
- **逻辑审查**: 结构化 JSON 输出（timeline/location/props/characters/emotionHook）
- **审查驱动重写**: 自动流水线中，时间线或人物冲突时自动重写（最多 2 轮）
- **Token 预算裁剪**: 4 级裁剪策略（大纲→skills→前文→整体），模型感知预算

**详细文档**:
- `chapter/overview.md` — 章节生成流程、故事记忆、去油检测、逻辑审查

**代码入口**:
- `compileChapterPrompt()` — 章节生成 prompt（含 token 裁剪）
- `compileLogicReviewPrompt()` — 逻辑审查 prompt
- `extractAndSaveStoryMemory()` — 故事记忆提取
- `useChapterDrafting` — 自动保存、去油检测、版本历史

---

## 营销素材 (marketing/)

**关键词**: 简介、书名、封面、blurb、title、cover、marketing

**核心概念**:
- **简介 (Blurb)**: 220-380 字爆款导语，含两场戏（当众退婚 + 深夜后悔）
- **书名 (Title)**: 8 组双语候选，4 种风格（霸气/打脸/暧昧/悬念）
- **封面提示词**: 英文 DALL-E/Midjourney prompt，竖版 7:10 构图
- **子任务独立化**: blurbs/titles/cover 各自独立状态，任一失败不阻塞其余

**详细文档**:
- `marketing/overview.md` — 营销素材生成流程、子任务管理

**代码入口**:
- `compileBlurbPrompt()` / `compileTitlePrompt()` / `compileCoverPrompt()`
- `useMarketing` — 子任务状态管理

---

## LLM 服务 (llm/)

**关键词**: provider、model、prompt、token、retry、streaming、temperature、context window

**核心概念**:
- **Provider 预设**: DeepSeek / OpenAI / Gemini / Grok，各自 apiStyle 不同
- **阶段模型分配**: outline→OpenAI, chapter→Gemini 3.1 Pro, review→Gemini, marketing→OpenAI
- **重试机制**: `retryWithBackoff()` — 429/500/502/503 自动重试，指数退避 1/2/4 秒
- **流式超时**: 60 秒无 token 返回自动中断
- **Token 预算**: `getModelContextWindow()` 动态计算，chapter 默认取模型 context 的 60%

**详细文档**:
- `llm/overview.md` — Provider 配置、Prompt 编译流程、重试策略、Token 管理

**代码入口**:
- `runLLMStream()` — 统一 LLM 调用入口
- `getConfigForStage()` — 获取阶段对应的 provider 配置
- `compile*Prompt()` 系列 — 各阶段 prompt 编译

---

## 数据层 (data/)

**关键词**: database、IndexedDB、Dexie、project、chapter、skill、chatMessage、import、export

**核心概念**:
- **4 张表**: `projects`, `chapters`, `skills`, `chatMessages`
- **故事记忆**: 存储在 `project.storyMemory` 字段（JSON blob）
- **版本历史**: `chapter.versionHistory` 最多 5 条，自动保存时从 DB 实时读取（避免竞态）
- **项目导入导出**: `projectIO.ts` — JSON 格式，含项目+章节+聊天记录

**详细文档**:
- `data/overview.md` — 数据模型、表结构、导入导出、备份

**代码入口**:
- `db.ts` — Dexie 定义 + Skill 种子
- `types.ts` — TypeScript 接口
- `projectIO.ts` — 导入导出

---

## Skill 系统 (skill/)

**关键词**: skill、规则、模板、skill 选择、临时 skill、extra skill

**核心概念**:
- **内置 Skill**: 8 个预设（workflow/outline_template/wolf_setting/logic_check/female_slap/degrease/blurb/connect_skills）
- **分类**: workflow / template / rule / logic_check / blurb
- **自动包含 vs 可选**: outline 阶段自动包含 outline_template + genre skill；chapter 阶段自动包含 degrease + connect_skills + logic_check
- **临时 Skill**: 上传 .md/.txt 文件，仅本次会话有效，支持多个
- **注入位置**: 拼接到 `compile*Prompt()` 的 system prompt 中

**详细文档**:
- `skill/overview.md` — Skill 分类、选择逻辑、注入机制

**代码入口**:
- `SkillSelectorModal.tsx` — Skill 选择 UI
- `db.ts` `seedSkills()` — 预设 Skill 种子

---

## 如何使用本索引

1. **快速定位**: 根据用户问题中的关键词，在上表中找到对应领域
2. **了解概念**: 阅读领域的"核心概念"列表，建立基本理解
3. **深入细节**: 按"详细文档"路径加载具体文档
4. **查看代码**: 按"代码入口"直接定位实现文件
