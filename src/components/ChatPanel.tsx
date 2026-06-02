import { useState, useRef, useEffect } from 'react';
import { Copy, Download, Send, RefreshCw, MessageSquare, Trash2, RotateCcw } from 'lucide-react';
import type { ChatMessage } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  streamingLabel?: string;
  toolbar?: React.ReactNode;
  onSend: (text: string) => void;
  onClear?: () => void;
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyInline(s: string): string {
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  s = s.replace(/`([^`\n]+?)`/g, '<code class="bg-paper-50 border border-rule px-1 font-mono text-[10px] rounded-sm">$1</code>');
  return s;
}

function renderMarkdown(text: string): { __html: string } {
  const lines = escapeHtml(text).split('\n');
  const chunks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trimEnd();
    if (/^-{3,}$/.test(line) || /^={3,}$/.test(line)) {
      chunks.push('<hr class="border-rule my-2" />');
      i++; continue;
    }
    const hMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (hMatch) {
      const sizes = ['text-sm font-black', 'text-sm font-bold', 'text-xs font-bold', 'text-xs font-semibold', 'text-xs font-semibold', 'text-xs font-semibold'];
      chunks.push(`<p class="${sizes[hMatch[1].length - 1]} text-ink mt-3 mb-1">${applyInline(hMatch[2])}</p>`);
      i++; continue;
    }
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trimEnd())) {
        items.push(`<li class="ml-4" style="list-style-type:disc">${applyInline(lines[i].trimEnd().slice(2))}</li>`);
        i++;
      }
      chunks.push(`<ul class="space-y-0.5 my-1">${items.join('')}</ul>`);
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trimEnd())) {
        items.push(`<li class="ml-4" style="list-style-type:decimal">${applyInline(lines[i].trimEnd().replace(/^\d+\.\s/, ''))}</li>`);
        i++;
      }
      chunks.push(`<ol class="space-y-0.5 my-1">${items.join('')}</ol>`);
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^[-*]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !/^-{3,}$/.test(lines[i])
    ) {
      paraLines.push(applyInline(lines[i].trimEnd()));
      i++;
    }
    if (paraLines.length > 0) {
      chunks.push(`<p class="leading-relaxed">${paraLines.join('<br/>')}</p>`);
    }
  }
  return { __html: chunks.join('\n') };
}

export default function ChatPanel({
  messages,
  isStreaming,
  streamingContent,
  streamingLabel = '生成中...',
  toolbar,
  onSend,
  onClear,
  onUseReviewSuggestion,
  disabled,
  placeholder,
  className = '',
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isStreaming, streamingContent.length > 0]);

  const handleSend = () => {
    const text = input.trim();
    onSend(text);
    setInput('');
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && !isStreaming) handleSend();
    }
  };

  return (
    <div
      className={`flex flex-col bg-paper-50 border border-rule ${className}`}
      style={{ height: 'calc(100vh - 240px)', minHeight: '480px' }}
    >
      {/* ── Messages area ── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Clear button header */}
        {(messages.length > 0 || isStreaming) && onClear && (
          <div className="flex justify-end px-3 pt-2">
            <button
              onClick={() => {
                if (window.confirm('清除所有对话记录？')) onClear();
              }}
              className="flex items-center gap-1 text-[10px] text-ink-400 hover:text-red-500 border border-rule px-2 py-0.5 bg-paper hover:bg-red-50 transition"
            >
              <Trash2 size={9} /> 清屏
            </button>
          </div>
        )}
        <div className="p-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-ink-300 gap-2">
            <MessageSquare size={28} />
            <p className="text-xs font-semibold">还没有对话记录</p>
            <p className="text-[10px]">点击上方操作按钮或在下方输入内容开始</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col gap-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            {msg.role === 'user' ? (
              <div className="max-w-[75%] bg-accent text-white text-xs px-3 py-2 leading-relaxed whitespace-pre-wrap break-words">
                {msg.content || '（触发生成）'}
              </div>
            ) : (
              <div className="w-full space-y-1.5">
                {/* Kind badge */}
                {msg.kind && (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-ink-400 px-1.5 py-0.5 border border-rule bg-paper">
                    {msg.kind === 'outline' ? '大纲' : msg.kind === 'review' ? '大纲审查' : msg.kind === 'chapter' ? '正文' : '逻辑审查'}
                  </span>
                )}
                <div
                  className="w-full bg-paper border border-rule p-3 text-xs text-ink leading-relaxed break-words prose-sm"
                  dangerouslySetInnerHTML={renderMarkdown(msg.content)}
                />
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => navigator.clipboard.writeText(msg.content).then(() => alert('已复制！'))}
                    className="flex items-center gap-1 text-[10px] text-ink-400 hover:text-ink border border-rule px-2 py-0.5 bg-paper hover:bg-paper-100 transition"
                  >
                    <Copy size={10} /> 复制
                  </button>
                  <button
                    onClick={() => exportMd(msg.content)}
                    className="flex items-center gap-1 text-[10px] text-ink-400 hover:text-ink border border-rule px-2 py-0.5 bg-paper hover:bg-paper-100 transition"
                  >
                    <Download size={10} /> 导出 MD
                  </button>
                  {msg.kind === 'logic-review' && onUseReviewSuggestion && (
                    <button
                      onClick={() => onUseReviewSuggestion(msg.content)}
                      className="flex items-center gap-1 text-[10px] text-accent hover:text-accent-hover border border-accent/40 hover:border-accent px-2 py-0.5 bg-paper hover:bg-accent-faint transition font-bold"
                    >
                      <RotateCcw size={10} /> 使用该建议重新生成
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* ── Streaming bubble ── */}
        {isStreaming && (
          <div className="flex flex-col items-start gap-1.5">
            {streamingContent ? (
              <div className="w-full bg-paper border border-accent/40 p-3 font-mono text-xs text-ink leading-relaxed whitespace-pre-wrap break-words">
                {streamingContent}
                <span className="inline-block w-1.5 h-3 bg-accent animate-pulse ml-0.5 align-middle" />
              </div>
            ) : (
              <div className="bg-paper border border-rule px-3 py-2 flex items-center gap-2 text-xs text-ink-400">
                <RefreshCw size={12} className="animate-spin text-accent" />
                {streamingLabel}
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Toolbar + Input ── */}
      <div className="border-t border-rule p-3 space-y-2 bg-paper shrink-0">
        {toolbar && (
          <div className="flex flex-wrap gap-1.5 pb-1.5 border-b border-rule">
            {toolbar}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder={placeholder || '输入消息... (Enter 发送，Shift+Enter 换行)'}
            disabled={disabled || isStreaming}
            className="flex-1 bg-paper-50 border border-rule p-2.5 font-mono text-[11px] text-ink focus:outline-none focus:border-accent leading-relaxed resize-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={disabled || isStreaming}
            className="self-end bg-accent hover:bg-accent-hover disabled:opacity-50 text-white px-3 py-2 flex items-center gap-1.5 text-xs font-bold transition shrink-0"
          >
            <Send size={12} /> 发送
          </button>
        </div>
      </div>
    </div>
  );
}
