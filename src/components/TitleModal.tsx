import { useState, useEffect } from 'react';
import { X, Sparkles, RefreshCw, Check } from 'lucide-react';

interface TitleModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTitle: string;
  titleCandidates: string;
  titleCustomPrompt: string;
  isGenerating: boolean;
  onSetCustomPrompt: (v: string) => void;
  onGenerate: () => void;
  onApplyTitle: (title: string) => void;
}

export default function TitleModal({
  isOpen,
  onClose,
  currentTitle,
  titleCandidates,
  titleCustomPrompt,
  isGenerating,
  onSetCustomPrompt,
  onGenerate,
  onApplyTitle,
}: TitleModalProps) {
  const [editTitle, setEditTitle] = useState(currentTitle);

  useEffect(() => {
    setEditTitle(currentTitle);
  }, [currentTitle, isOpen]);

  if (!isOpen) return null;

  // Parse candidates: each line that looks like a title entry
  const candidateLines = titleCandidates
    ? titleCandidates.split('\n').filter((l) => l.trim())
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-paper border border-rule shadow-lg w-full max-w-lg mx-4 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-rule shrink-0">
          <h2 className="text-sm font-black font-display text-ink">书名编辑 &amp; 生成</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink transition">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* 当前书名编辑 */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-ink-400 uppercase tracking-widest block">当前书名</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="flex-1 bg-paper-50 border border-rule px-3 py-2 text-sm font-bold text-ink focus:outline-none focus:border-accent"
                placeholder="输入书名..."
              />
              <button
                onClick={() => onApplyTitle(editTitle)}
                className="bg-accent hover:bg-accent-hover text-white text-xs font-bold px-3 py-2 flex items-center gap-1.5 transition shrink-0"
              >
                <Check size={12} /> 保存
              </button>
            </div>
          </div>

          {/* 生成候选 */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-ink-400 uppercase tracking-widest block">AI 生成要求（可选）</label>
            <textarea
              value={titleCustomPrompt}
              onChange={(e) => onSetCustomPrompt(e.target.value)}
              rows={2}
              placeholder='例如"侧重权谋感、主角是医女"...'
              className="w-full bg-paper-50 border border-rule p-2.5 font-mono text-[10px] text-ink resize-none focus:outline-none focus:border-accent"
            />
            <button
              onClick={onGenerate}
              disabled={isGenerating}
              className="w-full bg-paper border border-rule hover:bg-paper-100 disabled:opacity-50 text-ink-500 text-xs font-bold px-3 py-2 flex items-center justify-center gap-1.5 transition"
            >
              {isGenerating ? (
                <><RefreshCw size={12} className="animate-spin" /> 生成中...</>
              ) : (
                <><Sparkles size={12} /> 生成备选书名（中英双语）</>
              )}
            </button>
          </div>

          {/* 候选列表 */}
          {candidateLines.length > 0 && (
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-ink-400 uppercase tracking-widest block">候选书名（点击应用）</label>
              <div className="bg-paper-50 border border-rule p-3 space-y-1 max-h-52 overflow-y-auto font-mono text-[11px] text-ink leading-relaxed">
                {candidateLines.map((line, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      const clean = line.replace(/^[\d\.\-\*】】【\s]+/, '').split(/[（(]/)[0].trim();
                      if (clean) setEditTitle(clean);
                    }}
                    className="cursor-pointer hover:bg-accent-faint hover:text-accent px-1.5 py-0.5 transition"
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
