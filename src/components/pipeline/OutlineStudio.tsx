import type { Dispatch, SetStateAction } from 'react';
import type { Project, Skill, ChatMessage } from '../../types';
import type { GenerationTask, TaskControlRender } from '../../hooks/usePipelineTask';
import { Button, Space, Popover, Checkbox } from 'antd';
import {
  ThunderboltOutlined,
  BookOutlined,
  EditOutlined,
  UploadOutlined,
  AuditOutlined,
  DownloadOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
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
  handleUseOutlineReviewSuggestion?: (reviewContent: string) => void;
  onPause: () => void;
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
  handleUseOutlineReviewSuggestion,
  onPause,
  renderTaskControl,
  syncOutlineChaptersToDb,
  setShowOutlineEditor,
  setShowOutlineSkillPopover,
  setShowExampleModal,
  setOutlineExtraSkillKeys,
  setOutlineExtraSkillText,
}: OutlineStudioProps) {
  // ── Skill 选择 Popover 内容 ──
  const skillPopoverContent = (
    <div style={{ minWidth: 200 }}>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {skills
          .filter((s) => !['workflow', 'blurb', 'outline_template'].includes(s.key))
          .map((s) => (
            <Checkbox
              key={s.key}
              checked={outlineExtraSkillKeys.includes(s.key)}
              onChange={(e) => {
                setOutlineExtraSkillKeys(
                  e.target.checked
                    ? [...outlineExtraSkillKeys, s.key]
                    : outlineExtraSkillKeys.filter((k: string) => k !== s.key),
                );
              }}
            >
              <span style={{ fontSize: 11 }}>{s.name}</span>
            </Checkbox>
          ))}
        <div
          style={{
            borderTop: '1px solid #eaeaea',
            paddingTop: 6,
            marginTop: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              color: '#888888',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <UploadOutlined style={{ fontSize: 9 }} /> 上传临时 Skill
            <input
              type="file"
              accept=".txt,.md"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) =>
                  setOutlineExtraSkillText((ev.target?.result as string) || '');
                reader.readAsText(file, 'utf-8');
                e.target.value = '';
                setShowOutlineSkillPopover(false);
              }}
            />
          </label>
          {outlineExtraSkillKeys.length > 0 && (
            <span style={{ fontSize: 9, color: '#000000', fontWeight: 700 }}>
              {outlineExtraSkillKeys.length} 已选
            </span>
          )}
        </div>
      </Space>
    </div>
  );

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
          await db.projects.update(projectId, {
            outline: merged,
            outlineValidationUpdatedAt: Date.now(),
          });
        }}
      />

      <ChatPanel
        messages={outlineChatMessages}
        isStreaming={isGenerating && (activeTask === 'outline' || activeTask === 'outline-review')}
        streamingContent={activeTask === 'outline' ? generationOutput : outlineReviewOutput}
        streamingLabel={
          activeTask === 'outline'
            ? outlineGenerationStatus || '生成大纲中...'
            : '审查大纲中...'
        }
        onSend={handleOutlineChatSend}
        onClear={handleClearOutlineChat}
        onPause={onPause}
        onUseReviewSuggestion={handleUseOutlineReviewSuggestion}
        disabled={!project}
        placeholder="输入修改意见后按 Enter 发送，或点击上方按钮直接生成大纲..."
        toolbar={
          <Space size={6} wrap>
            <Button
              type="primary"
              size="small"
              icon={
                <ThunderboltOutlined
                  spin={activeTask === 'outline' && isGenerating}
                />
              }
              disabled={isGenerating}
              onClick={() => handleOutlineChatSend('')}
            >
              {project.outline ? '重新生成' : '生成大纲'}
            </Button>
            {renderTaskControl('outline', () => handleGenerateOutline(true))}

            <Button
              size="small"
              icon={<ThunderboltOutlined />}
              disabled={isGenerating}
              onClick={() => {
                const slapContent =
                  skills.find((s) => s.key === 'female_slap')?.content || '';
                handleGenerateOutline(false, slapContent);
              }}
            >
              打脸闭环
            </Button>

            <Button
              size="small"
              icon={
                <AuditOutlined
                  spin={activeTask === 'outline-review' && isGenerating}
                />
              }
              disabled={isGenerating || !project.outline}
              onClick={() => handleReviewOutline()}
            >
              审查大纲
            </Button>
            {renderTaskControl('outline-review', () => handleReviewOutline(true))}

            <Button
              size="small"
              icon={<DownloadOutlined />}
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
            >
              导出 MD
            </Button>

            <Button
              size="small"
              icon={<BookOutlined />}
              disabled={isGenerating || !project.outline}
              onClick={async () => {
                const n = await syncOutlineChaptersToDb(project.outline, projectId);
                alert(
                  n > 0
                    ? `已同步 ${n} 个章节到数据库。`
                    : '未在大纲中找到章节（请确认包含"### 第 X 章："格式）。',
                );
              }}
            >
              同步章节
            </Button>

            <Popover
              content={skillPopoverContent}
              title="选择 Skill"
              trigger="click"
              open={showOutlineSkillPopover}
              onOpenChange={setShowOutlineSkillPopover}
              placement="topLeft"
            >
              <Button size="small" icon={<AppstoreOutlined />}>
                选择 Skill
              </Button>
            </Popover>

            <Button
              size="small"
              icon={<UploadOutlined />}
              onClick={() => setShowExampleModal(true)}
            >
              上传例文{project.rawExample ? ' ✓' : ''}
            </Button>

            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setShowOutlineEditor(true)}
            >
              编辑大纲
            </Button>
          </Space>
        }
      />

      <ExampleModal
        isOpen={showExampleModal}
        onClose={() => setShowExampleModal(false)}
        rawExample={project.rawExample || ''}
        onChange={(text) => {
          import('../../db').then(({ db }) =>
            db.projects.update(projectId, { rawExample: text }),
          );
        }}
        onSave={() => {/* saved via onChange */}}
      />
    </div>
  );
}
