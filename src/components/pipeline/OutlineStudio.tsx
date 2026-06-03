import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Project, Skill, ChatMessage } from '../../types';
import type { GenerationTask, TaskControlRender } from '../../hooks/usePipelineTask';
import { Button, Space, Dropdown, Tooltip, Modal, message as antdMessage } from 'antd';
import {
  ThunderboltOutlined,
  EditOutlined,
  UploadOutlined,
  AuditOutlined,
  DownloadOutlined,
  AppstoreOutlined,
  MoreOutlined,
  SyncOutlined,
  BookOutlined,
} from '@ant-design/icons';
import ChatPanel from '../ChatPanel';
import OutlineEditorModal from '../OutlineEditorModal';
import ExampleModal from '../ExampleModal';
import SkillSelectorModal from '../SkillSelectorModal';
import CollapsibleOutline from '../CollapsibleOutline';
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
  outlineExtraSkillTexts: string[];
  showOutlineEditor: boolean;
  showOutlineSkillPopover: boolean;
  showExampleModal: boolean;
  outlineChatMessages: ChatMessage[];
  handleGenerateOutline: (resume?: boolean, extraSlapSkill?: string, feedbackOverride?: string) => void;
  handleReviewOutline: (resume?: boolean) => void;
  handleOutlineChatSend: (userText: string) => void;
  handleClearOutlineChat: () => void;
  handleUseOutlineReviewSuggestion?: (reviewContent: string) => void;
  onRegenerate?: () => void;
  onEditResend?: (messageId: number, newContent: string) => void;
  onPause: () => void;
  renderTaskControl: TaskControlRender;
  syncOutlineChaptersToDb: (outline: string, projectId: number) => Promise<number>;
  setShowOutlineEditor: Dispatch<SetStateAction<boolean>>;
  setShowOutlineSkillPopover: Dispatch<SetStateAction<boolean>>;
  setShowExampleModal: Dispatch<SetStateAction<boolean>>;
  setOutlineExtraSkillKeys: (v: string[]) => void;
  setOutlineExtraSkillTexts: (v: string[]) => void;
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
  outlineExtraSkillTexts,
  showOutlineEditor,
  showOutlineSkillPopover,
  showExampleModal,
  outlineChatMessages,
  handleGenerateOutline,
  handleReviewOutline,
  handleOutlineChatSend,
  handleClearOutlineChat,
  handleUseOutlineReviewSuggestion,
  onRegenerate,
  onEditResend,
  onPause,
  renderTaskControl,
  syncOutlineChaptersToDb,
  setShowOutlineEditor,
  setShowOutlineSkillPopover,
  setShowExampleModal,
  setOutlineExtraSkillKeys,
  setOutlineExtraSkillTexts,
}: OutlineStudioProps) {
  const [showOutlineViewer, setShowOutlineViewer] = useState(false);

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
        onRegenerate={onRegenerate}
        onEditResend={onEditResend}
        onUseReviewSuggestion={handleUseOutlineReviewSuggestion}
        disabled={!project}
        placeholder="输入修改意见后按 Enter 发送，或点击上方按钮直接生成大纲..."
        emptyTitle="大纲工作台"
        emptyDescription="点击「生成大纲」开始，或在下方输入修改意见"
        suggestions={[
          '让开头更有冲突感',
          '增加反转和悬念',
          '优化角色动机逻辑',
          '缩短到 20 章',
          '增加更多爽点',
        ]}
        toolbar={
          <Space size={6} wrap>
            <Tooltip title={isGenerating ? '正在生成中' : ''}>
              <Button
                type="primary"
                size="small"
                icon={<ThunderboltOutlined />}
                disabled={isGenerating}
                onClick={() => handleOutlineChatSend('')}
              >
                {project.outline ? '重新生成' : '生成大纲'}
              </Button>
            </Tooltip>
            {renderTaskControl('outline', () => handleGenerateOutline(true))}

            <Tooltip title={!project.outline ? '请先生成大纲' : ''}>
              <Button
                size="small"
                icon={<AuditOutlined />}
                disabled={isGenerating || !project.outline}
                onClick={() => handleReviewOutline()}
              >
                审查大纲
              </Button>
            </Tooltip>
            {renderTaskControl('outline-review', () => handleReviewOutline(true))}

            <Dropdown
              menu={{
                items: [
                  {
                    key: 'slap',
                    icon: <ThunderboltOutlined />,
                    label: '打脸闭环生成',
                    disabled: isGenerating,
                    onClick: () => {
                      const slapContent = skills.find((s) => s.key === 'female_slap')?.content || '';
                      handleGenerateOutline(false, slapContent);
                    },
                  },
                  { type: 'divider' },
                  {
                    key: 'sync',
                    icon: <SyncOutlined />,
                    label: '同步章节',
                    disabled: isGenerating || !project.outline,
                    onClick: async () => {
                      const n = await syncOutlineChaptersToDb(project.outline, projectId);
                      n > 0
                        ? antdMessage.success(`已同步 ${n} 个章节`)
                        : antdMessage.warning('未找到章节（需包含"### 第 X 章"格式）');
                    },
                  },
                  {
                    key: 'export',
                    icon: <DownloadOutlined />,
                    label: '导出 MD',
                    disabled: !project.outline,
                    onClick: () => {
                      const blob = new Blob([project.outline], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `《${project.title || '未命名'}》大纲.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                      antdMessage.success('已导出');
                    },
                  },
                  {
                    key: 'view',
                    icon: <BookOutlined />,
                    label: '查看大纲结构',
                    disabled: !project.outline,
                    onClick: () => setShowOutlineViewer(true),
                  },
                  {
                    key: 'edit',
                    icon: <EditOutlined />,
                    label: '编辑大纲',
                    disabled: !project.outline,
                    onClick: () => setShowOutlineEditor(true),
                  },
                  { type: 'divider' },
                  {
                    key: 'skill',
                    icon: <AppstoreOutlined />,
                    label: `选择 Skill${outlineExtraSkillKeys.length > 0 ? ` (${outlineExtraSkillKeys.length})` : ''}`,
                    onClick: () => setShowOutlineSkillPopover(true),
                  },
                  {
                    key: 'example',
                    icon: <UploadOutlined />,
                    label: `上传例文${project.rawExample ? ' ✓ 已上传' : ''}`,
                    onClick: () => setShowExampleModal(true),
                  },
                ],
              }}
              trigger={['click']}
            >
              <Button size="small" icon={<MoreOutlined />}>
                更多
              </Button>
            </Dropdown>
          </Space>
        }
      />

      <SkillSelectorModal
        open={showOutlineSkillPopover}
        onClose={() => setShowOutlineSkillPopover(false)}
        skills={skills}
        selectedKeys={outlineExtraSkillKeys}
        onChange={setOutlineExtraSkillKeys}
        extraSkillTexts={outlineExtraSkillTexts}
        onExtraSkillTextsChange={setOutlineExtraSkillTexts}
        builtinKeys={['outline_template', ...(project.genre === 'classic-wolf' ? ['wolf_setting'] : []), ...(project.genre === 'female-slap' ? ['female_slap'] : [])]}
        excludeKeys={['workflow', 'blurb']}
        title="大纲 Skill 选择"
      />

      {/* 大纲结构查看器 */}
      <Modal
        title="大纲结构"
        open={showOutlineViewer}
        onCancel={() => setShowOutlineViewer(false)}
        footer={null}
        width={600}
      >
        <CollapsibleOutline outline={project.outline || ''} />
      </Modal>

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
