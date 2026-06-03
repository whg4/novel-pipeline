/**
 * 项目模板管理
 * 模板保存在 localStorage 中，包含题材/背景/人物/默认 Skill 配置
 */

export interface ProjectTemplate {
  name: string;
  genre: string;
  background: string;
  characters: string;
  defaultSkillKeys: string[];
  createdAt: number;
}

const STORAGE_KEY = 'novel_pipeline_templates';

export function getTemplates(): ProjectTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTemplate(template: ProjectTemplate): void {
  const templates = getTemplates();
  templates.push(template);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export function deleteTemplate(index: number): void {
  const templates = getTemplates();
  templates.splice(index, 1);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export function exportTemplate(template: ProjectTemplate): void {
  const json = JSON.stringify(template, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `模板-${template.name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
