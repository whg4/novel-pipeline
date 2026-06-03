import { useState, useRef, useEffect, useCallback } from 'react';
import { Bubble, Sender, Welcome } from '@ant-design/x';
import { XMarkdown } from '@ant-design/x-markdown';
import { Button, Space, Popconfirm, message as antdMessage, Tooltip } from 'antd';
import {
  CopyOutlined,
  DownloadOutlined,
  SyncOutlined,
  DeleteOutlined,
  MessageOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  StopOutlined,
  ArrowDownOutlined,
  ExportOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { ChatMessage } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  streamingLabel?: string;
  toolbar?: React.ReactNode;
  onSend: (text: string) => void;
  onClear?: () => void;
  onPause?: () => void;
  onRegenerate?: () => void;
  onUseReviewSuggestion?: (reviewContent: string) => void;
  onEditResend?: (messageId: number, newContent: string) => void;
  /** 外部错误信息（显示在对话流底部） */
  errorMessage?: string | null;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** 空状态引导文案 */
  emptyTitle?: string;
  emptyDescription?: string;
}

// ── 工具函数 ──
function exportMd(content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `导出-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportConversation(messages: ChatMessage[]) {
  if (messages.length === 0) return;
  const lines = messages.map(msg => {
    const role = msg.role === 'user' ? '👤 用户' : '🤖 AI';
    const kind = msg.kind ? ` [${kindLabels[msg.kind] || msg.kind}]` : '';
    return `### ${role}${kind}\n\n${msg.content}\n`;
  });
  const md = `# 对话记录\n\n${lines.join('\n---\n\n')}`;
  exportMd(md);
  antdMessage.success('对话已导出');
}

function formatTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (isToday) return `${hh}:${mm}`;
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  return `${M}-${D} ${hh}:${mm}`;
}

const kindLabels: Record<string, string> = {
  outline: '大纲',
  review: '大纲审查',
  chapter: '正文',
  'logic-review': '逻辑审查',
};

// ── AI 消息操作按钮（hover 显示）──
function MessageActions({
  content,
  kind,
  isLast,
  isStreaming,
  onUseReviewSuggestion,
  onRegenerate,
}: {
  content: string;
  kind?: string;
  isLast?: boolean;
  isStreaming?: boolean;
  onUseReviewSuggestion?: (reviewContent: string) => void;
  onRegenerate?: () => void;
}) {
  return (
    <Space size={4} className="chat-actions">
      <Tooltip title="复制">
        <Button
          size="small"
          type="text"
          icon={<CopyOutlined />}
          onClick={() => {
            navigator.clipboard.writeText(content).then(() => antdMessage.success('已复制！'));
          }}
        />
      </Tooltip>
      <Tooltip title="导出 Markdown">
        <Button
          size="small"
          type="text"
          icon={<DownloadOutlined />}
          onClick={() => exportMd(content)}
        />
      </Tooltip>
      {(kind === 'logic-review' || kind === 'review') && onUseReviewSuggestion && (
        <Tooltip title="使用该建议重新生成">
          <Button
            size="small"
            type="text"
            icon={<SyncOutlined />}
            onClick={() => onUseReviewSuggestion(content)}
            style={{ color: '#000000' }}
          />
        </Tooltip>
      )}
      {isLast && !isStreaming && onRegenerate && (
        <Tooltip title="重新生成">
          <Button
            size="small"
            type="text"
            icon={<SyncOutlined />}
            onClick={onRegenerate}
          />
        </Tooltip>
      )}
    </Space>
  );
}

// ── 用户消息操作按钮 ──
function UserMessageActions({
  messageId,
  content,
  onEditResend,
}: {
  messageId?: number;
  content: string;
  onEditResend?: (messageId: number, newContent: string) => void;
}) {
  return (
    <Space size={4} className="chat-actions">
      <Tooltip title="复制">
        <Button
          size="small"
          type="text"
          icon={<CopyOutlined />}
          onClick={() => {
            navigator.clipboard.writeText(content).then(() => antdMessage.success('已复制！'));
          }}
        />
      </Tooltip>
      {messageId && onEditResend && (
        <Tooltip title="编辑并重新发送">
          <Button
            size="small"
            type="text"
            icon={<EditOutlined />}
            onClick={() => onEditResend(messageId, content)}
          />
        </Tooltip>
      )}
    </Space>
  );
}

