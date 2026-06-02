import { useState, useRef } from 'react';
import { LLM_PAUSED_ERROR } from '../services/llm';

export type GenerationTask = 'auto' | 'outline' | 'outline-review' | 'chapter' | 'review' | 'marketing' | 'title';

export type TaskControlRender = (task: GenerationTask, onResume: () => void) => React.ReactNode;

export function usePipelineTask() {
  const [activeTask, setActiveTask] = useState<GenerationTask | null>(null);
  const [pausedTask, setPausedTask] = useState<GenerationTask | null>(null);
  const [pauseMessage, setPauseMessage] = useState('');

  const generationAbortRef = useRef<AbortController | null>(null);
  const pausedTaskRef = useRef<GenerationTask | null>(null);

  const beginGenerationTask = (task: GenerationTask, resume = false) => {
    const controller = new AbortController();
    generationAbortRef.current = controller;
    pausedTaskRef.current = null;
    setActiveTask(task);
    if (!resume) setPausedTask(null);
    setPauseMessage('');

    return {
      signal: controller.signal,
      shouldPause: () => pausedTaskRef.current === task,
    };
  };

  const pauseCurrentTask = (autoPauseRef?: React.MutableRefObject<boolean>) => {
    if (!activeTask) return;
    pausedTaskRef.current = activeTask;
    if (activeTask === 'auto' && autoPauseRef) autoPauseRef.current = true;
    setPausedTask(activeTask);
    setPauseMessage('已暂停，当前内容已保留。');
    generationAbortRef.current?.abort();
  };

  const finishGenerationTask = (task: GenerationTask, paused = false) => {
    setActiveTask(prev => prev === task ? null : prev);
    if (!paused) {
      setPausedTask(prev => prev === task ? null : prev);
      pausedTaskRef.current = null;
    }
    generationAbortRef.current = null;
  };

  const isPausedError = (error: any) => error?.message === LLM_PAUSED_ERROR || error?.name === 'AbortError';

  const markTaskPaused = (task: GenerationTask, message = '已暂停，当前内容已保留。') => {
    pausedTaskRef.current = task;
    setPausedTask(task);
    setPauseMessage(message);
  };

  return {
    activeTask,
    setActiveTask,
    pausedTask,
    setPausedTask,
    pauseMessage,
    setPauseMessage,
    generationAbortRef,
    pausedTaskRef,
    beginGenerationTask,
    pauseCurrentTask,
    finishGenerationTask,
    isPausedError,
    markTaskPaused,
  };
}
