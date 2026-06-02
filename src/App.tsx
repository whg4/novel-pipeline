import { Routes, Route, NavLink, useNavigate, useParams, Navigate, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { Project } from './types';
import DashboardView from './views/DashboardView';
import SkillRegistry from './views/SkillRegistry';
import SettingsView from './views/SettingsView';
import PipelineView from './views/PipelineView';
import StageModelView from './views/StageModelView';
import {
  BookOpen, Layers, BookMarked, Sliders, Key, Heart, Cpu
} from 'lucide-react';

// ── Wrapper that reads :projectId from URL and renders PipelineView ──────────
function PipelineRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = projectId ? parseInt(projectId, 10) : NaN;
  if (isNaN(id)) return <Navigate to="/" replace />;
  return <PipelineView projectId={id} />;
}

// ── Static sidebar nav items ──────────────────────────────────────────────────
const BASE_NAV = [
  { path: '/',              icon: <BookOpen size={14} />, label: '书架',       num: '01' },
  { path: '/stage-models', icon: <Cpu     size={14} />, label: '阶段模型',   num: '03' },
  { path: '/skills',       icon: <Sliders size={14} />, label: 'Skill 管理', num: '04' },
  { path: '/settings',     icon: <Key     size={14} />, label: '模型连接',   num: '05' },
];

// ── Shell ─────────────────────────────────────────────────────────────────────
function Shell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Detect active project from URL /pipeline/:id
  const match = pathname.match(/\/pipeline\/(\d+)/);
  const activeProjectId = match ? parseInt(match[1], 10) : null;

  const activeProject = useLiveQuery(
    () => activeProjectId ? db.projects.get(activeProjectId) : Promise.resolve(undefined),
    [activeProjectId]
  ) as Project | undefined;

  const handleSelectProject = (projectId: number) => {
    navigate(`/pipeline/${projectId}`);
  };

  return (
    <div className="flex min-h-screen bg-paper text-ink flex-col md:flex-row">
      {/* Sidebar */}
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
            {BASE_NAV.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 py-2.5 text-left transition-all text-xs ${
                    isActive
                      ? 'text-accent font-bold border-l-2 border-accent pl-3'
                      : 'text-ink-500 hover:text-ink pl-3.5 border-l-2 border-transparent'
                  }`
                }
              >
                <span className="text-[9px] font-mono font-bold text-ink-400 w-5 shrink-0">{item.num}</span>
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            ))}

            {/* Pipeline entry — dynamic */}
            {activeProjectId ? (
              <NavLink
                to={`/pipeline/${activeProjectId}`}
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 py-2.5 text-left transition-all text-xs ${
                    isActive
                      ? 'text-accent font-bold border-l-2 border-accent pl-3'
                      : 'text-ink-500 hover:text-ink pl-3.5 border-l-2 border-transparent'
                  }`
                }
              >
                <span className="text-[9px] font-mono font-bold text-ink-400 w-5 shrink-0">02</span>
                <Layers size={14} />
                <span>创作流水线</span>
                <span className="ml-auto text-[8px] font-bold bg-accent/10 text-accent px-1.5 py-0.5 border border-accent/20">
                  已选
                </span>
              </NavLink>
            ) : (
              <button
                onClick={() => alert('请先选择或创建一个小说项目。')}
                className="w-full flex items-center gap-3 py-2.5 text-left transition-all text-xs opacity-40 cursor-not-allowed pl-3.5 border-l-2 border-transparent"
              >
                <span className="text-[9px] font-mono font-bold text-ink-400 w-5 shrink-0">02</span>
                <Layers size={14} />
                <span>创作流水线</span>
              </button>
            )}
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

      {/* Main workspace */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto max-h-screen">
        <Routes>
          <Route path="/" element={<DashboardView onSelectProject={handleSelectProject} />} />
          <Route path="/pipeline/:projectId" element={<PipelineRoute />} />
          <Route path="/stage-models" element={<StageModelView />} />
          <Route path="/skills" element={<SkillRegistry />} />
          <Route path="/settings" element={<SettingsView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return <Shell />;
}
