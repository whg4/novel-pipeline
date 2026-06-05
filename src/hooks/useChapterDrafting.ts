import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { message as antdMessage } from 'antd';
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
  const [chapterExtraSkillTexts, setChapterExtraSkillTexts] = useState<string[]>([]);
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

  // Client-Side AI Grease Detection（评分制）
  useEffect(() => {
    if (!editingDraft) {
      setGreaseWarnings([]);
      return;
    }
    const foundWarnings: string[] = [];
    const badPatterns: { regex: RegExp; label: string; score: number }[] = [
      // ── 微表情套路 ──
      { regex: /眼神.*(暗|深|沉|冷|厉|锐)/g, label: '眼神一暗/变深 (AI 微表情)', score: 1 },
      { regex: /喉结.*(滚动|微动|滑动)/g, label: '喉结滚动 (AI 微表情)', score: 1 },
      { regex: /指尖.*(颤|抖|发白|收紧)/g, label: '指尖发颤 (AI 情绪描写)', score: 1 },
      { regex: /嘴角.*(微微|轻轻|缓缓).*(上扬|勾起|扬起)/g, label: '嘴角微微上扬 (AI 微笑套路)', score: 1 },
      { regex: /眸子.*(暗|深|沉|闪|亮)/g, label: '眸子一暗 (AI 眼神套路)', score: 1 },
      { regex: /眉.*(微蹙|轻蹙|紧锁|拧起)/g, label: '眉头微蹙 (AI 表情套路)', score: 1 },

      // ── 呼吸/身体过渡 ──
      { regex: /深吸.*口气/g, label: '深吸一口气 (AI 呼吸过渡)', score: 1 },
      { regex: /不禁.*(屏住|倒吸|攥紧)/g, label: '不禁屏住呼吸 (AI 过渡)', score: 1 },
      { regex: /拳头.*(攥紧|握紧|收紧)/g, label: '拳头攥紧 (AI 身体反应)', score: 1 },

      // ── 修辞结构 ──
      { regex: /没有.*由于|没有.*迟疑|没有.*犹豫/g, label: '没有一丝犹豫 (AI 决策描述)', score: 1 },
      { regex: /(不单|不仅).*(甚至还|甚至于)/g, label: '不仅...甚至 (AI 修辞)', score: 1 },
      { regex: /没有.*拉扯/g, label: '没有拉扯 (AI 套路总结)', score: 1 },
      { regex: /仿佛.*般|宛如.*般|好似.*般/g, label: '仿佛...般 (AI 比喻结构)', score: 1 },

      // ── 叙事违规 ──
      { regex: /(自我认知|极端荒谬|在.*智谋面前|他不知道的是)/g, label: '上帝视角分析 (违反限知叙述)', score: 2 },
      { regex: /(像是在看.*滑稽|像是在看.*脑萎缩|像看.*傻子)/g, label: '强行刻薄比喻 (违反去油底线)', score: 2 },

      // ── 高频 AI 副词/形容词堆砌 ──
      { regex: /微微/g, label: '「微微」过度使用', score: 1 },
      { regex: /缓缓/g, label: '「缓缓」过度使用', score: 1 },
      { regex: /淡淡/g, label: '「淡淡」过度使用', score: 1 },
      { regex: /悄然/g, label: '「悄然」过度使用', score: 1 },
      { regex: /竟然|居然/g, label: '「竟然/居然」过度使用', score: 1 },
      { regex: /不禁/g, label: '「不禁」过度使用', score: 1 },

      // ── 结构性问题 ──
      { regex: /——.*——/g, label: '连续破折号插入 (AI 注解习惯)', score: 1 },
      { regex: /（[^）]{0,5}注[^）]{0,10}）/g, label: '括号注解 (AI 旁白习惯)', score: 2 },
    ];

    let totalScore = 0;
    badPatterns.forEach(p => {
      const matches = editingDraft.match(p.regex);
      if (matches && matches.length > 0) {
        const count = matches.length;
        const penalty = Math.min(count, 3); // 单个模式最多扣 3 分
        totalScore += penalty * p.score;
        foundWarnings.push(`${p.label} ×${count}`);
      }
    });

    // 额外：短句重复检测（连续 3 句都是 5 字以下的短句）
    const sentences = editingDraft.split(/[。！？\n]+/).filter(s => s.trim().length > 0);
    let shortStreak = 0;
    for (const s of sentences) {
      if (s.trim().length <= 5) {
        shortStreak++;
        if (shortStreak >= 3) {
          foundWarnings.push('连续短句重复 (AI 节奏单一)');
          totalScore += 2;
          break;
        }
      } else {
        shortStreak = 0;
      }
    }

    // 将评分附加到第一条警告
    if (foundWarnings.length > 0) {
      const scoreLabel = totalScore <= 5 ? '低' : totalScore <= 15 ? '中' : '高';
      foundWarnings.unshift(`AI 味评分: ${totalScore} (${scoreLabel}) — ${foundWarnings.length} 项问题`);
    }

    setGreaseWarnings(foundWarnings);
  }, [editingDraft]);

  // ── 自动保存（编辑后 2 秒 debounce）──
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDraftRef = useRef<string>('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saved'>('idle');
  const isLocalGeneratingRef = useRef(false);

  useEffect(() => {
    // 生成中不自动保存（由生成流程自行保存，避免竞态覆盖）
    if (!activeChapterId || !editingDraft || isLocalGeneratingRef.current) return;
    // 内容未变化则跳过
    if (editingDraft === lastSavedDraftRef.current) return;

    setSaveStatus('pending');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      // 从 DB 读取最新版本历史（避免与手动保存竞态）
      const latestCh = await db.chapters.get(activeChapterId);
      if (!latestCh || latestCh.content === editingDraft) { setSaveStatus('idle'); return; }
      const updatedHistory = [...(latestCh.versionHistory || [])];
      if (latestCh.content) {
        updatedHistory.push({ content: latestCh.content, timestamp: Date.now() });
      }
      await db.chapters.update(activeChapterId, {
        content: editingDraft,
        versionHistory: updatedHistory.slice(-5),
        lastEdited: Date.now(),
      });
      lastSavedDraftRef.current = editingDraft;
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, 2000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [editingDraft, activeChapterId]);

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
    antdMessage.success('草稿已保存。');
  };

  const handleGenerateChapterStream = async (resume = false, promptOverride?: string, extraSkillTextOverride?: string) => {
    if (activeChapterId === null || !project) return;
    const streamOptions = beginGenerationTask('chapter', resume);
    isLocalGeneratingRef.current = true;
    setIsGenerating(true);
    setChapterError(null);
    if (!resume) setEditingContent('');
    let accumulated = resume ? editingDraft : '';
    let wasPaused = false;
    const effectivePrompt = promptOverride !== undefined ? promptOverride : chapterRegenerationPrompt;
    const effectiveSkillText = extraSkillTextOverride !== undefined ? extraSkillTextOverride : chapterExtraSkillTexts.join('\n\n');

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
        genre: project.genre,
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
        // 截断检测：正文不以句末标点结束时警告
        const trimmed = accumulated.trim();
        if (trimmed.length > 100 && !/[。！？…」』"'")\]】]$/.test(trimmed)) {
          antdMessage.warning('正文可能被截断（未以句末标点结束），请检查末尾是否完整');
        }
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
      isLocalGeneratingRef.current = false;
      setIsGenerating(false);
      finishGenerationTask('chapter', wasPaused);
    }
  };

  const handleExportChapterMarkdown = (ch: Chapter) => {
    const content = ch.id === activeChapterId ? editingDraft : (ch.content || '');
    const clean = stripLogicReview(content);
    if (!clean) { antdMessage.warning('该章节还没有正文。'); return; }
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
      antdMessage.warning('该章节还没有正文，无法进行逻辑审查。');
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
        antdMessage.error(`逻辑审查失败：${e.message}`);
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

  // 编辑重发：删除该消息及之后的所有消息，用新内容重新发送
  const handleEditResendChapter = async (messageId: number, newContent: string) => {
    if (activeChapterId === null) return;
    const allMsgs = await db.chatMessages
      .where('[projectId+scope+chapterId]').equals([projectId, 'chapter', activeChapterId]).sortBy('createdAt');
    const idx = allMsgs.findIndex(m => m.id === messageId);
    if (idx === -1) return;
    const toDelete = allMsgs.slice(idx).filter(m => m.id != null).map(m => m.id!);
    if (toDelete.length > 0) await db.chatMessages.bulkDelete(toDelete);
    await handleChapterChatSend(newContent);
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
    chapterExtraSkillTexts,
    saveStatus,
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
    handleEditResendChapter,
    handleUseReviewSuggestion,
    setChapterExtraSkillKeys,
    setChapterExtraSkillTexts,
  };
}
