import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Project, Chapter, Skill, ChatMessage } from '../types';
import {
  runLLMStream, compileChapterPrompt, compileLogicReviewPrompt, parseLogicReviewResult,
  extractAndSaveStoryMemory,
} from '../services/llm';
import { stripLogicReview, sanitizeMarkdownFileName } from '../utils/pipeline';
import type { GenerationTask } from './usePipelineTask';
import type { LLMStreamOptions } from '../services/llm';

interface TaskControl {
  beginGenerationTask: (task: GenerationTask, resume?: boolean) => LLMStreamOptions;
  isPausedError: (error: any) => boolean;
  markTaskPaused: (task: GenerationTask, message?: string) => void;
  finishGenerationTask: (task: GenerationTask, paused?: boolean) => void;
}

export function useChapterDrafting(
  projectId: number,
  project: Project | undefined,
  chapters: Chapter[],
  skills: Skill[],
  taskControl: TaskControl,
  setIsGenerating: (v: boolean) => void,
) {
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingOutline, setEditingOutline] = useState('');
  const [editingDraft, setEditingContent] = useState('');
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [greaseWarnings, setGreaseWarnings] = useState<string[]>([]);
  const [chapterRegenerationPrompt, setChapterRegenerationPrompt] = useState('');
  const [chapterExtraSkillKeys, setChapterExtraSkillKeys] = useState<string[]>([]);
  const [chapterExtraSkillText, setChapterExtraSkillText] = useState('');
  const [logicReviewOutput, setLogicReviewOutput] = useState('');

  const { beginGenerationTask, isPausedError, markTaskPaused, finishGenerationTask } = taskControl;

  // 内部查询当前选中章节的聊天记录
  const chapterChatMessages: ChatMessage[] = useLiveQuery<ChatMessage[], ChatMessage[]>(
    () => activeChapterId
      ? db.chatMessages.where('[projectId+scope+chapterId]').equals([projectId, 'chapter', activeChapterId]).sortBy('createdAt') as any
      : Promise.resolve([]),
    [projectId, activeChapterId],
    []
  );

  // Load first chapter automatically
  useEffect(() => {
    if (chapters.length > 0 && activeChapterId === null) {
      const first = chapters[0];
      if (first.id) handleSelectChapter(first);
    }
  }, [chapters]);

  // Client-Side AI Grease Detection
  useEffect(() => {
    if (!editingDraft) {
      setGreaseWarnings([]);
      return;
    }
    const foundWarnings: string[] = [];
    const badPatterns = [
      { regex: /眼神.*(暗|深|沉)/i, label: '"眼神一暗/变深" (经典 AI 微表情套路)' },
      { regex: /喉结.*(滚动|微动)/i, label: '"喉结滚动" (AI 微表情套路)' },
      { regex: /指尖.*(颤|抖)/i, label: '"指尖发颤" (高频 AI 情绪描写)' },
      { regex: /深吸.*口气/i, label: '"深吸一口气" (AI 呼吸过渡)' },
      { regex: /没有.*由于|没有.*迟疑/i, label: '"没有一丝犹豫" (AI 决策描述重复)' },
      { regex: /(不单|不仅).*(甚至连)/i, label: '"不仅...甚至连..." (AI 修辞结构)' },
      { regex: /没有.*拉扯/i, label: '"没有拉扯" (AI 套路总结)' },
      { regex: /(自我认知|极端荒谬|在.*智谋面前|他不知道的是)/i, label: '"上帝视角分析" (违反限知叙述约束)' },
      { regex: /(像是在看.*滑稽|像是在看.*脑萎缩)/i, label: '"强行刻薄比喻" (违反去油底线)' }
    ];

    badPatterns.forEach(p => {
      if (p.regex.test(editingDraft)) {
        foundWarnings.push(p.label);
      }
    });

    setGreaseWarnings(foundWarnings);
  }, [editingDraft]);

  const handleSelectChapter = (ch: Chapter) => {
    setActiveChapterId(ch.id!);
    setEditingTitle(ch.title);
    setEditingOutline(ch.outlineSection);
    setEditingContent(ch.content);
    setChapterRegenerationPrompt(ch.regenerationPrompt || '');
  };

  const handleCreateNewChapter = async () => {
    const nextNum = chapters.length === 0 ? 1 : chapters[chapters.length - 1].chapterNumber + 1;
    const newCh: Chapter = {
      projectId,
      chapterNumber: nextNum,
      title: `第 ${nextNum} 章`,
      outlineSection: '',
      content: '',
      isCompleted: false,
      versionHistory: [],
      lastEdited: Date.now()
    };

    const newId = await db.chapters.add(newCh);
    setActiveChapterId(Number(newId));
    setEditingTitle(`第 ${nextNum} 章`);
    setEditingOutline('');
    setEditingContent('');
    setChapterRegenerationPrompt('');
  };

  const handleDeleteChapter = async (chapterId: number) => {
    await db.chapters.delete(chapterId);
    if (activeChapterId === chapterId) {
      setActiveChapterId(null);
      setEditingTitle('');
      setEditingOutline('');
      setEditingContent('');
      setChapterRegenerationPrompt('');
    }
  };

  const handleClearAllChapters = async () => {
    const ids = chapters.map(c => c.id).filter(Boolean) as number[];
    await Promise.all(ids.map(id => db.chapters.delete(id)));
    setActiveChapterId(null);
    setEditingTitle('');
    setEditingOutline('');
    setEditingContent('');
    setChapterRegenerationPrompt('');
  };

  const handleSaveChapterManual = async () => {
    if (activeChapterId === null) return;
    const ch = chapters.find(c => c.id === activeChapterId);
    if (!ch) return;

    const updatedHistory = [...(ch.versionHistory || [])];
    if (ch.content && ch.content !== editingDraft) {
      updatedHistory.push({ content: ch.content, timestamp: Date.now() });
    }

    await db.chapters.update(activeChapterId, {
      title: editingTitle,
      outlineSection: editingOutline,
      content: editingDraft,
      versionHistory: updatedHistory.slice(-5),
      lastEdited: Date.now()
    });
    alert('草稿已保存。');
  };

  const handleGenerateChapterStream = async (resume = false, promptOverride?: string, extraSkillTextOverride?: string) => {
    if (activeChapterId === null || !project) return;
    const streamOptions = beginGenerationTask('chapter', resume);
    setIsGenerating(true);
    setChapterError(null);
    if (!resume) setEditingContent('');
    let accumulated = resume ? editingDraft : '';
    let wasPaused = false;
    const effectivePrompt = promptOverride !== undefined ? promptOverride : chapterRegenerationPrompt;
    const effectiveSkillText = extraSkillTextOverride !== undefined ? extraSkillTextOverride : chapterExtraSkillText;

    const prevChapters = chapters.filter(c => c.chapterNumber < (chapters.find(x => x.id === activeChapterId)?.chapterNumber || 0));

    try {
      // 读取项目的故事记忆（跨章节连续性）
      const fullProject = await db.projects.get(projectId);
      const currentStoryMemory = fullProject?.storyMemory;

      const compiled = compileChapterPrompt({
        outline: project.outline,
        chapterNum: chapters.find(c => c.id === activeChapterId)?.chapterNumber || 1,
        chapterOutline: editingOutline,
        previousChapters: prevChapters,
        skills,
        regenerationPrompt: effectivePrompt,
        extraSkillKeys: chapterExtraSkillKeys,
        extraSkillText: effectiveSkillText,
        storyMemory: currentStoryMemory,
      });

      const recentFeedback = chapterChatMessages
        .filter(m => m.role === 'user')
        .slice(-3)
        .map(m => m.content)
        .join('\n---\n');
      if (recentFeedback && !effectivePrompt) {
        compiled.user += `\n\n【历史修改要求（参考）】\n${recentFeedback}`;
      }

      if (resume && accumulated) {
        compiled.user += `\n--- 已生成但被暂停的正文片段 ---\n${accumulated}\n\n请从该片段最后一句之后继续续写，只输出后续正文，不要重复已经写过的内容。`;
      }

      await runLLMStream('chapter', compiled.system, compiled.user, (tok) => {
        accumulated += tok;
        setEditingContent(accumulated);
      }, streamOptions);

      await db.chapters.update(activeChapterId, {
        content: accumulated,
        lastEdited: Date.now()
      });
      if (!wasPaused) {
        await db.chatMessages.add({ projectId, scope: 'chapter', chapterId: activeChapterId, role: 'assistant', kind: 'chapter', content: accumulated, createdAt: Date.now() });
        // 提取故事记忆（异步，失败不影响主流程）
        const chNum = chapters.find(c => c.id === activeChapterId)?.chapterNumber || 1;
        await extractAndSaveStoryMemory(projectId, accumulated, chNum, currentStoryMemory);
      }
    } catch (e: any) {
      if (isPausedError(e)) {
        wasPaused = true;
        markTaskPaused('chapter');
        setChapterError('已暂停，当前正文草稿已保留。');
        await db.chapters.update(activeChapterId, {
          content: accumulated,
          lastEdited: Date.now(),
        });
      } else {
        setChapterError(e.message);
      }
    } finally {
      setIsGenerating(false);
      finishGenerationTask('chapter', wasPaused);
    }
  };

  const handleExportChapterMarkdown = (ch: Chapter) => {
    const content = ch.id === activeChapterId ? editingDraft : (ch.content || '');
    const clean = stripLogicReview(content);
    if (!clean) { alert('该章节还没有正文。'); return; }
    const title = ch.title || `第 ${ch.chapterNumber} 章`;
    const markdown = `# ${title}\n\n${clean}\n`;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${sanitizeMarkdownFileName(title)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleLogicReviewChapter = async (ch: Chapter, resume = false) => {
    if (!ch.content || ch.content.length < 50) {
      alert('该章节还没有正文，无法进行逻辑审查。');
      return;
    }
    const streamOptions = beginGenerationTask('review', resume);
    setIsGenerating(true);
    if (!resume) setLogicReviewOutput('');
    const logicSkill = skills.find(s => s.key === 'logic_check')?.content || '';
    let acc = resume ? logicReviewOutput : '';
    let wasPaused = false;
    try {
      // 读取项目完整信息作为审查上下文
      const fullProject = await db.projects.get(projectId);
      const compiled = compileLogicReviewPrompt(ch.content, ch.chapterNumber, logicSkill, true, {
        chapterOutline: ch.outlineSection || undefined,
        storyMemory: fullProject?.storyMemory,
        background: fullProject?.background,
        characters: fullProject?.characters,
      });
      await runLLMStream('review', compiled.system, compiled.user, tok => {
        acc += tok;
        setLogicReviewOutput(acc);
      }, streamOptions);
      await db.chapters.update(ch.id!, { logicCheckLog: acc });
      if (!wasPaused) {
        await db.chatMessages.add({ projectId, scope: 'chapter', chapterId: ch.id!, role: 'assistant', kind: 'logic-review', content: acc, createdAt: Date.now() });
      }
    } catch (e: any) {
      if (isPausedError(e)) {
        wasPaused = true;
        markTaskPaused('review');
        if (acc) await db.chapters.update(ch.id!, { logicCheckLog: acc });
      } else {
        alert(`逻辑审查失败：${e.message}`);
      }
    } finally {
      setIsGenerating(false);
      finishGenerationTask('review', wasPaused);
    }
  };

  const handleChapterChatSend = async (userText: string, extraSkillTextOverride?: string) => {
    if (activeChapterId === null) return;
    if (userText.trim()) {
      await db.chatMessages.add({ projectId, scope: 'chapter', chapterId: activeChapterId, role: 'user', content: userText, createdAt: Date.now() });
      setChapterRegenerationPrompt(userText);
      await db.chapters.update(activeChapterId, { regenerationPrompt: userText });
    }
    await handleGenerateChapterStream(false, userText || undefined, extraSkillTextOverride);
  };

  const handleClearChapterChat = async () => {
    if (activeChapterId === null) return;
    await db.chatMessages.where('[projectId+scope+chapterId]').equals([projectId, 'chapter', activeChapterId]).delete();
  };

  const handleUseReviewSuggestion = (reviewContent: string) => {
    // 尝试解析结构化审查结果，提取具体失败项
    const result = parseLogicReviewResult(reviewContent);
    const failedItems = [
      !result.timeline.passed && `时间线问题：${result.timeline.detail}`,
      !result.location.passed && `地点问题：${result.location.detail}`,
      !result.props.passed && `道具问题：${result.props.detail}`,
      !result.characters.passed && `人物问题：${result.characters.detail}`,
      !result.emotionHook.passed && `情感钩子问题：${result.emotionHook.detail}`,
    ].filter(Boolean);

    const prompt = failedItems.length > 0
      ? `根据以下逻辑审查问题重新生成本章：\n${failedItems.join('\n')}`
      : `根据以上逻辑审查建议重新生成本章`;
    handleChapterChatSend(prompt);
  };

  return {
    activeChapterId,
    setActiveChapterId,
    editingTitle,
    setEditingTitle,
    editingOutline,
    setEditingOutline,
    editingDraft,
    setEditingContent,
    chapterError,
    greaseWarnings,
    chapterRegenerationPrompt,
    chapterExtraSkillKeys,
    chapterExtraSkillText,
    chapterChatMessages,
    logicReviewOutput,
    handleSelectChapter,
    handleCreateNewChapter,
    handleDeleteChapter,
    handleClearAllChapters,
    handleSaveChapterManual,
    handleGenerateChapterStream,
    handleExportChapterMarkdown,
    handleLogicReviewChapter,
    handleChapterChatSend,
    handleClearChapterChat,
    handleUseReviewSuggestion,
    setChapterExtraSkillKeys,
    setChapterExtraSkillText,
  };
}
