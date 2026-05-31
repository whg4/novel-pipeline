import Dexie, { type Table } from 'dexie';
import { Project, Chapter, Skill } from './types';

export class NovelDatabase extends Dexie {
  projects!: Table<Project>;
  chapters!: Table<Chapter>;
  skills!: Table<Skill>;

  constructor() {
    super('NovelPipelineDB');
    this.version(1).stores({
      projects: '++id, title, genre, createdAt',
      chapters: '++id, projectId, chapterNumber, isCompleted, lastEdited',
      skills: 'key, name, category',
    });
  }
}

export const db = new NovelDatabase();

// Pre-populate skills if empty
export async function seedSkills() {
  const count = await db.skills.count();
  if (count > 0) return;

  const presets: Omit<Skill, 'content'>[] = [
    {
      key: 'workflow',
      name: 'AI仿写短篇小说工作流 v3.0',
      category: 'workflow',
      description: '引导模型进行单篇比照仿写的整体开发与逻辑链校准。'
    },
    {
      key: 'outline_template',
      name: '仿写大纲输出格式模板 v3.0',
      category: 'template',
      description: '大纲生成的1:1内核复刻框架，包含反派链、底牌和情绪节奏。'
    },
    {
      key: 'wolf_setting',
      name: '⚙️ Skill: 欧美狼人设定 (Classic Tribal Werewolf Code)',
      category: 'rule',
      description: '纯阳刚物理硬碰硬欧美狼人生态，斩断ABO发情期与魔法威压。'
    },
    {
      key: 'logic_check',
      name: '⚙️ 小说正文逻辑审查流程（Skill）v3.2',
      category: 'logic_check',
      description: '对交付正文进行时间线、地标、物理常识与已知信息的一致性检验。'
    },
    {
      key: 'female_slap',
      name: '⚙️ 终极Skill：[沉浸式大女主爽文：打脸闭环]',
      category: 'rule',
      description: '反差压迫、仇恨踩痛点、不口舌争锋直接物理压制与惨烈特写处刑。'
    },
    {
      key: 'degrease',
      name: '⚙️ 终极小说写法 Skill：[AI去油法则]',
      category: 'rule',
      description: '绝不总结，绝不排比，绝不替读者下段位结论，杀除局部器官演戏。'
    },
    {
      key: 'blurb',
      name: '🎯 爆款网文简介（导语）生成 Skill v4.1',
      category: 'blurb',
      description: '不讲梗概，切片展现当众退婚/切割与深夜红眼下跪求你两大冲突。'
    },
    {
      key: 'connect_skills',
      name: '串联：大纲与各种skill',
      category: 'rule',
      description: '连接大纲唯一的最高地位，处理章节气势衔接与去专业化写实手法。'
    }
  ];

  const docsMapping: Record<string, string> = {
    workflow: '/docs/AI仿写短篇小说工作流 v3.0.md',
    outline_template: '/docs/仿写大纲输出格式模板 v3.0.md',
    wolf_setting: '/docs/⚙️ Skill_ 欧美狼人设定 (Classic Tribal Werewolf Code).md',
    logic_check: '/docs/⚙️ 小说正文逻辑审查流程（Skill）v3.2.md',
    female_slap: '/docs/⚙️ 终极Skill：[沉浸式大女主爽文：打脸闭环].md',
    degrease: '/docs/⚙️ 终极小说写法 Skill：[AI去油法则].md',
    blurb: '/docs/🎯 爆款网文简介（导语）生成 Skill v4.1.md',
    connect_skills: '/docs/串联：大纲与各种skill.md'
  };

  const seedData: Skill[] = [];

  for (const preset of presets) {
    let content = '';
    try {
      const path = docsMapping[preset.key];
      // Try to fetch dynamically from local served project
      const res = await fetch(path);
      if (res.ok) {
        content = await res.text();
      }
    } catch (e) {
      console.warn(`Fetch preset failed for ${preset.key}, falling back to hardcoded copy.`);
    }

    if (!content) {
      content = getFallbackContent(preset.key);
    }

    seedData.push({
      ...preset,
      content
    });
  }

  await db.skills.bulkAdd(seedData);
}

function getFallbackContent(key: string): string {
  // Safe fallbacks to match local documents
  switch (key) {
    case 'workflow':
      return `# AI仿写短篇小说工作流 v3.0\n使用模型：Gemini\n注意：若传入skill过多，效果反而不好。\n...\n`;
    case 'outline_template':
      return `# 仿写大纲输出格式模板 v3.0\n## 💡 仿写核心指令\n1. 内核 1:1 复刻\n2. 名词下沉\n3. 设定差异化\n4. 伏笔必回收\n5. 强制打脸前摇...\n`;
    case 'wolf_setting':
      return `# ⚙️ Skill: 欧美狼人设定\n1. 头狼/酋长 (Alpha)\n2. Luna (头狼之妻)\n3. 纯血/返祖血脉\n4. 族狼 (Beta)\n...\n`;
    case 'logic_check':
      return `# ⚙️ 小说正文逻辑审查流程（Skill）v3.2\n1. 时间线追踪\n2. 地点/行程追踪\n3. 道具/物品追踪\n4. 人物信息一致性\n...\n`;
    case 'female_slap':
      return `# ⚙️ 终极Skill：[沉浸式大女主爽文：打脸闭环]\n模块二：情绪外化\n模块三：冲突物理打击\n模块四：战损具象化...\n`;
    case 'degrease':
      return `# ⚙️ 终极小说写法 Skill：[AI去油法则]\n规则 1：杜绝上帝视角\n规则 2：斩断AI味句式\n规则 3：严禁器官演戏\n规则 4：杀微表情风景\n...\n`;
    case 'blurb':
      return `# 🎯 爆款网文简介（导语）生成 Skill v4.1\n一、核心心法\n二、十大创作法则\n三、五大实战结构模板\n...\n`;
    case 'connect_skills':
      return `# 串联：大纲与各种skill\n1. 剧情生成原则\n2. 叙事视角大忌\n3. 章节连贯性\n4. 交付格式...\n`;
    default:
      return '';
  }
}
