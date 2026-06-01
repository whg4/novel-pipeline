import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { APIConfig, Chapter, LLMProviderId, OutlineChecklistKey, OutlineValidationResult, StageAssignments, StageRole } from '../types';
import {
  runLLMStream, compileOutlinePrompt, compileChapterPrompt, compileBlurbPrompt,
  compileLogicReviewPrompt, compileTitlePrompt, compileCoverPrompt,
  getConfigForStage, getStageAssignments, saveStageAssignments,
  saveStageModelOverride, validateOutlineAgainstChecklist
} from '../services/llm';
import { getProviderPreset, PROVIDER_PRESETS } from '../services/providers';
import { 
  Sparkles, BookOpen, Layers, Edit3, 
  CheckSquare, Plus, Save, Copy, 
  AlertTriangle, RefreshCw, Play, Pause, FileSearch, Type, ImageIcon, Download, Cpu
} from 'lucide-react';

interface PipelineViewProps {
  projectId: number;
}

const OUTLINE_MAX_ATTEMPTS = 3;

const OUTLINE_CHECKLIST_ITEMS: { key: OutlineChecklistKey; title: string }[] = [
  { key: 'a_rhythm', title: '1:1 内核情绪、节奏、爽点复刻' },
  { key: 'b_no_jargon', title: '名词下沉 (无高科技、生僻、AI味名词)' },
  { key: 'c_differences', title: '细节数值差异化 (不同于原著数值)' },
  { key: 'd_payback', title: '前情免费章悬念伏笔与高潮必回收' },
  { key: 'e_motives', title: '强制打脸前摇 (反派合理化/崩溃链)' },
  { key: 'f_logic_time', title: '严密逻辑 (伤势处理、时间线差管理)' },
  { key: 'g_transition', title: '渣男觉醒层次感 (误导、信息差物证)' },
  { key: 'h_item_consistency', title: '物证流转状态一致性 (前毁后残)' },
  { key: 'i_no_pose', title: '大女主行为高光 (离开时引爆社会核弹)' },
  { key: 'j_cliffhangers', title: '章末强力倒计时与悬念勾子' },
];

const STAGE_MODEL_ITEMS: { stage: StageRole; label: string }[] = [
  { stage: 'outline', label: '大纲' },
  { stage: 'chapter', label: '正文' },
  { stage: 'review', label: '审查' },
  { stage: 'marketing', label: '营销' },
];

function createChecklistState(value = false): Record<OutlineChecklistKey, boolean> {
  return OUTLINE_CHECKLIST_ITEMS.reduce((acc, item) => {
    acc[item.key] = value;
    return acc;
  }, {} as Record<OutlineChecklistKey, boolean>);
}

function checklistStateFromValidation(result: OutlineValidationResult): Record<OutlineChecklistKey, boolean> {
  return OUTLINE_CHECKLIST_ITEMS.reduce((acc, item) => {
    acc[item.key] = Boolean(result.items.find(candidate => candidate.key === item.key)?.passed);
    return acc;
  }, {} as Record<OutlineChecklistKey, boolean>);
}

function buildStageConfigs(): Record<StageRole, APIConfig> {
  return STAGE_MODEL_ITEMS.reduce((acc, item) => {
    acc[item.stage] = getConfigForStage(item.stage);
    return acc;
  }, {} as Record<StageRole, APIConfig>);
}

