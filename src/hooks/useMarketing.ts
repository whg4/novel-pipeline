import { useState, useRef, useEffect } from 'react';
import { db } from '../db';
import type { Project, Chapter, Skill } from '../types';
import {
  runLLMStream, compileBlurbPrompt, compileTitlePrompt, compileCoverPrompt,
  getProviderConfig,
} from '../services/llm';
import type { GenerationTask } from './usePipelineTask';
import type { LLMStreamOptions } from '../services/llm';

interface TaskControl {
  beginGenerationTask: (task: GenerationTask, resume?: boolean) => LLMStreamOptions;
  isPausedError: (error: any) => boolean;
  markTaskPaused: (task: GenerationTask, message?: string) => void;
  finishGenerationTask: (task: GenerationTask, paused?: boolean) => void;
}

export function useMarketing(
  projectId: number,
  project: Project | undefined,
  chapters: Chapter[],
  skills: Skill[],
  taskControl: TaskControl,
  setIsGenerating: (v: boolean) => void,
) {
  const [blurbsOutput, setBlurbsOutput] = useState('');
  const [coverPrompt, setCoverPrompt] = useState('');
  const [titleOutput, setTitleOutput] = useState('');
  const [titleCustomPrompt, setTitleCustomPrompt] = useState('');

  const [coverImagePrompt, setCoverImagePrompt] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [isGeneratingCoverImage, setIsGeneratingCoverImage] = useState(false);
  const [coverImageError, setCoverImageError] = useState<string | null>(null);
  const coverImageAbortRef = useRef<AbortController | null>(null);

  const { beginGenerationTask, isPausedError, markTaskPaused, finishGenerationTask } = taskControl;

  // 子任务状态追踪
  const [marketingStatus, setMarketingStatus] = useState<Record<string, 'idle' | 'running' | 'done' | 'failed'>>({
    blurbs: 'idle', titles: 'idle', cover: 'idle',
  });
  const [marketingErrors, setMarketingErrors] = useState<Record<string, string | null>>({
    blurbs: null, titles: null, cover: null,
  });

  // 同步 coverPrompt → coverImagePrompt（仅首次填入）
  useEffect(() => {
    if (coverPrompt && !coverImagePrompt) {
      setCoverImagePrompt(coverPrompt);
    }
  }, [coverPrompt]);

  const updateSubtaskStatus = (task: string, status: 'idle' | 'running' | 'done' | 'failed', error?: string) => {
    setMarketingStatus(prev => ({ ...prev, [task]: status }));
    setMarketingErrors(prev => ({ ...prev, [task]: error || null }));
  };

  const handleGenerateBlurbs = async (streamOptions?: import('../services/llm').LLMStreamOptions) => {
    if (!project) return;
    updateSubtaskStatus('blurbs', 'running');
    try {
      const blurbTemplate = skills.find(s => s.key === 'blurb')?.content || '';
      const sampleText = chapters.slice(0, 3).map(c => c.content).join('\n\n');
      const blurbCompiled = compileBlurbPrompt(project.outline, sampleText, blurbTemplate, {
        background: project.background,
        characters: project.characters,
      });
      let blurbAcc = '';
      await runLLMStream('marketing', blurbCompiled.system, blurbCompiled.user, tok => {
        blurbAcc += tok;
        setBlurbsOutput(blurbAcc);
      }, streamOptions);
      updateSubtaskStatus('blurbs', 'done');
    } catch (e: any) {
      if (isPausedError(e)) throw e; // 让上层处理暂停
      updateSubtaskStatus('blurbs', 'failed', e.message);
    }
  };

  const handleGenerateTitlesLocal = async (streamOptions?: import('../services/llm').LLMStreamOptions) => {
    if (!project) return;
    updateSubtaskStatus('titles', 'running');
    try {
      const titleCompiled = compileTitlePrompt(project.outline, undefined, project.genre);
      let titleAcc = '';
      await runLLMStream('marketing', titleCompiled.system, titleCompiled.user, tok => { titleAcc += tok; }, streamOptions);
      await db.projects.update(projectId, { titleCandidates: titleAcc });
      setTitleOutput(titleAcc);
      updateSubtaskStatus('titles', 'done');
    } catch (e: any) {
      if (isPausedError(e)) throw e;
      updateSubtaskStatus('titles', 'failed', e.message);
    }
  };

  const handleGenerateCoverPromptLocal = async (streamOptions?: import('../services/llm').LLMStreamOptions) => {
    if (!project) return;
    updateSubtaskStatus('cover', 'running');
    try {
      const coverCompiled = compileCoverPrompt(project.outline, project.genre, {
        background: project.background,
        characters: project.characters,
      });
      let coverAcc = '';
      await runLLMStream('marketing', coverCompiled.system, coverCompiled.user, tok => { coverAcc += tok; }, streamOptions);
      await db.projects.update(projectId, { coverPrompt: coverAcc });
      setCoverPrompt(coverAcc);
      updateSubtaskStatus('cover', 'done');
    } catch (e: any) {
      if (isPausedError(e)) throw e;
      updateSubtaskStatus('cover', 'failed', e.message);
    }
  };

  const handleGenerateMarketingKit = async (resume = false) => {
    if (!project) return;
    const streamOptions = beginGenerationTask('marketing', resume);
    setIsGenerating(true);
    if (!resume) {
      setBlurbsOutput('');
      setTitleOutput('');
      setCoverPrompt('');
    }
    let wasPaused = false;

    try {
      // 逐个执行子任务，任一失败不阻塞其余
      if (!resume || !blurbsOutput) {
        await handleGenerateBlurbs(streamOptions);
      }
      if (!resume || !titleOutput) {
        await handleGenerateTitlesLocal(streamOptions);
      }
      if (!resume || !coverPrompt) {
        await handleGenerateCoverPromptLocal(streamOptions);
      }
    } catch (e: any) {
      if (isPausedError(e)) {
        wasPaused = true;
        markTaskPaused('marketing');
      }
    } finally {
      setIsGenerating(false);
      finishGenerationTask('marketing', wasPaused);
    }
  };

  const handleGenerateTitleCandidates = async (resume = false) => {
    if (!project) return;
    const streamOptions = beginGenerationTask('title', resume);
    setIsGenerating(true);
    if (!resume) setTitleOutput('');
    let acc = resume ? titleOutput : '';
    let wasPaused = false;

    try {
      const comp = compileTitlePrompt(project.outline, titleCustomPrompt, project.genre);
      await runLLMStream('marketing', comp.system, comp.user, tok => {
        acc += tok;
        setTitleOutput(acc);
      }, streamOptions);
      await db.projects.update(projectId, { titleCandidates: acc });
    } catch (e: any) {
      if (isPausedError(e)) {
        wasPaused = true;
        markTaskPaused('title');
        if (acc) await db.projects.update(projectId, { titleCandidates: acc });
      } else {
        alert(`书名生成失败：${e.message}`);
      }
    } finally {
      setIsGenerating(false);
      finishGenerationTask('title', wasPaused);
    }
  };

  const handleGenerateCoverImage = async () => {
    const prompt = coverImagePrompt.trim();
    if (!prompt) { alert('请先输入封面提示词'); return; }

    const openaiCfg = getProviderConfig('openai');
    const apiKey = openaiCfg.apiKey;
    if (!apiKey) {
      alert('请先在"模型连接"设置中填写 OpenAI API Key');
      return;
    }

    const abortCtrl = new AbortController();
    coverImageAbortRef.current = abortCtrl;
    setIsGeneratingCoverImage(true);
    setCoverImageError(null);
    setCoverImageUrl(null);

    try {
      const baseUrl = (openaiCfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const res = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        signal: abortCtrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-image-2',
          prompt,
          n: 1,
          size: '1024x1536',
          output_format: 'png',
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`API 错误 ${res.status}: ${errBody}`);
      }
      const data = await res.json();
      const imageData = data?.data?.[0];
      if (imageData?.b64_json) {
        setCoverImageUrl(`data:image/png;base64,${imageData.b64_json}`);
      } else if (imageData?.url) {
        setCoverImageUrl(imageData.url);
      } else {
        throw new Error('响应中未找到图片数据');
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setCoverImageError(e.message || '封面图片生成失败');
      }
    } finally {
      coverImageAbortRef.current = null;
      setIsGeneratingCoverImage(false);
    }
  };

  const handleCancelCoverImage = () => {
    coverImageAbortRef.current?.abort();
  };

  return {
    blurbsOutput,
    setBlurbsOutput,
    coverPrompt,
    setCoverPrompt,
    titleOutput,
    setTitleOutput,
    titleCustomPrompt,
    setTitleCustomPrompt,
    coverImagePrompt,
    setCoverImagePrompt,
    coverImageUrl,
    isGeneratingCoverImage,
    coverImageError,
    marketingStatus,
    marketingErrors,
    handleGenerateMarketingKit,
    handleGenerateTitleCandidates,
    handleGenerateCoverImage,
    handleCancelCoverImage,
    handleGenerateBlurbs,
    handleGenerateTitles: handleGenerateTitlesLocal,
    handleGenerateCoverPrompt: handleGenerateCoverPromptLocal,
  };
}
