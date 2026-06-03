import React, { useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { message as antdMessage } from 'antd';
import { db } from '../db';
import { Project } from '../types';
import { Plus, BookOpen, Clock, Tag, History, Trash2, Award, FileUp, Download, Upload } from 'lucide-react';
import { exportProject, importProject } from '../utils/projectIO';
import { getTemplates, saveTemplate } from '../utils/templates';

interface DashboardViewProps {
  onSelectProject: (projectId: number) => void;
}

export default function DashboardView({ onSelectProject }: DashboardViewProps) {
  const projects = useLiveQuery(() => db.projects.toArray()) || [];
  const chapters = useLiveQuery(() => db.chapters.toArray()) || [];

  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('general');
  const [background, setBackground] = useState('');
  const [characters, setCharacters] = useState('');
  const [rawExample, setRawExample] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const templates = getTemplates();

  const getChapterCount = (projectId: number) => {
    return chapters.filter(c => c.projectId === projectId).length;
  };

  const getCompletedCount = (projectId: number) => {
    return chapters.filter(c => c.projectId === projectId && c.isCompleted).length;
  };

  const handleDeleteProject = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('确定要删除这个小说项目吗？已生成的大纲、正文草稿和版本记录都会被永久删除。')) {
      await db.projects.delete(id);
      const projectChapters = chapters.filter(c => c.projectId === id);
      for (const ch of projectChapters) {
        if (ch.id) await db.chapters.delete(ch.id);
      }
    }
  };

  const handleExportProject = async (projectId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await exportProject(projectId);
      antdMessage.success('项目已导出');
    } catch (err: any) {
      antdMessage.error(`导出失败：${err.message}`);
    }
  };

  const handleImportProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const newId = await importProject(file);
      if (newId) {
        antdMessage.success('项目已导入');
        onSelectProject(newId);
      }
    } catch (err: any) {
      antdMessage.error(`导入失败：${err.message}`);
    }
    e.target.value = '';
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();

    const newProject: Project = {
      title: title.trim() || '未命名项目',
      genre,
      background,
      characters,
      rawExample,
      outline: '',
      createdAt: Date.now(),
    };

    const id = await db.projects.add(newProject);
    setShowModal(false);
    setTitle('');
    setBackground('');
    setCharacters('');
    setRawExample('');
    
    if (id) {
      onSelectProject(Number(id));
    }
  };

  return (
    <div className="space-y-10 max-w-4xl">
      {/* Editorial masthead */}
      <div className="border-b border-[#171717] pb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <p className="text-[10px] font-bold text-[#888888] tracking-[0.2em] uppercase mb-3">AI 辅助创作平台</p>
            <h1 className="font-sans text-4xl md:text-5xl font-black text-[#171717] leading-none">小说创作流水线</h1>
            <div className="w-10 h-0.5 bg-black mt-4 mb-4" />
            <p className="text-[#696b72] text-sm max-w-xl leading-relaxed">
              基于你的工作流和 Skill，完成仿写大纲、正文去油、逻辑自查、简介与封面提示词的一体化创作。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowGuide(true)}
              className="flex items-center gap-1 border border-[#eaeaea] hover:bg-[#f5f5f5] text-[#696b72] font-semibold px-3 py-2 text-sm transition"
              title="快速入门"
            >
              ?
            </button>
            <button
              onClick={() => importInputRef.current?.click()}
              className="flex items-center gap-2 border border-[#eaeaea] hover:bg-[#f5f5f5] text-[#696b72] font-semibold px-4 py-2 text-sm transition"
            >
              <Upload size={14} /> 导入项目
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImportProject}
            />
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 bg-black hover:bg-[#333] text-white font-bold px-5 py-2.5 text-sm transition shrink-0"
            >
              <Plus size={15} />
              新建小说项目
            </button>
          </div>
        </div>
      </div>

      {/* Project list */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-sans text-base font-bold text-[#171717] flex items-center gap-2">
            <BookOpen size={15} className="text-black" />
            我的书架
            <span className="text-sm font-normal text-[#888888] ml-1">（{projects.length}）</span>
          </h2>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-[#eaeaea]">
            <BookOpen size={40} className="mx-auto text-[#d4d4d4] mb-4" />
            <h3 className="font-sans font-bold text-[#171717] text-base mb-2">还没有小说项目</h3>
            <p className="text-[#696b72] text-sm max-w-sm mx-auto mb-5">
              先创建一个项目，粘贴例文、设定人物和背景，再进入创作流水线。
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 border border-[#171717] text-[#171717] hover:bg-[#f5f5f5] font-semibold px-4 py-2 text-xs transition"
            >
              <Plus size={13} /> 立即新建
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-rule border border-[#eaeaea]">
            {projects.map((project, index) => {
              const totalCh = getChapterCount(project.id!);
              const finCh = getCompletedCount(project.id!);
              return (
                <div
                  key={project.id}
                  onClick={() => {
                    onSelectProject(project.id!);
                  }}
                  className="bg-white hover:bg-[#f9f9f9] p-5 cursor-pointer group transition flex flex-col justify-between min-h-[160px]"
                >
                  <div className="space-y-2">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-[10px] font-mono text-[#888888] shrink-0">{String(index + 1).padStart(2, '0')}</span>
                        <h3 className="font-sans font-bold text-[#171717] group-hover:text-black transition text-base line-clamp-1">
                          {project.title}
                        </h3>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => handleExportProject(project.id!, e)}
                          className="text-[#d4d4d4] hover:text-black transition shrink-0 p-0.5"
                          title="导出项目"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          onClick={(e) => handleDeleteProject(project.id!, e)}
                          className="text-[#d4d4d4] hover:text-red-500 transition shrink-0 p-0.5"
                          title="删除项目"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 border border-[#eaeaea] text-[#696b72] bg-[#f5f5f5]">
                        <Tag size={9} className="text-black" />
                        {project.genre === 'classic-wolf'
                          ? '欧美狼人'
                          : project.genre === 'female-slap'
                          ? '大女主打脸'
                          : '通用小说'}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 border border-[#eaeaea] text-[#888888] bg-[#f5f5f5]">
                        <Clock size={9} />
                        {new Date(project.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <p className="text-xs text-[#696b72] line-clamp-2 leading-relaxed">
                      {project.background || '暂未填写世界观或背景设定。'}
                    </p>
                  </div>

                  <div className="border-t border-[#eaeaea] mt-4 pt-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="text-xs text-[#696b72] flex items-center gap-1.5">
                        <History size={11} className="text-[#888888]" />
                        章节：<span className="font-mono font-bold text-[#171717]">{totalCh}</span>
                      </div>
                      {finCh > 0 && (
                        <div className="text-xs font-semibold text-[#00a63e] flex items-center gap-1">
                          <Award size={11} /> {finCh} 完成
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-black group-hover:translate-x-0.5 duration-200 inline-block font-bold">
                      进入工作台 →
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Project Modal — 例文优先 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-[#eaeaea] max-w-2xl w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="border-b border-[#171717] pb-3">
              <h3 className="font-sans text-2xl font-black text-[#171717]">新建小说项目</h3>
              <p className="text-[11px] text-[#888] mt-1">粘贴例文，系统将复刻其节奏和结构，生成你的原创故事</p>
            </div>
            <form onSubmit={handleCreateProject} className="space-y-4">
              {/* 模板选择 */}
              {templates.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold text-[#888] uppercase">快速填充：</span>
                  {templates.map((t, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setGenre(t.genre);
                        setBackground(t.background);
                        setCharacters(t.characters);
                      }}
                      className="text-[10px] px-2 py-0.5 border border-[#eaeaea] hover:border-black hover:bg-[#f5f5f5] transition"
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}

              {/* 核心：例文 — 占最大面积 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-[#171717]">
                    📝 例文原文 <span className="text-[#00a63e] font-normal">（最重要！决定仿写质量）</span>
                  </label>
                  <label className="flex items-center gap-1 bg-white border border-[#eaeaea] hover:bg-[#f5f5f5] text-[#696b72] text-[10px] font-bold px-2 py-1 cursor-pointer transition">
                    <FileUp size={11} /> 上传 TXT
                    <input
                      type="file"
                      accept=".txt"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => setRawExample(ev.target?.result as string || '');
                        reader.readAsText(file, 'utf-8');
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                <textarea
                  value={rawExample}
                  onChange={(e) => setRawExample(e.target.value)}
                  className="w-full h-44 bg-[#f9f9f9] border border-[#eaeaea] px-3 py-2 text-sm font-mono text-xs text-[#171717] focus:outline-none focus:border-black focus:ring-1 focus:ring-black resize-none"
                  placeholder="粘贴要仿写的例文原文（建议 2000 字以上）...&#10;&#10;系统会分析其情绪线、爽点节奏、场景结构，然后用你设定的新背景和新人物重新生成。"
                />
                {rawExample && (
                  <div className="text-[10px] text-[#888]">{rawExample.length.toLocaleString()} 字</div>
                )}
              </div>

              {/* 紧凑行：书名 + 题材 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] font-bold text-[#888888] uppercase tracking-[0.1em]">书名</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-[#f9f9f9] border border-[#eaeaea] px-3 py-1.5 text-sm text-[#171717] focus:outline-none focus:border-black"
                    placeholder="选填，可稍后由 AI 生成"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#888888] uppercase tracking-[0.1em]">题材</label>
                  <select
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    className="w-full bg-[#f9f9f9] border border-[#eaeaea] px-3 py-1.5 text-sm text-[#171717] focus:outline-none focus:border-black"
                  >
                    <option value="general">通用</option>
                    <option value="classic-wolf">狼人</option>
                    <option value="female-slap">打脸</option>
                  </select>
                </div>
              </div>

              {/* 高级设置：可折叠 */}
              <details className="border border-[#eaeaea] rounded">
                <summary className="px-3 py-2 text-[11px] font-bold text-[#888] cursor-pointer hover:bg-[#f9f9f9] select-none">
                  高级设置：背景与人物 <span className="font-normal text-[#bbb]">（可选，后续随时补充）</span>
                </summary>
                <div className="px-3 pb-3 space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[#888888] uppercase tracking-[0.1em]">世界观与背景</label>
                    <textarea
                      value={background}
                      onChange={(e) => setBackground(e.target.value)}
                      className="w-full h-20 bg-[#f9f9f9] border border-[#eaeaea] px-3 py-2 text-xs text-[#171717] focus:outline-none focus:border-black resize-none"
                      placeholder="狼族部落、豪门集团、娱乐圈..."
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[#888888] uppercase tracking-[0.1em]">主要人物设定</label>
                    <textarea
                      value={characters}
                      onChange={(e) => setCharacters(e.target.value)}
                      className="w-full h-20 bg-[#f9f9f9] border border-[#eaeaea] px-3 py-2 text-xs text-[#171717] focus:outline-none focus:border-black resize-none"
                      placeholder="女主、男主、反派、隐藏身份..."
                    />
                  </div>
                </div>
              </details>

              <div className="flex justify-between items-center border-t border-[#eaeaea] pt-3">
                <button
                  type="button"
                  onClick={() => {
                    const name = prompt('模板名称：');
                    if (name?.trim()) {
                      saveTemplate({
                        name: name.trim(),
                        genre,
                        background,
                        characters,
                        defaultSkillKeys: [],
                        createdAt: Date.now(),
                      });
                      antdMessage.success(`模板「${name.trim()}」已保存`);
                    }
                  }}
                  className="text-[10px] text-[#888] hover:text-black transition underline"
                >
                  保存为模板
                </button>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="border border-[#eaeaea] text-[#696b72] hover:bg-[#f5f5f5] font-semibold px-4 py-1.5 text-sm transition"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={!rawExample.trim()}
                    className="bg-black hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-5 py-1.5 text-sm transition"
                  >
                  创建项目
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Start Guide */}
      {showGuide && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-[#eaeaea] max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="border-b border-[#171717] pb-3">
              <h3 className="text-xl font-black text-[#171717]">快速入门</h3>
            </div>
            <div className="space-y-3 text-sm text-[#333] leading-relaxed">
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-black text-white text-xs font-bold flex items-center justify-center">1</span>
                <div>
                  <div className="font-bold">设置 API Key</div>
                  <div className="text-[#888] text-xs">进入「模型连接」配置至少一个 LLM 供应商的 API Key（推荐 DeepSeek 或 Gemini）</div>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-black text-white text-xs font-bold flex items-center justify-center">2</span>
                <div>
                  <div className="font-bold">新建项目</div>
                  <div className="text-[#888] text-xs">填写书名、选择题材、粘贴要仿写的例文（最重要！），设定背景和人物</div>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-black text-white text-xs font-bold flex items-center justify-center">3</span>
                <div>
                  <div className="font-bold">一键全自动</div>
                  <div className="text-[#888] text-xs">进入创作流水线后点击「一键全自动」，系统自动完成：大纲生成 → 章节写作 → 逻辑审查 → 推广素材</div>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-black text-white text-xs font-bold flex items-center justify-center">4</span>
                <div>
                  <div className="font-bold">精修优化</div>
                  <div className="text-[#888] text-xs">在聊天框中输入修改意见，逐章精修。或使用「逻辑审查」自动检测问题</div>
                </div>
              </div>
            </div>
            <div className="border-t border-[#eaeaea] pt-3 flex justify-between items-center">
              <span className="text-[10px] text-[#bbb]">数据保存在浏览器本地，建议定期导出备份</span>
              <button
                onClick={() => setShowGuide(false)}
                className="bg-black hover:bg-[#333] text-white font-bold px-4 py-1.5 text-sm transition"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
