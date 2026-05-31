import React, { useState, useEffect } from 'react';
import { getAPIConfig, saveAPIConfig } from '../services/llm';
import { APIConfig } from '../types';
import { ShieldCheck, Info, Key, Server, Cpu, Check } from 'lucide-react';

export default function SettingsView() {
  const [config, setConfig] = useState<APIConfig>(getAPIConfig());
  const [showSavedToast, setShowSavedToast] = useState(false);

  useEffect(() => {
    saveAPIConfig(config);
  }, [config]);

  const handleProviderChange = (provider: APIConfig['provider']) => {
    let baseUrl = '';
    let model = '';
    
    switch (provider) {
      case 'deepseek':
        baseUrl = 'https://api.deepseek.com/v1';
        model = 'deepseek-chat';
        break;
      case 'openai':
        baseUrl = 'https://api.openai.com/v1';
        model = 'gpt-4o';
        break;
      case 'gemini':
        baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/';
        model = 'gemini-1.5-pro';
        break;
      case 'grok':
        baseUrl = 'https://api.x.ai/v1';
        model = 'grok-beta';
        break;
      case 'custom':
        baseUrl = 'https://api.yourproxy.com/v1';
        model = 'custom-model';
        break;
    }
    
    setConfig({
      ...config,
      provider,
      baseUrl,
      model,
    });
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveAPIConfig(config);
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 3000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
        <div className="bg-indigo-950 p-2 rounded-lg border border-indigo-800/30">
          <ShieldCheck className="text-indigo-400" size={24} />
        </div>
        <div>
          <h1 className="text-xl font-bold">API Connection settings</h1>
          <p className="text-slate-400 text-xs">Configure your API credentials. Secrets reside entirely on your device and are never forwarded anywhere else.</p>
        </div>
      </div>

      <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 flex gap-3 text-slate-300">
        <Info size={18} className="text-indigo-400 shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed">
          Because this application runs 100% in your local browser, calls to some endpoints might run into CORS issues. In that case, we recommend either launching your browser with CORS disabled for local testing, or supplying an <strong>API Proxy / Relay</strong> path in the Custom setting.
        </p>
      </div>

      <form onSubmit={handleSave} className="bg-slate-800/30 border border-slate-700/40 rounded-xl p-6 space-y-6 shadow-xl">
        <div className="space-y-4">
          {/* Provider Toggle Grid */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Server size={14} className="text-indigo-400" /> API Provider Preset
            </label>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {(['deepseek', 'openai', 'gemini', 'grok', 'custom'] as const).map((prov) => (
                <button
                  type="button"
                  key={prov}
                  onClick={() => handleProviderChange(prov)}
                  className={`py-2 px-3 text-xs font-semibold rounded-lg border uppercase transition text-center ${
                    config.provider === prov
                      ? 'bg-indigo-600/10 border-indigo-500 text-indigo-300 shadow-md shadow-indigo-950'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                  }`}
                >
                  {prov === 'gemini' ? 'Google Gemini' : prov === 'grok' ? 'xAI Grok' : prov}
                </button>
              ))}
            </div>
          </div>

          {/* Secret API Key Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Key size={14} className="text-indigo-400" /> API Secret Key
            </label>
            <input
              type="password"
              required
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500"
              placeholder={
                config.provider === 'deepseek'
                  ? 'sk-...'
                  : config.provider === 'openai'
                  ? 'sk-proj-...'
                  : 'Enter your API credentials...'
              }
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Custom Endpoint Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Server size={14} className="text-indigo-400" /> Base URL Address
              </label>
              <input
                type="text"
                required
                value={config.baseUrl}
                onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>

            {/* Model Name Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Cpu size={14} className="text-indigo-400" /> LLM Model Name
              </label>
              <input
                type="text"
                required
                value={config.model}
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-800/80 pt-4">
            {/* Temperature Slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Creativity (Temperature)</label>
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
                onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500 h-1.5 bg-slate-900 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-semibold px-0.5">
                <span>Deterministic (0.1)</span>
                <span>Wild Creative (1.5)</span>
              </div>
            </div>

            {/* Max Output Limit */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Max Generation Tokens</label>
                <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-950/40 border border-indigo-900 px-2 py-0.5 rounded">
                  {config.maxTokens}
                </span>
              </div>
              <input
                type="number"
                min="200"
                max="16000"
                step="100"
                value={config.maxTokens}
                onChange={(e) => setConfig({ ...config, maxTokens: parseInt(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
          </div>
        </div>

        {/* Buttons Panel */}
        <div className="flex justify-end items-center gap-3 pt-5 border-t border-slate-800">
          {showSavedToast && (
            <span className="text-xs font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 px-3 py-1.5 rounded-lg flex items-center gap-1.5 anim-fade animate-pulse">
              <Check size={14} /> Connection saved successfully!
            </span>
          )}
          <button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition px-6 py-2 rounded-lg text-sm shadow-md"
          >
            Save API Settings
          </button>
        </div>
      </form>
    </div>
  );
}
