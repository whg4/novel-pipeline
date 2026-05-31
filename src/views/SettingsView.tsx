import { useState } from 'react';
import { AlertTriangle, Check, Cpu, Key, Loader2, Save, Server, ShieldCheck, Sparkles } from 'lucide-react';
import { APIConfig, LLMConnectionTestResult, LLMProviderId } from '../types';
import { getAPIConfig, saveAPIConfig, testLLMConnection } from '../services/llm';
import { createConfigForProvider, getProviderPreset, PROVIDER_PRESETS } from '../services/providers';

const supportLabel = {
  supported: '可直接调用',
  'proxy-recommended': '建议代理',
  'relay-only': '仅本地 Relay',
} as const;

const supportClass = {
  supported: 'border-emerald-900/50 bg-emerald-950/30 text-emerald-300',
  'proxy-recommended': 'border-amber-900/50 bg-amber-950/30 text-amber-300',
  'relay-only': 'border-sky-900/50 bg-sky-950/30 text-sky-300',
} as const;

export default function SettingsView() {
  const [config, setConfig] = useState<APIConfig>(getAPIConfig());
  const [savedMessage, setSavedMessage] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<LLMConnectionTestResult | null>(null);

  const activePreset = getProviderPreset(config.provider);

  const handleProviderChange = (provider: LLMProviderId) => {
    const nextConfig = createConfigForProvider(provider, {
      apiKey: config.apiKey,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });
    setConfig(nextConfig);
    setTestResult(null);
  };

  const handleModelSuggestion = (model: string) => {
    setConfig({ ...config, model });
    setTestResult(null);
  };

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    saveAPIConfig(config);
    setSavedMessage('配置已保存。后续大纲、正文、简介都会使用当前模型。');
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
      <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
        <div className="bg-indigo-950 p-2 rounded-lg border border-indigo-800/30">
          <ShieldCheck className="text-indigo-400" size={24} />
        </div>
        <div>
          <h1 className="text-xl font-bold">模型连接</h1>
          <p className="text-slate-400 text-xs">
            在这里切换 OpenAI、DeepSeek、Claude、Gemini、Grok、OpenRouter 或自定义接口。密钥只保存在你的浏览器本地。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest">
            <Server size={14} className="text-indigo-400" /> 选择模型供应商
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
            {PROVIDER_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.id}
                onClick={() => handleProviderChange(preset.id)}
                className={`text-left p-3 rounded-xl border transition ${
                  config.provider === preset.id
                    ? 'bg-indigo-600/10 border-indigo-500/70 text-indigo-100 shadow-md shadow-indigo-950/40'
                    : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold">{preset.shortName}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${supportClass[preset.directBrowserSupport]}`}>
                    {supportLabel[preset.directBrowserSupport]}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{preset.description}</p>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSave} className="lg:col-span-2 bg-slate-800/30 border border-slate-700/40 rounded-xl p-6 space-y-6 shadow-xl">
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-slate-100">当前供应商：{activePreset.name}</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-indigo-300">
                {activePreset.apiStyle}
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">{activePreset.helpText}</p>
            {activePreset.directBrowserSupport !== 'supported' && (
              <div className="flex items-start gap-2 text-[11px] text-amber-300 bg-amber-950/20 border border-amber-900/40 p-2 rounded-lg">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>如果浏览器直连失败，请把接口转到你自己的代理地址或本地 relay，再在下面填写代理后的 Base URL。</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Key size={14} className="text-indigo-400" /> API 密钥
              </label>
              <input
                type="password"
                value={config.apiKey}
                onChange={(event) => {
                  setConfig({ ...config, apiKey: event.target.value });
                  setTestResult(null);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500"
                placeholder={config.apiStyle === 'local-relay' ? '本地 relay 可选；如果需要鉴权再填写' : '请输入该供应商的 API Key'}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Server size={14} className="text-indigo-400" /> 接口 Base URL
              </label>
              <input
                type="text"
                value={config.baseUrl}
                onChange={(event) => {
                  setConfig({ ...config, baseUrl: event.target.value });
                  setTestResult(null);
                }}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Cpu size={14} className="text-indigo-400" /> 模型名称
              </label>
              <input
                type="text"
                value={config.model}
                onChange={(event) => {
                  setConfig({ ...config, model: event.target.value });
                  setTestResult(null);
                }}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">常用模型建议</div>
            <div className="flex flex-wrap gap-2">
              {activePreset.modelSuggestions.map((model) => (
                <button
                  type="button"
                  key={model}
                  onClick={() => handleModelSuggestion(model)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition ${
                    config.model === model
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  {model}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-800/80 pt-4">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">创意温度</label>
                <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-950/40 border border-indigo-900 px-2 py-0.5 rounded">
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
                className="w-full accent-indigo-500 h-1.5 bg-slate-900 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-semibold px-0.5">
                <span>稳一点</span>
                <span>放开写</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">最大输出 Token</label>
                <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-950/40 border border-indigo-900 px-2 py-0.5 rounded">
                  {config.maxTokens}
                </span>
              </div>
              <input
                type="number"
                min="200"
                max="32000"
                step="100"
                value={config.maxTokens}
                onChange={(event) => setConfig({ ...config, maxTokens: parseInt(event.target.value, 10) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
          </div>

          {testResult && (
            <div className={`rounded-xl border p-4 text-xs space-y-1 ${
              testResult.ok
                ? 'bg-emerald-950/20 border-emerald-900/50 text-emerald-300'
                : 'bg-rose-950/20 border-rose-900/50 text-rose-300'
            }`}
            >
              <div className="font-bold">{testResult.message}</div>
              <div className="text-slate-300 break-words">{testResult.detail}</div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-end items-stretch sm:items-center gap-3 pt-5 border-t border-slate-800">
            {savedMessage && (
              <span className="text-xs font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                <Check size={14} /> {savedMessage}
              </span>
            )}
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting}
              className="bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-slate-200 border border-slate-700 font-semibold transition px-5 py-2 rounded-lg text-sm flex items-center justify-center gap-2"
            >
              {isTesting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {isTesting ? '正在测试...' : '测试连接'}
            </button>
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition px-6 py-2 rounded-lg text-sm shadow-md flex items-center justify-center gap-2"
            >
              <Save size={15} /> 保存配置
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
