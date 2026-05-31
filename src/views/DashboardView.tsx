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
    if (confirm('Are you absolutely sure you want to delete this novel project? All compiled drafts and outlines will be lost permanently.')) {
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
    // Reset state
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
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-slate-800 to-indigo-950 p-6 rounded-2xl border border-slate-700/50 shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-50 to-indigo-300">
            Novel Pipeline Studio
          </h1>
          <p className="text-slate-400 mt-1 max-w-xl text-sm">
            Professional AI-driven novel imitation pipeline built for rapid plot outline structuring, anti-grease drafting, rigorous log-checking, and click-optimized summary marketing.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2.5 rounded-lg transition shadow-md hover:shadow-indigo-500/10 text-sm shrink-0"
        >
          <Plus size={16} />
          Create New Novel Project
        </button>
      </div>

      {/* Grid of existing novels */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <BookOpen size={18} className="text-indigo-400" />
          Active Novel Shelves ({projects.length})
        </h2>

        {projects.length === 0 ? (
          <div className="text-center py-16 bg-slate-800/40 rounded-xl border border-slate-800 border-dashed">
            <BookOpen size={48} className="mx-auto text-slate-600 mb-3" />
            <h3 className="font-semibold text-slate-300 text-sm">No Active Projects</h3>
            <p className="text-slate-500 text-xs mt-1 max-w-sm mx-auto">
              Ready to construct your masterpiece? Create a new project to feed reference stories, build outlines, and draft.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="mt-4 inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-medium px-3.5 py-1.5 rounded-lg transition text-xs"
            >
              <Plus size={14} /> Create One Now
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map((project) => {
              const totalCh = getChapterCount(project.id!);
              const finCh = getCompletedCount(project.id!);
              return (
                <div
                  key={project.id}
                  onClick={() => {
                    onSelectProject(project.id!);
                    setActiveTab('pipeline');
                  }}
                  className="bg-slate-800/50 hover:bg-slate-800 border border-slate-700/55 rounded-xl p-5 hover:border-slate-600 transition flex flex-col justify-between cursor-pointer group shadow hover:shadow-lg"
                >
                  <div className="space-y-3">
                    <div className="flex justify-between items-start gap-2">
                      <h3 className="font-bold text-slate-200 group-hover:text-indigo-300 transition text-base line-clamp-1">
                        {project.title}
                      </h3>
                      <button
                        onClick={(e) => handleDeleteProject(project.id!, e)}
                        className="text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-slate-900/40 transition shrink-0"
                        title="Delete project"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700/80 text-slate-300">
                        <Tag size={10} className="text-indigo-400" />
                        {project.genre === 'classic-wolf'
                          ? 'Tribal Werewolf'
                          : project.genre === 'female-slap'
                          ? 'Female Slapback'
                          : 'General Genre'}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700/80 text-slate-400">
                        <Clock size={10} />
                        {new Date(project.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed">
                      {project.background || 'No background configurations defined yet.'}
                    </p>
                  </div>

                  <div className="border-t border-slate-700/60 mt-4 pt-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <History size={12} className="text-amber-400" />
                        Chapters: <span className="font-mono text-indigo-300">{totalCh}</span>
                      </div>
                      {finCh > 0 && (
                        <div className="text-xs font-semibold text-emerald-400 flex items-center gap-1 bg-emerald-900/20 px-2 py-0.5 rounded-full border border-emerald-800/10">
                          <Award size={11} /> {finCh} Finished
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-indigo-400 group-hover:translate-x-1 duration-200 inline-block font-semibold">
                      Open Studio →
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Project Modal dialog */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-xl max-w-2xl w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <h3 className="text-lg font-bold text-slate-100 border-b border-slate-700 pb-3">
              Initialize New Novel Project
            </h3>
            <form onSubmit={handleCreateProject} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Book Title</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. Luna's Wild Blood"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Genre & System rules</label>
                  <select
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="female-slap">Female Slapback (打脸闭环)</option>
                    <option value="classic-wolf">Tribal Werewolf (欧美狼人设定)</option>
                    <option value="general">Generic Creative Novel</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">World Setting & Background Description</label>
                <textarea
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  className="w-full h-20 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  placeholder="Describe your world (e.g. The Silverpine Forest occupied by Bloodfang pack, or a corporate high-profile metropolis...)"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Main Characters Profiles</label>
                <textarea
                  value={characters}
                  onChange={(e) => setCharacters(e.target.value)}
                  className="w-full h-20 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  placeholder="Protagonist name, antagonist motives, love interests, hidden identities, and professional tags..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Reference Example Novel (Paste here is highly recommended)</label>
                <textarea
                  value={rawExample}
                  onChange={(e) => setRawExample(e.target.value)}
                  className="w-full h-32 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                  placeholder="Paste several paragraphs or a full sample story. The AI will replicate the precise emotional arc, tension structure, and pacing 1:1."
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-700 pt-4 mt-6">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold px-4 py-2 rounded-lg text-sm transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition"
                >
                  Construct Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
