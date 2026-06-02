import { useRef } from 'react';
import { X, FileUp, Save } from 'lucide-react';

interface ExampleModalProps {
  isOpen: boolean;
  onClose: () => void;
  rawExample: string;
  onChange: (text: string) => void;
  onSave: () => void;
}

export default function ExampleModal({
  isOpen,
  onClose,
  rawExample,
  onChange,
  onSave,
}: ExampleModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onChange(ev.target?.result as string || '');
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white border border-[#eaeaea] shadow-lg w-full max-w-2xl mx-4 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#eaeaea] shrink-0">
          <h2 className="text-sm font-black font-sans text-[#171717]">例文管理</h2>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 bg-white border border-[#eaeaea] hover:bg-[#f5f5f5] text-[#696b72] text-xs font-bold px-3 py-1.5 cursor-pointer transition">
              <FileUp size={12} /> 上传 TXT
              <input ref={fileInputRef} type="file" accept=".txt" className="hidden" onChange={handleFile} />
            </label>
            <button onClick={onClose} className="text-[#888888] hover:text-[#171717] transition">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Textarea */}
        <div className="flex-1 overflow-hidden p-5">
          <textarea
            value={rawExample}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-full bg-[#f9f9f9] border border-[#eaeaea] p-3 font-mono text-xs text-[#171717] leading-relaxed resize-none focus:outline-none focus:border-black"
            placeholder="上传或粘贴例文（支持 TXT 上传，也可直接粘贴）——大纲生成将仿写其节奏与张力曲线。"
            style={{ minHeight: '320px' }}
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#eaeaea] shrink-0">
          <button onClick={onClose} className="border border-[#eaeaea] bg-white hover:bg-[#f5f5f5] text-[#696b72] text-xs font-bold px-4 py-2 transition">
            取消
          </button>
          <button
            onClick={() => { onSave(); onClose(); }}
            className="bg-black hover:bg-[#333] text-white text-xs font-bold px-4 py-2 flex items-center gap-1.5 transition"
          >
            <Save size={12} /> 保存例文
          </button>
        </div>
      </div>
    </div>
  );
}
