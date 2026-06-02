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
    <div className="bg-accent-faint border border-accent/30 p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {isAutoRunning && <RefreshCw size={16} className="animate-spin text-accent shrink-0" />}
        <div className="min-w-0">
          <div className="text-xs font-bold text-accent truncate">{autoProgress?.step || '准备中...'}</div>
          {autoProgress && (
            <div className="text-[10px] text-ink-400 mt-0.5">步骤 {autoProgress.current} / {autoProgress.total}</div>
          )}
        </div>
        {autoProgress && (
          <div className="flex-1 h-1.5 bg-rule rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-500"
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
          className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold px-3 py-1.5 transition shrink-0"
        >
          <Play size={12} /> 继续
        </button>
      )}
      {autoProgress?.step === '全部完成 ✓' && (
        <button
          onClick={onDismiss}
          className="text-xs text-ink-400 hover:text-ink font-semibold px-3 py-1.5 shrink-0"
        >
          关闭
        </button>
      )}
    </div>
  );
}
