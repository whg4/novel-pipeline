import { Pause } from 'lucide-react';
import type { GenerationTask } from '../../hooks/usePipelineTask';

interface PauseBannerProps {
  pauseMessage: string;
  pausedTask: GenerationTask | null;
}

export default function PauseBanner({ pauseMessage, pausedTask }: PauseBannerProps) {
  if (!pauseMessage || !pausedTask) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 text-xs font-semibold flex items-center gap-2">
      <Pause size={14} /> {pauseMessage}
    </div>
  );
}
