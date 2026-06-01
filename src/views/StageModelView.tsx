import { useState } from 'react';
import { AlertTriangle, Check, Cpu, Server } from 'lucide-react';
import type { APIConfig, LLMProviderId, StageAssignments, StageRole } from '../types';
import {
  getConfigForStage,
  getProviderConfigs,
  getStageAssignments,
  saveStageAssignments,
  saveStageModelOverride,
} from '../services/llm';
import { getProviderPreset, PROVIDER_PRESETS } from '../services/providers';

const STAGE_MODEL_ITEMS: { stage: StageRole; label: string; description: string }[] = [
  { stage: 'outline', label: '大纲', description: '结构规划、章节拆分、爽点闭环。' },
  { stage: 'chapter', label: '正文', description: '单章正文生成与续写。' },
  { stage: 'review', label: '审查', description: '逻辑审查、时间线与物证一致性。' },
  { stage: 'marketing', label: '营销', description: '简介、书名候选、封面提示词。' },
];

function buildStageConfigs(): Record<StageRole, APIConfig> {
  return STAGE_MODEL_ITEMS.reduce((acc, item) => {
    acc[item.stage] = getConfigForStage(item.stage);
    return acc;
  }, {} as Record<StageRole, APIConfig>);
}

export default function StageModelView() {
  const [stageAssignments, setStageAssignments] = useState<StageAssignments>(getStageAssignments);
  const [stageConfigs, setStageConfigs] = useState<Record<StageRole, APIConfig>>(buildStageConfigs);
  const [activeStageTab, setActiveStageTab] = useState<StageRole>('outline');
  const [savedMessage, setSavedMessage] = useState('');
  const configuredProviders = Object.keys(getProviderConfigs()) as LLMProviderId[];

  const handleStageProviderChange = (stage: StageRole, provider: LLMProviderId) => {
    const nextAssignments = { ...stageAssignments, [stage]: provider };
    setStageAssignments(nextAssignments);
    saveStageAssignments(nextAssignments);
    saveStageModelOverride(stage, '');
    setStageConfigs({ ...buildStageConfigs(), [stage]: getConfigForStage(stage) });
    setSavedMessage('阶段供应商已保存，模型覆盖已重置。');
    setTimeout(() => setSavedMessage(''), 2500);
  };

  const handleStageModelChange = (stage: StageRole, model: string) => {
    setStageConfigs(prev => ({
      ...prev,
      [stage]: {
        ...(prev[stage] ?? getConfigForStage(stage)),
        model,
      },
    }));
    saveStageModelOverride(stage, model);
    setSavedMessage('阶段模型已保存。');
    setTimeout(() => setSavedMessage(''), 2500);
  };

  const activeItem = STAGE_MODEL_ITEMS.find(item => item.stage === activeStageTab) ?? STAGE_MODEL_ITEMS[0];
  const activeProvider = stageAssignments[activeStageTab];
  const activePreset = getProviderPreset(activeProvider);
  const activeConfig = stageConfigs[activeStageTab] ?? getConfigForStage(activeStageTab);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3 border-b-2 border-ink pb-4">
        <div className="bg-accent-faint p-2 border border-accent/20">
          <Cpu className="text-accent" size={24} />
        </div>
        <div>
          <h1 className="text-xl font-black font-display">阶段模型</h1>
          <p className="text-ink-500 text-xs">
            为大纲、正文、审查和营销分别指定供应商与模型。API Key 仍在“模型连接”中按供应商独立配置。
          </p>
        </div>
      </div>

      {savedMessage && (
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-grove bg-grove-light border border-grove/40 px-3 py-1.5">
          <Check size={14} /> {savedMessage}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 bg-paper-50 border border-rule p-3 space-y-2">
          {STAGE_MODEL_ITEMS.map((item) => {
            const preset = getProviderPreset(stageAssignments[item.stage]);
            const isActive = activeStageTab === item.stage;
            return (
              <button
                key={item.stage}
                type="button"
                onClick={() => setActiveStageTab(item.stage)}
                className={`w-full text-left border px-3 py-3 transition ${
                  isActive
                    ? 'bg-accent text-white border-accent'
                    : 'bg-paper text-ink-500 border-rule hover:text-ink hover:border-rule-dark'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold">{item.label}</span>
                  <span className={`text-[10px] font-mono ${isActive ? 'text-white/80' : 'text-accent'}`}>
                    {preset.shortName}
                  </span>
                </div>
                <p className={`text-[10px] mt-1 leading-relaxed ${isActive ? 'text-white/70' : 'text-ink-400'}`}>
                  {item.description}
                </p>
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-3 bg-paper-50 border border-rule p-6 space-y-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs font-bold text-ink flex items-center gap-1.5">
                <Server size={14} className="text-accent" /> {activeItem.label}阶段
              </div>
              <p className="text-xs text-ink-500 mt-1">{activeItem.description}</p>
            </div>
            <span className="text-[10px] text-ink-400 bg-paper border border-rule px-2 py-1 font-semibold">
              配置会立即保存到本地
            </span>
          </div>

          {!configuredProviders.includes(activeProvider) && (
            <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 p-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>当前供应商尚未在“模型连接”中保存密钥。该阶段会按指派调用，但生成前需要先配置对应 Key。</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-ink-600 uppercase tracking-wider">供应商</label>
              <select
                value={activeProvider}
                onChange={(event) => handleStageProviderChange(activeStageTab, event.target.value as LLMProviderId)}
                className="w-full bg-paper-50 border border-rule px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                {PROVIDER_PRESETS.map(provider => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}{configuredProviders.includes(provider.id) ? '（已配置）' : '（未配置密钥）'}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-ink-600 uppercase tracking-wider">模型名称</label>
              <input
                type="text"
                value={activeConfig.model}
                onChange={(event) => handleStageModelChange(activeStageTab, event.target.value)}
                className="w-full bg-paper-50 border border-rule px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold text-ink-400 uppercase tracking-wider">{activePreset.shortName} 常用模型</div>
            <div className="flex flex-wrap gap-2">
              {activePreset.modelSuggestions.map(model => (
                <button
                  type="button"
                  key={model}
                  onClick={() => handleStageModelChange(activeStageTab, model)}
                  className={`text-[11px] font-semibold px-2.5 py-1 border transition ${
                    activeConfig.model === model
                      ? 'bg-accent border-accent text-white'
                      : 'bg-paper border-rule text-ink-500 hover:text-ink hover:border-rule-dark'
                  }`}
                >
                  {model}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}