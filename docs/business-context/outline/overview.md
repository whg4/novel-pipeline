# 大纲系统

## 大纲生成流程

**代码入口**: `compileOutlinePrompt()` in `src/services/llm.ts`

### Prompt 组成

| 部分 | 内容 | 来源 |
|------|------|------|
| System | 大纲模板 Skill + 类型 Skill + 用户选择的额外 Skill | `outline_template` + genre skill + extra |
| User | 项目背景 + 人物设定 + 例文原文 + 验证反馈 | project fields |

**关键**: 例文原文是仿写的核心依据，直接传入 prompt（非摘要）。

### 大纲修订 vs 重新生成

| 操作 | 入口函数 | 上下文 |
|------|---------|--------|
| 重新生成 | `compileOutlinePrompt()` | 例文 + 背景 + 人物 + 聊天历史反馈 |
| 修订 | `compileOutlineRevisionPrompt()` | **已有大纲** + 审查反馈 + 例文 + 背景 + 人物 |

修订模式的核心差异：
- system prompt 明确指示"有针对性修正，不从头重写"
- user prompt 中已有大纲放在 `--- 当前大纲（需要修订）---` 段
- 例文仍作为参照保留

## 结构化验证 (10 项自检清单)

**代码入口**: `validateAgainstChecklist()` in `src/services/llm.ts`

**清单常量**: `OUTLINE_CHECKLIST_ITEMS`

| Key | 标题 | 说明 |
|-----|------|------|
| `a_rhythm` | 节奏对齐 | 与参考原文分镜/事件密度一一对应 |
| `b_no_jargon` | 无术语注解 | 不出现括号内解释 |
| `c_differences` | 差异标注 | 与参考原文的替换点明确标记 |
| `d_payback` | 伏笔回收 | 每个伏笔有明确回收章节 |
| `e_motives` | 角色动机一致 | 无突兀行为转变 |
| `f_logic_time` | 时间线逻辑 | 无时间矛盾 |
| `g_transition` | 章节衔接 | 末尾钩子→下一章开头无缝 |
| `h_item_consistency` | 道具一致性 | 获取/使用/消失有闭环 |
| `i_no_pose` | 无上帝视角 | 不出现"他不知道的是" |
| `j_cliffhangers` | 章末悬念 | 每章结尾有钩子 |

**验证流程**:
1. LLM 输出 JSON: `{"summary":"...", "items":[{"key":"a_rhythm","passed":true,"reason":"..."}]}`
2. 解析失败时 `buildFailedValidation` 返回全项未通过（安全降级）
3. 自动流水线中：通过 → 进入下一阶段；未通过 → 将 failed items 的 reason 注入下一轮生成

## 章节同步

**代码入口**: `syncOutlineChaptersToDb()` in `src/utils/pipeline.ts`

**解析规则**: 正则 `/(#{2,4})\s*第\s*([一二三四五六七八九十百]+|\d+)\s*章[：:\-\s]\s*([^\n]+)/g`

**支持格式**:
- `### 第 1 章：标题`（标准）
- `## 第一章：标题`（中文数字 + ##）
- `### 第三章-标题`（破折号分隔）
- `#### 第十章 标题`（无分隔符）

**同步逻辑**:
- 新章节 → 创建空记录
- 已存在 → 更新 title + outlineSection，保留 content/versionHistory
- **大纲中不存在的旧章节 → 自动删除**（含关联的 chatMessages）

## 大纲逻辑审查

**代码入口**: `compileOutlineLogicReviewPrompt()` in `src/services/llm.ts`

**上下文**: 大纲 + 逻辑检查 Skill + 项目背景 + 人物设定 + 参考例文节选

**审查维度**: 时间线一致性、角色动机、情节逻辑、伏笔回收、章末悬念、差距/矛盾

**输出**: 自由文本审查报告（非结构化），用于用户参考
