import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Project } from '../types';
import { Plus, BookOpen, Clock, Tag, History, Trash2, Award } from 'lucide-react';

interface DashboardViewProps {
  onSelectProject: (projectId: number) => void;
  setActiveTab: (tab: string) => void;
}

export default function DashboardView({ onSelectProject, setActiveTab }: DashboardViewProps) {
  const projects = useLiveQuery(() => db.projects.toArray()) || [];
  const chapters = useLiveQuery(() => db.chapters.toArray()) || [];

  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('female-slap');
  const [background, setBackground] = useState('');
  const [characters, setCharacters] = useState('');
  const [rawExample, setRawExample] = useState('');

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

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const newProject: Project = {
      title,
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
      setActiveTab('pipeline');
    }
  };

  return (
    <div className="space-y-10 max-w-4xl">
      {/* Editorial masthead */}
      <div className="border-b-2 border-ink pb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <p className="text-[10px] font-bold text-ink-400 tracking-[0.2em] uppercase mb-3">AI 辅助创作平台</p>
            <h1 className="font-display text-4xl md:text-5xl font-black text-ink leading-none">小说创作流水线</h1>
            <div className="w-10 h-0.5 bg-accent mt-4 mb-4" />
            <p className="text-ink-500 text-sm max-w-xl leading-relaxed">
              基于你的工作流和 Skill，完成仿写大纲、正文去油、逻辑自查、简介与封面提示词的一体化创作。
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold px-5 py-2.5 text-sm transition shrink-0"
          >
            <Plus size={15} />
            新建小说项目
          </button>
        </div>
      </div>

      {/* Project list */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-base font-bold text-ink flex items-center gap-2">
            <BookOpen size={15} className="text-accent" />
            我的书架
            <span className="text-sm font-normal text-ink-400 ml-1">（{projects.length}）</span>
          </h2>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-rule">
            <BookOpen size={40} className="mx-auto text-ink-300 mb-4" />
            <h3 className="font-serif font-bold text-ink text-base mb-2">还没有小说项目</h3>
            <p className="text-ink-500 text-sm max-w-sm mx-auto mb-5">
              先创建一个项目，粘贴例文、设定人物和背景，再进入创作流水线。
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 border border-ink text-ink hover:bg-paper-100 font-semibold px-4 py-2 text-xs transition"
            >
              <Plus size={13} /> 立即新建
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-rule border border-rule">
            {projects.map((project, index) => {
              const totalCh = getChapterCount(project.id!);
              const finCh = getCompletedCount(project.id!);
              return (
                <div
                  key={project.id}
                  onClick={() => {
                    onSelectProject(project.id!);
                    setActiveTab('pipeline');
                  }}
                  className="bg-paper hover:bg-paper-50 p-5 cursor-pointer group transition flex flex-col justify-between min-h-[160px]"
                >
                  <div className="space-y-2">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-[10px] font-mono text-ink-400 shrink-0">{String(index + 1).padStart(2, '0')}</span>
                        <h3 className="font-serif font-bold text-ink group-hover:text-accent transition text-base line-clamp-1">
                          {project.title}
                        </h3>
                      </div>
                      <button
                        onClick={(e) => handleDeleteProject(project.id!, e)}
                        className="text-ink-300 hover:text-accent transition shrink-0 p-0.5"
                        title="删除项目"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 border border-rule text-ink-500 bg-paper-100">
                        <Tag size={9} className="text-accent" />
                        {project.genre === 'classic-wolf'
                          ? '欧美狼人'
                          : project.genre === 'female-slap'
                          ? '大女主打脸'
                          : '通用小说'}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 border border-rule text-ink-400 bg-paper-100">
                        <Clock size={9} />
                        {new Date(project.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <p className="text-xs text-ink-500 line-clamp-2 leading-relaxed">
                      {project.background || '暂未填写世界观或背景设定。'}
                    </p>
                  </div>

                  <div className="border-t border-rule mt-4 pt-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="text-xs text-ink-500 flex items-center gap-1.5">
                        <History size={11} className="text-ink-400" />
                        章节：<span className="font-mono font-bold text-ink">{totalCh}</span>
                      </div>
                      {finCh > 0 && (
                        <div className="text-xs font-semibold text-grove flex items-center gap-1">
                          <Award size={11} /> {finCh} 完成
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-accent group-hover:translate-x-0.5 duration-200 inline-block font-bold">
                      进入工作台 →
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Project Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-paper border border-rule max-w-2xl w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto space-y-5">
            <div className="border-b-2 border-ink pb-4">
              <h3 className="font-display text-2xl font-black text-ink">新建小说项目</h3>
              <div className="w-8 h-0.5 bg-accent mt-2" />
            </div>
            <form onSubmit={handleCreateProject} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-ink-400 uppercase tracking-[0.15em]">书名</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-paper-50 border border-rule px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                    placeholder="例如：月下纯血"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-ink-400 uppercase tracking-[0.15em]">题材与规则</label>
                  <select
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    className="w-full bg-paper-50 border border-rule px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  >
                    <option value="female-slap">大女主打脸闭环</option>
                    <option value="classic-wolf">欧美狼人设定</option>
                    <option value="general">通用小说</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-ink-400 uppercase tracking-[0.15em]">世界观与背景</label>
                <textarea
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  className="w-full h-20 bg-paper-50 border border-rule px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
                  placeholder="填写故事背景，例如狼族部落、豪门集团、娱乐圈、古早虐恋背景等。"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-ink-400 uppercase tracking-[0.15em]">主要人物设定</label>
                <textarea
                  value={characters}
                  onChange={(e) => setCharacters(e.target.value)}
                  className="w-full h-20 bg-paper-50 border border-rule px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
                  placeholder="填写女主、男主、反派、隐藏身份、专业领域、误会物证等关键信息。"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-ink-400 uppercase tracking-[0.15em]">例文原文（建议粘贴）</label>
                <textarea
                  value={rawExample}
                  onChange={(e) => setRawExample(e.target.value)}
                  className="w-full h-32 bg-paper-50 border border-rule px-3 py-2 text-sm font-mono text-xs text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
                  placeholder="粘贴要仿写的例文。系统会尽量复刻情绪线、爽点、节奏和结构，但替换成新背景、新人物、新事件。"
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-rule pt-4 mt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="border border-rule text-ink-500 hover:bg-paper-100 font-semibold px-4 py-2 text-sm transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="bg-accent hover:bg-accent-hover text-white font-bold px-5 py-2 text-sm transition"
                >
                  创建项目
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
