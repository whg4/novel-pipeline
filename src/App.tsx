import { Routes, Route, NavLink, useNavigate, useParams, Navigate, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ConfigProvider } from 'antd';
import { XProvider } from '@ant-design/x';
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

// ── Ant Design 主题配置：Vercel Geist 浅色模式 ────────────────────
const antdTheme = {
  token: {
    colorPrimary: '#000000',
    colorPrimaryHover: '#333333',
    colorPrimaryActive: '#000000',
    colorBgContainer: '#ffffff',
    colorBgLayout: '#f9f9f9',
    colorBgElevated: '#ffffff',
    colorBorder: '#eaeaea',
    colorBorderSecondary: '#f0f0f0',
    colorText: '#171717',
    colorTextSecondary: '#696b72',
    colorTextTertiary: '#888888',
    colorTextQuaternary: '#d4d4d4',
    colorError: '#ee0000',
    colorSuccess: '#00a63e',
    colorWarning: '#f5a623',
    fontFamily: "'Geist', 'Inter', 'Noto Sans SC', system-ui, sans-serif",
    borderRadius: 6,
    controlHeight: 32,
    fontSize: 12,
  },
  components: {
    Button: {
      colorPrimary: '#000000',
      colorPrimaryHover: '#333333',
      colorPrimaryActive: '#000000',
      borderRadius: 6,
      controlHeight: 28,
      fontSize: 12,
    },
  },
};

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
    <div className="flex min-h-screen bg-white text-[#171717] flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-52 bg-[#f9f9f9] border-b md:border-b-0 md:border-r border-[#eaeaea] flex flex-col justify-between shrink-0 select-none">
        <div className="p-5 space-y-8">
          {/* Logo */}
          <div className="pb-5 border-b border-[#171717]">
            <div className="flex items-center gap-2 mb-2">
              <BookMarked size={14} className="text-black" />
              <span className="text-[9px] font-bold text-[#888888] tracking-[0.2em] uppercase">小说流水线</span>
            </div>
            <h1 className="font-sans text-2xl font-black text-[#171717] leading-none">创作工作台</h1>
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
                      ? 'text-black font-bold border-l-2 border-black pl-3'
                      : 'text-[#696b72] hover:text-[#171717] pl-3.5 border-l-2 border-transparent'
                  }`
                }
              >
                <span className="text-[9px] font-mono font-bold text-[#888888] w-5 shrink-0">{item.num}</span>
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
                      ? 'text-black font-bold border-l-2 border-black pl-3'
                      : 'text-[#696b72] hover:text-[#171717] pl-3.5 border-l-2 border-transparent'
                  }`
                }
              >
                <span className="text-[9px] font-mono font-bold text-[#888888] w-5 shrink-0">02</span>
                <Layers size={14} />
                <span>创作流水线</span>
                <span className="ml-auto text-[8px] font-bold bg-[#f5f5f5] text-[#696b72] px-1.5 py-0.5 border border-[#eaeaea]">
                  已选
                </span>
              </NavLink>
            ) : (
              <button
                onClick={() => alert('请先选择或创建一个小说项目。')}
                className="w-full flex items-center gap-3 py-2.5 text-left transition-all text-xs opacity-40 cursor-not-allowed pl-3.5 border-l-2 border-transparent"
              >
                <span className="text-[9px] font-mono font-bold text-[#888888] w-5 shrink-0">02</span>
                <Layers size={14} />
                <span>创作流水线</span>
              </button>
            )}
          </nav>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-[#eaeaea] text-[10px] text-[#888888] space-y-2 font-medium">
          {activeProject && (
            <div className="bg-[#f5f5f5] border border-[#eaeaea] px-2.5 py-2 text-[#171717] text-[10px] font-semibold leading-snug">
              当前项目：<strong>{activeProject.title}</strong>
            </div>
          )}
          <div className="flex items-center gap-1">
            <span>本地浏览器运行</span>
            <Heart size={8} className="text-black fill-current mx-0.5" />
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
  return (
    <ConfigProvider theme={antdTheme}>
      <XProvider theme={antdTheme}>
        <Shell />
      </XProvider>
    </ConfigProvider>
  );
}
