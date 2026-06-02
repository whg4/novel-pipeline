import { useState } from 'react';
import { AlertTriangle, Check, Cpu, Key, Loader2, Save, Server, ShieldCheck, Sparkles } from 'lucide-react';
import { APIConfig, LLMConnectionTestResult, LLMProviderId } from '../types';
import {
  getProviderConfig,
  saveProviderConfig,
  getProviderConfigs,
  testLLMConnection,
} from '../services/llm';
import { getProviderPreset, PROVIDER_PRESETS } from '../services/providers';

const supportLabel = {
  supported: '可直接调用',
  'proxy-recommended': '建议代理',
  'relay-only': '仅本地 Relay',
} as const;

const supportClass = {
  supported: 'border-grove/40 bg-[#ddf3e4] text-[#00a63e]',
  'proxy-recommended': 'border-amber-200 bg-amber-50 text-amber-700',
  'relay-only': 'border-sky-200 bg-sky-50 text-sky-700',
} as const;

export default function SettingsView() {
  const [config, setConfig] = useState<APIConfig>(() => getProviderConfig('deepseek'));
  const [savedMessage, setSavedMessage] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<LLMConnectionTestResult | null>(null);
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
    setConfiguredProviders(Object.keys(getProviderConfigs()) as LLMProviderId[]);
    setSavedMessage('已保存。该供应商的密钥独立存储，阶段分配请到“阶段模型”中调整。');
    setTimeout(() => setSavedMessage(''), 3000);
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
      <div className="flex items-center gap-3 border-b border-[#171717] pb-4">
        <div className="bg-[#f5f5f5] p-2 border border-accent/20">
          <ShieldCheck className="text-black" size={24} />
        </div>
        <div>
          <h1 className="text-xl font-black font-sans">模型连接</h1>
          <p className="text-[#696b72] text-xs">
            每个供应商单独保存密钥（互不共享）。阶段分配与具体模型请在“阶段模型”中调整。密钥只保存在你的浏览器本地。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-[#888888] uppercase tracking-widest">
            <Server size={14} className="text-black" /> 选择模型供应商
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
            {PROVIDER_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.id}
                onClick={() => handleProviderChange(preset.id)}
                className={`text-left p-3 border transition ${
                  config.provider === preset.id
                    ? 'bg-[#f5f5f5] border-accent/70 text-[#171717]'
                    : 'bg-white border-[#eaeaea] text-[#696b72] hover:border-[#d4d4d4] hover:text-[#171717]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold flex items-center gap-1.5">
                    {configuredProviders.includes(preset.id) && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[#00a63e] shrink-0"
                        title="已配置密钥"
                      />
                    )}
                    {preset.shortName}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${supportClass[preset.directBrowserSupport]}`}>
                    {supportLabel[preset.directBrowserSupport]}
                  </span>
                </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#888888]">{preset.description}</p>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSave} className="lg:col-span-2 bg-[#f9f9f9] border border-[#eaeaea] p-6 space-y-6">
          <div className="bg-white border border-[#eaeaea] p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-[#171717]">当前供应商：{activePreset.name}</span>
              <span className="text-[10px] font-mono px-2 py-0.5 bg-[#f5f5f5] border border-[#eaeaea] text-black">
                {activePreset.apiStyle}
              </span>
            </div>
            <p className="text-xs text-[#696b72] leading-relaxed">{activePreset.helpText}</p>
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
                <Key size={14} className="text-black" /> API 密钥
              </label>
              <input
                type="password"
                value={config.apiKey}
                onChange={(event) => {
                  setConfig({ ...config, apiKey: event.target.value });
                  setTestResult(null);
                }}
                className="w-full bg-[#f9f9f9] border border-[#eaeaea] px-3 py-2 text-sm text-[#171717] font-mono focus:outline-none focus:ring-2 focus:ring-black/50 focus:border-black"
                placeholder={config.apiStyle === 'local-relay' ? '本地 relay 可选；如果需要鉴权再填写' : '请输入该供应商的 API Key'}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-ink-600 uppercase tracking-wider flex items-center gap-2">
                <Server size={14} className="text-black" /> 接口 Base URL
              </label>
              <input
                type="text"
                value={config.baseUrl}
                onChange={(event) => {
                  setConfig({ ...config, baseUrl: event.target.value });
                  setTestResult(null);
                }}
                className="w-full bg-[#f9f9f9] border border-[#eaeaea] px-3 py-2 text-sm text-[#171717] focus:outline-none focus:ring-2 focus:ring-black/50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-ink-600 uppercase tracking-wider flex items-center gap-2">
                <Cpu size={14} className="text-black" /> 模型名称
              </label>
              <input
                type="text"
                value={config.model}
                onChange={(event) => {
                  setConfig({ ...config, model: event.target.value });
                  setTestResult(null);
                }}
                className="w-full bg-[#f9f9f9] border border-[#eaeaea] px-3 py-2 text-sm text-[#171717] focus:outline-none focus:ring-2 focus:ring-black/50"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold text-[#888888] uppercase tracking-wider">常用模型建议</div>
            <div className="flex flex-wrap gap-2">
              {activePreset.modelSuggestions.map((model) => (
                <button
                  type="button"
                  key={model}
                  onClick={() => handleModelSuggestion(model)}
                  className={`text-[11px] font-semibold px-2.5 py-1 border transition ${
                    config.model === model
                      ? 'bg-black border-accent text-white'
                      : 'bg-white border-[#eaeaea] text-[#696b72] hover:text-[#171717] hover:border-[#d4d4d4]'
                  }`}
                >
                  {model}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-[#eaeaea] pt-4">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-ink-600 uppercase tracking-wider">创意温度</label>
                <span className="text-xs font-mono font-bold text-black bg-[#f5f5f5] border border-accent/20 px-2 py-0.5">
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
                className="w-full accent-black h-1.5 bg-[#f5f5f5] rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-[#888888] font-semibold px-0.5">
                <span>稳一点</span>
                <span>放开写</span>
              </div>
            </div>
          </div>

          {testResult && (
            <div className={`border p-4 text-xs space-y-1 ${
              testResult.ok
                ? 'bg-[#ddf3e4] border-grove/40 text-[#00a63e]'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
            >
              <div className="font-bold">{testResult.message}</div>
              <div className="text-ink-600 break-words">{testResult.detail}</div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-end items-stretch sm:items-center gap-3 pt-5 border-t border-[#eaeaea]">
            {savedMessage && (
              <span className="text-xs font-semibold text-[#00a63e] bg-[#ddf3e4] border border-grove/40 px-3 py-1.5 flex items-center gap-1.5">
                <Check size={14} /> {savedMessage}
              </span>
            )}
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting}
              className="bg-white hover:bg-[#f5f5f5] disabled:opacity-60 text-[#696b72] border border-[#eaeaea] font-semibold transition px-5 py-2 text-sm flex items-center justify-center gap-2"
            >
              {isTesting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {isTesting ? '正在测试...' : '测试连接'}
            </button>
            <button
              type="submit"
              className="bg-black hover:bg-[#333] text-white font-semibold transition px-6 py-2 text-sm flex items-center justify-center gap-2"
            >
              <Save size={15} /> 保存配置
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}
