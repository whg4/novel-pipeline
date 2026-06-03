import type { Dispatch, SetStateAction } from 'react';
import type { Project, Chapter, Skill, ChatMessage } from '../../types';
import type { GenerationTask, TaskControlRender } from '../../hooks/usePipelineTask';
import { Button, Space, Modal, Alert, Typography, Popconfirm, Dropdown, Tooltip, message as antdMessage } from 'antd';
import {
  BookOutlined,
  EditOutlined,
  PlusOutlined,
  SaveOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  ThunderboltOutlined,
  AuditOutlined,
  AppstoreOutlined,
  EyeOutlined,
  CopyOutlined,
  DeleteOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import ChatPanel from '../ChatPanel';
import SkillSelectorModal from '../SkillSelectorModal';
import { db } from '../../db';

const { Text } = Typography;

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
  chapterExtraSkillTexts: string[];
  showChapterSkillPopover: boolean;
  showChapterOutlineEditor: boolean;
  viewingChapter: { title: string; content: string } | null;
  handleSelectChapter: (ch: Chapter) => void;
  handleCreateNewChapter: () => void;
  handleDeleteChapter: (chapterId: number) => void;
  handleClearAllChapters: () => void;
  handleSaveChapterManual: () => void;
  handleGenerateChapterStream: (resume?: boolean, promptOverride?: string, extraSkillTextOverride?: string) => void;
  handleExportChapterMarkdown: (ch: Chapter) => void;
  handleLogicReviewChapter: (ch: Chapter, resume?: boolean) => void;
  handleChapterChatSend: (userText: string, extraSkillTextOverride?: string) => void;
  handleClearChapterChat: () => void;
  handleUseReviewSuggestion: (reviewContent: string) => void;
  onRegenerate?: () => void;
  onEditResend?: (messageId: number, newContent: string) => void;
  onPause: () => void;
  renderTaskControl: TaskControlRender;
  setEditingOutline: Dispatch<SetStateAction<string>>;
  setChapterExtraSkillKeys: (v: string[]) => void;
  setChapterExtraSkillTexts: (v: string[]) => void;
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
  chapterExtraSkillTexts,
  showChapterSkillPopover,
  showChapterOutlineEditor,
  viewingChapter,
  handleSelectChapter,
  handleCreateNewChapter,
  handleDeleteChapter,
  handleClearAllChapters,
  handleSaveChapterManual,
  handleGenerateChapterStream,
  handleExportChapterMarkdown,
  handleLogicReviewChapter,
  handleChapterChatSend,
  handleClearChapterChat,
  handleUseReviewSuggestion,
  onRegenerate,
  onEditResend,
  onPause,
  renderTaskControl,
  setEditingOutline,
  setChapterExtraSkillKeys,
  setChapterExtraSkillTexts,
  setShowChapterSkillPopover,
  setShowChapterOutlineEditor,
  setViewingChapter,
}: DraftingRoomProps) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
      {/* ── Chapter selector sidebar ── */}
      <div
        className="xl:col-span-1 flex flex-col justify-between overflow-y-auto"
        style={{
          border: '1px solid #eaeaea',
          background: '#f9f9f9',
          padding: 16,
          height: 'calc(100vh - 240px)',
        }}
      >
        <div className="space-y-4">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#888888',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                margin: 0,
              }}
            >
              <BookOutlined style={{ color: '#000000' }} /> 章节列表
            </h3>
            <Button
              size="small"
              type="text"
              icon={<PlusOutlined />}
              onClick={handleCreateNewChapter}
              title="新建章节"
            />
            {chapters.length > 0 && (
              <Popconfirm
                title="清空章节"
                description={`确认清空全部 ${chapters.length} 个章节？此操作不可撤销。`}
                onConfirm={handleClearAllChapters}
                okText="清空"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button
                  size="small"
                  type="text"
                  icon={<DeleteOutlined />}
                  title="清空全部章节"
                  danger
                />
              </Popconfirm>
            )}
          </div>

          <div className="space-y-1">
            {chapters.map((ch) => (
              <button
                key={ch.id}
                onClick={() => handleSelectChapter(ch)}
                className={`w-full text-left px-3 py-2 text-xs font-semibold border-l-2 flex items-center justify-between transition ${
                  activeChapterId === ch.id
                    ? 'border-black text-black bg-[#f5f5f5] font-bold'
                    : 'border-transparent text-[#696b72] hover:bg-[#f5f5f5] hover:text-[#171717]'
                }`}
              >
                <span>
                  第 {ch.chapterNumber} 章: {ch.title.split(':').pop()?.trim()}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {ch.content && (
                    <Button
                      type="text"
                      size="small"
                      icon={<EyeOutlined style={{ fontSize: 11 }} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewingChapter({
                          title: ch.title || `第 ${ch.chapterNumber} 章`,
                          content: ch.content!,
                        });
                      }}
                      title="查看原文"
                      style={{ padding: 0, minWidth: 'auto', height: 'auto' }}
                    />
                  )}
                  <Popconfirm
                    title="删除章节"
                    description={`确认删除「第 ${ch.chapterNumber} 章」？此操作不可撤销。`}
                    onConfirm={() => handleDeleteChapter(ch.id!)}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                      onClick={(e) => e.stopPropagation()}
                      title="删除章节"
                      style={{ padding: 0, minWidth: 'auto', height: 'auto', color: '#888888' }}
                    />
                  </Popconfirm>
                  {ch.content ? (
                    <span
                      style={{
                        fontSize: 9,
                        padding: '1px 6px',
                        background: '#ddf3e4',
                        fontWeight: 700,
                        border: '1px solid rgba(0,166,62,0.3)',
                        color: '#00a63e',
                      }}
                    >
                      {ch.content.length} words
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: 9,
                        padding: '1px 6px',
                        background: '#f5f5f5',
                        fontWeight: 700,
                        color: '#888888',
                        border: '1px solid #eaeaea',
                      }}
                    >
                      empty
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {chapters.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '24px 0',
              color: '#888888',
              border: '1px dashed #eaeaea',
              background: '#f5f5f5',
            }}
          >
            <p style={{ fontSize: 10, margin: '0 0 8px' }}>还没有章节。</p>
            <Button type="link" size="small" onClick={handleCreateNewChapter}>
              添加第一章
            </Button>
          </div>
        )}
      </div>

      {/* ── ChatPanel area ── */}
      <div className="xl:col-span-3 space-y-3">
        {/* Grease warnings */}
        {greaseWarnings.length > 0 && (
          <Alert
            type="warning"
            icon={<ExclamationCircleOutlined />}
            message={
              <span style={{ fontSize: 12, fontWeight: 700 }}>去油警告</span>
            }
            description={
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {greaseWarnings.map((warn, i) => (
                  <li key={i} style={{ fontSize: 10, fontWeight: 600 }}>
                    {warn}
                  </li>
                ))}
              </ul>
            }
            style={{ background: '#fef2f2', border: '1px solid rgba(238,0,0,0.3)' }}
          />
        )}

        {/* Chapter error */}
        {chapterError && activeTask !== 'chapter' && (
          <Alert
            type="error"
            message={chapterError}
            icon={<ExclamationCircleOutlined />}
            style={{ fontSize: 10 }}
          />
        )}

        {activeChapterId !== null ? (
          <ChatPanel
            messages={chapterChatMessages}
            isStreaming={isGenerating && (activeTask === 'chapter' || activeTask === 'review')}
            streamingContent={activeTask === 'chapter' ? editingDraft : logicReviewOutput}
            streamingLabel={activeTask === 'chapter' ? '生成正文中...' : '逻辑审查中...'}
            onSend={handleChapterChatSend}
            onClear={handleClearChapterChat}
            onPause={onPause}
            onRegenerate={onRegenerate}
            onEditResend={onEditResend}
            onUseReviewSuggestion={handleUseReviewSuggestion}
            placeholder="输入重写建议后按 Enter 发送，或点击上方按钮直接生成正文..."
            toolbar={
              <Space size={6} wrap>
                <Tooltip title={isGenerating ? '正在生成中' : ''}>
                  <Button
                    type="primary"
                    size="small"
                    icon={<ThunderboltOutlined spin={activeTask === 'chapter' && isGenerating} />}
                    disabled={isGenerating}
                    onClick={() => handleChapterChatSend('')}
                  >
                    {chapters.find((c) => c.id === activeChapterId)?.content ? '重新生成' : '生成正文'}
                  </Button>
                </Tooltip>
                {renderTaskControl('chapter', () => handleGenerateChapterStream(true))}

                <Tooltip title={isGenerating ? '正在生成中' : ''}>
                  <Button
                    size="small"
                    icon={<AuditOutlined spin={activeTask === 'review' && isGenerating} />}
                    disabled={isGenerating}
                    onClick={() => {
                      const ch = chapters.find((c) => c.id === activeChapterId);
                      if (ch) handleLogicReviewChapter(ch);
                    }}
                  >
                    逻辑审查
                  </Button>
                </Tooltip>
                {renderTaskControl('review', () => {
                  const ch = chapters.find((c) => c.id === activeChapterId);
                  if (ch) handleLogicReviewChapter(ch, true);
                })}

                <Tooltip title="保存当前草稿">
                  <Button
                    size="small"
                    icon={<SaveOutlined />}
                    onClick={handleSaveChapterManual}
                  >
                    保存
                  </Button>
                </Tooltip>

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
                          handleChapterChatSend('按打脸闭环风格重新生成本章', slapContent);
                        },
                      },
                      { type: 'divider' },
                      {
                        key: 'export',
                        icon: <DownloadOutlined />,
                        label: '导出本章 MD',
                        onClick: () => {
                          const ch = chapters.find((c) => c.id === activeChapterId);
                          if (ch) {
                            handleExportChapterMarkdown(ch);
                            antdMessage.success('已导出');
                          }
                        },
                      },
                      {
                        key: 'outline',
                        icon: <EditOutlined />,
                        label: '编辑章节大纲',
                        onClick: () => setShowChapterOutlineEditor(true),
                      },
                      { type: 'divider' },
                      {
                        key: 'skill',
                        icon: <AppstoreOutlined />,
                        label: `选择 Skill${chapterExtraSkillKeys.length > 0 ? ` (${chapterExtraSkillKeys.length})` : ''}`,
                        onClick: () => setShowChapterSkillPopover(true),
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
        ) : (
          <div
            className="bg-white border border-[#eaeaea] border-dashed flex flex-col items-center justify-center text-center space-y-3"
            style={{ height: 'calc(100vh - 240px)', minHeight: 480 }}
          >
            <EditOutlined style={{ fontSize: 32, color: '#d4d4d4' }} />
            <h4 className="font-bold text-[#171717] text-sm">请选择章节</h4>
            <p className="text-[#888888] text-xs max-w-xs">
              从左侧列表选择一个章节，或新建章节开始写作。
            </p>
            <Button size="small" onClick={handleCreateNewChapter}>
              新建章节
            </Button>
          </div>
        )}
      </div>

      {/* ── Skill 选择弹窗 ── */}
      <SkillSelectorModal
        open={showChapterSkillPopover}
        onClose={() => setShowChapterSkillPopover(false)}
        skills={skills}
        selectedKeys={chapterExtraSkillKeys}
        onChange={setChapterExtraSkillKeys}
        extraSkillTexts={chapterExtraSkillTexts}
        onExtraSkillTextsChange={setChapterExtraSkillTexts}
        builtinKeys={['degrease', 'connect_skills', 'logic_check']}
        excludeKeys={['workflow', 'blurb', 'outline_template']}
        title="章节 Skill 选择"
      />

      {/* ── Chapter outline editor modal ── */}
      <Modal
        title="本章大纲要求"
        open={showChapterOutlineEditor && activeChapterId !== null}
        onCancel={() => setShowChapterOutlineEditor(false)}
        width={640}
        footer={
          <Space>
            <Button onClick={() => setShowChapterOutlineEditor(false)}>取消</Button>
            <Button
              type="primary"
              onClick={async () => {
                const ch = chapters.find((c) => c.id === activeChapterId);
                if (ch?.id) await db.chapters.update(ch.id, { outlineSection: editingOutline });
                setShowChapterOutlineEditor(false);
              }}
            >
              保存
            </Button>
          </Space>
        }
      >
        <textarea
          value={editingOutline}
          onChange={(e) => setEditingOutline(e.target.value)}
          style={{
            width: '100%',
            minHeight: 320,
            background: '#f5f5f5',
            border: '1px solid #eaeaea',
            padding: 12,
            fontFamily: "'JetBrains Mono', Consolas, monospace",
            fontSize: 11,
            color: '#171717',
            lineHeight: 1.6,
            resize: 'none',
            outline: 'none',
          }}
          placeholder="将本章大纲片段粘贴在此..."
          autoFocus
        />
        <Text type="secondary" style={{ fontSize: 10 }}>
          内容将在关闭前点击"保存"时写入数据库，生成正文时作为参考。
        </Text>
      </Modal>

      {/* ── Chapter content viewer modal ── */}
      <Modal
        title={viewingChapter?.title || ''}
        open={!!viewingChapter}
        onCancel={() => setViewingChapter(null)}
        width={640}
        footer={
          <Space>
            <Button
              icon={<CopyOutlined />}
              onClick={() => {
                if (viewingChapter) {
                  navigator.clipboard
                    .writeText(viewingChapter.content)
                    .then(() => alert('已复制！'));
                }
              }}
            >
              复制
            </Button>
            <Button onClick={() => setViewingChapter(null)}>关闭</Button>
          </Space>
        }
      >
        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          <pre
            style={{
              fontFamily: "'JetBrains Mono', Consolas, monospace",
              fontSize: 12,
              color: '#171717',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {viewingChapter?.content}
          </pre>
        </div>
        <Text type="secondary" style={{ fontSize: 10 }}>
          {viewingChapter?.content.length} 字符
        </Text>
      </Modal>
    </div>
  );
}
