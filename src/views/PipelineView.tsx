import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { message as antdMessage, Dropdown } from 'antd';
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
  const [userManuallySwitched, setUserManuallySwitched] = useState(false);
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

  // 状态驱动 Tab 自动切换（仅首次进入时生效，用户手动切换后不再干预）
  useEffect(() => {
    if (!project || userManuallySwitched) return;
    const hasOutline = project.outline && project.outline.length >= 50;
    const hasContent = chapters.some(c => c.content && c.content.length >= 100);

    if (!hasOutline) setPipelineTab('outline');
    else if (hasOutline && !hasContent) setPipelineTab('drafting');
    else if (hasContent) setPipelineTab('drafting');
  }, [project?.outline, chapters.length]);

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
      antdMessage.warning('还没有可导出的章节正文。');
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
            chapters.length > 1 ? (
              <Dropdown
                menu={{
                  items: [
                    { key: 'all', label: '从头开始（全部）', onClick: () => autoHook.handleRunAutoPipeline(false) },
                    { type: 'divider' as const },
                    ...chapters.map((ch, i) => ({
                      key: `ch-${i}`,
                      label: `从第 ${ch.chapterNumber} 章开始`,
                      disabled: !project.outline || project.outline.length < 50,
                      onClick: () => autoHook.handleRunAutoPipeline(false, i),
                    })),
                  ],
                }}
                trigger={['click']}
              >
                <button
                  disabled={isGenerating}
                  className="flex items-center gap-1.5 bg-black hover:bg-[#333] disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 transition"
                >
                  <Play size={12} /> 一键全自动 ▾
                </button>
              </Dropdown>
            ) : (
              <button
                onClick={() => autoHook.handleRunAutoPipeline(false)}
                disabled={isGenerating}
                className="flex items-center gap-1.5 bg-black hover:bg-[#333] disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 transition"
              >
                <Play size={12} /> 一键全自动
              </button>
            )
          )}

          {/* 状态引导卡片 */}
          {(() => {
            const hasOutline = project.outline && project.outline.length >= 50;
            const hasContent = chapters.filter(c => c.content && c.content.length >= 100).length;
            const totalChapters = chapters.length;

            if (!hasOutline) {
              return (
                <div className="bg-[#f0f5ff] border border-[#d6e4ff] px-4 py-2.5 mb-2 flex items-center gap-3 text-xs">
                  <span className="text-[#1677ff] font-bold">📝 第一步</span>
                  <span className="text-[#333]">点击「一键全自动」或「生成大纲」开始创作</span>
                  {!project.rawExample && (
                    <span className="text-[#fa8c16] ml-auto font-semibold">⚠ 请先上传例文</span>
                  )}
                </div>
              );
            }
            if (hasOutline && !hasContent) {
              return (
                <div className="bg-[#f6ffed] border border-[#d9f7be] px-4 py-2.5 mb-2 flex items-center gap-3 text-xs">
                  <span className="text-[#52c41a] font-bold">📖 第二步</span>
                  <span className="text-[#333]">大纲已就绪，共 {totalChapters} 章。切换到「写作间」逐章生成正文</span>
                </div>
              );
            }
            if (hasContent > 0 && hasContent < totalChapters) {
              return (
                <div className="bg-[#fff7e6] border border-[#ffe0b2] px-4 py-2.5 mb-2 flex items-center gap-3 text-xs">
                  <span className="text-[#fa8c16] font-bold">✍️ 进行中</span>
                  <span className="text-[#333]">已完成 {hasContent}/{totalChapters} 章。继续写作或使用「一键全自动」补全剩余章节</span>
                </div>
              );
            }
            return null;
          })()}

          <div className="flex border-b border-[#eaeaea]">
            {(['outline', 'drafting', 'marketing'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => { setPipelineTab(tab); setUserManuallySwitched(true); }}
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
          outlineExtraSkillKeys={outlineHook.outlineExtraSkillKeys}
          outlineExtraSkillTexts={outlineHook.outlineExtraSkillTexts}
          showOutlineEditor={showOutlineEditor}
          showOutlineSkillPopover={showOutlineSkillPopover}
          showExampleModal={showExampleModal}
          outlineChatMessages={outlineChatMessages}
          handleGenerateOutline={outlineHook.handleGenerateOutline}
          handleReviewOutline={outlineHook.handleReviewOutline}
          handleOutlineChatSend={outlineHook.handleOutlineChatSend}
          handleClearOutlineChat={outlineHook.handleClearOutlineChat}
          handleUseOutlineReviewSuggestion={outlineHook.handleUseOutlineReviewSuggestion}
          onRegenerate={() => outlineHook.handleOutlineChatSend('')}
          onEditResend={outlineHook.handleEditResendOutline}
          onPause={() => taskCtrl.pauseCurrentTask(autoHook.autoPauseRef)}
          renderTaskControl={renderTaskControl}
          syncOutlineChaptersToDb={syncOutlineChaptersToDb}
          setShowOutlineEditor={setShowOutlineEditor}
          setShowOutlineSkillPopover={setShowOutlineSkillPopover}
          setShowExampleModal={setShowExampleModal}
          setOutlineExtraSkillKeys={outlineHook.setOutlineExtraSkillKeys}
          setOutlineExtraSkillTexts={outlineHook.setOutlineExtraSkillTexts}
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
          saveStatus={chapterDraftHook.saveStatus}
          activeTask={activeTask}
          editingOutline={chapterDraftHook.editingOutline}
          editingDraft={chapterDraftHook.editingDraft}
          chapterError={chapterDraftHook.chapterError}
          greaseWarnings={chapterDraftHook.greaseWarnings}
          logicReviewOutput={chapterDraftHook.logicReviewOutput}
          chapterChatMessages={chapterDraftHook.chapterChatMessages}
          chapterExtraSkillKeys={chapterDraftHook.chapterExtraSkillKeys}
          chapterExtraSkillTexts={chapterDraftHook.chapterExtraSkillTexts}
          showChapterSkillPopover={showChapterSkillPopover}
          showChapterOutlineEditor={showChapterOutlineEditor}
          viewingChapter={viewingChapter}
          handleSelectChapter={chapterDraftHook.handleSelectChapter}
          handleCreateNewChapter={chapterDraftHook.handleCreateNewChapter}
          handleDeleteChapter={chapterDraftHook.handleDeleteChapter}
          handleClearAllChapters={chapterDraftHook.handleClearAllChapters}
          handleSaveChapterManual={chapterDraftHook.handleSaveChapterManual}
          handleGenerateChapterStream={chapterDraftHook.handleGenerateChapterStream}
          handleExportChapterMarkdown={chapterDraftHook.handleExportChapterMarkdown}
          handleLogicReviewChapter={chapterDraftHook.handleLogicReviewChapter}
          handleChapterChatSend={chapterDraftHook.handleChapterChatSend}
          handleClearChapterChat={chapterDraftHook.handleClearChapterChat}
          handleUseReviewSuggestion={chapterDraftHook.handleUseReviewSuggestion}
          onRegenerate={() => chapterDraftHook.handleChapterChatSend('')}
          onEditResend={chapterDraftHook.handleEditResendChapter}
          onPause={() => taskCtrl.pauseCurrentTask(autoHook.autoPauseRef)}
          renderTaskControl={renderTaskControl}
          setEditingOutline={chapterDraftHook.setEditingOutline}
          setChapterExtraSkillKeys={chapterDraftHook.setChapterExtraSkillKeys}
          setChapterExtraSkillTexts={chapterDraftHook.setChapterExtraSkillTexts}
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
