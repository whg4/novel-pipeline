# 开发规范

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | React 18 + TypeScript |
| 构建 | Vite |
| UI | Ant Design 5 + @ant-design/x (Chat UI) + Tailwind CSS |
| 数据库 | Dexie (IndexedDB 封装) |
| 路由 | React Router 6 |
| 图标 | Lucide React + Ant Design Icons |

## 项目结构

```
src/
├── services/llm.ts       ← LLM 核心（prompt 编译 + 流式分发），最大文件
├── services/providers.ts ← Provider 预设
├── hooks/                ← 业务逻辑 hooks（每个 hook 对应一个功能域）
├── views/                ← 页面级组件
├── components/           ← UI 组件
│   └── pipeline/         ← Pipeline 阶段组件
├── utils/                ← 纯函数工具
├── types.ts              ← 全局类型
└── db.ts                 ← 数据库定义
```

## 编码规范

### Hooks 设计

- 每个 hook 对应一个独立的功能域（大纲/章节/营销/自动流水线）
- Hook 接收 `taskControl` 对象（来自 `usePipelineTask`），不直接管理 AbortController
- Hook 返回 handler 函数和状态，由 PipelineView 组合
- 数据库操作在 hook 内部完成，组件不直接写 DB

### 状态管理

- 全局状态通过 `useLiveQuery` 响应式读取
- 组件局部状态用 `useState`
- 跨 hook 共享的状态通过 props 传递（当前方案，非 Context）
- `isGenerating` 是全局锁，同一时间只允许一个生成任务运行

### LLM 调用

- 所有 LLM 调用通过 `runLLMStream(stage, system, user, onToken, options)`
- 不要直接调用 `fetch`（封面图片生成除外）
- 暂停通过 `options.signal` (AbortController) 实现
- 重试由 `retryWithBackoff` 自动处理

### Prompt 编译

- 每个阶段有独立的 `compile*Prompt()` 函数
- Skill 内容直接拼接到 system prompt
- 上下文（背景/人物/大纲）拼接到 user prompt
- Token 裁剪在 `compileChapterPrompt` 内部完成

### 数据库操作

- 使用 Dexie API（`db.projects.get()`, `db.chapters.update()` 等）
- 版本历史从 DB 实时读取（避免竞态）
- 删除项目时必须清理 chapters + chatMessages
- 大纲同步时自动删除旧章节

### 错误处理

- LLM 错误分为：可重试（429/5xx）和不可重试（401/403/用户暂停）
- `isPausedError()` 判断是否为用户暂停
- UI 反馈使用 `antdMessage`（不使用 `alert()`）
- 全局 ErrorBoundary 防止组件崩溃白屏

## 常用命令

```bash
npm run dev          # 启动开发服务器
npm run build        # TypeScript 检查 + Vite 构建
npx tsc --noEmit     # 仅 TypeScript 类型检查
```

## 注意事项

- 所有数据存储在浏览器 IndexedDB，清缓存即丢失
- API Key 存储在 localStorage 明文中
- 纯前端架构，无后端服务
- 跨设备同步需要用户手动导入/导出 JSON
