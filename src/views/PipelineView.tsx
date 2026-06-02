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
import {
  Sparkles, Layers, Edit3, Play, Download, PenLine
} from 'lucide-react';
import { usePipelineTask } from '../hooks/usePipelineTask';
import type { TaskControlRender } from '../hooks/usePipelineTask';
import {
  stripLogicReview, sanitizeMarkdownFileName,
  syncOutlineChaptersToDb
} from '../utils/pipeline';
import TitleModal from '../components/TitleModal';
import OutlineStudio from '../components/pipeline/OutlineStudio';
import DraftingRoom from '../components/pipeline/DraftingRoom';
import MarketingKit from '../components/pipeline/MarketingKit';
import AutoPipelineProgress from '../components/pipeline/AutoPipelineProgress';
import PauseBanner from '../components/pipeline/PauseBanner';

interface PipelineViewProps {
  projectId: number;
}

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

export default function PipelineView({ projectId }: PipelineViewProps) {
  // Chapter selection
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null);

  // Query state
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const chapters = useLiveQuery(() => db.chapters.where('projectId').equals(projectId).sortBy('chapterNumber'), [projectId]) || [];

  // Sync project title into editing state when project first loads
  const [editingProjectTitle, setEditingProjectTitle] = useState('');
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

  // Shared task control hook
  const {
    activeTask,
    pausedTask, setPausedTask,
    pauseMessage, setPauseMessage,
    pausedTaskRef,
    beginGenerationTask, pauseCurrentTask, finishGenerationTask,
    isPausedError, markTaskPaused,
  } = usePipelineTask();

  // View States
  const [pipelineTab, setPipelineTab] = useState<'outline' | 'drafting' | 'marketing'>('outline');
  const [isGenerating, setIsGenerating] = useState(false);
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

  // Client-Side AI Greasing Text Analyzer
  useEffect(() => {
    if (!editingDraft) {
      setGreaseWarnings([]);
      return;
    }
    const foundWarnings: string[] = [];
    const badPatterns = [
      { regex: /眼神.*(暗|深|沉)/i, label: '"眼神一暗/变深" (Classic AI micro-expression cliché)' },
      { regex: /喉结.*(滚动|微动)/i, label: '"喉结滚动" (Oclushed AI micro-expression cliché)' },
      { regex: /指尖.*(颤|抖)/i, label: '"指尖发颤" (Cliché physical emotional highlight)' },
      { regex: /深吸.*口气/i, label: '"深吸一口气" (Frequent AI breath transition)' },
      { regex: /没有.*由于|没有.*迟疑/i, label: '"没有一丝犹豫" (Repetitive AI decision description)' },
      { regex: /(不单|不仅).*(甚至连)/i, label: '"不仅...甚至连..." (Pretentious AI rhetorical structure)' },
      { regex: /没有.*拉扯/i, label: '"没有拉扯" (AI pattern summary)' },
      { regex: /(自我认知|极端荒谬|在.*智谋面前|他不知道的是)/i, label: '"上帝视角分析" (Violates First-person/limited narrative constraints)' },
      { regex: /(像是在看.*滑稽|像是在看.*脑萎缩)/i, label: '"强行生硬刻薄比喻" (Violating clean anti-grease line)' }
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

  // Defined before the project guard so the useEffect above can safely reference it
  const handleSelectChapter = (ch: Chapter) => {
    setActiveChapterId(ch.id!);
    setEditingTitle(ch.title);
    setEditingOutline(ch.outlineSection);
    setEditingContent(ch.content);
    setChapterRegenerationPrompt(ch.regenerationPrompt || '');
  };

  // Shared renderTaskControl — 暂停已由 Sender onCancel 处理，此处只渲染 Resume 按钮
  const renderTaskControl: TaskControlRender = (task, onResume) => {
    if (pausedTask === task) {
      return (
        <button
          type="button"
          onClick={onResume}
          className="bg-black hover:bg-[#333] text-white text-xs font-bold px-3 py-1.5 flex items-center gap-1.5 transition"
        >
          <Play size={12} /> 继续
        </button>
      );
    }

    return null;
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
      <div className="flex items-center justify-center p-12 text-[#888888]">
        <Sparkles size={36} className="animate-spin text-[#d4d4d4] mb-2" />
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
    if (activeChapterId === null) return;
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
      if (!resume || !blurbsOutput) {
        const blurbCompiled = compileBlurbPrompt(project.outline, sampleText, blurbTemplate);
        let blurbAcc = resume ? blurbsOutput : '';
        await runLLMStream('marketing', blurbCompiled.system, blurbCompiled.user, tok => {
          blurbAcc += tok;
          setBlurbsOutput(blurbAcc);
        }, streamOptions);
      }

      if (!resume || !titleOutput) {
        const titleCompiled = compileTitlePrompt(project.outline);
        let titleAcc = resume ? titleOutput : '';
        await runLLMStream('marketing', titleCompiled.system, titleCompiled.user, tok => { titleAcc += tok; }, streamOptions);
        await db.projects.update(projectId, { titleCandidates: titleAcc });
        setTitleOutput(titleAcc);
      }

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

  // ----------------------------------------------------
  // 一键全自动流水线
  // ----------------------------------------------------
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

      // Step 1: 生成大纲
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

          setAutoProgress({ step: `逻辑审查大纲（第 ${attempt}/${OUTLINE_MAX_ATTEMPTS} 轮）`, current: 1, total: 7 });
          setOutlineGenerationStatus(`自动流水线逻辑审查大纲（第 ${attempt}/${OUTLINE_MAX_ATTEMPTS} 轮）...`);
          let reviewAcc = '';
          const reviewComp = compileOutlineLogicReviewPrompt(acc, logicSkill);
          await runLLMStream('outline', reviewComp.system, reviewComp.user, tok => {
            reviewAcc += tok;
          }, streamOptions);
          checkPause();

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
          throw new Error('未能从大纲中解析出章节（请确认大纲包含"### 第 X 章：标题"格式）');
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
            const _resumingReview = resumingReview;
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
    void reviewContent;
  };

  return (
    <div className="space-y-6">
      {/* 项目标题与导航 */}
      <div className="border-b border-[#171717] pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold text-[#888888] uppercase tracking-widest">当前项目</div>
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
              className="text-xl font-black font-sans text-[#171717] bg-transparent border-b border-transparent hover:border-[#eaeaea] focus:border-black focus:outline-none w-full max-w-xs"
              placeholder="项目书名（点击编辑）"
            />
            <button
              onClick={() => setShowTitleModal(true)}
              title="生成备选书名"
              className="p-1 text-[#888888] hover:text-black border border-[#eaeaea] hover:border-black bg-white hover:bg-[#f5f5f5] transition shrink-0"
            >
              <PenLine size={13} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleExportNovelMarkdown}
            className="flex items-center gap-1.5 bg-white border border-[#eaeaea] hover:bg-[#f5f5f5] text-[#696b72] text-xs font-bold px-3 py-1.5 transition"
          >
            <Download size={12} /> 导出小说
          </button>

          {!isAutoRunning && !pausedTask && (
            <button
              onClick={() => handleRunAutoPipeline(false)}
              disabled={isGenerating}
              className="flex items-center gap-1.5 bg-black hover:bg-[#333] disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 transition"
            >
              <Play size={12} /> 一键全自动
            </button>
          )}

          <div className="flex border-b border-[#eaeaea]">
            <button
              onClick={() => setPipelineTab('outline')}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px ${
                pipelineTab === 'outline' ? 'border-black text-black' : 'border-transparent text-[#696b72] hover:text-[#171717]'
              }`}
            >
              <Layers size={13} /> 第一阶段：大纲
            </button>
            <button
              onClick={() => setPipelineTab('drafting')}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px ${
                pipelineTab === 'drafting' ? 'border-black text-black' : 'border-transparent text-[#696b72] hover:text-[#171717]'
              }`}
            >
              <Edit3 size={13} /> 第二阶段：写作间
            </button>
            <button
              onClick={() => setPipelineTab('marketing')}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px ${
                pipelineTab === 'marketing' ? 'border-black text-black' : 'border-transparent text-[#696b72] hover:text-[#171717]'
              }`}
            >
              <Sparkles size={13} /> 第三阶段：推广
            </button>
          </div>
        </div>
      </div>

      <PauseBanner pauseMessage={pauseMessage} pausedTask={pausedTask} />

      <AutoPipelineProgress
        isAutoRunning={isAutoRunning}
        autoProgress={autoProgress}
        onPause={() => pauseCurrentTask(autoPauseRef)}
        onResume={() => { autoPauseRef.current = false; handleRunAutoPipeline(true); }}
        onDismiss={() => setAutoProgress(null)}
      />

      {/* STAGE 1: OUTLINE STUDIO */}
      {pipelineTab === 'outline' && (
        <OutlineStudio
          projectId={projectId}
          project={project}
          skills={skills}
          isGenerating={isGenerating}
          activeTask={activeTask}
          generationOutput={generationOutput}
          outlineReviewOutput={outlineReviewOutput}
          outlineGenerationStatus={outlineGenerationStatus}
          outlineFeedback={outlineFeedback}
          outlineExtraSkillKeys={outlineExtraSkillKeys}
          outlineExtraSkillText={outlineExtraSkillText}
          showOutlineEditor={showOutlineEditor}
          showOutlineSkillPopover={showOutlineSkillPopover}
          showExampleModal={showExampleModal}
          outlineChatMessages={outlineChatMessages}
          handleGenerateOutline={handleGenerateOutline}
          handleReviewOutline={handleReviewOutline}
          handleOutlineChatSend={handleOutlineChatSend}
          handleClearOutlineChat={handleClearOutlineChat}
          onPause={() => pauseCurrentTask(autoPauseRef)}
          renderTaskControl={renderTaskControl}
          syncOutlineChaptersToDb={syncOutlineChaptersToDb}
          setShowOutlineEditor={setShowOutlineEditor}
          setShowOutlineSkillPopover={setShowOutlineSkillPopover}
          setShowExampleModal={setShowExampleModal}
          setOutlineExtraSkillKeys={setOutlineExtraSkillKeys}
          setOutlineExtraSkillText={setOutlineExtraSkillText}
        />
      )}

      {/* STAGE 2: DRAFTING ROOM */}
      {pipelineTab === 'drafting' && (
        <DraftingRoom
          project={project}
          chapters={chapters}
          skills={skills}
          activeChapterId={activeChapterId}
          isGenerating={isGenerating}
          activeTask={activeTask}
          editingOutline={editingOutline}
          editingDraft={editingDraft}
          chapterError={chapterError}
          greaseWarnings={greaseWarnings}
          logicReviewOutput={logicReviewOutput}
          chapterChatMessages={chapterChatMessages}
          chapterExtraSkillKeys={chapterExtraSkillKeys}
          chapterExtraSkillText={chapterExtraSkillText}
          showChapterSkillPopover={showChapterSkillPopover}
          showChapterOutlineEditor={showChapterOutlineEditor}
          viewingChapter={viewingChapter}
          handleSelectChapter={handleSelectChapter}
          handleCreateNewChapter={handleCreateNewChapter}
          handleSaveChapterManual={handleSaveChapterManual}
          handleGenerateChapterStream={handleGenerateChapterStream}
          handleExportChapterMarkdown={handleExportChapterMarkdown}
          handleLogicReviewChapter={handleLogicReviewChapter}
          handleChapterChatSend={handleChapterChatSend}
          handleClearChapterChat={handleClearChapterChat}
          handleUseReviewSuggestion={handleUseReviewSuggestion}
          onPause={() => pauseCurrentTask(autoPauseRef)}
          renderTaskControl={renderTaskControl}
          setEditingOutline={setEditingOutline}
          setChapterExtraSkillKeys={setChapterExtraSkillKeys}
          setChapterExtraSkillText={setChapterExtraSkillText}
          setShowChapterSkillPopover={setShowChapterSkillPopover}
          setShowChapterOutlineEditor={setShowChapterOutlineEditor}
          setViewingChapter={setViewingChapter}
        />
      )}

      {/* STAGE 3: MARKETING KIT */}
      {pipelineTab === 'marketing' && (
        <MarketingKit
          isAutoRunning={isAutoRunning}
          activeTask={activeTask}
          blurbsOutput={blurbsOutput}
          coverPrompt={coverPrompt}
          coverImagePrompt={coverImagePrompt}
          coverImageUrl={coverImageUrl}
          isGeneratingCoverImage={isGeneratingCoverImage}
          coverImageError={coverImageError}
          handleGenerateMarketingKit={handleGenerateMarketingKit}
          handleGenerateCoverImage={handleGenerateCoverImage}
          handleCancelCoverImage={handleCancelCoverImage}
          renderTaskControl={renderTaskControl}
          setCoverImagePrompt={setCoverImagePrompt}
        />
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
