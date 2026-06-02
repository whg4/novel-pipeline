import type { Dispatch, SetStateAction } from 'react';
import type { Project, Chapter, Skill, ChatMessage } from '../../types';
import type { GenerationTask, TaskControlRender } from '../../hooks/usePipelineTask';
import {
  BookOpen, Edit3, Plus, Save, Download,
  AlertTriangle, Sparkles, FileSearch, FileUp,
  Layers, Eye, X
} from 'lucide-react';
import ChatPanel from '../ChatPanel';
import { db } from '../../db';

interface DraftingRoomProps {
  project: Project;
  chapters: Chapter[];
  skills: Skill[];
  activeChapterId: number | null;
  isGenerating: boolean;
  activeTask: GenerationTask | null;
  editingOutline: string;
  editingDraft: string;
  chapterError: string | null;
  greaseWarnings: string[];
  logicReviewOutput: string;
  chapterChatMessages: ChatMessage[];
  chapterExtraSkillKeys: string[];
  chapterExtraSkillText: string;
  showChapterSkillPopover: boolean;
  showChapterOutlineEditor: boolean;
  viewingChapter: { title: string; content: string } | null;
  handleSelectChapter: (ch: Chapter) => void;
  handleCreateNewChapter: () => void;
  handleSaveChapterManual: () => void;
  handleGenerateChapterStream: (resume?: boolean, promptOverride?: string, extraSkillTextOverride?: string) => void;
  handleExportChapterMarkdown: (ch: Chapter) => void;
  handleLogicReviewChapter: (ch: Chapter, resume?: boolean) => void;
  handleChapterChatSend: (userText: string, extraSkillTextOverride?: string) => void;
  handleClearChapterChat: () => void;
  handleUseReviewSuggestion: (reviewContent: string) => void;
  renderTaskControl: TaskControlRender;
  setEditingOutline: Dispatch<SetStateAction<string>>;
  setChapterExtraSkillKeys: (v: string[]) => void;
  setChapterExtraSkillText: (v: string) => void;
  setShowChapterSkillPopover: Dispatch<SetStateAction<boolean>>;
  setShowChapterOutlineEditor: Dispatch<SetStateAction<boolean>>;
  setViewingChapter: (v: { title: string; content: string } | null) => void;
}

export default function DraftingRoom({
  chapters,
  skills,
  activeChapterId,
  isGenerating,
  activeTask,
  editingOutline,
  editingDraft,
  chapterError,
  greaseWarnings,
  logicReviewOutput,
  chapterChatMessages,
  chapterExtraSkillKeys,
  showChapterSkillPopover,
  showChapterOutlineEditor,
  viewingChapter,
  handleSelectChapter,
  handleCreateNewChapter,
  handleSaveChapterManual,
  handleGenerateChapterStream,
  handleExportChapterMarkdown,
  handleLogicReviewChapter,
  handleChapterChatSend,
  handleClearChapterChat,
  handleUseReviewSuggestion,
  renderTaskControl,
  setEditingOutline,
  setChapterExtraSkillKeys,
  setChapterExtraSkillText,
  setShowChapterSkillPopover,
  setShowChapterOutlineEditor,
  setViewingChapter,
}: DraftingRoomProps) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
      {/* Chapter selector sidebar */}
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
                <button
                  onClick={handleSaveChapterManual}
                  className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                >
                  <Save size={10} /> 保存草稿
                </button>

                <button
                  onClick={() => {
                    const ch = chapters.find(c => c.id === activeChapterId);
                    if (ch) handleExportChapterMarkdown(ch);
                  }}
                  className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
                >
                  <Download size={10} /> 导出单章
                </button>

                <button
                  disabled={isGenerating}
                  onClick={() => handleChapterChatSend('')}
                  className="flex items-center gap-1 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-[10px] font-bold px-2.5 py-1.5 transition"
                >
                  <Sparkles size={10} className={activeTask === 'chapter' && isGenerating ? 'animate-spin' : ''} />
                  {chapters.find(c => c.id === activeChapterId)?.content ? '重新生成' : '生成正文'}
                </button>
                {renderTaskControl('chapter', () => handleGenerateChapterStream(true))}

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
                  复制
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
    </div>
  );
}
