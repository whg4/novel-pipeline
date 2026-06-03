import { useState, useEffect, useRef } from 'react';
import { message as antdMessage } from 'antd';
import { db } from '../db';
import type { Project, Skill } from '../types';
import {
  runLLMStream, compileOutlinePrompt, compileChapterPrompt, compileBlurbPrompt,
  compileTitlePrompt, compileCoverPrompt, compileLogicReviewPrompt,
  parseLogicReviewResult,
  validateOutlineAgainstChecklist, OUTLINE_CHECKLIST_ITEMS,
  extractAndSaveStoryMemory,
  LLM_PAUSED_ERROR
} from '../services/llm';
import { syncOutlineChaptersToDb } from '../utils/pipeline';
import type { GenerationTask } from './usePipelineTask';

const OUTLINE_MAX_ATTEMPTS = 3;

type AutoPipelinePhase = 'outline' | 'sync' | 'chapter' | 'review' | 'blurb' | 'title' | 'cover' | 'done';
interface AutoPipelineResumeState {
  phase: AutoPipelinePhase;
  currentOutline: string;
  outlineAttempt: number;
  validationFeedback: string;
  chapterIndex: number;
  chapterId?: number;
  partialText: string;
  totalSteps: number;
}

const AUTO_PHASE_ORDER: Record<AutoPipelinePhase, number> = {
  outline: 0, sync: 1, chapter: 2, review: 3, blurb: 4, title: 5, cover: 6, done: 7,
};

const AUTO_RESUME_STORAGE_PREFIX = 'novel_pipeline_auto_resume_state';

function getAutoResumeStorageKey(projectId: number): string {
  return `${AUTO_RESUME_STORAGE_PREFIX}:${projectId}`;
}

function loadAutoResumeState(projectId: number): AutoPipelineResumeState | null {
  try {
    const raw = localStorage.getItem(getAutoResumeStorageKey(projectId));
    return raw ? JSON.parse(raw) as AutoPipelineResumeState : null;
  } catch {
    return null;
  }
}

function saveAutoResumeState(projectId: number, state: AutoPipelineResumeState) {
  localStorage.setItem(getAutoResumeStorageKey(projectId), JSON.stringify(state));
}

function clearAutoResumeState(projectId: number) {
  localStorage.removeItem(getAutoResumeStorageKey(projectId));
}

function getAutoProgressCurrent(state: AutoPipelineResumeState): number {
  if (state.phase === 'outline') return 1;
  if (state.phase === 'sync') return 2;
  if (state.phase === 'chapter') return 2 + state.chapterIndex * 2 + 1;
  if (state.phase === 'review') return 2 + state.chapterIndex * 2 + 2;
  if (state.phase === 'blurb') return Math.max(1, state.totalSteps - 1);
  if (state.phase === 'title' || state.phase === 'cover') return state.totalSteps;
  return state.totalSteps;
}

interface TaskControl {
  beginGenerationTask: (task: GenerationTask, resume?: boolean) => import('../services/llm').LLMStreamOptions;
  isPausedError: (error: any) => boolean;
  markTaskPaused: (task: GenerationTask, message?: string) => void;
  finishGenerationTask: (task: GenerationTask, paused?: boolean) => void;
  pausedTaskRef: React.MutableRefObject<GenerationTask | null>;
}

/** 外部 hook 提供的 UI 状态设置器 */
interface UISetters {
  setGenerationOutput: (v: string) => void;
  setEditingContent: (v: string) => void;
  setBlurbsOutput: (v: string) => void;
  setTitleOutput: (v: string) => void;
  setCoverPrompt: (v: string) => void;
  setPausedTask: (v: GenerationTask | null) => void;
  setPauseMessage: (v: string) => void;
  setIsGenerating: (v: boolean) => void;
}

