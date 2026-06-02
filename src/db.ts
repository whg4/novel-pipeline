import Dexie, { type Table } from 'dexie';
import { Project, Chapter, Skill, ChatMessage } from './types';

import workflowMd from '../docs/AI仿写短篇小说工作流 v3.0.md?raw';
import outlineTemplateMd from '../docs/仿写大纲输出格式模板 v3.0.md?raw';
import wolfSettingMd from '../docs/⚙️ Skill_ 欧美狼人设定 (Classic Tribal Werewolf Code).md?raw';
import logicCheckMd from '../docs/⚙️ 小说正文逻辑审查流程（Skill）v3.2.md?raw';
import featureSlapMd from '../docs/⚙️ 终极Skill：[沉浸式大女主爽文：打脸闭环].md?raw';
import degreaseMd from '../docs/⚙️ 终极小说写法 Skill：[AI去油法则].md?raw';
import blurbMd from '../docs/🎯 爆款网文简介（导语）生成 Skill v4.1.md?raw';
import connectSkillsMd from '../docs/串联：大纲与各种skill.md?raw';

export class NovelDatabase extends Dexie {
  projects!: Table<Project>;
  chapters!: Table<Chapter>;
  skills!: Table<Skill>;
  chatMessages!: Table<ChatMessage>;

  constructor() {
    super('NovelPipelineDB');
    this.version(1).stores({
      projects: '++id, title, genre, createdAt',
      chapters: '++id, projectId, chapterNumber, isCompleted, lastEdited',
      skills: 'key, name, category',
    });
    this.version(2).stores({
      projects: '++id, title, genre, createdAt',
      chapters: '++id, projectId, chapterNumber, isCompleted, lastEdited',
      skills: 'key, name, category',
      chatMessages: '++id, [projectId+scope], [projectId+scope+chapterId], createdAt',
    });
    // v3: Project 新增可选字段 storyMemory（JSON blob，无需变更 store 定义）
    this.version(3).stores({
      projects: '++id, title, genre, createdAt',
      chapters: '++id, projectId, chapterNumber, isCompleted, lastEdited',
      skills: 'key, name, category',
      chatMessages: '++id, [projectId+scope], [projectId+scope+chapterId], createdAt',
    });
  }
}

export const db = new NovelDatabase();

// Pre-populate skills if empty
export async function seedSkills() {
  const count = await db.skills.count();
  if (count > 0) return;

  const presets: Skill[] = [
    {
      key: 'workflow',
      name: 'AI仿写短篇小说工作流 v3.0',
      category: 'workflow',
      description: '引导模型进行单篇比照仿写的整体开发与逻辑链校准。',
      content: workflowMd,
    },
    {
      key: 'outline_template',
      name: '仿写大纲输出格式模板 v3.0',
      category: 'template',
      description: '大纲生成的1:1内核复刻框架，包含反派链、底牌和情绪节奏。',
      content: outlineTemplateMd,
    },
    {
      key: 'wolf_setting',
      name: '⚙️ Skill: 欧美狼人设定 (Classic Tribal Werewolf Code)',
      category: 'rule',
      description: '纯阳刚物理硬碰硬欧美狼人生态，斩断ABO发情期与魔法威压。',
      content: wolfSettingMd,
    },
    {
      key: 'logic_check',
      name: '⚙️ 小说正文逻辑审查流程（Skill）v3.2',
      category: 'logic_check',
      description: '对交付正文进行时间线、地标、物理常识与已知信息的一致性检验。',
      content: logicCheckMd,
    },
    {
      key: 'female_slap',
      name: '⚙️ 终极Skill：[沉浸式大女主爽文：打脸闭环]',
      category: 'rule',
      description: '反差压迫、仇恨踩痛点、不口舌争锋直接物理压制与惨烈特写处刑。',
      content: featureSlapMd,
    },
    {
      key: 'degrease',
      name: '⚙️ 终极小说写法 Skill：[AI去油法则]',
      category: 'rule',
      description: '绝不总结，绝不排比，绝不替读者下段位结论，杀除局部器官演戏。',
      content: degreaseMd,
    },
    {
      key: 'blurb',
      name: '🎯 爆款网文简介（导语）生成 Skill v4.1',
      category: 'blurb',
      description: '不讲梗概，切片展现当众退婚/切割与深夜红眼下跪求你两大冲突。',
      content: blurbMd,
    },
    {
      key: 'connect_skills',
      name: '串联：大纲与各种skill',
      category: 'rule',
      description: '连接大纲唯一的最高地位，处理章节气势衔接与去专业化写实手法。',
      content: connectSkillsMd,
    },
  ];

  await db.skills.bulkAdd(presets);
}

// Update all preset skills to the latest bundled content (call on version bump)
export async function reseedSkillContents() {
  const bundled: Record<string, string> = {
    workflow: workflowMd,
    outline_template: outlineTemplateMd,
    wolf_setting: wolfSettingMd,
    logic_check: logicCheckMd,
    female_slap: featureSlapMd,
    degrease: degreaseMd,
    blurb: blurbMd,
    connect_skills: connectSkillsMd,
  };

  for (const [key, content] of Object.entries(bundled)) {
    await db.skills.update(key, { content });
  }
}

