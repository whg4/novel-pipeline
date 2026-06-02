import type { GenerationTask, TaskControlRender } from '../../hooks/usePipelineTask';
import {
  Sparkles, ImageIcon, Download, Copy, RefreshCw,
  AlertTriangle, Pause
} from 'lucide-react';
import { renderMarkdown } from '../../utils/markdown';

interface MarketingKitProps {
  isAutoRunning: boolean;
  activeTask: GenerationTask | null;
  blurbsOutput: string;
  coverPrompt: string;
  coverImagePrompt: string;
  coverImageUrl: string | null;
  isGeneratingCoverImage: boolean;
  coverImageError: string | null;
  handleGenerateMarketingKit: (resume?: boolean) => void;
  handleGenerateCoverImage: () => void;
  handleCancelCoverImage: () => void;
  renderTaskControl: TaskControlRender;
  setCoverImagePrompt: (v: string) => void;
}

export default function MarketingKit({
  isAutoRunning,
  activeTask,
  blurbsOutput,
  coverPrompt,
  coverImagePrompt,
  coverImageUrl,
  isGeneratingCoverImage,
  coverImageError,
  handleGenerateMarketingKit,
  handleGenerateCoverImage,
  handleCancelCoverImage,
  renderTaskControl,
  setCoverImagePrompt,
}: MarketingKitProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-[#f9f9f9] border border-[#eaeaea] p-5 space-y-4 flex flex-col justify-between min-h-[460px]">
          <div className="space-y-3">
            <div className="flex justify-between items-center pb-2 border-b border-[#eaeaea]">
              <h3 className="text-sm font-bold text-[#171717] flex items-center gap-1.5">
                <Sparkles size={15} className="text-black" /> 爆款简介（导语）
              </h3>
              <button
                disabled={activeTask === 'marketing' || isAutoRunning}
                onClick={() => handleGenerateMarketingKit()}
                className="bg-black hover:bg-[#333] disabled:opacity-50 text-white text-xs font-bold px-3.5 py-1.5 flex items-center gap-1.5 transition"
              >
                <Sparkles size={12} className={activeTask === 'marketing' ? 'animate-spin' : ''} />
                一键生成推广素材
              </button>
              {renderTaskControl('marketing', () => handleGenerateMarketingKit(true))}
            </div>

            <div className="flex-1">
              {activeTask === 'marketing' && !blurbsOutput ? (
                <div className="flex flex-col items-center justify-center py-20 text-[#888888] space-y-2">
                  <RefreshCw size={24} className="animate-spin text-[#d4d4d4]" />
                  <p className="text-xs">正在生成...</p>
                </div>
              ) : blurbsOutput ? (
                <div
                  className="w-full h-[320px] overflow-y-auto bg-white border border-[#eaeaea] p-4 text-[#171717] text-xs leading-relaxed prose-sm"
                  dangerouslySetInnerHTML={renderMarkdown(blurbsOutput)}
                />
              ) : (
                <div className="w-full h-[320px] bg-white border border-[#eaeaea] p-4 text-[#888888] text-xs flex items-center justify-center">
                  点击"一键生成推广素材"后，此处将生成 3 个风格各异的爆款简介...
                </div>
              )}
            </div>
          </div>

          {blurbsOutput && (
            <div className="flex justify-between items-center bg-[#f5f5f5] border border-[#eaeaea] p-3 text-[10px] text-[#888888]">
              <span>✓ 简介已生成。</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(blurbsOutput);
                  alert('已复制所有简介！');
                }}
                className="text-black hover:text-black font-bold"
              >
                复制全部
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-[#f9f9f9] border border-[#eaeaea] p-4 space-y-4">
          <div className="flex justify-between items-center pb-2 border-b border-[#eaeaea]">
            <h3 className="text-sm font-bold text-[#171717] flex items-center gap-1.5">
              <ImageIcon size={14} className="text-black" /> 封面图片生成
            </h3>
            <span className="text-[10px] text-[#888888] border border-[#eaeaea] px-2 py-0.5">gpt-image-2</span>
          </div>
          <p className="text-[10px] text-[#888888] leading-normal">
            使用 OpenAI <code className="bg-white border border-[#eaeaea] px-1">gpt-image-2</code> 模型生成竖版封面（1024×1536）。需在"模型连接"中配置 OpenAI API Key。
          </p>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-[#888888] uppercase tracking-widest block">封面提示词</label>
            <textarea
              value={coverImagePrompt}
              onChange={e => setCoverImagePrompt(e.target.value)}
              rows={5}
              placeholder={coverPrompt ? '已从大纲自动生成提示词，可直接编辑后生成图片…' : '先点击左侧"一键生成推广素材"自动生成提示词，或在此直接输入英文提示词…'}
              className="w-full bg-white border border-[#eaeaea] p-2.5 font-mono text-[10px] text-[#171717] resize-y focus:outline-none focus:border-black"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleGenerateCoverImage}
              disabled={isGeneratingCoverImage || !coverImagePrompt.trim()}
              className="flex-1 bg-black hover:bg-[#333] disabled:opacity-50 text-white text-xs font-bold px-3 py-2 flex items-center justify-center gap-1.5 transition"
            >
              {isGeneratingCoverImage ? (
                <><Sparkles size={12} className="animate-spin" /> 生成中…</>
              ) : (
                <><Sparkles size={12} /> 生成封面图片</>
              )}
            </button>
            {isGeneratingCoverImage && (
              <button
                onClick={handleCancelCoverImage}
                className="border border-[#eaeaea] bg-white hover:bg-red-50 text-[#696b72] hover:text-red-600 text-xs font-bold px-3 py-2 flex items-center gap-1 transition"
              >
                <Pause size={12} /> 暂停
              </button>
            )}
            {coverImagePrompt && (
              <button
                onClick={() => { navigator.clipboard.writeText(coverImagePrompt); alert('提示词已复制！'); }}
                className="border border-[#eaeaea] bg-white hover:bg-[#f5f5f5] text-[#171717] text-xs font-bold px-3 py-2 transition"
              >
                <Copy size={12} />
              </button>
            )}
          </div>

          {coverImageError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 p-2.5 text-[10px] text-red-700">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{coverImageError}</span>
            </div>
          )}

          {coverImageUrl ? (
            <div className="space-y-2">
              <img
                src={coverImageUrl}
                alt="AI 生成封面"
                className="w-full border border-[#eaeaea]"
              />
              <a
                href={coverImageUrl}
                download="novel-cover.png"
                className="w-full border border-[#eaeaea] bg-white hover:bg-[#f5f5f5] text-[#171717] text-center font-bold text-xs py-2 flex items-center justify-center gap-1.5 transition"
              >
                <Download size={12} /> 下载封面图片
              </a>
            </div>
          ) : !isGeneratingCoverImage && !coverImageError && (
            <div className="text-center py-8 text-[#d4d4d4] border border-[#eaeaea] bg-white border-dashed">
              <ImageIcon size={24} className="mx-auto mb-2" />
              <span className="text-[10px] font-semibold block">填写提示词后点击"生成封面图片"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
