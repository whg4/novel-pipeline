import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { ChatMessage } from '../types';
import { stripLogicReview, sanitizeMarkdownFileName, syncOutlineChaptersToDb } from '../utils/pipeline';
import {
  Sparkles, Layers, Edit3, Play, Download, PenLine
} from 'lucide-react';
import { usePipelineTask } from '../hooks/usePipelineTask';
import type { TaskControlRender } from '../hooks/usePipelineTask';
import { useOutlineGeneration } from '../hooks/useOutlineGeneration';
import { useChapterDrafting } from '../hooks/useChapterDrafting';
import { useMarketing } from '../hooks/useMarketing';
import { useAutoPipeline } from '../hooks/useAutoPipeline';
import TitleModal from '../components/TitleModal';
import OutlineStudio from '../components/pipeline/OutlineStudio';
import DraftingRoom from '../components/pipeline/DraftingRoom';
import MarketingKit from '../components/pipeline/MarketingKit';
import AutoPipelineProgress from '../components/pipeline/AutoPipelineProgress';
import PauseBanner from '../components/pipeline/PauseBanner';

interface PipelineViewProps {
  projectId: number;
}

export default function PipelineView({ projectId }: PipelineViewProps) {
  // ---- 全局查询 ----
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const chapters = useLiveQuery(() => db.chapters.where('projectId').equals(projectId).sortBy('chapterNumber'), [projectId]) || [];
  const skills = useLiveQuery(() => db.skills.toArray()) || [];

  const outlineChatMessages: ChatMessage[] = useLiveQuery<ChatMessage[], ChatMessage[]>(
    () => db.chatMessages.where('[projectId+scope]').equals([projectId, 'outline']).sortBy('createdAt') as any,
    [projectId],
    []
  );

  // ---- 任务控制 ----
  const taskCtrl = usePipelineTask();
  const { activeTask, pausedTask, setPausedTask, pauseMessage, setPauseMessage, pausedTaskRef } = taskCtrl;

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationOutput, setGenerationOutput] = useState('');
  const [pipelineTab, setPipelineTab] = useState<'outline' | 'drafting' | 'marketing'>('outline');
  const [editingProjectTitle, setEditingProjectTitle] = useState('');
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [showExampleModal, setShowExampleModal] = useState(false);
  const [showOutlineEditor, setShowOutlineEditor] = useState(false);
  const [showChapterOutlineEditor, setShowChapterOutlineEditor] = useState(false);
  const [showOutlineSkillPopover, setShowOutlineSkillPopover] = useState(false);
  const [showChapterSkillPopover, setShowChapterSkillPopover] = useState(false);
  const [viewingChapter, setViewingChapter] = useState<{ title: string; content: string } | null>(null);

  useEffect(() => {
    if (project?.title && !editingProjectTitle) {
      setEditingProjectTitle(project.title);
    }
  }, [project?.title]);

  // ---- Hook: 章节写作（需先定义以获取 activeChapterId）----
  const chapterDraftHook = useChapterDrafting(
    projectId, project, chapters, skills,
    taskCtrl, setIsGenerating,
  );

  // ---- Hook: 大纲生成 ----
  const outlineHook = useOutlineGeneration(
    projectId, project, skills, outlineChatMessages,
    taskCtrl, setIsGenerating, setGenerationOutput,
  );

  // ---- Hook: 营销 ----
  const marketingHook = useMarketing(
    projectId, project, chapters, skills,
    taskCtrl, setIsGenerating,
  );

  // ---- Hook: 自动流水线 ----
  const autoHook = useAutoPipeline(
    projectId, project, skills,
    { ...taskCtrl, pausedTaskRef },
    {
      setGenerationOutput,
      setEditingContent: chapterDraftHook.setEditingContent,
      setBlurbsOutput: marketingHook.setBlurbsOutput,
      setTitleOutput: marketingHook.setTitleOutput,
      setCoverPrompt: marketingHook.setCoverPrompt,
      setPausedTask,
      setPauseMessage,
      setIsGenerating,
    },
    chapterDraftHook.activeChapterId,
  );

  // ---- 共享工具 ----
  const renderTaskControl: TaskControlRender = () => null;

  const handleExportNovelMarkdown = () => {
    const exportChapters = [...chapters]
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .map((chapter) => ({
        ...chapter,
        content: chapter.id === chapterDraftHook.activeChapterId ? chapterDraftHook.editingDraft : chapter.content,
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

    const markdown = `# ${project?.title || '未命名小说'}\n\n${manuscript}\n`;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${sanitizeMarkdownFileName(project?.title || '')}-小说正文.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // ---- Loading Guard ----
  if (!project) {
    return (
      <div className="flex items-center justify-center p-12 text-[#888888]">
        <Sparkles size={36} className="animate-spin text-[#d4d4d4] mb-2" />
        <p className="text-sm">加载项目中...</p>
      </div>
    );
  }

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

          {!autoHook.isAutoRunning && !pausedTask && (
            <button
              onClick={() => autoHook.handleRunAutoPipeline(false)}
              disabled={isGenerating}
              className="flex items-center gap-1.5 bg-black hover:bg-[#333] disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 transition"
            >
              <Play size={12} /> 一键全自动
            </button>
          )}

          <div className="flex border-b border-[#eaeaea]">
            {(['outline', 'drafting', 'marketing'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setPipelineTab(tab)}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px ${
                  pipelineTab === tab ? 'border-black text-black' : 'border-transparent text-[#696b72] hover:text-[#171717]'
                }`}
              >
                {tab === 'outline' && <><Layers size={13} /> 第一阶段：大纲</>}
                {tab === 'drafting' && <><Edit3 size={13} /> 第二阶段：写作间</>}
                {tab === 'marketing' && <><Sparkles size={13} /> 第三阶段：推广</>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <PauseBanner pauseMessage={pauseMessage} pausedTask={pausedTask} />

      <AutoPipelineProgress
        isAutoRunning={autoHook.isAutoRunning}
        autoProgress={autoHook.autoProgress}
        onPause={() => taskCtrl.pauseCurrentTask(autoHook.autoPauseRef)}
        onResume={() => { autoHook.autoPauseRef.current = false; autoHook.handleRunAutoPipeline(true); }}
        onDismiss={() => autoHook.setAutoProgress(null)}
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
          outlineReviewOutput={outlineHook.outlineReviewOutput}
          outlineGenerationStatus={outlineHook.outlineGenerationStatus}
          outlineFeedback={outlineHook.outlineFeedback}
          outlineExtraSkillKeys={outlineHook.outlineExtraSkillKeys}
          outlineExtraSkillText={outlineHook.outlineExtraSkillText}
          showOutlineEditor={showOutlineEditor}
          showOutlineSkillPopover={showOutlineSkillPopover}
          showExampleModal={showExampleModal}
          outlineChatMessages={outlineChatMessages}
          handleGenerateOutline={outlineHook.handleGenerateOutline}
          handleReviewOutline={outlineHook.handleReviewOutline}
          handleOutlineChatSend={outlineHook.handleOutlineChatSend}
          handleClearOutlineChat={outlineHook.handleClearOutlineChat}
          handleUseOutlineReviewSuggestion={outlineHook.handleUseOutlineReviewSuggestion}
          onPause={() => taskCtrl.pauseCurrentTask(autoHook.autoPauseRef)}
          renderTaskControl={renderTaskControl}
          syncOutlineChaptersToDb={syncOutlineChaptersToDb}
          setShowOutlineEditor={setShowOutlineEditor}
          setShowOutlineSkillPopover={setShowOutlineSkillPopover}
          setShowExampleModal={setShowExampleModal}
          setOutlineExtraSkillKeys={outlineHook.setOutlineExtraSkillKeys}
          setOutlineExtraSkillText={outlineHook.setOutlineExtraSkillText}
        />
      )}

      {/* STAGE 2: DRAFTING ROOM */}
      {pipelineTab === 'drafting' && (
        <DraftingRoom
          project={project}
          chapters={chapters}
          skills={skills}
          activeChapterId={chapterDraftHook.activeChapterId}
          isGenerating={isGenerating}
          activeTask={activeTask}
          editingOutline={chapterDraftHook.editingOutline}
          editingDraft={chapterDraftHook.editingDraft}
          chapterError={chapterDraftHook.chapterError}
          greaseWarnings={chapterDraftHook.greaseWarnings}
          logicReviewOutput={chapterDraftHook.logicReviewOutput}
          chapterChatMessages={chapterDraftHook.chapterChatMessages}
          chapterExtraSkillKeys={chapterDraftHook.chapterExtraSkillKeys}
          chapterExtraSkillText={chapterDraftHook.chapterExtraSkillText}
          showChapterSkillPopover={showChapterSkillPopover}
          showChapterOutlineEditor={showChapterOutlineEditor}
          viewingChapter={viewingChapter}
          handleSelectChapter={chapterDraftHook.handleSelectChapter}
          handleCreateNewChapter={chapterDraftHook.handleCreateNewChapter}
          handleDeleteChapter={chapterDraftHook.handleDeleteChapter}
          handleSaveChapterManual={chapterDraftHook.handleSaveChapterManual}
          handleGenerateChapterStream={chapterDraftHook.handleGenerateChapterStream}
          handleExportChapterMarkdown={chapterDraftHook.handleExportChapterMarkdown}
          handleLogicReviewChapter={chapterDraftHook.handleLogicReviewChapter}
          handleChapterChatSend={chapterDraftHook.handleChapterChatSend}
          handleClearChapterChat={chapterDraftHook.handleClearChapterChat}
          handleUseReviewSuggestion={chapterDraftHook.handleUseReviewSuggestion}
          onPause={() => taskCtrl.pauseCurrentTask(autoHook.autoPauseRef)}
          renderTaskControl={renderTaskControl}
          setEditingOutline={chapterDraftHook.setEditingOutline}
          setChapterExtraSkillKeys={chapterDraftHook.setChapterExtraSkillKeys}
          setChapterExtraSkillText={chapterDraftHook.setChapterExtraSkillText}
          setShowChapterSkillPopover={setShowChapterSkillPopover}
          setShowChapterOutlineEditor={setShowChapterOutlineEditor}
          setViewingChapter={setViewingChapter}
        />
      )}

      {/* STAGE 3: MARKETING KIT */}
      {pipelineTab === 'marketing' && (
        <MarketingKit
          isAutoRunning={autoHook.isAutoRunning}
          activeTask={activeTask}
          blurbsOutput={marketingHook.blurbsOutput}
          coverPrompt={marketingHook.coverPrompt}
          coverImagePrompt={marketingHook.coverImagePrompt}
          coverImageUrl={marketingHook.coverImageUrl}
          isGeneratingCoverImage={marketingHook.isGeneratingCoverImage}
          coverImageError={marketingHook.coverImageError}
          handleGenerateMarketingKit={marketingHook.handleGenerateMarketingKit}
          handleGenerateCoverImage={marketingHook.handleGenerateCoverImage}
          handleCancelCoverImage={marketingHook.handleCancelCoverImage}
          renderTaskControl={renderTaskControl}
          setCoverImagePrompt={marketingHook.setCoverImagePrompt}
        />
      )}

      {/* Modals */}
      <TitleModal
        isOpen={showTitleModal}
        onClose={() => setShowTitleModal(false)}
        currentTitle={project?.title || ''}
        titleCandidates={marketingHook.titleOutput || project?.titleCandidates || ''}
        titleCustomPrompt={marketingHook.titleCustomPrompt}
        isGenerating={isGenerating && activeTask === 'title'}
        onSetCustomPrompt={marketingHook.setTitleCustomPrompt}
        onGenerate={marketingHook.handleGenerateTitleCandidates}
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
