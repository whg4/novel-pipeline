import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { Project } from './types';
import DashboardView from './views/DashboardView';
import SkillRegistry from './views/SkillRegistry';
import SettingsView from './views/SettingsView';
import PipelineView from './views/PipelineView';
import { 
  BookOpen, Layers, BookMarked, Sliders, Key, Heart 
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  const activeProject = useLiveQuery(
    () => {
      if (!selectedProjectId) return Promise.resolve(undefined);
      return db.projects.get(selectedProjectId);
    },
    [selectedProjectId]
  ) as Project | undefined;

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100 flex-col md:flex-row">
      {/* Sidebar navigation */}
      <aside className="w-full md:w-64 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col justify-between shrink-0 select-none">
        <div className="p-5 space-y-6">
          {/* Logo Heading */}
          <div className="flex items-center gap-3 border-b border-slate-850 pb-5">
            <div className="bg-indigo-600/10 p-2 rounded-xl border border-indigo-500/20">
              <BookMarked size={22} className="text-indigo-400" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">小说流水线</span>
              <h1 className="text-sm font-extrabold text-slate-200">创作工作台</h1>
            </div>
          </div>

          {/* Nav groups */}
          <nav className="space-y-1.5 text-xs font-semibold">
            {/* 1. Dashboard Tab */}
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition ${
                activeTab === 'dashboard'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40'
                  : 'text-slate-400 hover:bg-slate-850 hover:text-slate-200'
              }`}
            >
              <BookOpen size={16} />
              书架
            </button>

            {/* 2. Pipeline tab */}
            <button
              onClick={() => {
                if (selectedProjectId) {
                  setActiveTab('pipeline');
                } else {
                  alert('请先选择或创建一个小说项目。');
                  setActiveTab('dashboard');
                }
              }}
              className={`w-full flex items-center justify-between px-4 py-2.5 rounded-lg transition ${
                !selectedProjectId ? 'opacity-50 cursor-not-allowed' : ''
              } ${
                activeTab === 'pipeline'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40'
                  : 'text-slate-400 hover:bg-slate-850 hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-3">
                <Layers size={16} /> 创作流水线
              </span>
              {activeProject && (
                <span className="text-[9px] bg-slate-950 font-mono px-1.5 py-0.5 rounded border border-slate-800 text-indigo-300">
                  已选择
                </span>
              )}
            </button>

            {/* 3. Skill Register */}
            <button
              onClick={() => setActiveTab('skills')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition ${
                activeTab === 'skills'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40'
                  : 'text-slate-400 hover:bg-slate-850 hover:text-slate-200'
              }`}
            >
              <Sliders size={16} /> Skill 管理
            </button>

            {/* 4. Settings tab */}
            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition ${
                activeTab === 'settings'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40'
                  : 'text-slate-400 hover:bg-slate-850 hover:text-slate-200'
              }`}
            >
              <Key size={16} /> 模型连接
            </button>
          </nav>
        </div>

        {/* Footer brand detail */}
        <div className="p-5 border-t border-slate-850 text-[10px] text-slate-500 space-y-2 font-semibold">
          {activeProject && (
            <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-850 leading-normal animate-pulse text-indigo-300">
              当前项目：<strong>{activeProject.title}</strong>
            </div>
          )}
          <div className="flex items-center gap-1">
            <span>本地浏览器运行</span>
            <Heart size={8} className="text-rose-500 fill-current" />
            <span>多模型适配</span>
          </div>
        </div>
      </aside>

      {/* Main workspace section */}
      <main className="flex-1 p-6 md:p-8 overflow-y-auto max-h-screen">
        {activeTab === 'dashboard' && (
          <DashboardView 
            onSelectProject={setSelectedProjectId} 
            setActiveTab={setActiveTab} 
          />
        )}
        {activeTab === 'pipeline' && selectedProjectId && (
          <PipelineView projectId={selectedProjectId} />
        )}
        {activeTab === 'skills' && <SkillRegistry />}
        {activeTab === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
