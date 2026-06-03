import { useState } from 'react';
import { db } from '../db';
import type { Project, Skill, ChatMessage } from '../types';
import {
  runLLMStream, compileOutlinePrompt, compileOutlineLogicReviewPrompt,
  compileOutlineRevisionPrompt,
} from '../services/llm';
import { syncOutlineChaptersToDb } from '../utils/pipeline';
import type { GenerationTask } from './usePipelineTask';
import type { LLMStreamOptions } from '../services/llm';

interface TaskControl {
  beginGenerationTask: (task: GenerationTask, resume?: boolean) => LLMStreamOptions;
  isPausedError: (error: any) => boolean;
  markTaskPaused: (task: GenerationTask, message?: string) => void;
  finishGenerationTask: (task: GenerationTask, paused?: boolean) => void;
}

export function useOutlineGeneration(
  projectId: number,
  project: Project | undefined,
  skills: Skill[],
  outlineChatMessages: ChatMessage[],
  taskControl: TaskControl,
  setIsGenerating: (v: boolean) => void,
  setGenerationOutput?: (v: string) => void,
) {
  const [outlineGenerationStatus, setOutlineGenerationStatus] = useState('');
  const [outlineReviewOutput, setOutlineReviewOutput] = useState('');
  const [outlineExtraSkillKeys, setOutlineExtraSkillKeys] = useState<string[]>([]);
  const [outlineExtraSkillText, setOutlineExtraSkillText] = useState('');

  const { beginGenerationTask, isPausedError, markTaskPaused, finishGenerationTask } = taskControl;

  const handleGenerateOutline = async (resume = false, extraSlapSkill?: string, feedbackOverride?: string) => {
    if (!project) return;
    const streamOptions = beginGenerationTask('outline', resume);
    setIsGenerating(true);
    setOutlineGenerationStatus(resume ? '继续生成大纲...' : '生成大纲中...');
    const template = skills.find(s => s.key === 'outline_template')?.content || '';
    const wolfSkill = project.genre === 'classic-wolf'
      ? (skills.find(s => s.key === 'wolf_setting')?.content || '')
      : undefined;
    const slapSkill = extraSlapSkill ?? (project.genre === 'female-slap'
      ? (skills.find(s => s.key === 'female_slap')?.content || '')
      : undefined);

    const effectiveFeedback = feedbackOverride || '';
    let accumulated = resume ? (project.outline || '') : '';
    let wasPaused = false;

    try {
      const compiled = compileOutlinePrompt(
        project.rawExample,
        project.background,
        project.characters,
        template,
        effectiveFeedback || undefined,
        wolfSkill,
        slapSkill,
        outlineExtraSkillKeys,
        outlineExtraSkillText,
        skills
      );

      const recentFeedback = outlineChatMessages
        .filter(m => m.role === 'user')
        .slice(-4)
        .map(m => m.content)
        .join('\n---\n');
      if (recentFeedback && !effectiveFeedback) {
        compiled.user += `\n\n【历史修改要求（参考）】\n${recentFeedback}`;
      }

      await runLLMStream('outline', compiled.system, compiled.user, (tok) => {
        accumulated += tok;
        setGenerationOutput?.(accumulated);
      }, streamOptions);

      await db.projects.update(projectId, { outline: accumulated, outlineValidationUpdatedAt: Date.now() });
      // 自动同步章节结构
      if (accumulated) {
        const n = await syncOutlineChaptersToDb(accumulated, projectId);
        setOutlineGenerationStatus(n > 0
          ? `大纲已生成并保存，已同步 ${n} 个章节。`
          : '大纲已生成并保存。');
      } else {
        setOutlineGenerationStatus('大纲已生成并保存。');
      }
      if (!wasPaused) {
        await db.chatMessages.add({ projectId, scope: 'outline', role: 'assistant', kind: 'outline', content: accumulated, createdAt: Date.now() });
      }
    } catch (e: any) {
      if (isPausedError(e)) {
        wasPaused = true;
        markTaskPaused('outline');
        setOutlineGenerationStatus('已暂停，当前大纲片段已保留。');
        if (accumulated) {
          await db.projects.update(projectId, { outline: accumulated, outlineValidationUpdatedAt: Date.now() });
        }
      } else {
        alert(`大纲生成失败：${e.message}`);
        setOutlineGenerationStatus('大纲生成失败。');
      }
    } finally {
      setIsGenerating(false);
      finishGenerationTask('outline', wasPaused);
    }
  };

  const handleReviewOutline = async (resume = false) => {
    if (!project?.outline) {
      alert('请先生成大纲后再进行逻辑审查。');
      return;
    }
    const logicSkill = skills.find(s => s.key === 'logic_check')?.content || '';
    const streamOptions = beginGenerationTask('outline-review', resume);
    setIsGenerating(true);
    if (!resume) setOutlineReviewOutput('');
    let wasPaused = false;
    try {
      const compiled = compileOutlineLogicReviewPrompt(project.outline, logicSkill, {
        background: project.background,
        characters: project.characters,
        rawExample: project.rawExample || undefined,
      });
      let acc = resume ? outlineReviewOutput : '';
      await runLLMStream('outline', compiled.system, compiled.user, (tok) => {
        acc += tok;
        setOutlineReviewOutput(acc);
      }, streamOptions);
      if (!wasPaused) {
        await db.chatMessages.add({ projectId, scope: 'outline', role: 'assistant', kind: 'review', content: acc, createdAt: Date.now() });
      }
    } catch (e: any) {
      if (isPausedError(e)) {
        wasPaused = true;
        markTaskPaused('outline-review');
      } else {
        alert(`大纲审查失败：${e.message}`);
      }
    } finally {
      setIsGenerating(false);
      finishGenerationTask('outline-review', wasPaused);
    }
  };

  const handleOutlineChatSend = async (userText: string) => {
    if (userText.trim()) {
      await db.chatMessages.add({ projectId, scope: 'outline', role: 'user', content: userText, createdAt: Date.now() });
    }
    await handleGenerateOutline(false, undefined, userText || undefined);
  };

  const handleClearOutlineChat = async () => {
    await db.chatMessages.where('[projectId+scope]').equals([projectId, 'outline']).delete();
  };

  // 编辑重发：删除该消息及之后的所有消息，用新内容重新发送
  const handleEditResendOutline = async (messageId: number, newContent: string) => {
    const allMsgs = await db.chatMessages
      .where('[projectId+scope]').equals([projectId, 'outline']).sortBy('createdAt');
    const idx = allMsgs.findIndex(m => m.id === messageId);
    if (idx === -1) return;
    const toDelete = allMsgs.slice(idx).filter(m => m.id != null).map(m => m.id!);
    if (toDelete.length > 0) await db.chatMessages.bulkDelete(toDelete);
    await handleOutlineChatSend(newContent);
  };

  // 根据大纲审查建议，使用已有大纲作为上下文重新修订大纲
  const handleUseOutlineReviewSuggestion = async (reviewContent: string) => {
    if (!project?.outline) return;

    // 保存用户消息到聊天记录
    await db.chatMessages.add({
      projectId, scope: 'outline', role: 'user',
      content: '根据以上审查建议修订大纲',
      createdAt: Date.now(),
    });

    const streamOptions = beginGenerationTask('outline');
    setIsGenerating(true);
    setOutlineGenerationStatus('根据审查建议修订大纲中...');

    const template = skills.find(s => s.key === 'outline_template')?.content || '';
    const wolfSkill = project.genre === 'classic-wolf'
      ? (skills.find(s => s.key === 'wolf_setting')?.content || '')
      : undefined;
    const slapSkill = project.genre === 'female-slap'
      ? (skills.find(s => s.key === 'female_slap')?.content || '')
      : undefined;
    const extraSkillContents = outlineExtraSkillKeys
      .map(k => skills.find(s => s.key === k)?.content || '')
      .filter(Boolean);
    let accumulated = '';
    let wasPaused = false;

    try {
      const compiled = compileOutlineRevisionPrompt(
        project.outline,
        reviewContent,
        project.background,
        project.characters,
        template,
        wolfSkill,
        slapSkill,
        extraSkillContents,
        outlineExtraSkillText,
        project.rawExample || undefined,
      );

      await runLLMStream('outline', compiled.system, compiled.user, (tok) => {
        accumulated += tok;
        setGenerationOutput?.(accumulated);
      }, streamOptions);

      await db.projects.update(projectId, { outline: accumulated, outlineValidationUpdatedAt: Date.now() });
      // 自动同步章节结构
      if (accumulated) {
        const n = await syncOutlineChaptersToDb(accumulated, projectId);
        setOutlineGenerationStatus(n > 0
          ? `大纲已修订并保存，已同步 ${n} 个章节。`
          : '大纲已修订并保存。');
      } else {
        setOutlineGenerationStatus('大纲已修订并保存。');
      }
      if (!wasPaused) {
        await db.chatMessages.add({
          projectId, scope: 'outline', role: 'assistant', kind: 'outline',
          content: accumulated, createdAt: Date.now(),
        });
      }
    } catch (e: any) {
      if (isPausedError(e)) {
        wasPaused = true;
        markTaskPaused('outline');
        setOutlineGenerationStatus('已暂停，修订片段已保留。');
        if (accumulated) {
          await db.projects.update(projectId, { outline: accumulated, outlineValidationUpdatedAt: Date.now() });
        }
      } else {
        alert(`大纲修订失败：${e.message}`);
        setOutlineGenerationStatus('大纲修订失败。');
      }
    } finally {
      setIsGenerating(false);
      finishGenerationTask('outline', wasPaused);
    }
  };

  return {
    outlineGenerationStatus,
    outlineReviewOutput,
    outlineExtraSkillKeys,
    outlineExtraSkillText,
    setOutlineExtraSkillKeys,
    setOutlineExtraSkillText,
    handleGenerateOutline,
    handleReviewOutline,
    handleOutlineChatSend,
    handleClearOutlineChat,
    handleEditResendOutline,
    handleUseOutlineReviewSuggestion,
  };
}
