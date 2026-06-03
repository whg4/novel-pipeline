/**
 * 项目导入/导出工具
 * 将项目完整数据（项目 + 章节 + 对话记录）序列化为 JSON 文件
 */

import { db } from '../db';
import type { Project, Chapter, ChatMessage } from '../types';

interface ProjectExportData {
  version: 1;
  exportedAt: number;
  project: Project;
  chapters: Chapter[];
  chatMessages: ChatMessage[];
}

/**
 * 导出单个项目为 JSON 文件并下载
 */
export async function exportProject(projectId: number): Promise<void> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('项目不存在');

  const chapters = await db.chapters
    .where('projectId').equals(projectId)
    .sortBy('chapterNumber');

  const chatMessages = await db.chatMessages
    .where('projectId').equals(projectId)
    .sortBy('createdAt');

  const data: ProjectExportData = {
    version: 1,
    exportedAt: Date.now(),
    project,
    chapters,
    chatMessages,
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFileName(project.title || '未命名项目')}-${formatDate()}.novel-pipeline.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 从 JSON 文件导入项目
 * @returns 导入的项目 ID，失败返回 null
 */
export async function importProject(file: File): Promise<number | null> {
  const text = await file.text();
  let data: ProjectExportData;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('文件格式无效，无法解析 JSON。');
  }

  if (data.version !== 1 || !data.project || !Array.isArray(data.chapters)) {
    throw new Error('文件格式不兼容。请确认是本工具导出的 .novel-pipeline.json 文件。');
  }

  const { project, chapters, chatMessages } = data;

  // 移除旧 ID，避免冲突
  const { id: _pid, ...projectFields } = project;
  const newProjectId = await db.projects.add({
    ...projectFields,
    title: `${project.title || '未命名项目'}（导入）`,
    createdAt: Date.now(),
  });

  // 导入章节，重映射 projectId
  for (const ch of chapters) {
    const { id: _cid, ...chFields } = ch;
    await db.chapters.add({
      ...chFields,
      projectId: newProjectId,
    });
  }

  // 导入聊天记录，重映射 projectId 和 chapterId
  if (Array.isArray(chatMessages) && chatMessages.length > 0) {
    // 构建旧 chapterId → 新 chapterId 的映射
    const newChapters = await db.chapters
      .where('projectId').equals(newProjectId)
      .toArray();
    const oldChapters = chapters;
    const chapterIdMap = new Map<number, number>();
    for (let i = 0; i < oldChapters.length; i++) {
      if (oldChapters[i].id && newChapters[i]?.id) {
        chapterIdMap.set(oldChapters[i].id!, newChapters[i].id!);
      }
    }

    for (const msg of chatMessages) {
      const { id: _mid, ...msgFields } = msg;
      await db.chatMessages.add({
        ...msgFields,
        projectId: newProjectId,
        chapterId: msg.chapterId ? chapterIdMap.get(msg.chapterId) ?? msg.chapterId : undefined,
      });
    }
  }

  return newProjectId;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 50) || '项目';
}

function formatDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}${m}${day}_${h}${min}`;
}
