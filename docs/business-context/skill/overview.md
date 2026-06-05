# Skill 系统

## 概述

Skill 是注入 LLM prompt 中的写作规则/模板/约束。用户可以选择额外 Skill 来定制生成风格。

## 分类

| 类别 | 说明 | 示例 |
|------|------|------|
| `workflow` | 工作流指南 | AI仿写短篇小说工作流 |
| `template` | 输出格式模板 | 仿写大纲输出格式模板 |
| `rule` | 写作规则/约束 | AI去油法则、欧美狼人设定、打脸闭环 |
| `logic_check` | 审查规则 | 小说正文逻辑审查流程 |
| `blurb` | 营销规则 | 爆款网文简介生成 |

## 自动包含 vs 可选

### 大纲阶段

| Skill | 来源 | 是否自动包含 |
|-------|------|------------|
| `outline_template` | System prompt | ✅ 是（作为大纲格式模板） |
| `wolf_setting` | System prompt | ✅ 是（仅 genre='classic-wolf'） |
| `female_slap` | System prompt | ✅ 是（仅 genre='female-slap'） |
| 其他 rule/logic_check | 用户选择 | ❌ 可选（通过 SkillSelectorModal） |

`builtinKeys` = `['outline_template', 'wolf_setting'(conditional), 'female_slap'(conditional)]`
`excludeKeys` = `['workflow', 'blurb']`

### 章节阶段

| Skill | 来源 | 是否自动包含 |
|-------|------|------------|
| `degrease` | System prompt | ✅ 是（去油法则） |
| `connect_skills` | System prompt | ✅ 是（章节串联） |
| `logic_check` | System prompt | ✅ 是（内部自检，不输出） |
| 其他 rule/template | 用户选择 | ❌ 可选 |

`builtinKeys` = `['degrease', 'connect_skills', 'logic_check']`
`excludeKeys` = `['workflow', 'blurb', 'outline_template']`

## 选择 UI

**代码位置**: `src/components/SkillSelectorModal.tsx`

**功能**:
- 按类别分组展示（彩色圆点标识）
- 显示每项的 description
- "已自动包含"区域展示内置 Skill（只读）
- 临时 Skill 区域：支持上传多个 .md/.txt 文件，每个可独立移除
- 底部"上传临时 Skill"按钮，支持多文件选择

## 注入位置

Skill 内容被拼接到 `compile*Prompt()` 的 system prompt 中：

```
--- 《AI去油法则》（写作手法约束）---
{degreaseSkill}

--- 《串联》（章节衔接要求）---
{connectSkill}

--- 补充 Skill ---
{extraSkillContents.join('\n\n')}

--- 临时补充 Skill ---
{extraSkillText}
```

## 临时 Skill

- 上传的文件内容存储在 `outlineExtraSkillTexts[]` / `chapterExtraSkillTexts[]`（string 数组）
- 传入 prompt 时 `join('\n\n')` 拼接为单个字符串
- 仅当前会话有效（React state，不持久化到 DB）
- 支持同时上传多个文件

## 预设 Skill 种子

**代码位置**: `db.ts` — `seedSkills()`

首次运行时从 `docs/*.md` 文件通过 Vite `?raw` 导入，写入 skills 表。
更新 Skill 内容后调用 `reseedSkillContents()` 刷新。
