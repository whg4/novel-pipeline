import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Chapter, ChatMessage } from '../types';
import {
  runLLMStream, compileOutlinePrompt, compileOutlineLogicReviewPrompt,
  compileChapterPrompt, compileBlurbPrompt,
  compileLogicReviewPrompt, compileTitlePrompt, compileCoverPrompt,
  LLM_PAUSED_ERROR
} from '../services/llm';
import { renderMarkdown } from '../utils/markdown';
import {
  Sparkles, BookOpen, Layers, Edit3, Plus, Save, Copy, FileUp,
  AlertTriangle, RefreshCw, Play, Pause, FileSearch, ImageIcon, Download,
  PenLine, Eye, X
} from 'lucide-react';
import ChatPanel from '../components/ChatPanel';
import TitleModal from '../components/TitleModal';
import ExampleModal from '../components/ExampleModal';
import OutlineEditorModal from '../components/OutlineEditorModal';

interface PipelineViewProps {
  projectId: number;
}

const OUTLINE_MAX_ATTEMPTS = 3;

type GenerationTask = 'auto' | 'outline' | 'outline-review' | 'chapter' | 'review' | 'marketing' | 'title';
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
  outline: 0,
  sync: 1,
  chapter: 2,
  review: 3,
  blurb: 4,
  title: 5,
  cover: 6,
  done: 7,
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



// Strip non-narrative content: logic review (after ---) and optional content sections
function stripLogicReview(content: string): string {
  // Strip at first horizontal rule used as separator
  let result = content;
  const hrIndex = content.indexOf('\n---');
  if (hrIndex !== -1) result = content.substring(0, hrIndex);
  else if (content.startsWith('---')) result = '';

  // Also strip any trailing optional content blocks
  const optionalPatterns = [
    /\n可选[：:：]/,
    /\n（可选）/,
    /\n【可选[^】]*】/,
    /\n\[可选[^\]]*\]/,
    /\n可选内容[：:：\s]/,
    /\n可选场景[：:：\s]/,
  ];
  for (const pat of optionalPatterns) {
    const m = pat.exec(result);
    if (m) result = result.substring(0, m.index);
  }

  return result.trim();
}