export default function ChatPanel({
  messages,
  isStreaming,
  streamingContent,
  streamingLabel = '生成中...',
  toolbar,
  onSend,
  onClear,
  onPause,
  onRegenerate,
  onUseReviewSuggestion,
  onEditResend,
  errorMessage,
  disabled,
  placeholder,
  className = '',
  emptyTitle,
  emptyDescription,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ── Escape 快捷键停止生成 ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isStreaming && onPause) {
        e.preventDefault();
        onPause();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isStreaming, onPause]);

  // ── 滚动到底部检测 ──
  const checkScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 200);
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    return () => el.removeEventListener('scroll', checkScroll);
  }, [checkScroll]);

  const scrollToBottom = () => {
    scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
  };

  // ── 自动聚焦输入框 ──
  const focusInput = () => {
    setTimeout(() => {
      const textarea = document.querySelector('.ant-sender .ant-input, .ant-sender textarea') as HTMLTextAreaElement | null;
      textarea?.focus();
    }, 80);
  };

  // ── 编辑重发逻辑 ──
  const handleEditStart = (messageId: number, content: string) => {
    setEditingId(messageId);
    setEditText(content);
  };

  const handleEditConfirm = () => {
    if (editingId && editText.trim() && onEditResend) {
      onEditResend(editingId, editText.trim());
      setEditingId(null);
      setEditText('');
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditText('');
  };

  // ── 找到最后一条 AI 消息的 id ──
  const lastAiMsgIndex = [...messages].reverse().findIndex(m => m.role === 'assistant');
  const lastAiMsgId = lastAiMsgIndex >= 0 ? messages[messages.length - 1 - lastAiMsgIndex]?.id : undefined;

  // ── 将 ChatMessage[] 转换为 Bubble.List items 格式 ──
  const bubbleItems = messages.map((msg, idx) => {
    const isLastAi = msg.role === 'assistant' && msg.id === lastAiMsgId;
    const isUserMsg = msg.role === 'user';
    const isEditing = editingId === msg.id;

    return {
      key: msg.id ?? `msg-${msg.createdAt}-${idx}`,
      role: isUserMsg ? 'user' : 'ai',
      content: isUserMsg ? (msg.content || '（触发生成）') : msg.content,
      placement: isUserMsg ? ('end' as const) : ('start' as const),
      header:
        msg.role === 'assistant' && msg.kind ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip title={kindLabels[msg.kind]}>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: '#888888',
                  padding: '1px 6px',
                  border: '1px solid #eaeaea',
                  background: '#f5f5f5',
                  display: 'inline-block',
                }}
              >
                {kindLabels[msg.kind]}
              </span>
            </Tooltip>
            <span style={{ fontSize: 9, color: '#bbbbbb' }}>{formatTime(msg.createdAt)}</span>
          </div>
        ) : isUserMsg ? (
          <span style={{ fontSize: 9, color: '#bbbbbb' }}>{formatTime(msg.createdAt)}</span>
        ) : undefined,
      footer:
        isEditing ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 }}>
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditConfirm(); }
                if (e.key === 'Escape') handleEditCancel();
              }}
              style={{
                flex: 1, fontSize: 12, padding: '6px 8px', border: '1px solid #d9d9d9',
                borderRadius: 6, resize: 'vertical', minHeight: 36, fontFamily: 'inherit',
              }}
              autoFocus
            />
            <Button size="small" type="primary" icon={<CheckOutlined />} onClick={handleEditConfirm} />
            <Button size="small" icon={<CloseOutlined />} onClick={handleEditCancel} />
          </div>
        ) : msg.role === 'assistant' ? (
          <MessageActions
            content={msg.content}
            kind={msg.kind}
            isLast={isLastAi}
            isStreaming={isStreaming}
            onUseReviewSuggestion={onUseReviewSuggestion}
            onRegenerate={onRegenerate}
          />
        ) : isUserMsg && onEditResend ? (
          <UserMessageActions
            messageId={msg.id}
            content={msg.content}
            onEditResend={handleEditStart}
          />
        ) : undefined,
    };
  });

  // ── 追加流式气泡 ──
  if (isStreaming) {
    if (streamingContent) {
      bubbleItems.push({
        key: 'streaming',
        role: 'ai',
        content: streamingContent,
        placement: 'start' as const,
        header: undefined,
        footer: undefined,
      });
    } else {
      bubbleItems.push({
        key: 'streaming-waiting',
        role: 'ai',
        content: streamingLabel,
        placement: 'start' as const,
        header: undefined,
        footer: undefined,
      });
    }
  }

  // ── Role 预设样式 ──
  const role = {
    user: {
      placement: 'end' as const,
      variant: 'filled' as const,
      style: {
        maxWidth: '75%',
      },
      styles: {
        content: {
          backgroundColor: '#000000',
          color: '#ffffff',
          fontSize: 12,
          paddingBlock: 8,
          paddingInline: 12,
        },
      },
    },
    ai: {
      placement: 'start' as const,
      variant: 'borderless' as const,
      contentRender: (content: string) => (
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <XMarkdown
            content={content}
            streaming={
              isStreaming && bubbleItems[bubbleItems.length - 1]?.content === content
                ? { tail: true }
                : undefined
            }
          />
        </div>
      ),
      style: {
        width: '100%',
      },
      styles: {
        content: {
          fontSize: 13,
          paddingBlock: 8,
          paddingInline: 12,
        },
      },
    },
  };

  return (
    <div
      className={`flex flex-col ${className}`}
      style={{
        height: 'calc(100vh - 240px)',
        minHeight: 480,
        border: '1px solid #eaeaea',
        background: '#f9f9f9',
        position: 'relative',
      }}
    >
      {/* ── Messages area ── */}
      <div ref={scrollContainerRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {messages.length === 0 && !isStreaming ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
            }}
          >
            <Welcome
              variant="borderless"
              icon={<MessageOutlined style={{ fontSize: 32, color: '#d4d4d4' }} />}
              title={emptyTitle || '还没有对话记录'}
              description={emptyDescription || '点击上方操作按钮或在下方输入内容开始'}
            />
          </div>
        ) : (
          <Bubble.List
            items={bubbleItems}
            role={role}
            autoScroll
            style={{ height: '100%', padding: '16px 16px 0' }}
          />
        )}
      </div>

      {/* ── 滚动到底部浮动按钮 ── */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          style={{
            position: 'absolute',
            bottom: 140,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '1px solid #d9d9d9',
            background: '#ffffff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            zIndex: 10,
          }}
        >
          <ArrowDownOutlined style={{ fontSize: 14, color: '#666' }} />
        </button>
      )}

      {/* ── 错误消息 ── */}
      {errorMessage && !isStreaming && (
        <div style={{ padding: '0 16px 8px', flexShrink: 0 }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', borderRadius: 8,
              background: '#fef2f2', border: '1px solid #fecaca',
              fontSize: 12, color: '#dc2626',
            }}
          >
            <ExclamationCircleOutlined style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{errorMessage}</span>
          </div>
        </div>
      )}

      {/* ── 流式输出时的停止按钮 ── */}
      {isStreaming && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '4px 0',
            background: '#f9f9f9',
            flexShrink: 0,
          }}
        >
          <button
            onClick={onPause}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 16px',
              borderRadius: 20,
              border: '1px solid #d9d9d9',
              background: '#ffffff',
              cursor: 'pointer',
              fontSize: 12,
              color: '#666',
              transition: 'all 0.15s',
            }}
          >
            <StopOutlined style={{ fontSize: 10 }} /> 停止生成
          </button>
        </div>
      )}

      {/* ── Toolbar + Input ── */}
      <div
        style={{
          borderTop: '1px solid #eaeaea',
          padding: 12,
          background: '#ffffff',
          flexShrink: 0,
        }}
      >
        {(toolbar || onClear) && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 6,
              paddingBottom: 8,
              marginBottom: 8,
              borderBottom: '1px solid #eaeaea',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1 }}>{toolbar}</div>
            <Space size={4}>
              {messages.length > 0 && (
                <Tooltip title="导出全部对话">
                  <Button
                    size="small"
                    icon={<ExportOutlined />}
                    onClick={() => exportConversation(messages)}
                  />
                </Tooltip>
              )}
              {onClear && (
                <Popconfirm
                  title="清除对话记录"
                  description="确认清除所有对话记录？"
                  onConfirm={onClear}
                  okText="确认"
                  cancelText="取消"
                >
                  <Button size="small" icon={<DeleteOutlined />} danger>
                    清屏
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </div>
        )}
        <Sender
          value={input}
          onChange={setInput}
          onSubmit={(text) => {
            if (!text.trim()) return;
            onSend(text);
            setInput('');
            focusInput();
          }}
          loading={isStreaming}
          disabled={disabled}
          placeholder={
            isStreaming
              ? '生成中... 按 Escape 停止，可继续输入下一条'
              : placeholder || '输入修改意见...'
          }
          submitType="enter"
          autoSize={{ minRows: 1, maxRows: 8 }}
        />
      </div>

      {/* ── hover 显隐样式 + 流式光标动画 ── */}
      <style>{`
        .chat-actions {
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .ant-bubble:hover .chat-actions,
        .ant-bubble-wrapper:hover .chat-actions {
          opacity: 1;
        }

        /* 流式光标动画 */
        @keyframes blink-cursor {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .streaming-cursor::after {
          content: '▌';
          animation: blink-cursor 0.8s infinite;
          color: #000;
          font-weight: 400;
          margin-left: 1px;
        }
      `}</style>
    </div>
  );
}
