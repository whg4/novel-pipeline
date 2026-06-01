import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { Project } from './types';
import DashboardView from './views/DashboardView';
import SkillRegistry from './views/SkillRegistry';
import SettingsView from './views/SettingsView';
import PipelineView from './views/PipelineView';
import StageModelView from './views/StageModelView';
import { 
  BookOpen, Layers, BookMarked, Sliders, Key, Heart, Cpu
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

  const navItems = [
    { id: 'dashboard', icon: <BookOpen size={14} />, label: '书架', num: '01', disabled: false },
    { id: 'pipeline', icon: <Layers size={14} />, label: '创作流水线', num: '02', disabled: !selectedProjectId },
    { id: 'stage-models', icon: <Cpu size={14} />, label: '阶段模型', num: '03', disabled: false },
    { id: 'skills', icon: <Sliders size={14} />, label: 'Skill 管理', num: '04', disabled: false },
    { id: 'settings', icon: <Key size={14} />, label: '模型连接', num: '05', disabled: false },
  ];

  return (
    <div className="flex min-h-screen bg-paper text-ink flex-col md:flex-row">
      {/* Sidebar navigation */}
      <aside className="w-full md:w-52 bg-paper-50 border-b md:border-b-0 md:border-r border-rule flex flex-col justify-between shrink-0 select-none">
        <div className="p-5 space-y-8">
          {/* Logo */}
          <div className="pb-5 border-b-2 border-ink">
            <div className="flex items-center gap-2 mb-2">
              <BookMarked size={14} className="text-accent" />
              <span className="text-[9px] font-bold text-ink-400 tracking-[0.2em] uppercase">小说流水线</span>
            </div>
            <h1 className="font-display text-2xl font-black text-ink leading-none">创作工作台</h1>
          </div>

          {/* Nav */}
          <nav className="space-y-0.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  if (item.disabled) {
                    alert('请先选择或创建一个小说项目。');
                    setActiveTab('dashboard');
                    return;
                  }
                  setActiveTab(item.id);
                }}
                className={`w-full flex items-center gap-3 py-2.5 text-left transition-all text-xs ${
                  item.disabled ? 'opacity-40 cursor-not-allowed' : ''
                } ${
                  activeTab === item.id
                    ? 'text-accent font-bold border-l-2 border-accent pl-3'
                    : 'text-ink-500 hover:text-ink pl-3.5 border-l-2 border-transparent'
                }`}
              >
                <span className="text-[9px] font-mono font-bold text-ink-400 w-5 shrink-0">{item.num}</span>
                {item.icon}
                <span>{item.label}</span>
                {item.id === 'pipeline' && activeProject && (
                  <span className="ml-auto text-[8px] font-bold bg-accent/10 text-accent px-1.5 py-0.5 border border-accent/20">
                    已选
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-rule text-[10px] text-ink-400 space-y-2 font-medium">
          {activeProject && (
            <div className="bg-accent-faint border border-accent/20 px-2.5 py-2 text-accent text-[10px] font-semibold leading-snug">
              当前项目：<strong>{activeProject.title}</strong>
            </div>
          )}
          <div className="flex items-center gap-1">
            <span>本地浏览器运行</span>
            <Heart size={8} className="text-accent fill-current mx-0.5" />
            <span>多模型适配</span>
          </div>
        </div>
      </aside>

      {/* Main workspace section */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto max-h-screen">
        {activeTab === 'dashboard' && (
          <DashboardView 
            onSelectProject={setSelectedProjectId} 
            setActiveTab={setActiveTab} 
          />
        )}
        {activeTab === 'pipeline' && selectedProjectId && (
          <PipelineView projectId={selectedProjectId} />
        )}
        {activeTab === 'stage-models' && <StageModelView />}
        {activeTab === 'skills' && <SkillRegistry />}
        {activeTab === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