// 将大纲拆成主体（一~三）、自检清单（四）、可选附录（五）三部分
function splitOutlineSections(outline: string): { preamble: string; main: string; checklist: string; appendix: string } {
  const idxOne  = outline.search(/\n##\s*一[、,，.]/);
  const idxFour = outline.search(/\n##\s*四[、,，.]/);
  const idxFive = outline.search(/\n##\s*五[、,，.]/);
  const preamble = idxOne > 0 ? outline.slice(0, idxOne).trim() : '';
  const mainStart = idxOne > 0 ? idxOne : 0;
  if (idxFour === -1) return { preamble, main: outline.slice(mainStart).trim(), checklist: '', appendix: '' };
  const main = outline.slice(mainStart, idxFour).trim();
  if (idxFive === -1) return { preamble, main, checklist: outline.slice(idxFour).trim(), appendix: '' };
  return {
    preamble,
    main,
    checklist: outline.slice(idxFour, idxFive).trim(),
    appendix: outline.slice(idxFive).trim(),
  };
}

function sanitizeMarkdownFileName(name: string): string {
  return (name || '小说正文')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '小说正文';
}

// 从大纲文本解析章节（格式：### 第 X 章：标题 或 ### 第X章:标题）
function parseOutlineChapters(
  outline: string
): { chapterNumber: number; title: string; outlineSection: string }[] {
  const pattern = /###\s*第\s*(\d+)\s*章[：:]\s*([^\n]+)/g;
  const positions: { num: number; title: string; start: number }[] = [];
  let match;
  while ((match = pattern.exec(outline)) !== null) {
    positions.push({ num: parseInt(match[1], 10), title: match[2].trim(), start: match.index });
  }
  return positions.map((pos, i) => {
    const end = i + 1 < positions.length ? positions[i + 1].start : outline.length;
    return {
      chapterNumber: pos.num,
      title: pos.title,
      outlineSection: outline.slice(pos.start, end).trim(),
    };
  });
}

// 将解析结果写入数据库（已存在的章节不覆盖正文内容）
async function syncOutlineChaptersToDb(outline: string, projectId: number): Promise<number> {
  const parsed = parseOutlineChapters(outline);
  if (parsed.length === 0) return 0;
  for (const p of parsed) {
    const existing = await db.chapters
      .where('projectId').equals(projectId)
      .and(c => c.chapterNumber === p.chapterNumber)
      .first();
    if (!existing) {
      await db.chapters.add({
        projectId,
        chapterNumber: p.chapterNumber,
        title: `第 ${p.chapterNumber} 章：${p.title}`,
        outlineSection: p.outlineSection,
        content: '',
        isCompleted: false,
        versionHistory: [],
        lastEdited: Date.now(),
      });
    } else if (!existing.outlineSection || existing.outlineSection.length < 20) {
      await db.chapters.update(existing.id!, { outlineSection: p.outlineSection });
    }
  }
  return parsed.length;
}

export default function PipelineView({ projectId }: PipelineViewProps) {
  // Chapter selection — must be declared before useLiveQuery hooks that depend on it
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null);

  // Query state
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const chapters = useLiveQuery(() => db.chapters.where('projectId').equals(projectId).sortBy('chapterNumber'), [projectId]) || [];

  // Sync project title into editing state when project first loads
  useEffect(() => {
    if (project?.title && !editingProjectTitle) {
      setEditingProjectTitle(project.title);
    }
  }, [project?.title]);
  const skills = useLiveQuery(() => db.skills.toArray()) || [];

  // Chat message history
  const outlineChatMessages: ChatMessage[] = useLiveQuery<ChatMessage[], ChatMessage[]>(
    () => db.chatMessages.where('[projectId+scope]').equals([projectId, 'outline']).sortBy('createdAt') as any,
    [projectId],
    []
  );

  const chapterChatMessages: ChatMessage[] = useLiveQuery<ChatMessage[], ChatMessage[]>(
    () => activeChapterId
      ? db.chatMessages.where('[projectId+scope+chapterId]').equals([projectId, 'chapter', activeChapterId]).sortBy('createdAt') as any
      : Promise.resolve([]),
    [projectId, activeChapterId],
    []
  );

  // View States
  const [pipelineTab, setPipelineTab] = useState<'outline' | 'drafting' | 'marketing'>('outline');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTask, setActiveTask] = useState<GenerationTask | null>(null);
  const [pausedTask, setPausedTask] = useState<GenerationTask | null>(null);
  const [pauseMessage, setPauseMessage] = useState('');
  const [generationOutput, setGenerationOutput] = useState('');

  // ----------------------------------------------------
  // SUB-TAB 1: OUTLINE STUDIO STATE
  // ----------------------------------------------------
  const [outlineGenerationStatus, setOutlineGenerationStatus] = useState('');
  const [outlineReviewOutput, setOutlineReviewOutput] = useState('');
  const [outlineFeedback, _setOutlineFeedback] = useState('');
  const [outlineExtraSkillKeys, setOutlineExtraSkillKeys] = useState<string[]>([]);
  const [outlineExtraSkillText, setOutlineExtraSkillText] = useState('');

  // ----------------------------------------------------
  // SUB-TAB 2: DRAFTING ROOM STATE
  // ----------------------------------------------------
  const [editingTitle, setEditingTitle] = useState('');
  const [editingOutline, setEditingOutline] = useState('');
  const [editingDraft, setEditingContent] = useState('');
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [greaseWarnings, setGreaseWarnings] = useState<string[]>([]);
  const [chapterRegenerationPrompt, setChapterRegenerationPrompt] = useState('');
  const [chapterExtraSkillKeys, setChapterExtraSkillKeys] = useState<string[]>([]);
  const [chapterExtraSkillText, setChapterExtraSkillText] = useState('');
  const [editingProjectTitle, setEditingProjectTitle] = useState('');

  // ----------------------------------------------------
  // UI: MODAL + POPOVER STATE
  // ----------------------------------------------------
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [showExampleModal, setShowExampleModal] = useState(false);
  const [showOutlineEditor, setShowOutlineEditor] = useState(false);
  const [showChapterOutlineEditor, setShowChapterOutlineEditor] = useState(false);
  const [showOutlineSkillPopover, setShowOutlineSkillPopover] = useState(false);
  const [showChapterSkillPopover, setShowChapterSkillPopover] = useState(false);
  const [viewingChapter, setViewingChapter] = useState<{ title: string; content: string } | null>(null);

  // Load first chapter automatically on startup if none selected
  useEffect(() => {
    if (chapters.length > 0 && activeChapterId === null) {
      const first = chapters[0];
      if (first.id) handleSelectChapter(first);
    }
  }, [chapters]);

  // Client-Side AI Greasing Text Analyzer (Auto runs on typing draft inside Drafting Room)
  useEffect(() => {
    if (!editingDraft) {
      setGreaseWarnings([]);
      return;
    }
    const foundWarnings: string[] = [];
    const badPatterns = [
      { regex: /眼神.*(暗|深|沉)/i, label: '“眼神一暗/变深” (Classic AI micro-expression cliché)' },
      { regex: /喉结.*(滚动|微动)/i, label: '“喉结滚动” (Oclushed AI micro-expression cliché)' },
      { regex: /指尖.*(颤|抖)/i, label: '“指尖发颤” (Cliché physical emotional highlight)' },
      { regex: /深吸.*口气/i, label: '“深吸一口气” (Frequent AI breath transition)' },
      { regex: /没有.*由于|没有.*迟疑/i, label: '“没有一丝犹豫” (Repetitive AI decision description)' },
      { regex: /(不单|不仅).*(甚至连)/i, label: '“不仅...甚至连...” (Pretentious AI rhetorical structure)' },
      { regex: /没有.*拉扯/i, label: '“没有拉扯” (AI pattern summary)' },
      { regex: /(自我认知|极端荒谬|在.*智谋面前|他不知道的是)/i, label: '“上帝视角分析” (Violates First-person/limited narrative constraints)' },
      { regex: /(像是在看.*滑稽|像是在看.*脑萎缩)/i, label: '“强行生硬刻薄比喻” (Violating clean anti-grease line)' }
    ];

    badPatterns.forEach(p => {
      if (p.regex.test(editingDraft)) {
        foundWarnings.push(p.label);
      }
    });

    setGreaseWarnings(foundWarnings);
  }, [editingDraft]);

  // ----------------------------------------------------
  // ENGINE 3: MARKETING SHORTS STATE
  // ----------------------------------------------------
  const [blurbsOutput, setBlurbsOutput] = useState('');
  const [coverPrompt, setCoverPrompt] = useState('');
  const [titleOutput, setTitleOutput] = useState('');
  const [titleCustomPrompt, setTitleCustomPrompt] = useState('');

  // 封面图片生成
  const [coverImagePrompt, setCoverImagePrompt] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [isGeneratingCoverImage, setIsGeneratingCoverImage] = useState(false);
  const [coverImageError, setCoverImageError] = useState<string | null>(null);
  const coverImageAbortRef = useRef<AbortController | null>(null);

  // 自动流水线状态
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState<{ step: string; current: number; total: number } | null>(null);
  const autoResumeRef = useRef<AutoPipelineResumeState | null>(null);
  const autoPauseRef = useRef(false);
  const generationAbortRef = useRef<AbortController | null>(null);
  const pausedTaskRef = useRef<GenerationTask | null>(null);

  // 章节逻辑审查输出
  const [logicReviewOutput, setLogicReviewOutput] = useState('');

  // 同步 coverPrompt → coverImagePrompt（仅首次填入，不覆盖用户编辑）
  useEffect(() => {
    if (coverPrompt && !coverImagePrompt) {
      setCoverImagePrompt(coverPrompt);
    }
  }, [coverPrompt]);

  useEffect(() => {
    const savedAutoState = loadAutoResumeState(projectId);
    if (!savedAutoState || savedAutoState.phase === 'done') return;

    autoResumeRef.current = savedAutoState;
    setPausedTask('auto');
    setPauseMessage('检测到未完成的一键全自动任务，点击继续将从当前步骤接着执行。');
    setAutoProgress({
      step: '已暂停（点击继续）',
      current: getAutoProgressCurrent(savedAutoState),
      total: savedAutoState.totalSteps || 7,
    });

    if (savedAutoState.partialText) {
      if (savedAutoState.phase === 'outline') setGenerationOutput(savedAutoState.partialText);
      if (savedAutoState.phase === 'review') setLogicReviewOutput(savedAutoState.partialText);
      if (savedAutoState.phase === 'blurb') setBlurbsOutput(savedAutoState.partialText);
      if (savedAutoState.phase === 'title') setTitleOutput(savedAutoState.partialText);
      if (savedAutoState.phase === 'cover') setCoverPrompt(savedAutoState.partialText);
    }
  }, [projectId]);

  const beginGenerationTask = (task: GenerationTask, resume = false) => {
    const controller = new AbortController();
    generationAbortRef.current = controller;
    pausedTaskRef.current = null;
    setActiveTask(task);
    if (!resume) setPausedTask(null);
    setPauseMessage('');

    return {
      signal: controller.signal,
      shouldPause: () => pausedTaskRef.current === task,
    };
  };

  const pauseCurrentTask = () => {
    if (!activeTask) return;
    pausedTaskRef.current = activeTask;
    if (activeTask === 'auto') autoPauseRef.current = true;
    setPausedTask(activeTask);
    setPauseMessage('已暂停，当前内容已保留。');
    generationAbortRef.current?.abort();
  };

  const finishGenerationTask = (task: GenerationTask, paused = false) => {
    setActiveTask(prev => prev === task ? null : prev);
    if (!paused) {
      setPausedTask(prev => prev === task ? null : prev);
      pausedTaskRef.current = null;
    }
    generationAbortRef.current = null;
  };

  const isPausedError = (error: any) => error?.message === LLM_PAUSED_ERROR || error?.name === 'AbortError';

  const markTaskPaused = (task: GenerationTask, message = '已暂停，当前内容已保留。') => {
    pausedTaskRef.current = task;
    setPausedTask(task);
    setPauseMessage(message);
  };

  const renderTaskControl = (task: GenerationTask, onResume: () => void) => {
    if (activeTask === task) {
      return (
        <button
          type="button"
          onClick={pauseCurrentTask}
          className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3 py-1.5 flex items-center gap-1.5 transition"
        >
          <Pause size={12} /> 暂停
        </button>
      );
    }

    if (pausedTask === task) {
      return (
        <button
          type="button"
          onClick={onResume}
          className="bg-accent hover:bg-accent-hover text-white text-xs font-bold px-3 py-1.5 flex items-center gap-1.5 transition"
        >
          <Play size={12} /> 继续
        </button>
      );
    }

    return null;
  };

  // Defined before the project guard so the useEffect above can safely reference it
  const handleSelectChapter = (ch: Chapter) => {
    setActiveChapterId(ch.id!);
    setEditingTitle(ch.title);
    setEditingOutline(ch.outlineSection);
    setEditingContent(ch.content);
    setChapterRegenerationPrompt(ch.regenerationPrompt || '');
  };

  // ----------------------------------------------------
  // ENGINE 4: COVER IMAGE GENERATION (gpt-image-2)
  // ----------------------------------------------------
  const handleGenerateCoverImage = async () => {
    const prompt = coverImagePrompt.trim();
    if (!prompt) { alert('请先输入封面提示词'); return; }

    const { getProviderConfig: _getConfig } = await import('../services/llm');
    const openaiCfg = _getConfig('openai');
    const apiKey = openaiCfg.apiKey;
    if (!apiKey) {
      alert('请先在"模型连接"设置中填写 OpenAI API Key');
      return;
    }

    const abortCtrl = new AbortController();
    coverImageAbortRef.current = abortCtrl;
    setIsGeneratingCoverImage(true);
    setCoverImageError(null);
    setCoverImageUrl(null);

    try {
      const baseUrl = (openaiCfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const res = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        signal: abortCtrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-image-2',
          prompt,
          n: 1,
          size: '1024x1536',
          output_format: 'png',
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`API 错误 ${res.status}: ${errBody}`);
      }
      const data = await res.json();
      const imageData = data?.data?.[0];
      if (imageData?.b64_json) {
        setCoverImageUrl(`data:image/png;base64,${imageData.b64_json}`);
      } else if (imageData?.url) {
        setCoverImageUrl(imageData.url);
      } else {
        throw new Error('响应中未找到图片数据');
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setCoverImageError(e.message || '封面图片生成失败');
      }
    } finally {
      coverImageAbortRef.current = null;
      setIsGeneratingCoverImage(false);
    }
  };

  const handleCancelCoverImage = () => {
    coverImageAbortRef.current?.abort();
  };

  if (!project) {
    return (
      <div className="flex items-center justify-center p-12 text-ink-400">
        <Sparkles size={36} className="animate-spin text-ink-300 mb-2" />
        <p className="text-sm">加载项目中...</p>
      </div>
    );
  }

  // ----------------------------------------------------
  // ENGINE 1: OUTLINE GENERATION
  // ----------------------------------------------------
  const handleGenerateOutline = async (resume = false, extraSlapSkill?: string, feedbackOverride?: string) => {
    const streamOptions = beginGenerationTask('outline', resume);
    setIsGenerating(true);
    if (!resume) setGenerationOutput('');
    setOutlineGenerationStatus(resume ? '继续生成大纲...' : '生成大纲中...');
    const template = skills.find(s => s.key === 'outline_template')?.content || '';
    const wolfSkill = project.genre === 'classic-wolf'
      ? (skills.find(s => s.key === 'wolf_setting')?.content || '')
      : undefined;
    const slapSkill = extraSlapSkill ?? (project.genre === 'female-slap'
      ? (skills.find(s => s.key === 'female_slap')?.content || '')
      : undefined);
    let latestOutline = resume ? generationOutput : '';
    let wasPaused = false;
    const effectiveFeedback = feedbackOverride !== undefined ? feedbackOverride : outlineFeedback;

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

      // Inject recent chat feedback history as context
      const recentFeedback = outlineChatMessages
        .filter(m => m.role === 'user')
        .slice(-4)
        .map(m => m.content)
        .join('\n---\n');
      if (recentFeedback && !effectiveFeedback) {
        compiled.user += `\n\n【历史修改要求（参考）】\n${recentFeedback}`;
      }

      if (resume && latestOutline) {
        compiled.user += `\n--- 已生成但被暂停的大纲片段 ---\n${latestOutline}\n\n请从该片段后继续补全，不要重写已经完整输出的部分。`;
      }

      let accumulated = resume ? latestOutline : '';
      await runLLMStream('outline', compiled.system, compiled.user, (tok) => {
        accumulated += tok;
        latestOutline = accumulated;
        setGenerationOutput(accumulated);
      }, streamOptions);

      await db.projects.update(projectId, { outline: accumulated, outlineValidationUpdatedAt: Date.now() });
      setOutlineGenerationStatus('大纲已生成并保存。');
      // Save to chat history
      if (!wasPaused) {
        await db.chatMessages.add({ projectId, scope: 'outline', role: 'assistant', kind: 'outline', content: accumulated, createdAt: Date.now() });
      }
    } catch (e: any) {
      if (isPausedError(e)) {
        wasPaused = true;
        markTaskPaused('outline');
        if (latestOutline) {
          await db.projects.update(projectId, { outline: latestOutline, outlineValidationUpdatedAt: Date.now() });
        }
        setOutlineGenerationStatus('已暂停，当前大纲片段已保留。');
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
    if (!project.outline) {
      alert('请先生成大纲后再进行逻辑审查。');
      return;
    }
    const logicSkill = skills.find(s => s.key === 'logic_check')?.content || '';
    const streamOptions = beginGenerationTask('outline-review', resume);
    setIsGenerating(true);
    if (!resume) setOutlineReviewOutput('');
    let wasPaused = false;
    try {
      const compiled = compileOutlineLogicReviewPrompt(project.outline, logicSkill);
      let acc = resume ? outlineReviewOutput : '';
      await runLLMStream('outline', compiled.system, compiled.user, (tok) => {
        acc += tok;
        setOutlineReviewOutput(acc);
      }, streamOptions);
      // Save to chat history
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

  const handleUpdateOutlineManual = async (val: string) => {
    // Preserve preamble, checklist and appendix from the stored outline
    const { preamble, checklist, appendix } = splitOutlineSections(project.outline);
    const merged = [preamble, val, checklist, appendix].filter(Boolean).join('\n\n');
    await db.projects.update(projectId, { outline: merged, outlineValidationUpdatedAt: Date.now() });
  };

  // ----------------------------------------------------
  // ENGINE 2: CHAPTER DRAFTING
  // ----------------------------------------------------
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

  const handleSaveChapterManual = async () => {
    if (activeChapterId === null) return;
    const ch = chapters.find(c => c.id === activeChapterId);
    if (!ch) return;

    // Backup current content version first
    const updatedHistory = [...(ch.versionHistory || [])];
    if (ch.content && ch.content !== editingDraft) {
      updatedHistory.push({ content: ch.content, timestamp: Date.now() });
    }

    await db.chapters.update(activeChapterId, {
      title: editingTitle,
      outlineSection: editingOutline,
      content: editingDraft,
      versionHistory: updatedHistory.slice(-5), // Keep last 5 versions
      lastEdited: Date.now()
    });
    alert('草稿已保存。');
  };

  const handleGenerateChapterStream = async (resume = false, promptOverride?: string, extraSkillTextOverride?: string) => {
    if (activeChapterId === null) return;
    const streamOptions = beginGenerationTask('chapter', resume);
    setIsGenerating(true);
    setChapterError(null);
    if (!resume) setEditingContent('');
    let accumulated = resume ? editingDraft : '';
    let wasPaused = false;
    const effectivePrompt = promptOverride !== undefined ? promptOverride : chapterRegenerationPrompt;
    const effectiveSkillText = extraSkillTextOverride !== undefined ? extraSkillTextOverride : chapterExtraSkillText;
    
    // Determine preceding chapters for stich context
    const prevChapters = chapters.filter(c => c.chapterNumber < (chapters.find(x => x.id === activeChapterId)?.chapterNumber || 0));

    try {
      const compiled = compileChapterPrompt({
        outline: project.outline,
        chapterNum: chapters.find(c => c.id === activeChapterId)?.chapterNumber || 1,
        chapterOutline: editingOutline,
        previousChapters: prevChapters,
        skills,
        regenerationPrompt: effectivePrompt,
        extraSkillKeys: chapterExtraSkillKeys,
        extraSkillText: effectiveSkillText,
      });

      // Inject recent chat feedback as context
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

      // Update db directly
      await db.chapters.update(activeChapterId, {
        content: accumulated,
        lastEdited: Date.now()
      });
      // Save to chat history
      if (!wasPaused) {
        await db.chatMessages.add({ projectId, scope: 'chapter', chapterId: activeChapterId, role: 'assistant', kind: 'chapter', content: accumulated, createdAt: Date.now() });
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

  // ----------------------------------------------------
  // ENGINE 3: MARKETING SHORTS
  // ----------------------------------------------------
  const handleGenerateMarketingKit = async (resume = false) => {
    const streamOptions = beginGenerationTask('marketing', resume);
    setIsGenerating(true);
    if (!resume) {
      setBlurbsOutput('');
      setTitleOutput('');
      setCoverPrompt('');
    }
    const blurbTemplate = skills.find(s => s.key === 'blurb')?.content || '';
    const sampleText = chapters.slice(0, 3).map(c => c.content).join('\n\n');
    let wasPaused = false;

    try {
      // 1. 生成简介
      if (!resume || !blurbsOutput) {
        const blurbCompiled = compileBlurbPrompt(project.outline, sampleText, blurbTemplate);
        let blurbAcc = resume ? blurbsOutput : '';
        await runLLMStream('marketing', blurbCompiled.system, blurbCompiled.user, tok => {
          blurbAcc += tok;
          setBlurbsOutput(blurbAcc);
        }, streamOptions);
      }

      // 2. 生成书名候选
      if (!resume || !titleOutput) {
        const titleCompiled = compileTitlePrompt(project.outline);
        let titleAcc = resume ? titleOutput : '';
        await runLLMStream('marketing', titleCompiled.system, titleCompiled.user, tok => { titleAcc += tok; }, streamOptions);
        await db.projects.update(projectId, { titleCandidates: titleAcc });
        setTitleOutput(titleAcc);
      }

      // 3. 生成封面提示词
      if (!resume || !coverPrompt) {
        const coverCompiled = compileCoverPrompt(project.outline, project.genre);
        let coverAcc = resume ? coverPrompt : '';
        await runLLMStream('marketing', coverCompiled.system, coverCompiled.user, tok => { coverAcc += tok; }, streamOptions);
        await db.projects.update(projectId, { coverPrompt: coverAcc });
        setCoverPrompt(coverAcc);
      }
    } catch (e: any) {
      if (isPausedError(e)) {
        wasPaused = true;
        markTaskPaused('marketing');
      } else {
        alert(`推广素材生成失败：${e.message}`);
      }
    } finally {
      setIsGenerating(false);
      finishGenerationTask('marketing', wasPaused);
    }
  };

  const handleGenerateTitleCandidates = async (resume = false) => {
    const streamOptions = beginGenerationTask('title', resume);
    setIsGenerating(true);
    if (!resume) setTitleOutput('');
    let acc = resume ? titleOutput : '';
    let wasPaused = false;

    try {
      const comp = compileTitlePrompt(project.outline, titleCustomPrompt);
      await runLLMStream('marketing', comp.system, comp.user, tok => {
        acc += tok;
        setTitleOutput(acc);
      }, streamOptions);
      await db.projects.update(projectId, { titleCandidates: acc });
    } catch (e: any) {
      if (isPausedError(e)) {
        wasPaused = true;
        markTaskPaused('title');
        if (acc) await db.projects.update(projectId, { titleCandidates: acc });
      } else {
        alert(`书名生成失败：${e.message}`);
      }
    } finally {
      setIsGenerating(false);
      finishGenerationTask('title', wasPaused);
    }
  };

  // Helper copy text
  // eslint-disable-next-line @typescript-eslint/no-unused-vars

  const handleExportNovelMarkdown = () => {
    const exportChapters = [...chapters]
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .map((chapter) => ({
        ...chapter,
        content: chapter.id === activeChapterId ? editingDraft : chapter.content,
      }))
      .filter((chapter) => stripLogicReview(chapter.content || '').length > 0);

    if (exportChapters.length === 0) {
      alert('还没有可导出的章节正文。');
      return;
    }

    const manuscript = exportChapters.map((chapter) => {
      const title = chapter.title || `第 ${chapter.chapterNumber} 章`;
      return `## ${title}\n\n${stripLogicReview(chapter.content || '')}`;
    }).join('\n\n');

    const markdown = `# ${project.title || '未命名小说'}\n\n${manuscript}\n`;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${sanitizeMarkdownFileName(project.title)}-小说正文.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // 单章 AI 逻辑审查
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
      const compiled = compileLogicReviewPrompt(ch.content, ch.chapterNumber, logicSkill);
      await runLLMStream('review', compiled.system, compiled.user, tok => {
        acc += tok;
        setLogicReviewOutput(acc);
      }, streamOptions);
      await db.chapters.update(ch.id!, { logicCheckLog: acc });
      // Save to chat history
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

  // 一键全自动流水线
  const handleRunAutoPipeline = async (resume = false) => {
    if (!project || isGenerating || isAutoRunning) return;
    const streamOptions = beginGenerationTask('auto', resume);
    const savedAutoState = resume ? autoResumeRef.current ?? loadAutoResumeState(projectId) : null;
    const autoState: AutoPipelineResumeState = savedAutoState
      ? savedAutoState
      : {
        phase: project.outline && project.outline.length >= 50 ? 'sync' : 'outline',
        currentOutline: project.outline || '',
        outlineAttempt: 1,
        validationFeedback: '',
        chapterIndex: 0,
        partialText: '',
        totalSteps: 7,
      };
    autoResumeRef.current = autoState;

    setIsAutoRunning(true);
    setIsGenerating(true);
    autoPauseRef.current = false;
    let wasPaused = false;

    const checkPause = () => {
      if (autoPauseRef.current || pausedTaskRef.current === 'auto') throw new Error(LLM_PAUSED_ERROR);
    };

    try {
      const logicSkill = skills.find(s => s.key === 'logic_check')?.content || '';
      const blurbSkill = skills.find(s => s.key === 'blurb')?.content || '';
      const outlineTemplate = skills.find(s => s.key === 'outline_template')?.content || '';

      // Step 1: 生成大纲（若已有则跳过）
      let currentOutline = autoState.currentOutline || project.outline;
      if (AUTO_PHASE_ORDER[autoState.phase] <= AUTO_PHASE_ORDER.outline && (!currentOutline || currentOutline.length < 50 || autoState.partialText)) {

        for (let attempt = autoState.outlineAttempt; attempt <= OUTLINE_MAX_ATTEMPTS; attempt++) {
          autoState.phase = 'outline';
          autoState.outlineAttempt = attempt;
          setAutoProgress({ step: `生成大纲（第 ${attempt}/${OUTLINE_MAX_ATTEMPTS} 轮）`, current: 1, total: 7 });
          setOutlineGenerationStatus(`自动流水线生成大纲中（第 ${attempt}/${OUTLINE_MAX_ATTEMPTS} 轮）...`);
          const resumingOutline = resume && autoState.partialText && autoState.outlineAttempt === attempt;
          setGenerationOutput(resumingOutline ? autoState.partialText : '');

          const wolfSkill = project.genre === 'classic-wolf'
            ? (skills.find(s => s.key === 'wolf_setting')?.content || undefined)
            : undefined;
          const compiled = compileOutlinePrompt(
            project.rawExample,
            project.background,
            project.characters,
            outlineTemplate,
            autoState.validationFeedback || undefined,
            wolfSkill
          );
          if (resumingOutline) {
            compiled.user += `\n--- 已生成但暂停的大纲片段 ---\n${autoState.partialText}\n\n请从该片段后继续补全，不要重写已经输出的部分。`;
          }
          let acc = resumingOutline ? autoState.partialText : '';
          await runLLMStream('outline', compiled.system, compiled.user, tok => {
            acc += tok;
            autoState.partialText = acc;
            autoState.currentOutline = acc;
            setGenerationOutput(acc);
          }, streamOptions);
          currentOutline = acc;
          autoState.currentOutline = acc;
          autoState.partialText = '';
          checkPause();

          // Logic review pass
          setAutoProgress({ step: `逻辑审查大纲（第 ${attempt}/${OUTLINE_MAX_ATTEMPTS} 轮）`, current: 1, total: 7 });
          setOutlineGenerationStatus(`自动流水线逻辑审查大纲（第 ${attempt}/${OUTLINE_MAX_ATTEMPTS} 轮）...`);
          let reviewAcc = '';
          const reviewComp = compileOutlineLogicReviewPrompt(acc, logicSkill);
          await runLLMStream('outline', reviewComp.system, reviewComp.user, tok => {
            reviewAcc += tok;
          }, streamOptions);
          checkPause();

          // If no issues found, break; otherwise feed back into next attempt
          const noIssues = /没有问题|无问题|通过|无明显问题|未发现问题/i.test(reviewAcc);
          if (noIssues || attempt === OUTLINE_MAX_ATTEMPTS) {
            await db.projects.update(projectId, {
              outline: acc,
              outlineValidationUpdatedAt: Date.now(),
            });
            autoState.phase = 'sync';
            autoState.outlineAttempt = 1;
            autoState.validationFeedback = '';
            break;
          }

          autoState.validationFeedback = reviewAcc;
          autoState.outlineAttempt = attempt + 1;
          checkPause();
        }
        checkPause();
      }

      // Step 2: 解析并同步章节结构
      if (AUTO_PHASE_ORDER[autoState.phase] <= AUTO_PHASE_ORDER.sync) {
        autoState.phase = 'sync';
        setAutoProgress({ step: '解析章节结构', current: 2, total: 7 });
        const parsedCount = await syncOutlineChaptersToDb(currentOutline, projectId);
        if (parsedCount === 0) {
          throw new Error('未能从大纲中解析出章节（请确认大纲包含“### 第 X 章：标题”格式）');
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
        // If resuming a paused run use the saved index; otherwise find the first chapter
        // that still needs drafting or a logic review so we skip already-completed chapters.
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
            });
            if (resumingChapter) {
              chComp.user += `\n--- 已生成但暂停的正文片段 ---\n${autoState.partialText}\n\n请从该片段最后一句之后继续续写，只输出后续正文，不要重复已经写过的内容。`;
            }
            let draftAcc = resumingChapter ? autoState.partialText : '';
            await runLLMStream('chapter', chComp.system, chComp.user, tok => {
              draftAcc += tok;
              autoState.partialText = draftAcc;
              if (activeChapterId === ch.id) setEditingContent(draftAcc);
            }, streamOptions);
            await db.chapters.update(ch.id!, { content: draftAcc, lastEdited: Date.now() });
            allChapters[i] = { ...ch, content: draftAcc };
            autoState.partialText = '';
            if (activeChapterId === ch.id) setEditingContent(draftAcc);
          }
          checkPause();

          setAutoProgress({ step: `审查第 ${ch.chapterNumber} 章逻辑`, current: 2 + i * 2 + 2, total: totalSteps });
          const content = allChapters[i].content;
          const resumingReview = resume && autoState.phase === 'review' && autoState.chapterIndex === i && !!autoState.partialText;
          const needsReview = resumingReview || !allChapters[i].logicCheckLog;
          if (content && logicSkill && needsReview) {
            const _resumingReview = resumingReview; // alias to avoid re-declaration below
            autoState.phase = 'review';
            autoState.chapterIndex = i;
            autoState.chapterId = ch.id;
            const reviewComp = compileLogicReviewPrompt(content, ch.chapterNumber, logicSkill);
            if (_resumingReview) {
              reviewComp.user += `\n--- 已生成但暂停的审查片段 ---\n${autoState.partialText}\n\n请从该片段后继续补全审查报告，不要重复已经输出的部分。`;
            }
            let reviewAcc = _resumingReview ? autoState.partialText : '';
            await runLLMStream('review', reviewComp.system, reviewComp.user, tok => {
              reviewAcc += tok;
              autoState.partialText = reviewAcc;
            }, streamOptions);
            await db.chapters.update(ch.id!, { logicCheckLog: reviewAcc });
            autoState.partialText = '';
            if (activeChapterId === ch.id) setLogicReviewOutput(reviewAcc);
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
        const blurbComp = compileBlurbPrompt(currentOutline, sampleText, blurbSkill);
        let blurbAcc = resume && autoState.partialText ? autoState.partialText : '';
        await runLLMStream('marketing', blurbComp.system, blurbComp.user, tok => {
          blurbAcc += tok;
          autoState.partialText = blurbAcc;
          setBlurbsOutput(blurbAcc);
        }, streamOptions);
        autoState.partialText = '';
        autoState.phase = 'title';
        checkPause();
      }

      // 生成书名与封面
      if (AUTO_PHASE_ORDER[autoState.phase] <= AUTO_PHASE_ORDER.title) {
        autoState.phase = 'title';
        setAutoProgress({ step: '生成书名', current: totalSteps, total: totalSteps });
        const titleComp = compileTitlePrompt(currentOutline);
        let titleAcc = resume && autoState.partialText ? autoState.partialText : '';
        await runLLMStream('marketing', titleComp.system, titleComp.user, tok => {
          titleAcc += tok;
          autoState.partialText = titleAcc;
          setTitleOutput(titleAcc);
        }, streamOptions);
        await db.projects.update(projectId, { titleCandidates: titleAcc });
        setTitleOutput(titleAcc);
        autoState.partialText = '';
        autoState.phase = 'cover';
      }

      if (AUTO_PHASE_ORDER[autoState.phase] <= AUTO_PHASE_ORDER.cover) {
        autoState.phase = 'cover';
        setAutoProgress({ step: '生成封面提示词', current: totalSteps, total: totalSteps });
        const coverComp = compileCoverPrompt(currentOutline, project.genre);
        let coverAcc = resume && autoState.partialText ? autoState.partialText : '';
        await runLLMStream('marketing', coverComp.system, coverComp.user, tok => {
          coverAcc += tok;
          autoState.partialText = coverAcc;
          setCoverPrompt(coverAcc);
        }, streamOptions);
        await db.projects.update(projectId, { coverPrompt: coverAcc });
        setCoverPrompt(coverAcc);
        autoState.partialText = '';
      }

      autoState.phase = 'done';
      autoResumeRef.current = null;
      clearAutoResumeState(projectId);
      setAutoProgress({ step: '全部完成 ✓', current: totalSteps, total: totalSteps });
    } catch (e: any) {
      if (isPausedError(e)) {
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
        markTaskPaused('auto', '已暂停，点击继续将从当前步骤接着执行。');
        setAutoProgress(prev => prev ? { ...prev, step: '已暂停（点击继续）' } : null);
      } else {
        alert(`自动流水线执行出错：${e.message}`);
        autoResumeRef.current = null;
        clearAutoResumeState(projectId);
        setAutoProgress(null);
      }
    } finally {
      setIsAutoRunning(false);
      setIsGenerating(false);
      finishGenerationTask('auto', wasPaused);
    }
  };

  // ----------------------------------------------------
  // CHAT SEND HANDLERS
  // ----------------------------------------------------
  const handleOutlineChatSend = async (userText: string) => {
    if (userText.trim()) {
      await db.chatMessages.add({ projectId, scope: 'outline', role: 'user', content: userText, createdAt: Date.now() });
    }
    await handleGenerateOutline(false, undefined, userText || undefined);
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

  const handleClearOutlineChat = async () => {
    await db.chatMessages.where('[projectId+scope]').equals([projectId, 'outline']).delete();
  };

  const handleClearChapterChat = async () => {
    if (activeChapterId === null) return;
    await db.chatMessages.where('[projectId+scope+chapterId]').equals([projectId, 'chapter', activeChapterId]).delete();
  };

  const handleUseReviewSuggestion = (reviewContent: string) => {
    const prompt = `根据以上逻辑审查建议重新生成本章（建议内容已附在上下文中）`;
    handleChapterChatSend(prompt);
    void reviewContent; // reviewContent is already in chat history context
  };

  return (
    <div className="space-y-6">
      {/* 项目标题与导航 */}
      <div className="border-b-2 border-ink pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold text-ink-400 uppercase tracking-widest">当前项目</div>
          <div className="flex items-center gap-2 mt-0.5">
            <input
              type="text"
              value={editingProjectTitle}
              onChange={(e) => setEditingProjectTitle(e.target.value)}
              onBlur={async () => {
                const newTitle = editingProjectTitle.trim() || '未命名项目';
                if (newTitle !== project.title) {
                  await db.projects.update(projectId, { title: newTitle });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className="text-xl font-black font-display text-ink bg-transparent border-b border-transparent hover:border-rule focus:border-accent focus:outline-none w-full max-w-xs"
              placeholder="项目书名（点击编辑）"
            />
            <button
              onClick={() => setShowTitleModal(true)}
              title="生成备选书名"
              className="p-1 text-ink-400 hover:text-accent border border-rule hover:border-accent bg-paper hover:bg-accent-faint transition shrink-0"
            >
              <PenLine size={13} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleExportNovelMarkdown}
            className="flex items-center gap-1.5 bg-paper border border-rule hover:bg-paper-100 text-ink-500 text-xs font-bold px-3 py-1.5 transition"
          >
            <Download size={12} /> 导出小说
          </button>

          {/* 一键全自动 */}
          {!isAutoRunning && !pausedTask && (
            <button
              onClick={() => handleRunAutoPipeline(false)}
              disabled={isGenerating}
              className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 transition"
            >
              <Play size={12} /> 一键全自动
            </button>
          )}

          {/* 标签切换 */}
          <div className="flex border-b border-rule">
            <button
              onClick={() => setPipelineTab('outline')}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px ${
                pipelineTab === 'outline' ? 'border-accent text-accent' : 'border-transparent text-ink-500 hover:text-ink'
              }`}
            >
              <Layers size={13} /> 第一阶段：大纲
            </button>
            <button
              onClick={() => setPipelineTab('drafting')}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px ${
                pipelineTab === 'drafting' ? 'border-accent text-accent' : 'border-transparent text-ink-500 hover:text-ink'
              }`}
            >
              <Edit3 size={13} /> 第二阶段：写作间
            </button>
            <button
              onClick={() => setPipelineTab('marketing')}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px ${
                pipelineTab === 'marketing' ? 'border-accent text-accent' : 'border-transparent text-ink-500 hover:text-ink'
              }`}
            >
              <Sparkles size={13} /> 第三阶段：推广
            </button>
          </div>
        </div>
      </div>

      {pauseMessage && pausedTask && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 text-xs font-semibold flex items-center gap-2">
          <Pause size={14} /> {pauseMessage}
        </div>
      )}

      {/* 自动流水线进度条 */}
      {(isAutoRunning || autoProgress) && (
        <div className="bg-accent-faint border border-accent/30 p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {isAutoRunning && <RefreshCw size={16} className="animate-spin text-accent shrink-0" />}
            <div className="min-w-0">
              <div className="text-xs font-bold text-accent truncate">{autoProgress?.step || '准备中...'}</div>
              {autoProgress && (
                <div className="text-[10px] text-ink-400 mt-0.5">步骤 {autoProgress.current} / {autoProgress.total}</div>
              )}
            </div>
            {autoProgress && (
              <div className="flex-1 h-1.5 bg-rule rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (autoProgress.current / autoProgress.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
          {isAutoRunning ? (
            <button
              onClick={pauseCurrentTask}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3 py-1.5 transition shrink-0"
            >
              <Pause size={12} /> 暂停
            </button>
          ) : autoProgress?.step !== '全部完成 ✓' && autoProgress && (
            <button
              onClick={() => { autoPauseRef.current = false; handleRunAutoPipeline(true); }}
              className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold px-3 py-1.5 transition shrink-0"
            >
              <Play size={12} /> 继续
            </button>
          )}
          {autoProgress?.step === '全部完成 ✓' && (
            <button
              onClick={() => setAutoProgress(null)}
              className="text-xs text-ink-400 hover:text-ink font-semibold px-3 py-1.5 shrink-0"
            >
              关闭
            </button>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* STAGE 1: OUTLINE STUDIO */}
      {/* ---------------------------------------------------- */}
      {pipelineTab === 'outline' && (
        <div className="space-y-4">
          {/* OutlineEditorModal */}
          <OutlineEditorModal
            isOpen={showOutlineEditor}
            onClose={() => setShowOutlineEditor(false)}
            outline={splitOutlineSections(project.outline || '').main}
            onSave={handleUpdateOutlineManual}
          />

          {/* ChatPanel */}
          <ChatPanel
            messages={outlineChatMessages}
            isStreaming={isGenerating && (activeTask === 'outline' || activeTask === 'outline-review')}
            streamingContent={activeTask === 'outline' ? generationOutput : outlineReviewOutput}
            streamingLabel={activeTask === 'outline' ? (outlineGenerationStatus || '生成大纲中...') : '审查大纲中...'}
            onSend={handleOutlineChatSend}
            onClear={handleClearOutlineChat}
            disabled={!project}
            placeholder="输入修改意见后按 Enter 发送，或点击上方按钮直接生成大纲..."
            toolbar={
              <>
                {/* 重新生成 */}
                <button
                  disabled={isGenerating}
                  onClick={() => handleOutlineChatSend('')}
                  className="flex items-center gap-1 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-[10px] font-bold px-2.5 py-1.5 transition"
                >
                  <Sparkles size={10} className={activeTask === 'outline' && isGenerating ? 'animate-spin' : ''} />
                  {project.outline ? '重新生成' : '生成大纲'}
                </button>
                {renderTaskControl('outline', () => handleGenerateOutline(true))}

                {/* 打脸闭环 */}
                <button
                  disabled={isGenerating}
                  onClick={() => {
                    const slapContent = skills.find(s => s.key === 'female_slap')?.content || '';
                    handleGenerateOutline(false, slapContent);
                  }}
                  className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 disabled:opacity-50 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                >
                  <Sparkles size={10} /> 打脸闭环
                </button>

                {/* 审查大纲 */}
                <button
                  disabled={isGenerating || !project.outline}
                  onClick={() => handleReviewOutline()}
                  className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 disabled:opacity-50 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                >
                  <FileSearch size={10} className={activeTask === 'outline-review' && isGenerating ? 'animate-spin' : ''} />
                  审查大纲
                </button>
                {renderTaskControl('outline-review', () => handleReviewOutline(true))}

                {/* 导出 MD */}
                <button
                  disabled={!project.outline}
                  onClick={() => {
                    const blob = new Blob([project.outline], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `《${project.title || '未命名'}》大纲.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 disabled:opacity-50 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                >
                  <Download size={10} /> 导出 MD
                </button>

                {/* 同步章节 */}
                <button
                  disabled={isGenerating || !project.outline}
                  onClick={async () => {
                    const n = await syncOutlineChaptersToDb(project.outline, projectId);
                    alert(n > 0 ? `已同步 ${n} 个章节到数据库。` : '未在大纲中找到章节（请确认包含"### 第 X 章："格式）。');
                  }}
                  className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 disabled:opacity-50 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                >
                  <BookOpen size={10} /> 同步章节
                </button>

                {/* 选择 Skill */}
                <div className="relative">
                  <button
                    onClick={() => setShowOutlineSkillPopover(v => !v)}
                    className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                  >
                    <Layers size={10} /> 选择 Skill {showOutlineSkillPopover ? '▴' : '▾'}
                  </button>
                  {showOutlineSkillPopover && (
                    <div className="absolute bottom-full mb-1 left-0 z-20 bg-paper border border-rule shadow-lg p-2 min-w-[200px] space-y-1">
                      {skills.filter(s => !['workflow', 'blurb', 'outline_template'].includes(s.key)).map(s => (
                        <label key={s.key} className="flex items-center gap-2 text-[10px] text-ink cursor-pointer py-0.5 hover:bg-paper-100 px-1">
                          <input
                            type="checkbox"
                            checked={outlineExtraSkillKeys.includes(s.key)}
                            onChange={(e) => {
                              setOutlineExtraSkillKeys(e.target.checked
                                ? [...outlineExtraSkillKeys, s.key]
                                : outlineExtraSkillKeys.filter((k: string) => k !== s.key));
                            }}
                            className="accent-[#9b2d20] shrink-0"
                          />
                          <span className="truncate">{s.name}</span>
                        </label>
                      ))}
                      <div className="pt-1 border-t border-rule mt-1">
                        <label className="flex items-center gap-1 text-[10px] text-ink-400 font-bold cursor-pointer hover:bg-paper-100 px-1">
                          <FileUp size={9} /> 上传临时 Skill
                          <input
                            type="file"
                            accept=".txt,.md"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = (ev) => setOutlineExtraSkillText(ev.target?.result as string || '');
                              reader.readAsText(file, 'utf-8');
                              e.target.value = '';
                              setShowOutlineSkillPopover(false);
                            }}
                          />
                        </label>
                        {outlineExtraSkillKeys.length > 0 && (
                          <span className="text-[9px] text-accent font-bold px-1">{outlineExtraSkillKeys.length} 已选</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 上传例文 */}
                <button
                  onClick={() => setShowExampleModal(true)}
                  className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                >
                  <FileUp size={10} /> 上传例文{project.rawExample ? ' ✓' : ''}
                </button>

                {/* 编辑大纲 */}
                <button
                  onClick={() => setShowOutlineEditor(true)}
                  className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                >
                  <Edit3 size={10} /> 编辑大纲
                </button>
              </>
            }
          />

          {/* ExampleModal */}
          <ExampleModal
            isOpen={showExampleModal}
            onClose={() => setShowExampleModal(false)}
            rawExample={project.rawExample || ''}
            onChange={(text) => db.projects.update(projectId, { rawExample: text })}
            onSave={() => {/* saved via onChange */}}
          />
        </div>
      )}
      {/* STAGE 2: DRAFTING ROOM */}
      {/* ---------------------------------------------------- */}
      {pipelineTab === 'drafting' && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Chapter Outline selector column */}
          <div className="xl:col-span-1 border border-rule bg-paper-50 p-4 flex flex-col justify-between h-[calc(100vh-240px)] overflow-y-auto space-y-4">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold text-ink-400 uppercase tracking-widest flex items-center gap-1">
                  <BookOpen size={12} className="text-accent" /> 章节列表
                </h3>
                <button
                  onClick={handleCreateNewChapter}
                  className="p-1 hover:bg-accent-faint text-accent hover:text-accent-hover rounded transition border border-rule"
                  title="新建章节"
                >
                  <Plus size={14} />
                </button>
              </div>

              <div className="space-y-1">
                {chapters.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => handleSelectChapter(ch)}
                    className={`w-full text-left px-3 py-2 text-xs font-semibold border-l-2 flex items-center justify-between transition ${
                      activeChapterId === ch.id
                        ? 'border-accent text-accent bg-accent-faint font-bold'
                        : 'border-transparent text-ink-500 hover:bg-paper-100 hover:text-ink'
                    }`}
                  >
                    <span>第 {ch.chapterNumber} 章: {ch.title.split(':').pop()?.trim()}</span>
                    <div className="flex items-center gap-1.5">
                      {ch.content && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingChapter({ title: ch.title || `第 ${ch.chapterNumber} 章`, content: ch.content! });
                          }}
                          title="查看原文"
                          className="p-0.5 text-ink-400 hover:text-accent transition"
                        >
                          <Eye size={11} />
                        </button>
                      )}
                      {ch.content ? (
                        <span className="text-[9px] px-1.5 py-0.5 bg-grove-light font-bold border border-grove/30 text-grove">
                          {ch.content.length} words
                        </span>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 bg-paper-100 font-bold text-ink-400 border border-rule">
                          empty
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {chapters.length === 0 && (
              <div className="text-center py-6 text-ink-400 space-y-2 border border-rule border-dashed bg-paper">
                <p className="text-[10px]">还没有章节。</p>
                <button
                  type="button"
                  onClick={handleCreateNewChapter}
                  className="text-[10px] font-semibold text-accent hover:text-accent-hover underline"
                >
                  添加第一章
                </button>
              </div>
            )}
          </div>

          {/* ChatPanel area */}
          <div className="xl:col-span-3 space-y-3">
            {/* Grease warnings */}
            {greaseWarnings.length > 0 && (
              <div className="bg-accent-pale border border-accent/40 p-3 space-y-1.5">
                <div className="flex items-center gap-2 text-accent text-xs font-bold">
                  <AlertTriangle size={13} /> 去油警告
                </div>
                <ul className="space-y-0.5">
                  {greaseWarnings.map((warn, i) => (
                    <li key={i} className="text-[10px] text-ink font-semibold before:content-['•'] before:text-accent before:mr-1">{warn}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Chapter error */}
            {chapterError && activeTask !== 'chapter' && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 p-2.5 text-[10px] text-red-700">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>{chapterError}</span>
              </div>
            )}

            {activeChapterId !== null ? (
              <ChatPanel
                messages={chapterChatMessages}
                isStreaming={isGenerating && (activeTask === 'chapter' || activeTask === 'review')}
                streamingContent={activeTask === 'chapter' ? editingDraft : logicReviewOutput}
                streamingLabel={activeTask === 'chapter' ? '生成正文中...' : '逻辑审查中...'}
                onSend={handleChapterChatSend}
                onClear={handleClearChapterChat}
                onUseReviewSuggestion={handleUseReviewSuggestion}
                placeholder="输入重写建议后按 Enter 发送，或点击上方按钮直接生成正文..."
                toolbar={
                  <>
                    {/* 保存草稿 */}
                    <button
                      onClick={handleSaveChapterManual}
                      className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                    >
                      <Save size={10} /> 保存草稿
                    </button>

                    {/* 导出单章 */}
                    <button
                      onClick={() => {
                        const ch = chapters.find(c => c.id === activeChapterId);
                        if (ch) handleExportChapterMarkdown(ch);
                      }}
                      className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                    >
                      <Download size={10} /> 导出单章
                    </button>

                    {/* 重新生成 */}
                    <button
                      disabled={isGenerating}
                      onClick={() => handleChapterChatSend('')}
                      className="flex items-center gap-1 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-[10px] font-bold px-2.5 py-1.5 transition"
                    >
                      <Sparkles size={10} className={activeTask === 'chapter' && isGenerating ? 'animate-spin' : ''} />
                      {chapters.find(c => c.id === activeChapterId)?.content ? '重新生成' : '生成正文'}
                    </button>
                    {renderTaskControl('chapter', () => handleGenerateChapterStream(true))}

                    {/* 逻辑审查 */}
                    <button
                      disabled={isGenerating}
                      onClick={() => {
                        const ch = chapters.find(c => c.id === activeChapterId);
                        if (ch) handleLogicReviewChapter(ch);
                      }}
                      className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 disabled:opacity-50 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                    >
                      <FileSearch size={10} className={activeTask === 'review' && isGenerating ? 'animate-spin' : ''} />
                      逻辑审查
                    </button>
                    {renderTaskControl('review', () => {
                      const ch = chapters.find(c => c.id === activeChapterId);
                      if (ch) handleLogicReviewChapter(ch, true);
                    })}

                    {/* 打脸闭环 */}
                    <button
                      disabled={isGenerating}
                      onClick={() => {
                        const slapContent = skills.find(s => s.key === 'female_slap')?.content || '';
                        handleChapterChatSend('按打脸闭环风格重新生成本章', slapContent);
                      }}
                      className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 disabled:opacity-50 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                    >
                      <Sparkles size={10} /> 打脸闭环
                    </button>

                    {/* 选择 Skill */}
                    <div className="relative">
                      <button
                        onClick={() => setShowChapterSkillPopover(v => !v)}
                        className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                      >
                        <Layers size={10} /> 选择 Skill {showChapterSkillPopover ? '▴' : '▾'}
                      </button>
                      {showChapterSkillPopover && (
                        <div className="absolute bottom-full mb-1 left-0 z-20 bg-paper border border-rule shadow-lg p-2 min-w-[200px] space-y-1">
                          {skills.filter(s => !['workflow', 'blurb'].includes(s.key)).map(s => (
                            <label key={s.key} className="flex items-center gap-2 text-[10px] text-ink cursor-pointer py-0.5 hover:bg-paper-100 px-1">
                              <input
                                type="checkbox"
                                checked={chapterExtraSkillKeys.includes(s.key)}
                                onChange={(e) => {
                                  setChapterExtraSkillKeys(e.target.checked
                                    ? [...chapterExtraSkillKeys, s.key]
                                    : chapterExtraSkillKeys.filter(k => k !== s.key));
                                }}
                                className="accent-[#9b2d20] shrink-0"
                              />
                              <span className="truncate">{s.name}</span>
                            </label>
                          ))}
                          <div className="pt-1 border-t border-rule mt-1">
                            <label className="flex items-center gap-1 text-[10px] text-ink-400 font-bold cursor-pointer hover:bg-paper-100 px-1">
                              <FileUp size={9} /> 上传临时 Skill
                              <input
                                type="file"
                                accept=".txt,.md"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  const reader = new FileReader();
                                  reader.onload = (ev) => setChapterExtraSkillText(ev.target?.result as string || '');
                                  reader.readAsText(file, 'utf-8');
                                  e.target.value = '';
                                  setShowChapterSkillPopover(false);
                                }}
                              />
                            </label>
                            {chapterExtraSkillKeys.length > 0 && (
                              <span className="text-[9px] text-accent font-bold px-1">{chapterExtraSkillKeys.length} 已选</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 章节大纲 */}
                    <button
                      onClick={() => setShowChapterOutlineEditor(true)}
                      className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                    >
                      <Edit3 size={10} /> 章节大纲
                    </button>
                  </>
                }
              />
            ) : (
              <div className="bg-paper border border-rule border-dashed flex flex-col items-center justify-center text-center space-y-3 h-[calc(100vh-240px)]" style={{ minHeight: 480 }}>
                <Edit3 className="text-ink-300" size={32} />
                <h4 className="font-bold text-ink text-sm">请选择章节</h4>
                <p className="text-ink-400 text-xs max-w-xs">从左侧列表选择一个章节，或新建章节开始写作。</p>
                <button
                  onClick={handleCreateNewChapter}
                  className="border border-rule bg-paper hover:bg-paper-100 text-ink-500 font-semibold px-4 py-1.5 text-xs"
                >
                  新建章节
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* STAGE 3: MARKETING KIT */}
      {/* ---------------------------------------------------- */}
      {pipelineTab === 'marketing' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {/* Blurb Generation cards */}
            <div className="bg-paper-50 border border-rule p-5 space-y-4 flex flex-col justify-between min-h-[460px]">
              <div className="space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-rule">
                  <h3 className="text-sm font-bold text-ink flex items-center gap-1.5">
                    <Sparkles size={15} className="text-accent" /> 爆款简介（导语）
                  </h3>
                  <button
                    disabled={activeTask === 'marketing' || isAutoRunning}
                    onClick={() => handleGenerateMarketingKit()}
                    className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-bold px-3.5 py-1.5 flex items-center gap-1.5 transition"
                  >
                    <Sparkles size={12} className={activeTask === 'marketing' ? 'animate-spin' : ''} />
                    一键生成推广素材
                  </button>
                  {renderTaskControl('marketing', () => handleGenerateMarketingKit(true))}
                </div>

                <div className="flex-1">
                  {activeTask === 'marketing' && !blurbsOutput ? (
                    <div className="flex flex-col items-center justify-center py-20 text-ink-400 space-y-2">
                      <RefreshCw size={24} className="animate-spin text-ink-300" />
                      <p className="text-xs">正在生成...</p>
                    </div>
                  ) : blurbsOutput ? (
                    <div
                      className="w-full h-[320px] overflow-y-auto bg-paper border border-rule p-4 text-ink text-xs leading-relaxed prose-sm"
                      dangerouslySetInnerHTML={renderMarkdown(blurbsOutput)}
                    />
                  ) : (
                    <div className="w-full h-[320px] bg-paper border border-rule p-4 text-ink-400 text-xs flex items-center justify-center">
                      点击“一键生成推广素材”后，此处将生成 3 个风格各异的爆款简介...
                    </div>
                  )}
                </div>
              </div>

              {blurbsOutput && (
                <div className="flex justify-between items-center bg-paper-100 border border-rule p-3 text-[10px] text-ink-400">
                  <span>✓ 简介已生成。</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(blurbsOutput);
                      alert('已复制所有简介！');
                    }}
                    className="text-accent hover:text-accent-hover font-bold"
                  >
                    复制全部
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {/* 封面图片生成 */}
            <div className="bg-paper-50 border border-rule p-4 space-y-4">
              <div className="flex justify-between items-center pb-2 border-b border-rule">
                <h3 className="text-sm font-bold text-ink flex items-center gap-1.5">
                  <ImageIcon size={14} className="text-accent" /> 封面图片生成
                </h3>
                <span className="text-[10px] text-ink-400 border border-rule px-2 py-0.5">gpt-image-2</span>
              </div>
              <p className="text-[10px] text-ink-400 leading-normal">
                使用 OpenAI <code className="bg-paper border border-rule px-1">gpt-image-2</code> 模型生成竖版封面（1024×1536）。需在"模型连接"中配置 OpenAI API Key。
              </p>

              {/* 提示词输入框 */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-ink-400 uppercase tracking-widest block">封面提示词</label>
                <textarea
                  value={coverImagePrompt}
                  onChange={e => setCoverImagePrompt(e.target.value)}
                  rows={5}
                  placeholder={coverPrompt ? '已从大纲自动生成提示词，可直接编辑后生成图片…' : '先点击左侧"一键生成推广素材"自动生成提示词，或在此直接输入英文提示词…'}
                  className="w-full bg-paper border border-rule p-2.5 font-mono text-[10px] text-ink resize-y focus:outline-none focus:border-accent"
                />
              </div>

              {/* 操作按钮行 */}
              <div className="flex gap-2">
                <button
                  onClick={handleGenerateCoverImage}
                  disabled={isGeneratingCoverImage || !coverImagePrompt.trim()}
                  className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-bold px-3 py-2 flex items-center justify-center gap-1.5 transition"
                >
                  {isGeneratingCoverImage ? (
                    <><Sparkles size={12} className="animate-spin" /> 生成中…</>
                  ) : (
                    <><Sparkles size={12} /> 生成封面图片</>
                  )}
                </button>
                {isGeneratingCoverImage && (
                  <button
                    onClick={handleCancelCoverImage}
                    className="border border-rule bg-paper hover:bg-red-50 text-ink-500 hover:text-red-600 text-xs font-bold px-3 py-2 flex items-center gap-1 transition"
                  >
                    <Pause size={12} /> 暂停
                  </button>
                )}
                {coverImagePrompt && (
                  <button
                    onClick={() => { navigator.clipboard.writeText(coverImagePrompt); alert('提示词已复制！'); }}
                    className="border border-rule bg-paper hover:bg-paper-100 text-ink text-xs font-bold px-3 py-2 transition"
                  >
                    <Copy size={12} />
                  </button>
                )}
              </div>

              {/* 错误提示 */}
              {coverImageError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 p-2.5 text-[10px] text-red-700">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{coverImageError}</span>
                </div>
              )}

              {/* 生成的图片 */}
              {coverImageUrl ? (
                <div className="space-y-2">
                  <img
                    src={coverImageUrl}
                    alt="AI 生成封面"
                    className="w-full border border-rule"
                  />
                  <a
                    href={coverImageUrl}
                    download={`${sanitizeMarkdownFileName(project.title || '小说')}-封面.png`}
                    className="w-full border border-rule bg-paper hover:bg-paper-100 text-ink text-center font-bold text-xs py-2 flex items-center justify-center gap-1.5 transition"
                  >
                    <Download size={12} /> 下载封面图片
                  </a>
                </div>
              ) : !isGeneratingCoverImage && !coverImageError && (
                <div className="text-center py-8 text-ink-300 border border-rule bg-paper border-dashed">
                  <ImageIcon size={24} className="mx-auto mb-2" />
                  <span className="text-[10px] font-semibold block">填写提示词后点击"生成封面图片"</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Chapter outline editor modal */}
      {showChapterOutlineEditor && activeChapterId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowChapterOutlineEditor(false)}
        >
          <div
            className="bg-paper border border-rule shadow-xl flex flex-col w-full max-w-2xl mx-4"
            style={{ maxHeight: '80vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-rule shrink-0">
              <h2 className="text-sm font-black font-display text-ink">本章大纲要求</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    const ch = chapters.find(c => c.id === activeChapterId);
                    if (ch?.id) await db.chapters.update(ch.id, { outlineSection: editingOutline });
                    setShowChapterOutlineEditor(false);
                  }}
                  className="flex items-center gap-1 text-[10px] font-bold text-white bg-accent hover:bg-accent-hover px-3 py-1 transition"
                >
                  保存
                </button>
                <button
                  onClick={() => setShowChapterOutlineEditor(false)}
                  className="text-ink-400 hover:text-ink p-1 transition"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
              <textarea
                value={editingOutline}
                onChange={(e) => setEditingOutline(e.target.value)}
                className="w-full h-full bg-paper border border-rule p-3 font-mono text-[11px] text-ink focus:outline-none focus:border-accent leading-relaxed resize-none"
                style={{ minHeight: '320px' }}
                placeholder="将本章大纲片段粘贴在此..."
                autoFocus
              />
            </div>
            <div className="px-4 py-2 border-t border-rule shrink-0 text-[10px] text-ink-400">
              内容将在关闭前点击"保存"时写入数据库，生成正文时作为参考。
            </div>
          </div>
        </div>
      )}

      {/* Chapter content viewer modal */}
      {viewingChapter && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setViewingChapter(null)}
        >
          <div
            className="bg-paper border border-rule shadow-xl flex flex-col w-full max-w-2xl mx-4" style={{ maxHeight: '80vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-rule shrink-0">
              <h2 className="text-sm font-black font-display text-ink">{viewingChapter.title}</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(viewingChapter.content).then(() => alert('已复制！'))}
                  className="flex items-center gap-1 text-[10px] text-ink-400 hover:text-ink border border-rule px-2 py-1 bg-paper hover:bg-paper-100 transition"
                >
                  <Copy size={10} /> 复制
                </button>
                <button
                  onClick={() => setViewingChapter(null)}
                  className="text-ink-400 hover:text-ink p-1 transition"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <pre className="font-mono text-xs text-ink leading-relaxed whitespace-pre-wrap break-words">{viewingChapter.content}</pre>
            </div>
            <div className="px-4 py-2 border-t border-rule shrink-0">
              <span className="text-[10px] text-ink-400">{viewingChapter.content.length} 字符</span>
            </div>
          </div>
        </div>
      )}
      {/* Modals */}
      <TitleModal
        isOpen={showTitleModal}
        onClose={() => setShowTitleModal(false)}
        currentTitle={project?.title || ''}
        titleCandidates={titleOutput || project?.titleCandidates || ''}
        titleCustomPrompt={titleCustomPrompt}
        isGenerating={isGenerating && activeTask === 'title'}
        onSetCustomPrompt={setTitleCustomPrompt}
        onGenerate={handleGenerateTitleCandidates}
        onApplyTitle={async (title) => {
          const t = title.trim() || '未命名项目';
          await db.projects.update(projectId, { title: t });
          setEditingProjectTitle(t);
          setShowTitleModal(false);
        }}
      />
    </div>
  );
}
