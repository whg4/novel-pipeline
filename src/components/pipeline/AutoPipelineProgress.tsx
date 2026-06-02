import { RefreshCw, Pause, Play } from 'lucide-react';

interface AutoProgress {
  step: string;
  current: number;
  total: number;
}

interface AutoPipelineProgressProps {
  isAutoRunning: boolean;
  autoProgress: AutoProgress | null;
  onPause: () => void;
  onResume: () => void;
  onDismiss: () => void;
}

export default function AutoPipelineProgress({
  isAutoRunning,
  autoProgress,
  onPause,
  onResume,
  onDismiss,
}: AutoPipelineProgressProps) {
  if (!isAutoRunning && !autoProgress) return null;

  return (
    <div className="bg-[#f5f5f5] border border-[#eaeaea] p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {isAutoRunning && <RefreshCw size={16} className="animate-spin text-black shrink-0" />}
        <div className="min-w-0">
          <div className="text-xs font-bold text-black truncate">{autoProgress?.step || '准备中...'}</div>
          {autoProgress && (
            <div className="text-[10px] text-[#888888] mt-0.5">步骤 {autoProgress.current} / {autoProgress.total}</div>
          )}
        </div>
        {autoProgress && (
          <div className="flex-1 h-1.5 bg-[#eaeaea] rounded-full overflow-hidden">
            <div
              className="h-full bg-black rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (autoProgress.current / autoProgress.total) * 100)}%` }}
            />
          </div>
        )}
      </div>
      {isAutoRunning ? (
        <button
          onClick={onPause}
          className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3 py-1.5 transition shrink-0"
        >
          <Pause size={12} /> 暂停
        </button>
      ) : autoProgress?.step !== '全部完成 ✓' && autoProgress && (
        <button
          onClick={onResume}
          className="flex items-center gap-1.5 bg-black hover:bg-[#333] text-white text-xs font-bold px-3 py-1.5 transition shrink-0"
        >
          <Play size={12} /> 继续
        </button>
      )}
      {autoProgress?.step === '全部完成 ✓' && (
        <button
          onClick={onDismiss}
          className="text-xs text-[#888888] hover:text-[#171717] font-semibold px-3 py-1.5 shrink-0"
        >
          关闭
        </button>
      )}
    </div>
  );
}
