import { useState, useEffect } from 'react';
import { X, Save, Edit3 } from 'lucide-react';

interface OutlineEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  outline: string;
  onSave: (val: string) => void;
}

export default function OutlineEditorModal({
  isOpen,
  onClose,
  outline,
  onSave,
}: OutlineEditorModalProps) {
  const [draft, setDraft] = useState(outline);

  useEffect(() => {
    if (isOpen) setDraft(outline);
  }, [isOpen, outline]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(draft);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-paper border border-rule shadow-lg w-full max-w-3xl mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-rule shrink-0">
          <h2 className="text-sm font-black font-display text-ink flex items-center gap-2">
            <Edit3 size={14} className="text-accent" /> 编辑大纲
          </h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink transition">
            <X size={16} />
          </button>
        </div>

        {/* Textarea */}
        <div className="flex-1 overflow-hidden p-5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full h-full bg-paper-50 border border-rule p-3 font-mono text-xs text-ink leading-relaxed resize-none focus:outline-none focus:border-accent"
            placeholder="直接编辑大纲正文..."
            style={{ minHeight: '480px' }}
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-rule shrink-0">
          <button onClick={onClose} className="border border-rule bg-paper hover:bg-paper-100 text-ink-500 text-xs font-bold px-4 py-2 transition">
            取消
          </button>
          <button
            onClick={handleSave}
            className="bg-accent hover:bg-accent-hover text-white text-xs font-bold px-4 py-2 flex items-center gap-1.5 transition"
          >
            <Save size={12} /> 保存大纲
          </button>
        </div>
      </div>
    </div>
  );
}
