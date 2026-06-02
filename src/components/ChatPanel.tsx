import { useState } from 'react';
import { Bubble, Sender, Welcome } from '@ant-design/x';
import { XMarkdown } from '@ant-design/x-markdown';
import { Button, Space, Popconfirm, message as antdMessage, Tooltip } from 'antd';
import {
  CopyOutlined,
  DownloadOutlined,
  SyncOutlined,
  DeleteOutlined,
  MessageOutlined,
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
  onUseReviewSuggestion?: (reviewContent: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

function exportMd(content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `导出-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

const kindLabels: Record<string, string> = {
  outline: '大纲',
  review: '大纲审查',
  chapter: '正文',
  'logic-review': '逻辑审查',
};

// ── AI 消息操作按钮 ──
function MessageActions({
  content,
  kind,
  onUseReviewSuggestion,
}: {
  content: string;
  kind?: string;
  onUseReviewSuggestion?: (reviewContent: string) => void;
}) {
  return (
    <Space size={4}>
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
  onUseReviewSuggestion,
  disabled,
  placeholder,
  className = '',
}: ChatPanelProps) {
  const [input, setInput] = useState('');

  // ── 将 ChatMessage[] 转换为 Bubble.List items 格式 ──
  const bubbleItems = messages.map((msg) => ({
    key: msg.id ?? `msg-${msg.createdAt}`,
    role: msg.role === 'user' ? 'user' : 'ai',
    content: msg.role === 'user' ? (msg.content || '（触发生成）') : msg.content,
    placement: msg.role === 'user' ? ('end' as const) : ('start' as const),
    header:
      msg.role === 'assistant' && msg.kind ? (
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
      ) : undefined,
    footer:
      msg.role === 'assistant' ? (
        <MessageActions
          content={msg.content}
          kind={msg.kind}
          onUseReviewSuggestion={onUseReviewSuggestion}
        />
      ) : undefined,
  }));

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
        <XMarkdown
          content={content}
          streaming={
            isStreaming && bubbleItems[bubbleItems.length - 1]?.content === content
              ? { tail: true }
              : undefined
          }
        />
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
      }}
    >
      {/* ── Messages area ── */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
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
              title="还没有对话记录"
              description="点击上方操作按钮或在下方输入内容开始"
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
          </div>
        )}
        <Sender
          value={input}
          onChange={setInput}
          onSubmit={(text) => {
            onSend(text);
            setInput('');
          }}
          onCancel={onPause}
          loading={isStreaming}
          disabled={disabled}
          placeholder={placeholder || '输入消息... (Enter 发送，Shift+Enter 换行)'}
          submitType="enter"
          autoSize={{ minRows: 2, maxRows: 6 }}
        />
      </div>
    </div>
  );
}