export function useAutoPipeline(
  projectId: number,
  project: Project | undefined,
  skills: Skill[],
  taskControl: TaskControl,
  uiSetters: UISetters,
  activeChapterId: number | null,
) {
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState<{ step: string; current: number; total: number } | null>(null);
  const autoResumeRef = useRef<AutoPipelineResumeState | null>(null);
  const autoPauseRef = useRef(false);

  // 恢复中断的自动流水线
  useEffect(() => {
    const savedAutoState = loadAutoResumeState(projectId);
    if (!savedAutoState || savedAutoState.phase === 'done') return;

    autoResumeRef.current = savedAutoState;
    uiSetters.setPausedTask('auto');
    uiSetters.setPauseMessage('检测到未完成的一键全自动任务，点击继续将从当前步骤接着执行。');
    setAutoProgress({
      step: '已暂停（点击继续）',
      current: getAutoProgressCurrent(savedAutoState),
      total: savedAutoState.totalSteps || 7,
    });

    if (savedAutoState.partialText) {
      if (savedAutoState.phase === 'outline') uiSetters.setGenerationOutput(savedAutoState.partialText);
      if (savedAutoState.phase === 'blurb') uiSetters.setBlurbsOutput(savedAutoState.partialText);
      if (savedAutoState.phase === 'title') uiSetters.setTitleOutput(savedAutoState.partialText);
      if (savedAutoState.phase === 'cover') uiSetters.setCoverPrompt(savedAutoState.partialText);
    }
  }, [projectId]);

  const handleRunAutoPipeline = async (resume = false, startFromChapter?: number) => {
    if (!project) return;
    const streamOptions = taskControl.beginGenerationTask('auto', resume);
    const savedAutoState = resume ? autoResumeRef.current ?? loadAutoResumeState(projectId) : null;
    const autoState: AutoPipelineResumeState = savedAutoState
      ? savedAutoState
      : {
        phase: startFromChapter != null
          ? 'chapter'
          : project.outline && project.outline.length >= 50 ? 'sync' : 'outline',
        currentOutline: project.outline || '',
        outlineAttempt: 1,
        validationFeedback: '',
        chapterIndex: startFromChapter ?? 0,
        partialText: '',
        totalSteps: 7,
      };
    autoResumeRef.current = autoState;

    setIsAutoRunning(true);
    uiSetters.setIsGenerating(true);
    autoPauseRef.current = false;
    let wasPaused = false;

    const checkPause = () => {
      if (autoPauseRef.current || taskControl.pausedTaskRef.current === 'auto') throw new Error(LLM_PAUSED_ERROR);
    };

    try {
      const logicSkill = skills.find(s => s.key === 'logic_check')?.content || '';
      const blurbSkill = skills.find(s => s.key === 'blurb')?.content || '';
      const outlineTemplate = skills.find(s => s.key === 'outline_template')?.content || '';

      // 加载当前故事记忆
      const currentProject = await db.projects.get(projectId);
      let currentStoryMemory = currentProject?.storyMemory;

      // Step 1: 生成大纲（结构化验证）
      let currentOutline = autoState.currentOutline || project.outline;
      if (AUTO_PHASE_ORDER[autoState.phase] <= AUTO_PHASE_ORDER.outline && (!currentOutline || currentOutline.length < 50 || autoState.partialText)) {

        for (let attempt = autoState.outlineAttempt; attempt <= OUTLINE_MAX_ATTEMPTS; attempt++) {
          autoState.phase = 'outline';
          autoState.outlineAttempt = attempt;
          setAutoProgress({ step: `生成大纲（第 ${attempt}/${OUTLINE_MAX_ATTEMPTS} 轮）`, current: 1, total: 7 });
          const resumingOutline = resume && autoState.partialText && autoState.outlineAttempt === attempt;
          uiSetters.setGenerationOutput(resumingOutline ? autoState.partialText : '');

          const wolfSkill = project.genre === 'classic-wolf'
            ? (skills.find(s => s.key === 'wolf_setting')?.content || undefined)
            : undefined;
          const slapSkill = project.genre === 'female-slap'
            ? (skills.find(s => s.key === 'female_slap')?.content || undefined)
            : undefined;
          const compiled = compileOutlinePrompt(
            project.rawExample,
            project.background,
            project.characters,
            outlineTemplate,
            autoState.validationFeedback || undefined,
            wolfSkill,
            slapSkill,
            [],
            '',
            skills,
          );
          if (resumingOutline) {
            compiled.user += `\n--- 已生成但暂停的大纲片段 ---\n${autoState.partialText}\n\n请从该片段后继续补全，不要重写已经输出的部分。`;
          }
          let acc = resumingOutline ? autoState.partialText : '';
          await runLLMStream('outline', compiled.system, compiled.user, tok => {
            acc += tok;
            autoState.partialText = acc;
            autoState.currentOutline = acc;
            uiSetters.setGenerationOutput(acc);
          }, streamOptions);
          currentOutline = acc;
          autoState.currentOutline = acc;
          autoState.partialText = '';
          checkPause();

          // 结构化审查大纲（替代正则匹配）
          setAutoProgress({ step: `结构化审查大纲（第 ${attempt}/${OUTLINE_MAX_ATTEMPTS} 轮）`, current: 1, total: 7 });
          const templateSkill = skills.find(s => s.key === 'outline_template')?.content || '';
          const validationResult = await validateOutlineAgainstChecklist(
            acc,
            OUTLINE_CHECKLIST_ITEMS,
            templateSkill,
            { background: project.background, characters: project.characters, rawExample: project.rawExample },
            attempt,
          );
          checkPause();

          if (validationResult.passed || attempt === OUTLINE_MAX_ATTEMPTS) {
            await db.projects.update(projectId, {
              outline: acc,
              outlineValidationResult: validationResult,
              outlineValidationStatus: validationResult.passed ? 'valid' : 'invalid',
              outlineValidationUpdatedAt: Date.now(),
            });
            autoState.phase = 'sync';
            autoState.outlineAttempt = 1;
            autoState.validationFeedback = '';
            break;
          }

          // 构造结构化反馈
          const failedFeedback = validationResult.items
            .filter(item => !item.passed)
            .map(item => `- [${item.key}] ${item.reason}`)
            .join('\n');
          autoState.validationFeedback = `以下自检项未通过，请重点修正：\n${failedFeedback}`;
          autoState.outlineAttempt = attempt + 1;
          checkPause();
        }
        checkPause();
      }

      // Step 2: 解析并同步章节结构
      if (AUTO_PHASE_ORDER[autoState.phase] <= AUTO_PHASE_ORDER.sync) {
        autoState.phase = 'sync';
        setAutoProgress({ step: '解析章节结构', current: 2, total: 7 });
        const { count: parsedCount, staleChapters } = await syncOutlineChaptersToDb(currentOutline, projectId);
        if (staleChapters.length > 0) {
          antdMessage.info(`第 ${staleChapters.join('、')} 章大纲已变更，将重新生成正文`);
        }
        if (parsedCount === 0) {
          throw new Error(
            '未能从大纲中解析出章节。请确认大纲中每个章节标题使用以下格式之一：\n' +
            '- ### 第 1 章：标题\n' +
            '- ## 第一章：标题\n' +
            '- ### 第二章-标题'
          );
        }
        autoState.phase = 'chapter';
        autoState.partialText = '';
        checkPause();
      }

      // Step 3-N: 逐章生成正文 + 逻辑审查
      const allChapters = await db.chapters
        .where('projectId').equals(projectId)
        .sortBy('chapterNumber');

      const totalSteps = 2 + allChapters.length * 2 + 2;
      autoState.totalSteps = totalSteps;

      if (AUTO_PHASE_ORDER[autoState.phase] <= AUTO_PHASE_ORDER.review) {
        const startIndex = (
          autoState.phase === 'chapter' || autoState.phase === 'review'
        ) ? autoState.chapterIndex : (() => {
          const firstIncomplete = allChapters.findIndex(
            ch => !ch.content || ch.content.length < 100 || !ch.logicCheckLog
          );
          return firstIncomplete === -1 ? allChapters.length : firstIncomplete;
        })();
        for (let i = startIndex; i < allChapters.length; i++) {
          const ch = allChapters[i];
          const prevChs = allChapters.slice(0, i);
          const resumingChapter = resume && autoState.phase === 'chapter' && autoState.chapterIndex === i && autoState.partialText;

          setAutoProgress({ step: `生成第 ${ch.chapterNumber} 章正文`, current: 2 + i * 2 + 1, total: totalSteps });
          if (resumingChapter || !ch.content || ch.content.length < 100) {
            autoState.phase = 'chapter';
            autoState.chapterIndex = i;
            autoState.chapterId = ch.id;
            const chComp = compileChapterPrompt({
              outline: currentOutline,
              chapterNum: ch.chapterNumber,
              chapterOutline: ch.outlineSection,
              previousChapters: prevChs,
              skills,
              regenerationPrompt: ch.regenerationPrompt || '',
              extraSkillKeys: ch.extraSkillKeys || [],
              extraSkillText: ch.extraSkillText || '',
              storyMemory: currentStoryMemory,
              genre: project.genre,
            });
            if (resumingChapter) {
              chComp.user += `\n--- 已生成但暂停的正文片段 ---\n${autoState.partialText}\n\n请从该片段最后一句之后继续续写，只输出后续正文，不要重复已经写过的内容。`;
            }
            let draftAcc = resumingChapter ? autoState.partialText : '';
            await runLLMStream('chapter', chComp.system, chComp.user, tok => {
              draftAcc += tok;
              autoState.partialText = draftAcc;
              if (activeChapterId === ch.id) uiSetters.setEditingContent(draftAcc);
            }, streamOptions);
            await db.chapters.update(ch.id!, { content: draftAcc, lastEdited: Date.now() });
            allChapters[i] = { ...ch, content: draftAcc };
            autoState.partialText = '';
            if (activeChapterId === ch.id) uiSetters.setEditingContent(draftAcc);

            // 提取故事记忆（异步，失败不影响主流程）
            currentStoryMemory = await extractAndSaveStoryMemory(
              projectId, draftAcc, ch.chapterNumber, currentStoryMemory,
            );
          }
          checkPause();

          setAutoProgress({ step: `审查第 ${ch.chapterNumber} 章逻辑`, current: 2 + i * 2 + 2, total: totalSteps });
          const content = allChapters[i].content;
          const resumingReview = resume && autoState.phase === 'review' && autoState.chapterIndex === i && !!autoState.partialText;
          const needsReview = resumingReview || !allChapters[i].logicCheckLog;
          if (content && logicSkill && needsReview) {
            autoState.phase = 'review';
            autoState.chapterIndex = i;
            autoState.chapterId = ch.id;
            const reviewComp = compileLogicReviewPrompt(content, ch.chapterNumber, logicSkill, true, {
              chapterOutline: ch.outlineSection || undefined,
              storyMemory: currentStoryMemory,
              background: project.background,
              characters: project.characters,
            });
            if (resumingReview) {
              reviewComp.user += `\n--- 已生成但暂停的审查片段 ---\n${autoState.partialText}\n\n请从该片段后继续补全审查报告，不要重复已经输出的部分。`;
            }
            let reviewAcc = resumingReview ? autoState.partialText : '';
            await runLLMStream('review', reviewComp.system, reviewComp.user, tok => {
              reviewAcc += tok;
              autoState.partialText = reviewAcc;
            }, streamOptions);
            await db.chapters.update(ch.id!, { logicCheckLog: reviewAcc });
            autoState.partialText = '';
            checkPause();

            // 审查驱动自动重写：若时间线或人物行为有冲突，自动重写并重新审查（最多 2 轮）
            const MAX_REWRITE_ROUNDS = 2;
            for (let round = 0; round < MAX_REWRITE_ROUNDS; round++) {
              const reviewResult = parseLogicReviewResult(reviewAcc);
              const criticalFailures = [
                !reviewResult.timeline.passed && `时间线问题：${reviewResult.timeline.detail}`,
                !reviewResult.characters.passed && `人物行为问题：${reviewResult.characters.detail}`,
                !reviewResult.location.passed && `地点矛盾：${reviewResult.location.detail}`,
                !reviewResult.props.passed && `道具问题：${reviewResult.props.detail}`,
              ].filter(Boolean);
              // emotionHook 仅记录不触发重写（章末钩子缺失不值得完全重写）

              if (criticalFailures.length === 0) break;

              setAutoProgress({
                step: `修正第 ${ch.chapterNumber} 章（第 ${round + 1} 轮）`,
                current: 2 + i * 2 + 2, total: totalSteps,
              });

              // 用审查失败项作为重写指令，附上原文让模型定向修正而非从头重写
              const currentContent = allChapters[i].content || '';
              const rewritePrompt = `以下是需要修正的当前正文：\n${currentContent.slice(-2000)}\n\n请针对以下问题定向修正（保持其他未提及的部分基本不变）：\n${criticalFailures.join('\n')}`;
              const rewriteComp = compileChapterPrompt({
                outline: currentOutline,
                chapterNum: ch.chapterNumber,
                chapterOutline: ch.outlineSection,
                previousChapters: prevChs,
                skills,
                regenerationPrompt: rewritePrompt,
                extraSkillKeys: ch.extraSkillKeys || [],
                extraSkillText: ch.extraSkillText || '',
                storyMemory: currentStoryMemory,
                genre: project.genre,
              });
              let rewriteAcc = '';
              await runLLMStream('chapter', rewriteComp.system, rewriteComp.user, tok => {
                rewriteAcc += tok;
              }, streamOptions);
              await db.chapters.update(ch.id!, { content: rewriteAcc, lastEdited: Date.now() });
              allChapters[i] = { ...allChapters[i], content: rewriteAcc };
              if (activeChapterId === ch.id) uiSetters.setEditingContent(rewriteAcc);
              checkPause();

              // 重新审查
              const reReviewComp = compileLogicReviewPrompt(rewriteAcc, ch.chapterNumber, logicSkill, true, {
                chapterOutline: ch.outlineSection || undefined,
                storyMemory: currentStoryMemory,
                background: project.background,
                characters: project.characters,
              });
              reviewAcc = '';
              await runLLMStream('review', reReviewComp.system, reReviewComp.user, tok => {
                reviewAcc += tok;
              }, streamOptions);
              await db.chapters.update(ch.id!, { logicCheckLog: reviewAcc });
              checkPause();
            }

            // 重写后重新提取故事记忆（用最终版本更新记忆）
            const finalContent = allChapters[i].content;
            if (finalContent) {
              currentStoryMemory = await extractAndSaveStoryMemory(
                projectId, finalContent, ch.chapterNumber, currentStoryMemory,
              );
            }
          }
          autoState.phase = 'chapter';
          autoState.chapterIndex = i + 1;
          checkPause();
        }
        autoState.phase = 'blurb';
        autoState.partialText = '';
      }

      // 生成简介
      if (AUTO_PHASE_ORDER[autoState.phase] <= AUTO_PHASE_ORDER.blurb) {
        autoState.phase = 'blurb';
        setAutoProgress({ step: '生成爆款简介', current: totalSteps - 1, total: totalSteps });
        const latestChapters = await db.chapters.where('projectId').equals(projectId).sortBy('chapterNumber');
        const sampleText = latestChapters.slice(0, 3).map(c => c.content).join('\n\n');
        const blurbComp = compileBlurbPrompt(currentOutline, sampleText, blurbSkill, {
          background: project.background,
          characters: project.characters,
        });
        let blurbAcc = resume && autoState.partialText ? autoState.partialText : '';
        await runLLMStream('marketing', blurbComp.system, blurbComp.user, tok => {
          blurbAcc += tok;
          autoState.partialText = blurbAcc;
          uiSetters.setBlurbsOutput(blurbAcc);
        }, streamOptions);
        autoState.partialText = '';
        autoState.phase = 'title';
        checkPause();
      }

      // 生成书名与封面
      if (AUTO_PHASE_ORDER[autoState.phase] <= AUTO_PHASE_ORDER.title) {
        autoState.phase = 'title';
        setAutoProgress({ step: '生成书名', current: totalSteps, total: totalSteps });
        const titleComp = compileTitlePrompt(currentOutline, undefined, project.genre);
        let titleAcc = resume && autoState.partialText ? autoState.partialText : '';
        await runLLMStream('marketing', titleComp.system, titleComp.user, tok => {
          titleAcc += tok;
          autoState.partialText = titleAcc;
          uiSetters.setTitleOutput(titleAcc);
        }, streamOptions);
        await db.projects.update(projectId, { titleCandidates: titleAcc });
        uiSetters.setTitleOutput(titleAcc);
        autoState.partialText = '';
        autoState.phase = 'cover';
      }

      if (AUTO_PHASE_ORDER[autoState.phase] <= AUTO_PHASE_ORDER.cover) {
        autoState.phase = 'cover';
        setAutoProgress({ step: '生成封面提示词', current: totalSteps, total: totalSteps });
        const coverComp = compileCoverPrompt(currentOutline, project.genre, {
          background: project.background,
          characters: project.characters,
        });
        let coverAcc = resume && autoState.partialText ? autoState.partialText : '';
        await runLLMStream('marketing', coverComp.system, coverComp.user, tok => {
          coverAcc += tok;
          autoState.partialText = coverAcc;
          uiSetters.setCoverPrompt(coverAcc);
        }, streamOptions);
        await db.projects.update(projectId, { coverPrompt: coverAcc });
        uiSetters.setCoverPrompt(coverAcc);
        autoState.partialText = '';
      }

      autoState.phase = 'done';
      autoResumeRef.current = null;
      clearAutoResumeState(projectId);
      setAutoProgress({ step: '全部完成 ✓', current: totalSteps, total: totalSteps });
    } catch (e: any) {
      if (taskControl.isPausedError(e)) {
        wasPaused = true;
        if (autoState.partialText) {
          if (autoState.phase === 'outline') {
            await db.projects.update(projectId, { outline: autoState.partialText, outlineValidationUpdatedAt: Date.now() });
          } else if ((autoState.phase === 'chapter' || autoState.phase === 'review') && autoState.chapterId) {
            await db.chapters.update(autoState.chapterId, autoState.phase === 'chapter'
              ? { content: autoState.partialText, lastEdited: Date.now() }
              : { logicCheckLog: autoState.partialText });
          } else if (autoState.phase === 'title') {
            await db.projects.update(projectId, { titleCandidates: autoState.partialText });
          } else if (autoState.phase === 'cover') {
            await db.projects.update(projectId, { coverPrompt: autoState.partialText });
          }
        }
        saveAutoResumeState(projectId, autoState);
        taskControl.markTaskPaused('auto', '已暂停，点击继续将从当前步骤接着执行。');
        uiSetters.setPausedTask('auto');
        uiSetters.setPauseMessage('已暂停，点击继续将从当前步骤接着执行。');
        setAutoProgress(prev => prev ? { ...prev, step: '已暂停（点击继续）' } : null);
      } else {
        antdMessage.error(`自动流水线执行出错：${e.message}`);
        autoResumeRef.current = null;
        clearAutoResumeState(projectId);
        setAutoProgress(null);
      }
    } finally {
      setIsAutoRunning(false);
      uiSetters.setIsGenerating(false);
      taskControl.finishGenerationTask('auto', wasPaused);
    }
  };

  return {
    isAutoRunning,
    autoProgress,
    autoResumeRef,
    autoPauseRef,
    setAutoProgress,
    handleRunAutoPipeline,
  };
}

export { loadAutoResumeState, getAutoProgressCurrent };
