import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Skill } from '../types';
import { FileCode, Settings2, Edit, Save, Plus, FileUp, Trash2, CheckCircle2 } from 'lucide-react';

export default function SkillRegistry() {
  const skills = useLiveQuery(() => db.skills.toArray()) || [];
  const [selectedKey, setSelectedKey] = useState<string>('workflow');
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  
  // Custom skill modal form
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<'workflow' | 'template' | 'rule' | 'logic_check' | 'blurb'>('rule');
  const [newDesc, setNewDesc] = useState('');
  const [newContent, setNewContent] = useState('');

  const activeSkill = skills.find(s => s.key === selectedKey);

  const startEditing = () => {
    if (activeSkill) {
      setEditedContent(activeSkill.content);
      setIsEditing(true);
    }
  };

  const saveEdits = async () => {
    if (activeSkill) {
      await db.skills.update(selectedKey, { content: editedContent });
      setIsEditing(false);
    }
  };

  const handleCreateSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim() || !newName.trim()) return;

    const skill: Skill = {
      key: newKey.trim().toLowerCase(),
      name: newName,
      category: newCategory,
      description: newDesc,
      content: newContent || `# ${newName}\n\nAdd your guideline instructions here...`,
    };

    await db.skills.add(skill);
    setSelectedKey(skill.key);
    setShowAddModal(false);

    // Reset fields
    setNewKey('');
    setNewName('');
    setNewDesc('');
    setNewContent('');
  };

  const handleDeleteSkill = async (key: string) => {
    if (confirm(`Are you sure you want to permanently delete custom skill "${key}"? Preset system skills cannot be recovered unless database is reseeded.`)) {
      await db.skills.delete(key);
      const remaining = skills.filter(s => s.key !== key);
      if (remaining.length > 0) {
        setSelectedKey(remaining[0].key);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      const title = file.name.replace(/\.[^/.]+$/, ""); // strip extension
      const safeKey = title.toLowerCase().replace(/[^a-z0-9_-]/g, "_");

      setNewKey(safeKey);
      setNewName(title);
      setNewContent(text);
      setNewDesc(`Imported custom guideline from file: ${file.name}`);
    };
    reader.readAsText(file);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 h-[calc(100vh-180px)]">
      {/* Sidebar: Skills select index cards */}
      <div className="md:col-span-1 border border-rule bg-paper-50 p-4 flex flex-col justify-between overflow-y-auto space-y-4">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold text-ink-400 uppercase tracking-widest flex items-center gap-1.5">
              <Settings2 size={12} className="text-accent" /> Guideline Modules
            </h3>
            <button
              onClick={() => setShowAddModal(true)}
              className="p-1 hover:bg-accent-faint text-accent hover:text-accent-hover rounded transition border border-rule"
              title="Add custom skill"
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="space-y-1.5">
            {skills.map((skill) => (
              <div
                key={skill.key}
                onClick={() => {
                  setSelectedKey(skill.key);
                  setIsEditing(false);
                }}
                className={`w-full p-2.5 border-l-2 text-left cursor-pointer transition flex items-center justify-between group ${
                  selectedKey === skill.key
                    ? 'border-accent text-accent bg-accent-faint pl-3'
                    : 'border-transparent text-ink-500 hover:bg-paper-100 hover:text-ink pl-3'
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="text-xs font-bold truncate">{skill.name}</div>
                  <div className="text-[10px] text-ink-400 truncate font-semibold mt-0.5">{skill.description}</div>
                </div>
                {/* Prevent deleting default core assets */}
                {!['workflow', 'outline_template', 'wolf_setting', 'logic_check', 'female_slap', 'degrease', 'blurb', 'connect_skills'].includes(skill.key) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSkill(skill.key);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-ink-400 hover:text-red-600 transition"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="text-[10px] text-ink-400 bg-paper-100 p-3 border border-rule leading-normal">
          💡 Preset guidelines are compiled instantly when the LLM generates drafts or outlines in writing workflows.
        </div>
      </div>

      {/* Editor & Content panel */}
      <div className="md:col-span-3 border border-rule bg-paper overflow-hidden flex flex-col justify-between">
        {activeSkill ? (
          <>
            {/* Header toolbar */}
            <div className="px-4 py-3 border-b border-rule bg-paper-50 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-accent bg-accent-faint border border-accent/20 px-2 py-0.5 uppercase font-mono">
                  {activeSkill.category}
                </span>
                <h2 className="text-sm font-bold text-ink mt-1 font-display">{activeSkill.name}</h2>
              </div>

              <div>
                {isEditing ? (
                  <button
                    onClick={saveEdits}
                    className="flex items-center gap-1.5 bg-grove text-white hover:bg-grove-muted font-semibold text-xs px-3.5 py-1.5 transition"
                  >
                    <Save size={13} /> Save Guideline
                  </button>
                ) : (
                  <button
                    onClick={startEditing}
                    className="flex items-center gap-1.5 border border-rule bg-paper hover:bg-paper-100 text-ink-500 font-semibold text-xs px-3.5 py-1.5 transition"
                  >
                    <Edit size={13} /> Edit Instructions
                  </button>
                )}
              </div>
            </div>

            {/* TextArea editor or styled Viewer */}
            <div className="flex-1 p-5 overflow-auto text-xs leading-relaxed font-mono">
              {isEditing ? (
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className="w-full h-full bg-paper-50 border border-rule p-4 font-mono text-ink text-xs focus:ring-1 focus:ring-accent focus:outline-none leading-relaxed resize-none"
                />
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-ink-600 max-w-none text-xs leading-relaxed">
                  {activeSkill.content}
                </pre>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
            <FileCode size={40} className="text-ink-300 mb-2" />
            <p className="text-xs text-ink-400">No instruction card active. Select one from left side bar panel.</p>
          </div>
        )}
      </div>

      {/* Creation Modal Form */}
      {showAddModal && (
        <div className="fixed inset-0 bg-ink/60 flex items-center justify-center p-4 z-50">
          <div className="bg-paper border border-rule max-w-xl w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-black font-display text-ink border-b border-rule pb-2">
              Create / Upload Custom Guideline
            </h3>
            <form onSubmit={handleCreateSkill} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-bold text-ink-600 uppercase">Skill Title</label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      if (!newKey) {
                        setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_"));
                      }
                    }}
                    className="w-full bg-paper-50 border border-rule px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="e.g. 爽快爆笑爽文法则"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-bold text-ink-600 uppercase">Unique Key Handle</label>
                  <input
                    type="text"
                    required
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className="w-full bg-paper-50 border border-rule px-3 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="e.g. funny_punch"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-bold text-ink-600 uppercase">Category type</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as any)}
                    className="w-full bg-paper-50 border border-rule px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    <option value="rule">Writing Rule (写作风格约束)</option>
                    <option value="template">Output Template (大纲/格式模板)</option>
                    <option value="logic_check">Log check procedure (逻辑审查)</option>
                    <option value="blurb">Blurb / Summary style (简介规则)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="font-bold text-ink-600 uppercase">One-line description</label>
                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    className="w-full bg-paper-50 border border-rule px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="e.g. Adds dynamic comedic timing beats to slapback instances"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-ink-600 uppercase">Markdown instructions</label>
                  <label className="cursor-pointer text-accent hover:text-accent-hover font-semibold flex items-center gap-1">
                    <FileUp size={12} /> Upload .MD file
                    <input
                      type="file"
                      accept=".md,.txt"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full h-40 bg-paper-50 border border-rule px-3 py-2 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent"
                  placeholder="# Enter instructions..."
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-rule pt-3 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="border border-rule bg-paper hover:bg-paper-100 text-ink-500 font-semibold px-4 py-1.5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-accent hover:bg-accent-hover text-white font-semibold px-4 py-1.5 flex items-center gap-1.5"
                >
                  <CheckCircle2 size={13} /> Add Skill Module
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
