---
name: novel-pipeline-development
description: "小说创作流水线项目的业务上下文文档。用于：(1) 理解项目架构和数据流；(2) 修改 LLM prompt 编译逻辑；(3) 调整自动流水线流程；(4) 修复生成质量问题；(5) 扩展新的 Skill 或 Provider。"
---

# 小说创作流水线 — 业务上下文

## Overview

这是一个纯浏览器端的 AI 辅助网文创作工具，通过 LLM 完成从大纲生成到营销素材的全流程。核心价值是**仿写**：用户提供参考例文，系统复刻其节奏和结构，用新背景/新人物重新生成。

**技术栈**: React + TypeScript + Vite + Ant Design + Dexie (IndexedDB)
**架构**: 无后端，所有 LLM 调用从浏览器直连 provider API

## When to Use This Skill

- 修改 prompt 编译逻辑（`compileChapterPrompt`、`compileOutlinePrompt` 等）
- 调整自动流水线的阶段流程或质量门控
- 添加新的 LLM Provider 或模型
- 修复生成质量问题（上下文丢失、风格漂移、逻辑审查不准）
- 扩展 Skill 系统（新增写作规则、审查规则）
- 修改故事记忆提取逻辑
- 调整 Token 预算裁剪策略

## How to Use

```
docs/business-context/
├── SKILL.md                    ← 你在这里
├── _index.md                   ← 业务知识索引（首先加载）
├── pipeline/                   ← 创作流水线流程
│   └── overview.md             ← 端到端流程、自动流水线、暂停/恢复
├── outline/                    ← 大纲系统
│   └── overview.md             ← 大纲生成、验证、修订
├── chapter/                    ← 章节写作系统
│   └── overview.md             ← 章节生成、逻辑审查、故事记忆
├── marketing/                  ← 营销素材
│   └── overview.md             ← 简介、书名、封面
├── llm/                        ← LLM 服务层
│   └── overview.md             ← Provider 管理、Prompt 编译、重试、Token 管理
├── data/                       ← 数据层
│   └── overview.md             ← 数据模型、IndexedDB、导入导出
└── skill/                      ← Skill 系统
    └── overview.md             ← Skill 管理、选择、注入
```

## Quick Reference

| 信息 | 值 |
|------|-----|
| 入口 | `src/App.tsx` → `Shell` 组件 |
| 主页面 | `src/views/PipelineView.tsx` |
| LLM 核心 | `src/services/llm.ts` |
| 数据模型 | `src/types.ts` |
| 数据库 | `src/db.ts` (Dexie, 4 张表) |
| Pipeline Hooks | `src/hooks/useOutlineGeneration.ts`, `useChapterDrafting.ts`, `useAutoPipeline.ts`, `useMarketing.ts` |
| Prompt 模板 | `docs/*.md` (seeded into skills table) |
| Token 工具 | `src/utils/tokenEstimator.ts` |

## 数据流概览

```
用户输入（例文/背景/人物）
    ↓
大纲生成 ← compileOutlinePrompt + Skills
    ↓
大纲验证 ← validateOutlineAgainstChecklist (10 项)
    ↓
章节同步 ← syncOutlineChaptersToDb (解析 ### 第 N 章)
    ↓
逐章生成 ← compileChapterPrompt + StoryMemory + 前章末尾
    ↓
逻辑审查 ← compileLogicReviewPrompt (结构化 JSON)
    ↓ (审查失败 → 自动重写，最多 2 轮)
营销素材 ← Blurb / Title / Cover prompt
```

## File Organization

```
src/
├── services/llm.ts             ← LLM 调用核心（prompt 编译 + 流式分发）
├── services/providers.ts       ← Provider 预设和配置
├── hooks/                      ← 业务逻辑 hooks
│   ├── usePipelineTask.ts      ← 任务生命周期（开始/暂停/恢复/中止）
│   ├── useOutlineGeneration.ts ← 大纲生成、审查、修订
│   ├── useChapterDrafting.ts   ← 章节写作、自动保存、去油检测
│   ├── useAutoPipeline.ts      ← 一键全自动流水线
│   └── useMarketing.ts         ← 营销素材生成
├── utils/
│   ├── pipeline.ts             ← 大纲解析、章节同步、内容清洗
│   ├── tokenEstimator.ts       ← Token 估算和 Prompt 裁剪
│   ├── retryWithBackoff.ts     ← API 重试（指数退避）
│   ├── projectIO.ts            ← 项目导入导出
│   └── templates.ts            ← 项目模板管理
├── views/                      ← 页面组件
├── components/                 ← UI 组件
├── types.ts                    ← 全局类型定义
└── db.ts                       ← Dexie 数据库定义 + Skill 种子数据
```
