# 数据层

## 数据库

**技术**: Dexie (IndexedDB 封装)
**代码位置**: `src/db.ts`
**数据库名**: `NovelPipelineDB`
**版本**: v3

## 四张表

### projects

| 字段 | 类型 | 说明 |
|------|------|------|
| id | number (auto) | 主键 |
| title | string | 书名 |
| genre | string | 'general' / 'classic-wolf' / 'female-slap' |
| background | string | 世界观背景 |
| characters | string | 人物设定 |
| rawExample | string | 参考例文原文 |
| outline | string | 生成的大纲 |
| outlineValidationStatus | string | 'pending' / 'valid' / 'invalid' |
| outlineValidationResult | OutlineValidationResult | 结构化验证结果 |
| titleCandidates | string | AI 生成的书名候选 |
| coverPrompt | string | AI 生成的封面提示词 |
| storyMemory | StoryMemory | 故事记忆（JSON blob） |
| createdAt | number | 创建时间戳 |

### chapters

| 字段 | 类型 | 说明 |
|------|------|------|
| id | number (auto) | 主键 |
| projectId | number | 外键 |
| chapterNumber | number | 章节序号 |
| title | string | "第 N 章：标题" |
| outlineSection | string | 本章对应的大纲段 |
| content | string | 正文内容 |
| preChaptersEndHook | string | 衔接文本 |
| logicCheckLog | string | 逻辑审查报告（结构化 JSON） |
| regenerationPrompt | string | 用户重写指令 |
| extraSkillKeys | string[] | 本章额外 Skill keys |
| extraSkillText | string | 本章临时 Skill 文本 |
| isCompleted | boolean | 是否完成 |
| versionHistory | array | 最近 5 个版本 {content, timestamp} |
| lastEdited | number | 最后编辑时间 |

**索引**: `projectId`, `chapterNumber`, `isCompleted`, `lastEdited`

### skills

| 字段 | 类型 | 说明 |
|------|------|------|
| key | string (PK) | 唯一标识（如 'degrease'） |
| name | string | 显示名称 |
| content | string | Markdown 内容 |
| category | string | 'workflow' / 'template' / 'rule' / 'logic_check' / 'blurb' |
| description | string | 简要描述 |

**预设 Skill**（8 个，由 `seedSkills()` 种子化）:
- `workflow` — 工作流指南
- `outline_template` — 大纲输出格式模板
- `wolf_setting` — 欧美狼人设定
- `logic_check` — 逻辑审查流程
- `female_slap` — 大女主打脸闭环
- `degrease` — AI 去油法则
- `blurb` — 爆款简介生成
- `connect_skills` — 章节串联要求

### chatMessages

| 字段 | 类型 | 说明 |
|------|------|------|
| id | number (auto) | 主键 |
| projectId | number | 外键 |
| scope | string | 'outline' / 'chapter' |
| chapterId | number | 章节外键（scope='chapter' 时） |
| role | string | 'user' / 'assistant' |
| kind | string | 'outline' / 'review' / 'chapter' / 'logic-review' |
| content | string | 消息内容 |
| createdAt | number | 时间戳 |

**索引**: `[projectId+scope]`, `[projectId+scope+chapterId]`, `createdAt`

## 项目导入导出

**代码位置**: `src/utils/projectIO.ts`

**导出格式**: `.novel-pipeline.json`
```json
{
  "version": 1,
  "exportedAt": timestamp,
  "project": { ... },
  "chapters": [ ... ],
  "chatMessages": [ ... ]
}
```

**导入逻辑**: 重映射所有 ID（避免冲突），章节和聊天记录同步恢复

## 数据清理

删除项目时需清理三张表：
1. `db.chapters.where('projectId').equals(id).delete()`
2. `db.chatMessages.where('projectId').equals(id).delete()`
3. `db.projects.delete(id)`

大纲同步时自动删除旧章节及其聊天记录。
