import type { Dispatch, SetStateAction } from 'react';
import type { Project, Skill, ChatMessage } from '../../types';
import type { GenerationTask, TaskControlRender } from '../../hooks/usePipelineTask';
import {
  Sparkles, BookOpen, Layers, Edit3, FileUp,
  FileSearch, Download
} from 'lucide-react';
import ChatPanel from '../ChatPanel';
import OutlineEditorModal from '../OutlineEditorModal';
import ExampleModal from '../ExampleModal';
import { splitOutlineSections } from '../../utils/pipeline';

interface OutlineStudioProps {
  projectId: number;
  project: Project;
  skills: Skill[];
  isGenerating: boolean;
  activeTask: GenerationTask | null;
  generationOutput: string;
  outlineReviewOutput: string;
  outlineGenerationStatus: string;
  outlineFeedback: string;
  outlineExtraSkillKeys: string[];
  outlineExtraSkillText: string;
  showOutlineEditor: boolean;
  showOutlineSkillPopover: boolean;
  showExampleModal: boolean;
  outlineChatMessages: ChatMessage[];
  handleGenerateOutline: (resume?: boolean, extraSlapSkill?: string, feedbackOverride?: string) => void;
  handleReviewOutline: (resume?: boolean) => void;
  handleOutlineChatSend: (userText: string) => void;
  handleClearOutlineChat: () => void;
  renderTaskControl: TaskControlRender;
  syncOutlineChaptersToDb: (outline: string, projectId: number) => Promise<number>;
  setShowOutlineEditor: Dispatch<SetStateAction<boolean>>;
  setShowOutlineSkillPopover: Dispatch<SetStateAction<boolean>>;
  setShowExampleModal: Dispatch<SetStateAction<boolean>>;
  setOutlineExtraSkillKeys: (v: string[]) => void;
  setOutlineExtraSkillText: (v: string) => void;
}

export default function OutlineStudio({
  projectId,
  project,
  skills,
  isGenerating,
  activeTask,
  generationOutput,
  outlineReviewOutput,
  outlineGenerationStatus,
  outlineExtraSkillKeys,
  showOutlineEditor,
  showOutlineSkillPopover,
  showExampleModal,
  outlineChatMessages,
  handleGenerateOutline,
  handleReviewOutline,
  handleOutlineChatSend,
  handleClearOutlineChat,
  renderTaskControl,
  syncOutlineChaptersToDb,
  setShowOutlineEditor,
  setShowOutlineSkillPopover,
  setShowExampleModal,
  setOutlineExtraSkillKeys,
  setOutlineExtraSkillText,
}: OutlineStudioProps) {
  return (
    <div className="space-y-4">
      <OutlineEditorModal
        isOpen={showOutlineEditor}
        onClose={() => setShowOutlineEditor(false)}
        outline={splitOutlineSections(project.outline || '').main}
        onSave={async (val: string) => {
          const { preamble, checklist, appendix } = splitOutlineSections(project.outline);
          const merged = [preamble, val, checklist, appendix].filter(Boolean).join('\n\n');
          const { db } = await import('../../db');
          await db.projects.update(projectId, { outline: merged, outlineValidationUpdatedAt: Date.now() });
        }}
      />

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
            <button
              disabled={isGenerating}
              onClick={() => handleOutlineChatSend('')}
              className="flex items-center gap-1 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-[10px] font-bold px-2.5 py-1.5 transition"
            >
              <Sparkles size={10} className={activeTask === 'outline' && isGenerating ? 'animate-spin' : ''} />
              {project.outline ? '重新生成' : '生成大纲'}
            </button>
            {renderTaskControl('outline', () => handleGenerateOutline(true))}

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

            <button
              disabled={isGenerating || !project.outline}
              onClick={() => handleReviewOutline()}
              className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 disabled:opacity-50 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
            >
              <FileSearch size={10} className={activeTask === 'outline-review' && isGenerating ? 'animate-spin' : ''} />
              审查大纲
            </button>
            {renderTaskControl('outline-review', () => handleReviewOutline(true))}

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

            <button
              onClick={() => setShowExampleModal(true)}
              className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
            >
              <FileUp size={10} /> 上传例文{project.rawExample ? ' ✓' : ''}
            </button>

            <button
              onClick={() => setShowOutlineEditor(true)}
              className="flex items-center gap-1 bg-paper border border-rule hover:bg-paper-100 text-ink-500 text-[10px] font-bold px-2.5 py-1.5 transition"
            >
              <Edit3 size={10} /> 编辑大纲
            </button>
          </>
        }
      />

      <ExampleModal
        isOpen={showExampleModal}
        onClose={() => setShowExampleModal(false)}
        rawExample={project.rawExample || ''}
        onChange={(text) => {
          import('../../db').then(({ db }) => db.projects.update(projectId, { rawExample: text }));
        }}
        onSave={() => {/* saved via onChange */}}
      />
    </div>
  );
}