function buildValidationFeedback(result: OutlineValidationResult): string {
  return result.items
    .filter(item => !item.passed)
    .map(item => `- ${item.key}: ${item.reason}`)
    .join('\n');
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
  // Query state
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const chapters = useLiveQuery(() => db.chapters.where('projectId').equals(projectId).sortBy('chapterNumber'), [projectId]) || [];
  const skills = useLiveQuery(() => db.skills.toArray()) || [];

  // View States
  const [pipelineTab, setPipelineTab] = useState<'outline' | 'drafting' | 'marketing'>('outline');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationOutput, setGenerationOutput] = useState('');

  // ----------------------------------------------------
  // SUB-TAB 1: OUTLINE STUDIO STATE
  // ----------------------------------------------------
  const [outlineChecklist, setOutlineChecklist] = useState<Record<OutlineChecklistKey, boolean>>(createChecklistState());
  const [outlineValidationResult, setOutlineValidationResult] = useState<OutlineValidationResult | null>(null);
  const [outlineGenerationStatus, setOutlineGenerationStatus] = useState('');
  const [stageAssignments, setStageAssignments] = useState<StageAssignments>(getStageAssignments);
  const [stageConfigs, setStageConfigs] = useState<Record<StageRole, APIConfig>>(buildStageConfigs);
  const [activeStageTab, setActiveStageTab] = useState<StageRole>(STAGE_MODEL_ITEMS[0].stage);

  // ----------------------------------------------------
  // SUB-TAB 2: DRAFTING ROOM STATE
  // ----------------------------------------------------
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingOutline, setEditingOutline] = useState('');
  const [editingDraft, setEditingContent] = useState('');
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [greaseWarnings, setGreaseWarnings] = useState<string[]>([]);
  const [draftChecklist, setDraftChecklist] = useState<Record<string, boolean>>({
    timeline: false,
    place: false,
    item_consistent: false,
    item_possession: false,
    avoid_omniscience: false,
    avoid_loop: false,
    stitched_start: false
  });

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

  // 自动流水线状态
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState<{ step: string; current: number; total: number } | null>(null);
  const autoPauseRef = useRef(false);

  // 章节逻辑审查输出
  const [logicReviewOutput, setLogicReviewOutput] = useState('');

  useEffect(() => {
    if (!project?.outlineValidationResult) return;
    setOutlineValidationResult(project.outlineValidationResult);
    setOutlineChecklist(checklistStateFromValidation(project.outlineValidationResult));
  }, [project?.outlineValidationUpdatedAt]);

  const handlePipelineStageProviderChange = (stage: StageRole, provider: LLMProviderId) => {
    const nextAssignments = { ...stageAssignments, [stage]: provider };
    setStageAssignments(nextAssignments);
    saveStageAssignments(nextAssignments);
    saveStageModelOverride(stage, '');
    setStageConfigs({ ...buildStageConfigs(), [stage]: getConfigForStage(stage) });
  };

  const handlePipelineStageModelChange = (stage: StageRole, model: string) => {
    setStageConfigs(prev => ({
      ...prev,
      [stage]: {
        ...(prev[stage] ?? getConfigForStage(stage)),
        model,
      },
    }));
    saveStageModelOverride(stage, model);
  };

  // Defined before the project guard so the useEffect above can safely reference it
  const handleSelectChapter = (ch: Chapter) => {
    setActiveChapterId(ch.id!);
    setEditingTitle(ch.title);
    setEditingOutline(ch.outlineSection);
    setEditingContent(ch.content);
    setDraftChecklist({
      timeline: false,
      place: false,
      item_consistent: false,
      item_possession: false,
      avoid_omniscience: false,
      avoid_loop: false,
      stitched_start: false
    });
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
  const handleGenerateOutline = async () => {
    setIsGenerating(true);
    setGenerationOutput('');
    setOutlineGenerationStatus('准备生成大纲...');
    setOutlineValidationResult(null);
    setOutlineChecklist(createChecklistState());
    const template = skills.find(s => s.key === 'outline_template')?.content || '';
    
    try {
      let validationFeedback = '';
      let latestOutline = '';
      let latestValidation: OutlineValidationResult | null = null;

      for (let attempt = 1; attempt <= OUTLINE_MAX_ATTEMPTS; attempt++) {
        setOutlineGenerationStatus(`生成大纲中（第 ${attempt}/${OUTLINE_MAX_ATTEMPTS} 轮）...`);
        setGenerationOutput('');

        const compiled = compileOutlinePrompt(
          project.rawExample,
          project.background,
          project.characters,
          template,
          validationFeedback
        );

        let accumulated = '';
        await runLLMStream('outline', compiled.system, compiled.user, (tok) => {
          accumulated += tok;
          setGenerationOutput(accumulated);
        });
        latestOutline = accumulated;

        setOutlineGenerationStatus(`自检清单审查中（第 ${attempt}/${OUTLINE_MAX_ATTEMPTS} 轮）...`);
        latestValidation = await validateOutlineAgainstChecklist(
          accumulated,
          OUTLINE_CHECKLIST_ITEMS,
          template,
          {
            background: project.background,
            characters: project.characters,
            rawExample: project.rawExample,
          },
          attempt
        );
        setOutlineValidationResult(latestValidation);
        setOutlineChecklist(checklistStateFromValidation(latestValidation));

        if (latestValidation.passed) {
          await db.projects.update(projectId, {
            outline: accumulated,
            outlineValidationStatus: 'valid',
            outlineValidationResult: latestValidation,
            outlineValidationUpdatedAt: Date.now(),
          });
          await syncOutlineChaptersToDb(accumulated, projectId);
          setOutlineGenerationStatus('大纲已通过自检并同步章节。');
          return;
        }

        validationFeedback = buildValidationFeedback(latestValidation);
        if (attempt < OUTLINE_MAX_ATTEMPTS) {
          setOutlineGenerationStatus(`自检未通过，正在按失败项重新生成（下一轮 ${attempt + 1}/${OUTLINE_MAX_ATTEMPTS}）...`);
        }
      }

      if (latestValidation) {
        await db.projects.update(projectId, {
          outline: latestOutline,
          outlineValidationStatus: 'invalid',
          outlineValidationResult: latestValidation,
          outlineValidationUpdatedAt: Date.now(),
        });
      }
      setOutlineGenerationStatus('自检未通过：已保留最新草稿，请根据失败项调整后再生成。');
    } catch (e: any) {
      alert(`大纲生成失败：${e.message}`);
      setOutlineGenerationStatus('大纲生成失败。');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUpdateOutlineManual = async (val: string) => {
    await db.projects.update(projectId, {
      outline: val,
      outlineValidationStatus: undefined,
      outlineValidationResult: undefined,
      outlineValidationUpdatedAt: Date.now(),
    });
    setOutlineValidationResult(null);
    setOutlineChecklist(createChecklistState());
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

  const handleGenerateChapterStream = async () => {
    if (activeChapterId === null) return;
    setIsGenerating(true);
    setChapterError(null);
    setEditingContent('');
    
    // Determine preceding chapters for stich context
    const prevChapters = chapters.filter(c => c.chapterNumber < (chapters.find(x => x.id === activeChapterId)?.chapterNumber || 0));

    try {
      const isWerewolf = project.genre === 'classic-wolf';
      const isFemaleSlap = project.genre === 'female-slap';

      const compiled = compileChapterPrompt(
        project.outline,
        chapters.find(c => c.id === activeChapterId)?.chapterNumber || 1,
        editingOutline,
        prevChapters,
        skills,
        isWerewolf,
        isFemaleSlap
      );

      let accumulated = '';
      await runLLMStream('chapter', compiled.system, compiled.user, (tok) => {
        accumulated += tok;
        setEditingContent(accumulated);
      });

      // Update db directly
      await db.chapters.update(activeChapterId, {
        content: accumulated,
        lastEdited: Date.now()
      });

      setIsGenerating(false);
    } catch (e: any) {
      setChapterError(e.message);
      setIsGenerating(false);
    }
  };

  // ----------------------------------------------------
  // ENGINE 3: MARKETING SHORTS
  // ----------------------------------------------------
  const handleGenerateMarketingKit = async () => {
    setIsGenerating(true);
    setBlurbsOutput('');
    setTitleOutput('');
    setCoverPrompt('');
    const blurbTemplate = skills.find(s => s.key === 'blurb')?.content || '';
    const sampleText = chapters.slice(0, 3).map(c => c.content).join('\n\n');

    try {
      // 1. 生成简介
      const blurbCompiled = compileBlurbPrompt(project.outline, sampleText, blurbTemplate);
      let blurbAcc = '';
      await runLLMStream('marketing', blurbCompiled.system, blurbCompiled.user, tok => {
        blurbAcc += tok;
        setBlurbsOutput(blurbAcc);
      });

      // 2. 生成书名候选
      const titleCompiled = compileTitlePrompt(project.outline);
      let titleAcc = '';
      await runLLMStream('marketing', titleCompiled.system, titleCompiled.user, tok => { titleAcc += tok; });
      await db.projects.update(projectId, { titleCandidates: titleAcc });
      setTitleOutput(titleAcc);

      // 3. 生成封面提示词
      const coverCompiled = compileCoverPrompt(project.outline, project.genre);
      let coverAcc = '';
      await runLLMStream('marketing', coverCompiled.system, coverCompiled.user, tok => { coverAcc += tok; });
      await db.projects.update(projectId, { coverPrompt: coverAcc });
      setCoverPrompt(coverAcc);

      setIsGenerating(false);
    } catch (e: any) {
      alert(`推广素材生成失败：${e.message}`);
      setIsGenerating(false);
    }
  };

  // Helper copy text
  const handleCopyText = (txt: string) => {
    // Extract everything above "---" if found (to get clean story separate from log check)
    const splitIndex = txt.indexOf('---');
    const cleanDraft = splitIndex !== -1 ? txt.substring(0, splitIndex).trim() : txt;

    navigator.clipboard.writeText(cleanDraft);
    alert('正文已复制到剪贴板（审查内容已排除）。');
  };

  // 单章 AI 逻辑审查
  const handleLogicReviewChapter = async (ch: Chapter) => {
    if (!ch.content || ch.content.length < 50) {
      alert('该章节还没有正文，无法进行逻辑审查。');
      return;
    }
    setIsGenerating(true);
    setLogicReviewOutput('');
    const logicSkill = skills.find(s => s.key === 'logic_check')?.content || '';
    try {
      const compiled = compileLogicReviewPrompt(ch.content, ch.chapterNumber, logicSkill);
      let acc = '';
      await runLLMStream('review', compiled.system, compiled.user, tok => {
        acc += tok;
        setLogicReviewOutput(acc);
      });
      await db.chapters.update(ch.id!, { logicCheckLog: acc });
    } catch (e: any) {
      alert(`逻辑审查失败：${e.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // 一键全自动流水线
  const handleRunAutoPipeline = async () => {
    if (!project || isGenerating || isAutoRunning) return;
    setIsAutoRunning(true);
    setIsGenerating(true);
    autoPauseRef.current = false;

    const checkPause = () => {
      if (autoPauseRef.current) throw new Error('__PAUSED__');
    };

    try {
      const logicSkill = skills.find(s => s.key === 'logic_check')?.content || '';
      const blurbSkill = skills.find(s => s.key === 'blurb')?.content || '';
      const outlineTemplate = skills.find(s => s.key === 'outline_template')?.content || '';

      // Step 1: 生成大纲（若已有则跳过）
      let currentOutline = project.outline;
      if (!currentOutline || currentOutline.length < 50) {
        let validationFeedback = '';
        let latestValidation: OutlineValidationResult | null = null;

        for (let attempt = 1; attempt <= OUTLINE_MAX_ATTEMPTS; attempt++) {
          setAutoProgress({ step: `生成大纲（第 ${attempt}/${OUTLINE_MAX_ATTEMPTS} 轮）`, current: 1, total: 7 });
          setOutlineGenerationStatus(`自动流水线生成大纲中（第 ${attempt}/${OUTLINE_MAX_ATTEMPTS} 轮）...`);
          setGenerationOutput('');

          const compiled = compileOutlinePrompt(
            project.rawExample,
            project.background,
            project.characters,
            outlineTemplate,
            validationFeedback
          );
          let acc = '';
          await runLLMStream('outline', compiled.system, compiled.user, tok => {
            acc += tok;
            setGenerationOutput(acc);
          });
          currentOutline = acc;
          checkPause();

          setAutoProgress({ step: `自检大纲（第 ${attempt}/${OUTLINE_MAX_ATTEMPTS} 轮）`, current: 1, total: 7 });
          setOutlineGenerationStatus(`自动流水线自检大纲中（第 ${attempt}/${OUTLINE_MAX_ATTEMPTS} 轮）...`);
          latestValidation = await validateOutlineAgainstChecklist(
            acc,
            OUTLINE_CHECKLIST_ITEMS,
            outlineTemplate,
            {
              background: project.background,
              characters: project.characters,
              rawExample: project.rawExample,
            },
            attempt
          );
          setOutlineValidationResult(latestValidation);
          setOutlineChecklist(checklistStateFromValidation(latestValidation));

          if (latestValidation.passed) {
            await db.projects.update(projectId, {
              outline: acc,
              outlineValidationStatus: 'valid',
              outlineValidationResult: latestValidation,
              outlineValidationUpdatedAt: Date.now(),
            });
            break;
          }

          validationFeedback = buildValidationFeedback(latestValidation);
          if (attempt === OUTLINE_MAX_ATTEMPTS) {
            await db.projects.update(projectId, {
              outline: acc,
              outlineValidationStatus: 'invalid',
              outlineValidationResult: latestValidation,
              outlineValidationUpdatedAt: Date.now(),
            });
            throw new Error('大纲自检未通过，已停止自动流水线。请查看失败项后重新生成。');
          }
          checkPause();
        }
        checkPause();
      }

      // Step 2: 解析并同步章节结构
      setAutoProgress({ step: '解析章节结构', current: 2, total: 7 });
      const parsedCount = await syncOutlineChaptersToDb(currentOutline, projectId);
      if (parsedCount === 0) {
        throw new Error('未能从大纲中解析出章节（请确认大纲包含“### 第 X 章：标题”格式）');
      }
      checkPause();

      // Step 3-N: 逐章生成正文 + 逻辑审查
      const allChapters = await db.chapters
        .where('projectId').equals(projectId)
        .sortBy('chapterNumber');

      const totalSteps = 2 + allChapters.length * 2 + 2;

      for (let i = 0; i < allChapters.length; i++) {
        const ch = allChapters[i];
        const prevChs = allChapters.slice(0, i);

        setAutoProgress({ step: `生成第 ${ch.chapterNumber} 章正文`, current: 2 + i * 2 + 1, total: totalSteps });
        if (!ch.content || ch.content.length < 100) {
          const chComp = compileChapterPrompt(
            currentOutline, ch.chapterNumber, ch.outlineSection, prevChs,
            skills, project.genre === 'classic-wolf', project.genre === 'female-slap'
          );
          let draftAcc = '';
          await runLLMStream('chapter', chComp.system, chComp.user, tok => { draftAcc += tok; });
          await db.chapters.update(ch.id!, { content: draftAcc, lastEdited: Date.now() });
          allChapters[i] = { ...ch, content: draftAcc };
          if (activeChapterId === ch.id) setEditingContent(draftAcc);
        }
        checkPause();

        setAutoProgress({ step: `审查第 ${ch.chapterNumber} 章逻辑`, current: 2 + i * 2 + 2, total: totalSteps });
        const content = allChapters[i].content;
        if (content && logicSkill) {
          const reviewComp = compileLogicReviewPrompt(content, ch.chapterNumber, logicSkill);
          let reviewAcc = '';
          await runLLMStream('review', reviewComp.system, reviewComp.user, tok => { reviewAcc += tok; });
          await db.chapters.update(ch.id!, { logicCheckLog: reviewAcc });
          if (activeChapterId === ch.id) setLogicReviewOutput(reviewAcc);
        }
        checkPause();
      }

      // 生成简介
      setAutoProgress({ step: '生成爆款简介', current: totalSteps - 1, total: totalSteps });
      const latestChapters = await db.chapters.where('projectId').equals(projectId).sortBy('chapterNumber');
      const sampleText = latestChapters.slice(0, 3).map(c => c.content).join('\n\n');
      const blurbComp = compileBlurbPrompt(currentOutline, sampleText, blurbSkill);
      let blurbAcc = '';
      await runLLMStream('marketing', blurbComp.system, blurbComp.user, tok => { blurbAcc += tok; setBlurbsOutput(blurbAcc); });
      checkPause();

      // 生成书名与封面
      setAutoProgress({ step: '生成书名与封面提示词', current: totalSteps, total: totalSteps });
      const titleComp = compileTitlePrompt(currentOutline);
      let titleAcc = '';
      await runLLMStream('marketing', titleComp.system, titleComp.user, tok => { titleAcc += tok; });
      await db.projects.update(projectId, { titleCandidates: titleAcc });
      setTitleOutput(titleAcc);

      const coverComp = compileCoverPrompt(currentOutline, project.genre);
      let coverAcc = '';
      await runLLMStream('marketing', coverComp.system, coverComp.user, tok => { coverAcc += tok; });
      await db.projects.update(projectId, { coverPrompt: coverAcc });
      setCoverPrompt(coverAcc);

      setAutoProgress({ step: '全部完成 ✓', current: totalSteps, total: totalSteps });
    } catch (e: any) {
      if (e.message === '__PAUSED__') {
        setAutoProgress(prev => prev ? { ...prev, step: '已暂停（点击继续）' } : null);
      } else {
        alert(`自动流水线执行出错：${e.message}`);
        setAutoProgress(null);
      }
    } finally {
      setIsAutoRunning(false);
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 项目标题与导航 */}
      <div className="border-b-2 border-ink pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold text-ink-400 uppercase tracking-widest">当前项目</div>
          <h1 className="text-xl font-black font-display text-ink mt-0.5">{project.title}</h1>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* 一键全自动按鈕 */}
          <button
            onClick={handleRunAutoPipeline}
            disabled={isGenerating || isAutoRunning}
            className="flex items-center gap-1.5 bg-grove hover:bg-grove-muted disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 transition"
          >
            <Play size={12} className={isAutoRunning ? 'animate-pulse' : ''} />
            {isAutoRunning ? '运行中...' : '一键全自动'}
          </button>

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

      <div className="bg-paper-50 border border-rule p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs font-bold text-ink flex items-center gap-1.5">
              <Cpu size={14} className="text-accent" /> 阶段模型
            </div>
            <p className="text-[10px] text-ink-400 mt-0.5">每个阶段可独立选择供应商与模型，立即保存到本地配置。</p>
          </div>
          <span className="text-[10px] text-ink-400 bg-paper border border-rule px-2 py-1 font-semibold">
            输出 token 默认不限制
          </span>
        </div>

        <div className="space-y-3">
          {/* Stage tabs */}
          <div className="flex gap-0 border border-rule overflow-hidden">
            {STAGE_MODEL_ITEMS.map(({ stage, label }) => {
              const assigned = stageAssignments[stage];
              const preset = getProviderPreset(assigned);
              const isActive = activeStageTab === stage;
              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => setActiveStageTab(stage)}
                  className={`flex-1 px-3 py-2 text-xs font-semibold transition flex flex-col items-center gap-0.5 ${
                    isActive
                      ? 'bg-accent text-white'
                      : 'bg-paper-50 text-ink-400 hover:text-ink hover:bg-paper'
                  }`}
                >
                  <span>{label}</span>
                  <span className={`text-[10px] font-mono font-normal ${
                    isActive ? 'text-white/80' : 'text-accent'
                  }`}>{preset.shortName}</span>
                </button>
              );
            })}
          </div>

          {/* Active stage detail */}
          {(() => {
            const stage = activeStageTab;
            const assignedProvider = stageAssignments[stage];
            const config = stageConfigs[stage] ?? getConfigForStage(stage);
            const preset = getProviderPreset(assignedProvider);
            return (
              <div className="bg-paper border border-rule p-3 space-y-2">
                <select
                  value={assignedProvider}
                  onChange={(event) => handlePipelineStageProviderChange(stage, event.target.value as LLMProviderId)}
                  className="w-full bg-paper-50 border border-rule px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                  disabled={isGenerating || isAutoRunning}
                >
                  {PROVIDER_PRESETS.map(provider => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={config.model}
                  onChange={(event) => handlePipelineStageModelChange(stage, event.target.value)}
                  className="w-full bg-paper-50 border border-rule px-2 py-1.5 text-xs text-ink font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                  disabled={isGenerating || isAutoRunning}
                />
                <div className="flex flex-wrap gap-1.5">
                  {preset.modelSuggestions.slice(0, 3).map(model => (
                    <button
                      type="button"
                      key={model}
                      onClick={() => handlePipelineStageModelChange(stage, model)}
                      disabled={isGenerating || isAutoRunning}
                      className={`text-[10px] px-2 py-0.5 border font-semibold transition disabled:opacity-50 ${
                        config.model === model
                          ? 'bg-accent text-white border-accent'
                          : 'bg-paper-50 text-ink-400 border-rule hover:text-ink hover:border-rule-dark'
                      }`}
                    >
                      {model}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

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
              onClick={() => { autoPauseRef.current = true; }}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3 py-1.5 transition shrink-0"
            >
              <Pause size={12} /> 暂停
            </button>
          ) : autoProgress?.step !== '全部完成 ✓' && autoProgress && (
            <button
              onClick={() => { autoPauseRef.current = false; handleRunAutoPipeline(); }}
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-paper-50 border border-rule p-5 flex flex-col h-[calc(100vh-240px)]">
              <div className="flex-1 flex flex-col gap-3 min-h-0">
                <div className="flex justify-between items-center pb-2 border-b border-rule shrink-0">
                  <h3 className="text-sm font-bold text-ink flex items-center gap-1.5">
                    <Layers size={15} className="text-accent" /> 大纲编辑
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={!project.outline}
                      onClick={() => {
                        const blob = new Blob([project.outline], { type: 'text/markdown' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${project.title || '大纲'}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="bg-paper border border-rule hover:bg-paper-100 disabled:opacity-50 text-ink-500 text-xs font-bold px-3 py-1.5 flex items-center gap-1.5 transition"
                    >
                      <Download size={12} /> 导出 MD
                    </button>
                    <button
                      disabled={isGenerating}
                      onClick={async () => {
                        const n = await syncOutlineChaptersToDb(project.outline, projectId);
                        alert(n > 0 ? `已同步 ${n} 个章节到数据库。` : '未在大纲中找到章节（请确认包含“### 第 X 章：”格式）。');
                      }}
                      className="bg-paper border border-rule hover:bg-paper-100 disabled:opacity-50 text-ink-500 text-xs font-bold px-3 py-1.5 flex items-center gap-1.5 transition"
                    >
                      <BookOpen size={12} /> 同步章节
                    </button>
                    <button
                      disabled={isGenerating}
                      onClick={handleGenerateOutline}
                      className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-bold px-3.5 py-1.5 flex items-center gap-1.5 transition"
                    >
                      <Sparkles size={12} className={isGenerating ? 'animate-spin' : ''} />
                      {project.outline ? '重新生成' : '生成大纲'}
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0">
                  {isGenerating && !generationOutput ? (
                    <div className="flex flex-col items-center justify-center py-20 text-ink-400 space-y-2">
                      <RefreshCw size={24} className="animate-spin text-ink-300" />
                      <p className="text-xs">{outlineGenerationStatus || '正在调用模型生成大纲...'}</p>
                    </div>
                  ) : (
                    <textarea
                      value={isGenerating ? generationOutput : project.outline}
                      onChange={(e) => handleUpdateOutlineManual(e.target.value)}
                      className="w-full h-full bg-paper border border-rule p-4 font-mono text-ink text-xs focus:ring-1 focus:ring-accent focus:outline-none leading-relaxed resize-none"
                      placeholder="大纲将在此生成。填写背景、人物设定与参考模板后，点击「生成大纲」..."
                    />
                  )}
                </div>
              </div>

              {project.outline && (
                <div className="flex justify-end pt-2">
                  <span className="text-[10px] text-ink-400 bg-paper-100 border border-rule px-2 py-1 inline-block font-semibold">
                    {project.outlineValidationStatus === 'valid'
                      ? '✓ 大纲已通过自检并保存。'
                      : project.outlineValidationStatus === 'invalid'
                        ? '✕ 大纲未通过自检，已保留最新草稿。'
                        : '✓ 大纲已生成并保存，可直接编辑。'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Checklist: 仿写大纲自检清单 */}
          <div className="space-y-4">
            <div className="bg-paper-50 border border-rule p-4 space-y-4">
              <h3 className="text-xs font-bold text-accent uppercase tracking-widest flex items-center gap-1.5">
                <CheckSquare size={13} /> 仿写大纲自检清单
              </h3>
              <p className="text-[10px] text-ink-400 leading-normal">
                生成后自动按《仿写大纲输出格式模板 v3.0》逐项验证；未通过会最多重试 {OUTLINE_MAX_ATTEMPTS} 轮。
              </p>

              {(outlineGenerationStatus || outlineValidationResult) && (
                <div className={`border p-3 text-[11px] leading-relaxed ${
                  outlineValidationResult?.passed
                    ? 'bg-grove-light border-grove/40 text-grove'
                    : outlineValidationResult
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : 'bg-paper border-rule text-ink-500'
                }`}>
                  <div className="font-bold">
                    {outlineValidationResult?.passed ? '自检通过' : outlineValidationResult ? '自检未通过' : '自检状态'}
                  </div>
                  <div className="mt-1">
                    {outlineValidationResult?.summary || outlineGenerationStatus}
                  </div>
                </div>
              )}

              <div className="space-y-2.5">
                {OUTLINE_CHECKLIST_ITEMS.map((item) => {
                  const itemResult = outlineValidationResult?.items.find(result => result.key === item.key);
                  const passed = outlineChecklist[item.key];

                  return (
                  <label
                    key={item.key}
                    className={`flex items-start gap-3 bg-paper border p-2.5 cursor-pointer transition ${
                      itemResult && !itemResult.passed ? 'border-red-200' : 'border-rule hover:border-rule-dark'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={passed}
                      onChange={(e) => setOutlineChecklist({ ...outlineChecklist, [item.key]: e.target.checked })}
                      className="rounded accent-[#9b2d20] shrink-0 cursor-pointer mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className={`block text-[11px] font-medium leading-tight ${
                        passed ? 'text-ink-400 line-through' : 'text-ink'
                      }`}>
                        {item.title}
                      </span>
                      {itemResult && !itemResult.passed && (
                        <span className="block mt-1 text-[10px] text-red-700 leading-snug">
                          {itemResult.reason}
                        </span>
                      )}
                    </span>
                  </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
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
                    {ch.content ? (
                      <span className="text-[9px] px-1.5 py-0.5 bg-grove-light font-bold border border-grove/30 text-grove">
                        {ch.content.length} words
                      </span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.5 bg-paper-100 font-bold text-ink-400 border border-rule">
                        empty
                      </span>
                    )}
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

          {/* Core Text Editor Grid */}
          <div className="xl:col-span-2 space-y-4">
            {activeChapterId !== null ? (
              <div className="bg-paper-50 border border-rule p-5 flex flex-col justify-between min-h-[500px] h-[calc(100vh-240px)]">
                <div className="flex flex-col h-full space-y-4">
                  {/* Top toolbar */}
                  <div className="flex flex-col sm:flex-row gap-3 justify-between sm:items-center border-b border-rule pb-3">
                    <div className="flex items-center gap-2 flex-grow max-w-sm">
                      <span className="text-[10px] font-mono bg-accent-faint text-accent px-2 py-1 border border-accent/20 shrink-0">
                        第 {chapters.find(c => c.id === activeChapterId)?.chapterNumber || 1} 章
                      </span>
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        className="bg-transparent border-b border-transparent hover:border-rule focus:border-accent focus:outline-none text-sm font-bold text-ink w-full py-0.5"
                        placeholder="章节标题"
                      />
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={handleSaveChapterManual}
                        className="p-1 px-2 hover:bg-paper-100 text-ink-500 border border-rule text-xs font-semibold flex items-center gap-1 transition"
                        title="保存草稿"
                      >
                        <Save size={12} /> 保存草稿
                      </button>

                      <button
                        disabled={isGenerating}
                        onClick={() => {
                          const ch = chapters.find(c => c.id === activeChapterId);
                          if (ch) handleLogicReviewChapter(ch);
                        }}
                        className="hover:bg-paper-100 disabled:opacity-50 text-grove border border-rule text-xs px-2.5 py-1.5 flex items-center gap-1.5 transition font-bold"
                        title="AI 逻辑审查"
                      >
                        <FileSearch size={12} className={isGenerating ? 'animate-spin' : ''} />
                        逻辑审查
                      </button>

                      <button
                        disabled={isGenerating}
                        onClick={handleGenerateChapterStream}
                        className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs px-3.5 py-1.5 flex items-center gap-1.5 transition font-bold"
                      >
                        <Sparkles size={12} className={isGenerating ? 'animate-spin' : ''} />
                        生成正文
                      </button>
                    </div>
                    {chapterError && (
                      <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 px-3 py-2 leading-relaxed">
                        <span className="font-bold">生成失败：</span>{chapterError}
                        <span className="ml-2 text-ink-400">（请在「阶段模型」中切换为可用模型）</span>
                      </div>
                    )}
                  </div>

                  {/* Dual Grid: Local Chapter Outline Requirements & Main Story Content */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 h-[80%]">
                    {/* Tiny Outline box for current single chapter */}
                    <div className="md:col-span-1 bg-paper-50 p-2.5 border border-rule flex flex-col justify-between space-y-2 h-full">
                      <div className="space-y-1 h-[100%] flex flex-col">
                        <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider">
                          本章大纲要求
                        </label>
                        <textarea
                          value={editingOutline}
                          onChange={(e) => setEditingOutline(e.target.value)}
                          className="w-full flex-1 bg-paper-50 border border-rule p-2.5 font-sans text-[11px] text-ink focus:outline-none focus:border-rule-dark leading-relaxed resize-none h-[100%]"
                          placeholder="将本章大纲片段粘贴在此（可从大纲编辑框复制）..."
                        />
                      </div>
                    </div>

                    {/* Main Core Editor */}
                    <div className="md:col-span-2 relative h-full flex flex-col">
                      <div className="absolute top-2 right-2 z-10 flex gap-2">
                        {editingDraft && (
                          <button
                            onClick={() => handleCopyText(editingDraft)}
                            className="p-1 px-2 bg-paper-100 border border-rule hover:bg-paper text-[10px] text-ink-500 font-bold flex items-center gap-1 transition"
                            title="Copy clean narrative"
                          >
                            <Copy size={11} /> 复制正文
                          </button>
                        )}
                      </div>
                      <textarea
                        value={isGenerating && !editingDraft ? generationOutput : editingDraft}
                        onChange={(e) => setEditingContent(e.target.value)}
                        className="w-full flex-1 h-full bg-paper-50 border border-rule p-4 pr-10 font-mono text-xs text-ink focus:ring-1 focus:ring-accent focus:outline-none leading-relaxed resize-none"
                        placeholder="正文将在此生成..."
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center text-[10px] text-ink-400 mt-2 border-t border-rule pt-2 font-semibold">
                  <span className="flex items-center gap-1.5">
                    字数：<strong className="font-mono text-ink">{editingDraft.length}</strong>
                  </span>
                  <span>每次重新生成时自动保存版本历史（最多 5 版）。</span>
                </div>
              </div>
            ) : (
              <div className="bg-paper border border-rule border-dashed p-16 text-center space-y-3">
                <Edit3 className="mx-auto text-ink-300" size={32} />
                <h4 className="font-bold text-ink text-sm">请选择章节</h4>
                <p className="text-ink-400 text-xs max-w-xs mx-auto">从左侧列表选择一个章节，或新建章节开始写作。</p>
                <button
                  onClick={handleCreateNewChapter}
                  className="border border-rule bg-paper hover:bg-paper-100 text-ink-500 font-semibold px-4 py-1.5 text-xs"
                >
                  新建章节
                </button>
              </div>
            )}
          </div>

          {/* Dynamic Reviewer Right Column: Anti-Grease Warning + Logic Reviews */}
          <div className="xl:col-span-1 space-y-4">
            {/* 1. Client-Side Anti-Grease Warn Card */}
            {greaseWarnings.length > 0 && (
              <div className="bg-accent-pale border border-accent/40 p-4 space-y-2">
                <div className="flex items-center gap-2 text-accent">
                  <AlertTriangle size={15} />
                  <h3 className="text-xs font-bold uppercase tracking-wider">去油警告</h3>
                </div>
                <p className="text-[10px] text-accent/80 leading-normal">
                  正文中检测到典型 AI 套路词句，请对照修改：
                </p>
                <ul className="space-y-1">
                  {greaseWarnings.map((warn, i) => (
                    <li key={i} className="text-[10px] text-ink font-bold flex items-start gap-1.5 before:content-['•'] before:text-accent" >
                      {warn}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* AI 逻辑审查报告 */}
            {(logicReviewOutput || chapters.find(c => c.id === activeChapterId)?.logicCheckLog) && (
              <div className="bg-grove-light border border-grove/40 p-4 space-y-2">
                <div className="flex items-center gap-2 text-grove">
                  <FileSearch size={15} />
                  <h3 className="text-xs font-bold uppercase tracking-wider">AI 逻辑审查报告</h3>
                </div>
                <pre className="text-[10px] text-ink-600 leading-relaxed whitespace-pre-wrap font-sans">
                  {logicReviewOutput || chapters.find(c => c.id === activeChapterId)?.logicCheckLog}
                </pre>
              </div>
            )}

            {/* 2. Interactive Logic Checklist */}
            <div className="bg-paper-50 border border-rule p-4 space-y-4">
              <h3 className="text-xs font-bold text-accent uppercase tracking-widest flex items-center gap-1.5">
                <CheckSquare size={13} /> 逻辑自查 v3.2
              </h3>
              <p className="text-[10px] text-ink-400 leading-normal">
                对照《小说正文逻辑审查流程 v3.2》检查当前章节，逐项打勾确认：
              </p>

              <div className="space-y-2">
                {[
                  { key: 'timeline', label: '时间线审查 (时间锚点/转场完美咬合)' },
                  { key: 'place', label: '地点/行程检测 (无突然瞬移、场景重置)' },
                  { key: 'item_consistent', label: '道具名词同章绝对一致 (不突变)' },
                  { key: 'item_possession', label: '取用路径完整 (角色确实拥有该物品)' },
                  { key: 'avoid_omniscience', label: '严禁越界知道 (无越过信息的上帝视角)' },
                  { key: 'avoid_loop', label: '无重伤下一秒活蹦乱跳/违背材质逻辑' },
                  { key: 'stitched_start', label: '物理接合 (章开头与前尾无缝贴合并无断层)' }
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex items-start gap-2.5 bg-paper border border-rule hover:border-rule-dark p-2.5 cursor-pointer transition"
                  >
                    <input
                      type="checkbox"
                      checked={draftChecklist[item.key]}
                      onChange={(e) => setDraftChecklist({ ...draftChecklist, [item.key]: e.target.checked })}
                      className="rounded accent-[#9b2d20] shrink-0 mt-0.5 cursor-pointer"
                    />
                    <span className={`text-[11px] leading-tight ${
                      draftChecklist[item.key] ? 'text-ink-400 line-through' : 'text-ink'
                    }`}>
                      {item.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
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
                    disabled={isGenerating}
                    onClick={handleGenerateMarketingKit}
                    className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-bold px-3.5 py-1.5 flex items-center gap-1.5 transition"
                  >
                    <Sparkles size={12} className={isGenerating ? 'animate-spin' : ''} />
                    一键生成推广素材
                  </button>
                </div>

                <div className="flex-1">
                  {isGenerating && !blurbsOutput ? (
                    <div className="flex flex-col items-center justify-center py-20 text-ink-400 space-y-2">
                      <RefreshCw size={24} className="animate-spin text-ink-300" />
                      <p className="text-xs">正在生成...</p>
                    </div>
                  ) : (
                    <textarea
                      readOnly
                      value={blurbsOutput}
                      className="w-full h-[320px] bg-paper border border-rule p-4 font-mono text-ink text-xs focus:ring-1 focus:ring-accent focus:outline-none leading-relaxed resize-none"
                      placeholder="点击“一键生成推广素材”后，此处将生成 3 个风格各异的爆款简介..."
                    />
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
            {/* 书名候选 */}
            <div className="bg-paper-50 border border-rule p-4 space-y-3">
              <div className="flex justify-between items-center pb-2 border-b border-rule">
                <h3 className="text-sm font-bold text-ink flex items-center gap-1.5">
                  <Type size={14} className="text-accent" /> 书名候选
                </h3>
                <button
                  disabled={isGenerating}
                  onClick={async () => {
                    setIsGenerating(true);
                    setTitleOutput('');
                    try {
                      const comp = compileTitlePrompt(project.outline);
                      let acc = '';
                      await runLLMStream('marketing', comp.system, comp.user, tok => { acc += tok; setTitleOutput(acc); });
                      await db.projects.update(projectId, { titleCandidates: acc });
                    } catch (e: any) {
                      alert(`书名生成失败：${e.message}`);
                    } finally {
                      setIsGenerating(false);
                    }
                  }}
                  className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 flex items-center gap-1.5 transition"
                >
                  <Sparkles size={12} className={isGenerating ? 'animate-spin' : ''} /> 生成书名
                </button>
              </div>
              {titleOutput ? (
                <div className="space-y-2">
                  <pre className="text-xs text-ink leading-relaxed whitespace-pre-wrap font-sans">{titleOutput}</pre>
                  <button
                    onClick={() => { navigator.clipboard.writeText(titleOutput); alert('书名候选已复制！'); }}
                    className="text-xs text-accent hover:text-accent-hover font-semibold"
                  >
                    复制全部书名
                  </button>
                </div>
              ) : (
                <div className="text-center py-6 text-ink-300 border border-rule border-dashed">
                  <Type size={20} className="mx-auto mb-2" />
                  <span className="text-[10px] font-semibold block">点击“生成书名”，根据大纲生成 8 个备选书名。</span>
                </div>
              )}
            </div>

            {/* 封面提示词 */}
            <div className="bg-paper-50 border border-rule p-4 space-y-4">
              <h3 className="text-xs font-bold text-accent uppercase tracking-widest flex items-center gap-1.5">
                <ImageIcon size={13} /> 封面提示词
              </h3>
              <p className="text-[10px] text-ink-400 leading-normal">
                用于 DALL-E 3 / Midjourney 等 AI 绘图模型的竖版封面生成提示词：
              </p>

              {coverPrompt ? (
                <div className="space-y-3">
                  <textarea
                    readOnly
                    value={coverPrompt}
                    className="w-full h-32 bg-paper border border-rule p-2.5 font-mono text-[10px] text-ink resize-none focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(coverPrompt);
                      alert('Cover prompt copied text!');
                    }}
                    className="w-full border border-rule bg-paper hover:bg-paper-100 text-ink text-center font-bold text-xs py-2 transition"
                  >
                    复制提示词
                  </button>
                </div>
              ) : (
                <div className="text-center py-8 text-ink-300 border border-rule bg-paper">
                  <span className="text-[10px] font-semibold block">点击左侧“一键生成推广素材”后，此处将自动生成封面提示词。</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
