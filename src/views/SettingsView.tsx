import { useState } from 'react';
import { AlertTriangle, Check, Cpu, Key, Loader2, Save, Server, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { APIConfig, LLMConnectionTestResult, LLMProviderId, StageAssignments, StageRole } from '../types';
import {
  getProviderConfig,
  saveProviderConfig,
  getProviderConfigs,
  getStageAssignments,
  saveStageAssignments,
  testLLMConnection,
} from '../services/llm';
import { getProviderPreset, PROVIDER_PRESETS } from '../services/providers';

const supportLabel = {
  supported: '可直接调用',
  'proxy-recommended': '建议代理',
  'relay-only': '仅本地 Relay',
} as const;

const supportClass = {
  supported: 'border-grove/40 bg-grove-light text-grove',
  'proxy-recommended': 'border-amber-200 bg-amber-50 text-amber-700',
  'relay-only': 'border-sky-200 bg-sky-50 text-sky-700',
} as const;

const stageLabels: Record<StageRole, string> = {
  outline: '大纲生成',
  chapter: '正文写作',
  review: '逻辑审查',
  marketing: '营销素材（简介 / 书名 / 封面）',
};

export default function SettingsView() {
  const [config, setConfig] = useState<APIConfig>(() => {
    const assignments = getStageAssignments();
    return getProviderConfig(assignments.outline);
  });
  const [savedMessage, setSavedMessage] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<LLMConnectionTestResult | null>(null);
  const [stageAssignments, setStageAssignments] = useState<StageAssignments>(getStageAssignments());
  const [configuredProviders, setConfiguredProviders] = useState<LLMProviderId[]>(
    () => Object.keys(getProviderConfigs()) as LLMProviderId[],
  );

  const activePreset = getProviderPreset(config.provider);

  const handleProviderChange = (provider: LLMProviderId) => {
    // 加载该供应商已保存的独立配置（不再复用上一个供应商的 Key）
    setConfig(getProviderConfig(provider));
    setTestResult(null);
  };

  const handleModelSuggestion = (model: string) => {
    setConfig({ ...config, model });
    setTestResult(null);
  };

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    saveProviderConfig(config);
    saveStageAssignments(stageAssignments);
    setConfiguredProviders(Object.keys(getProviderConfigs()) as LLMProviderId[]);
    setSavedMessage('已保存。该供应商的密钥独立存储，各阶段按指派调用对应模型。');
    setTimeout(() => setSavedMessage(''), 3000);
  };

  const handleStageAssignmentChange = (stage: StageRole, provider: LLMProviderId) => {
    setStageAssignments((prev) => ({ ...prev, [stage]: provider }));
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    const result = await testLLMConnection(config);
    setTestResult(result);
    setIsTesting(false);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3 border-b-2 border-ink pb-4">
        <div className="bg-accent-faint p-2 border border-accent/20">
          <ShieldCheck className="text-accent" size={24} />
        </div>
        <div>
          <h1 className="text-xl font-black font-display">模型连接</h1>
          <p className="text-ink-500 text-xs">
            每个供应商单独保存密钥（互不共享），并可为不同工作流阶段指派不同模型。密钥只保存在你的浏览器本地。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-ink-400 uppercase tracking-widest">
            <Server size={14} className="text-accent" /> 选择模型供应商
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
            {PROVIDER_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.id}
                onClick={() => handleProviderChange(preset.id)}
                className={`text-left p-3 border transition ${
                  config.provider === preset.id
                    ? 'bg-accent-faint border-accent/70 text-ink'
                    : 'bg-paper border-rule text-ink-500 hover:border-rule-dark hover:text-ink'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold flex items-center gap-1.5">
                    {configuredProviders.includes(preset.id) && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-grove shrink-0"
                        title="已配置密钥"
                      />
                    )}
                    {preset.shortName}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${supportClass[preset.directBrowserSupport]}`}>
                    {supportLabel[preset.directBrowserSupport]}
                  </span>
                </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-400">{preset.description}</p>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSave} className="lg:col-span-2 bg-paper-50 border border-rule p-6 space-y-6">
          <div className="bg-paper border border-rule p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-ink">当前供应商：{activePreset.name}</span>
              <span className="text-[10px] font-mono px-2 py-0.5 bg-paper-100 border border-rule text-accent">
                {activePreset.apiStyle}
              </span>
            </div>
            <p className="text-xs text-ink-500 leading-relaxed">{activePreset.helpText}</p>
            {activePreset.directBrowserSupport !== 'supported' && (
              <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 p-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>如果浏览器直连失败，请把接口转到你自己的代理地址或本地 relay，再在下面填写代理后的 Base URL。</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-bold text-ink-600 uppercase tracking-wider flex items-center gap-2">
                <Key size={14} className="text-accent" /> API 密钥
              </label>
              <input
                type="password"
                value={config.apiKey}
                onChange={(event) => {
                  setConfig({ ...config, apiKey: event.target.value });
                  setTestResult(null);
                }}
                className="w-full bg-paper-50 border border-rule px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                placeholder={config.apiStyle === 'local-relay' ? '本地 relay 可选；如果需要鉴权再填写' : '请输入该供应商的 API Key'}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-ink-600 uppercase tracking-wider flex items-center gap-2">
                <Server size={14} className="text-accent" /> 接口 Base URL
              </label>
              <input
                type="text"
                value={config.baseUrl}
                onChange={(event) => {
                  setConfig({ ...config, baseUrl: event.target.value });
                  setTestResult(null);
                }}
                className="w-full bg-paper-50 border border-rule px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-ink-600 uppercase tracking-wider flex items-center gap-2">
                <Cpu size={14} className="text-accent" /> 模型名称
              </label>
              <input
                type="text"
                value={config.model}
                onChange={(event) => {
                  setConfig({ ...config, model: event.target.value });
                  setTestResult(null);
                }}
                className="w-full bg-paper-50 border border-rule px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold text-ink-400 uppercase tracking-wider">常用模型建议</div>
            <div className="flex flex-wrap gap-2">
              {activePreset.modelSuggestions.map((model) => (
                <button
                  type="button"
                  key={model}
                  onClick={() => handleModelSuggestion(model)}
                  className={`text-[11px] font-semibold px-2.5 py-1 border transition ${
                    config.model === model
                      ? 'bg-accent border-accent text-white'
                      : 'bg-paper border-rule text-ink-500 hover:text-ink hover:border-rule-dark'
                  }`}
                >
                  {model}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-rule pt-4">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-ink-600 uppercase tracking-wider">创意温度</label>
                <span className="text-xs font-mono font-bold text-accent bg-accent-faint border border-accent/20 px-2 py-0.5">
                  {config.temperature}
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.5"
                step="0.05"
                value={config.temperature}
                onChange={(event) => setConfig({ ...config, temperature: parseFloat(event.target.value) })}
                className="w-full accent-[#9b2d20] h-1.5 bg-paper-100 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-ink-400 font-semibold px-0.5">
                <span>稳一点</span>
                <span>放开写</span>
              </div>
            </div>
          </div>

          {testResult && (
            <div className={`border p-4 text-xs space-y-1 ${
              testResult.ok
                ? 'bg-grove-light border-grove/40 text-grove'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
            >
              <div className="font-bold">{testResult.message}</div>
              <div className="text-ink-600 break-words">{testResult.detail}</div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-end items-stretch sm:items-center gap-3 pt-5 border-t border-rule">
            {savedMessage && (
              <span className="text-xs font-semibold text-grove bg-grove-light border border-grove/40 px-3 py-1.5 flex items-center gap-1.5">
                <Check size={14} /> {savedMessage}
              </span>
            )}
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting}
              className="bg-paper hover:bg-paper-100 disabled:opacity-60 text-ink-500 border border-rule font-semibold transition px-5 py-2 text-sm flex items-center justify-center gap-2"
            >
              {isTesting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {isTesting ? '正在测试...' : '测试连接'}
            </button>
            <button
              type="submit"
              className="bg-accent hover:bg-accent-hover text-white font-semibold transition px-6 py-2 text-sm flex items-center justify-center gap-2"
            >
              <Save size={15} /> 保存配置
            </button>
          </div>
        </form>
      </div>

      {/* 阶段模型指派 */}
      <div className="bg-paper-50 border border-rule p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-ink">
          <Workflow size={16} className="text-accent" /> 阶段模型指派
        </div>
        <p className="text-xs text-ink-500 leading-relaxed">
          为每个工作流阶段指定使用的供应商。需先在上方为对应供应商保存好密钥，再点击下方「保存配置」生效。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(Object.keys(stageLabels) as StageRole[]).map((stage) => (
            <div key={stage} className="space-y-1.5">
              <label className="text-xs font-bold text-ink-600 uppercase tracking-wider">
                {stageLabels[stage]}
              </label>
              <select
                value={stageAssignments[stage]}
                onChange={(event) => handleStageAssignmentChange(stage, event.target.value as LLMProviderId)}
                className="w-full bg-paper-50 border border-rule px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                {PROVIDER_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                    {configuredProviders.includes(preset.id) ? '（已配置）' : '（未配置密钥）'}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-ink-400">
          指派会随上方「保存配置」一并保存。
        </p>
      </div>
    </div>
  );
}
