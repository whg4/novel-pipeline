import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Chapter } from '../types';
import { runLLMStream, compileOutlinePrompt, compileChapterPrompt, compileBlurbPrompt } from '../services/llm';
import { 
  Sparkles, BookOpen, Layers, Edit3, 
  CheckSquare, Plus, Save, Copy, 
  AlertTriangle, RefreshCw 
} from 'lucide-react';

interface PipelineViewProps {
  projectId: number;
}

export default function PipelineView({ projectId }: PipelineViewProps) {
  // Query state
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const chapters = useLiveQuery(() => db.chapters.where('projectId').equals(projectId).sortBy('chapterNumber'), [projectId]) || [];
  const skills = useLiveQuery(() => db.skills.toArray()) || [];

  // View States
  const [pipelineTab, setPipelineTab] = useState<'outline' | 'drafting' | 'marketing'>('outline');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationOutput, setGenerationOutput] = useState('');

  // ----------------------------------------------------
  // SUB-TAB 1: OUTLINE STUDIO STATE
  // ----------------------------------------------------
  const [outlineChecklist, setOutlineChecklist] = useState<Record<string, boolean>>({
    a_rhythm: false,
    b_no_jargon: false,
    c_differences: false,
    d_payback: false,
    e_motives: false,
    f_logic_time: false,
    g_transition: false,
    h_item_consistency: false,
    i_no_pose: false,
    j_cliffhangers: false
  });

  // ----------------------------------------------------
  // SUB-TAB 2: DRAFTING ROOM STATE
  // ----------------------------------------------------
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingOutline, setEditingOutline] = useState('');
  const [editingDraft, setEditingContent] = useState('');
  const [greaseWarnings, setGreaseWarnings] = useState<string[]>([]);
  const [draftChecklist, setDraftChecklist] = useState<Record<string, boolean>>({
    timeline: false,
    place: false,
    item_consistent: false,
    item_possession: false,
    avoid_omniscience: false,
    avoid_loop: false,
    stitched_start: false
  });

  // Load first chapter automatically on startup if none selected
  useEffect(() => {
    if (chapters.length > 0 && activeChapterId === null) {
      const first = chapters[0];
      if (first.id) handleSelectChapter(first);
    }
  }, [chapters]);

  // Client-Side AI Greasing Text Analyzer (Auto runs on typing draft inside Drafting Room)
  useEffect(() => {
    if (!editingDraft) {
      setGreaseWarnings([]);
      return;
    }
    const foundWarnings: string[] = [];
    const badPatterns = [
      { regex: /眼神.*(暗|深|沉)/i, label: '“眼神一暗/变深” (Classic AI micro-expression cliché)' },
      { regex: /喉结.*(滚动|微动)/i, label: '“喉结滚动” (Oclushed AI micro-expression cliché)' },
      { regex: /指尖.*(颤|抖)/i, label: '“指尖发颤” (Cliché physical emotional highlight)' },
      { regex: /深吸.*口气/i, label: '“深吸一口气” (Frequent AI breath transition)' },
      { regex: /没有.*由于|没有.*迟疑/i, label: '“没有一丝犹豫” (Repetitive AI decision description)' },
      { regex: /(不单|不仅).*(甚至连)/i, label: '“不仅...甚至连...” (Pretentious AI rhetorical structure)' },
      { regex: /没有.*拉扯/i, label: '“没有拉扯” (AI pattern summary)' },
      { regex: /(自我认知|极端荒谬|在.*智谋面前|他不知道的是)/i, label: '“上帝视角分析” (Violates First-person/limited narrative constraints)' },
      { regex: /(像是在看.*滑稽|像是在看.*脑萎缩)/i, label: '“强行生硬刻薄比喻” (Violating clean anti-grease line)' }
    ];

    badPatterns.forEach(p => {
      if (p.regex.test(editingDraft)) {
        foundWarnings.push(p.label);
      }
    });

    setGreaseWarnings(foundWarnings);
  }, [editingDraft]);

  if (!project) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-400">
        <Sparkles size={36} className="animate-spin text-slate-600 mb-2" />
        <p className="text-sm">Fetching active book dimensions...</p>
      </div>
    );
  }

  // ----------------------------------------------------
  // ENGINE 1: OUTLINE GENERATION
  // ----------------------------------------------------
  const handleGenerateOutline = async () => {
    setIsGenerating(true);
    setGenerationOutput('');
    const template = skills.find(s => s.key === 'outline_template')?.content || '';
    
    try {
      const compiled = compileOutlinePrompt(
        project.rawExample,
        project.background,
        project.characters,
        template
      );

      let accumulated = '';
      await runLLMStream(compiled.system, compiled.user, (tok) => {
        accumulated += tok;
        setGenerationOutput(accumulated);
      });

      // Update in database
      await db.projects.update(projectId, { outline: accumulated });
      setIsGenerating(false);
    } catch (e: any) {
      alert(`Generation Failed: ${e.message}`);
      setIsGenerating(false);
    }
  };

  const handleUpdateOutlineManual = async (val: string) => {
    await db.projects.update(projectId, { outline: val });
  };

  // ----------------------------------------------------
  // ENGINE 2: CHAPTER DRAFTING
  // ----------------------------------------------------
  const handleSelectChapter = (ch: Chapter) => {
    setActiveChapterId(ch.id!);
    setEditingTitle(ch.title);
    setEditingOutline(ch.outlineSection);
    setEditingContent(ch.content);
    // Reset checklists
    setDraftChecklist({
      timeline: false,
      place: false,
      item_consistent: false,
      item_possession: false,
      avoid_omniscience: false,
      avoid_loop: false,
      stitched_start: false
    });
  };

  const handleCreateNewChapter = async () => {
    const nextNum = chapters.length === 0 ? 1 : chapters[chapters.length - 1].chapterNumber + 1;
    const newCh: Chapter = {
      projectId,
      chapterNumber: nextNum,
      title: `Chapter ${nextNum}`,
      outlineSection: '',
      content: '',
      isCompleted: false,
      versionHistory: [],
      lastEdited: Date.now()
    };

    const newId = await db.chapters.add(newCh);
    setActiveChapterId(Number(newId));
    setEditingTitle(`Chapter ${nextNum}`);
    setEditingOutline('');
    setEditingContent('');
  };

  const handleSaveChapterManual = async () => {
    if (activeChapterId === null) return;
    const ch = chapters.find(c => c.id === activeChapterId);
    if (!ch) return;

    // Backup current content version first
    const updatedHistory = [...(ch.versionHistory || [])];
    if (ch.content && ch.content !== editingDraft) {
      updatedHistory.push({ content: ch.content, timestamp: Date.now() });
    }

    await db.chapters.update(activeChapterId, {
      title: editingTitle,
      outlineSection: editingOutline,
      content: editingDraft,
      versionHistory: updatedHistory.slice(-5), // Keep last 5 versions
      lastEdited: Date.now()
    });
    alert('Draft saved locally.');
  };

  const handleGenerateChapterStream = async () => {
    if (activeChapterId === null) return;
    setIsGenerating(true);
    setEditingContent('');
    
    // Determine preceding chapters for stich context
    const prevChapters = chapters.filter(c => c.chapterNumber < (chapters.find(x => x.id === activeChapterId)?.chapterNumber || 0));

    try {
      const isWerewolf = project.genre === 'classic-wolf';
      const isFemaleSlap = project.genre === 'female-slap';

      const compiled = compileChapterPrompt(
        project.outline,
        chapters.find(c => c.id === activeChapterId)?.chapterNumber || 1,
        editingOutline,
        prevChapters,
        skills,
        isWerewolf,
        isFemaleSlap
      );

      let accumulated = '';
      await runLLMStream(compiled.system, compiled.user, (tok) => {
        accumulated += tok;
        setEditingContent(accumulated);
      });

      // Update db directly
      await db.chapters.update(activeChapterId, {
        content: accumulated,
        lastEdited: Date.now()
      });

      setIsGenerating(false);
    } catch (e: any) {
      alert(`Draft generation stream error: ${e.message}`);
      setIsGenerating(false);
    }
  };

  // ----------------------------------------------------
  // ENGINE 3: MARKETING SHORTS
  // ----------------------------------------------------
  const [blurbsOutput, setBlurbsOutput] = useState('');
  const [coverPrompt, setCoverPrompt] = useState('');

  const handleGenerateMarketingKit = async () => {
    setIsGenerating(true);
    setBlurbsOutput('');
    const blurbTemplate = skills.find(s => s.key === 'blurb')?.content || '';
    const sampleText = chapters.slice(0, 3).map(c => c.content).join('\n\n');

    try {
      const compiled = compileBlurbPrompt(
        project.outline,
        sampleText,
        blurbTemplate
      );

      let accumulated = '';
      await runLLMStream(compiled.system, compiled.user, (tok) => {
        accumulated += tok;
        setBlurbsOutput(accumulated);
      });

      // Also auto-concoct standard covers prompts
      const coverIdea = `Vertical dynamic comic cover, book titled "${project.title}", showcasing ${
        project.genre === 'classic-wolf' 
          ? 'a majestic返祖 pure-blood giant werewolf with silver furs running under the moonlight beside a strong tribe leader, natural elements landscape' 
          : 'an elegant elite corporate woman looking down with cold, calculating eyes, while a defeated antagonist sits clothes torn and ruined in backlights'
      }, cinematic high fantasy web novel cover design, aspect ratio 7:10.`;
      
      setCoverPrompt(coverIdea);
      setIsGenerating(false);
    } catch (e: any) {
      alert(`Marketing kit compiler failed: ${e.message}`);
      setIsGenerating(false);
    }
  };

  // Helper copy text
  const handleCopyText = (txt: string) => {
    // Extract everything above "---" if found (to get clean story separate from log check)
    const splitIndex = txt.indexOf('---');
    const cleanDraft = splitIndex !== -1 ? txt.substring(0, splitIndex).trim() : txt;

    navigator.clipboard.writeText(cleanDraft);
    alert('Clean narrative copied to clipboard (all AI logic reviews excluded!).');
  };

  return (
    <div className="space-y-6">
      {/* Title Header details */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active Project Space</div>
          <h1 className="text-lg font-bold text-indigo-300 mt-0.5">{project.title}</h1>
        </div>

        {/* Tab Selector buttons */}
        <div className="flex bg-slate-950 p-1.5 rounded-lg border border-slate-800">
          <button
            onClick={() => setPipelineTab('outline')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition ${
              pipelineTab === 'outline' ? 'bg-indigo-600 font-bold text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers size={13} /> Stage 1: Outline
          </button>
          <button
            onClick={() => setPipelineTab('drafting')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition ${
              pipelineTab === 'drafting' ? 'bg-indigo-600 font-bold text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Edit3 size={13} /> Stage 2: Drafting Room
          </button>
          <button
            onClick={() => setPipelineTab('marketing')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition ${
              pipelineTab === 'marketing' ? 'bg-indigo-600 font-bold text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles size={13} /> Stage 3: Marketing Kit
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------- */}
      {/* STAGE 1: OUTLINE STUDIO */}
      {/* ---------------------------------------------------- */}
      {pipelineTab === 'outline' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-slate-900/40 border border-slate-700/30 rounded-xl p-5 space-y-4 shadow flex flex-col justify-between min-h-[500px]">
              <div className="space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-sidebar border-slate-800">
                  <h3 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                    <Layers size={15} className="text-indigo-400" /> Compiled Book Outline
                  </h3>
                  <button
                    disabled={isGenerating}
                    onClick={handleGenerateOutline}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition"
                  >
                    <Sparkles size={12} className={isGenerating ? 'animate-spin' : ''} />
                    {project.outline ? 'Recompile Outline' : 'Generate Full Outline'}
                  </button>
                </div>

                <div className="flex-1">
                  {isGenerating && !generationOutput ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-500 space-y-2">
                      <RefreshCw size={24} className="animate-spin text-slate-600" />
                      <p className="text-xs">Invoking creative model pipeline...</p>
                    </div>
                  ) : (
                    <textarea
                      value={isGenerating ? generationOutput : project.outline}
                      onChange={(e) => handleUpdateOutlineManual(e.target.value)}
                      className="w-full h-[400px] bg-slate-950/70 border border-slate-800 rounded-xl p-4 font-mono text-slate-300 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none leading-relaxed resize-none"
                      placeholder="Your generated book outline will compile here. Give Background, characters, and press Generate outline..."
                    />
                  )}
                </div>
              </div>

              {project.outline && (
                <div className="flex justify-end pt-2">
                  <span className="text-[10px] text-slate-500 bg-slate-900/60 border border-slate-800/80 px-2 py-1 rounded inline-block font-semibold">
                    ✓ Outline compiled and stored. You can edit individual lines directly.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Checklist: 仿写大纲自检清单 */}
          <div className="space-y-4">
            <div className="bg-slate-905 border border-slate-800 bg-slate-900/40 p-4 rounded-xl space-y-4">
              <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
                <CheckSquare size={13} /> 仿写大纲自检清单 (Rules Check)
              </h3>
              <p className="text-[10px] text-slate-400 leading-normal">
                Based on your loaded <strong>仿写大纲输出格式模板 v3.0</strong> guidelines, verify each segment of your compile before you build chapter drafts:
              </p>

              <div className="space-y-2.5">
                {[
                  { key: 'a_rhythm', title: '1:1 内核情绪、节奏、爽点复刻' },
                  { key: 'b_no_jargon', title: '名词下沉 (无高科技、生僻、AI味名词)' },
                  { key: 'c_differences', title: '细节数值差异化 (不同于原著数值)' },
                  { key: 'd_payback', title: '前情免费章悬念伏笔与高潮必回收' },
                  { key: 'e_motives', title: '强制打脸前摇 (反派合理化/崩溃链)' },
                  { key: 'f_logic_time', title: '严密逻辑 (伤势处理、时间线差管理)' },
                  { key: 'g_transition', title: '渣男觉醒层次感 (误导、信息差物证)' },
                  { key: 'h_item_consistency', title: '物证流转状态一致性 (前毁后残)' },
                  { key: 'i_no_pose', title: '大女主行为高光 (离开时引爆社会核弹)' },
                  { key: 'j_cliffhangers', title: '章末强力倒计时与悬念勾子' }
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center gap-3 bg-slate-950/20 border border-slate-805 hover:border-slate-700/40 p-2.5 rounded-lg cursor-pointer transition"
                  >
                    <input
                      type="checkbox"
                      checked={outlineChecklist[item.key]}
                      onChange={(e) => setOutlineChecklist({ ...outlineChecklist, [item.key]: e.target.checked })}
                      className="rounded accent-indigo-500 shrink-0 cursor-pointer"
                    />
                    <span className={`text-[11px] font-medium leading-tight ${
                      outlineChecklist[item.key] ? 'text-slate-400 line-through' : 'text-slate-300'
                    }`}>
                      {item.title}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* STAGE 2: DRAFTING ROOM */}
      {/* ---------------------------------------------------- */}
      {pipelineTab === 'drafting' && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Chapter Outline selector column */}
          <div className="xl:col-span-1 border border-slate-800 bg-slate-900/40 rounded-xl p-4 flex flex-col justify-between h-[calc(100vh-240px)] overflow-y-auto space-y-4">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                  <BookOpen size={12} className="text-indigo-400" /> Chapter drafts Index
                </h3>
                <button
                  onClick={handleCreateNewChapter}
                  className="p-1 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 rounded transition border border-slate-800/80"
                  title="Add new chapter draft"
                >
                  <Plus size={14} />
                </button>
              </div>

              <div className="space-y-1">
                {chapters.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => handleSelectChapter(ch)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold border flex items-center justify-between transition ${
                      activeChapterId === ch.id
                        ? 'bg-indigo-600/10 border-indigo-500/40 text-indigo-300 font-bold'
                        : 'bg-transparent border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                    }`}
                  >
                    <span>第 {ch.chapterNumber} 章: {ch.title.split(':').pop()?.trim()}</span>
                    {ch.content ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 font-bold border border-slate-800 text-emerald-400">
                        {ch.content.length} words
                      </span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 font-bold text-slate-500 border border-slate-800">
                        empty
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {chapters.length === 0 && (
              <div className="text-center py-6 text-slate-500 space-y-2 border border-slate-800 border-dashed rounded-lg bg-slate-950/20">
                <p className="text-[10px]">No chapters built yet.</p>
                <button
                  type="button"
                  onClick={handleCreateNewChapter}
                  className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 underline"
                >
                  + Add First Chapter
                </button>
              </div>
            )}
          </div>

          {/* Core Text Editor Grid */}
          <div className="xl:col-span-2 space-y-4">
            {activeChapterId !== null ? (
              <div className="bg-slate-900/40 border border-slate-700/30 rounded-xl p-5 flex flex-col justify-between min-h-[500px] h-[calc(100vh-240px)] shadow">
                <div className="flex flex-col h-full space-y-4">
                  {/* Top toolbar */}
                  <div className="flex flex-col sm:flex-row gap-3 justify-between sm:items-center border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2 flex-grow max-w-sm">
                      <span className="text-[10px] font-mono bg-indigo-950/50 text-indigo-400 px-2 py-1 rounded border border-indigo-900/50 shrink-0">
                        Ch {chapters.find(c => c.id === activeChapterId)?.chapterNumber || 1}
                      </span>
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        className="bg-transparent border-b border-transparent hover:border-slate-800 focus:border-indigo-500 focus:outline-none text-sm font-bold text-slate-200 w-full py-0.5"
                        placeholder="Chapter Title Name"
                      />
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={handleSaveChapterManual}
                        className="p-1 px-2 hover:bg-slate-800 text-slate-300 rounded border border-slate-800 text-xs font-semibold flex items-center gap-1 transition animate-pulse"
                        title="Save Draft locally"
                      >
                        <Save size={12} /> Save Draft
                      </button>

                      <button
                        disabled={isGenerating}
                        onClick={handleGenerateChapterStream}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition font-bold"
                      >
                        <Sparkles size={12} className={isGenerating ? 'animate-spin' : ''} />
                        Draft Chapter Stream
                      </button>
                    </div>
                  </div>

                  {/* Dual Grid: Local Chapter Outline Requirements & Main Story Content */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 h-[80%]">
                    {/* Tiny Outline box for current single chapter */}
                    <div className="md:col-span-1 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between space-y-2 h-full">
                      <div className="space-y-1 h-[100%] flex flex-col">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Current Chapter Outline Requirements
                        </label>
                        <textarea
                          value={editingOutline}
                          onChange={(e) => setEditingOutline(e.target.value)}
                          className="w-full flex-1 bg-slate-900/30 border border-slate-800/80 rounded-lg p-2.5 font-sans text-[11px] text-slate-300 focus:outline-none focus:border-slate-700/60 leading-relaxed resize-none h-[100%]"
                          placeholder="Paste outline directives for this specific chapter. (e.g. Heroine walks into tribal arena, confronts Kael, refuses engagement pledge, triggers Kael anger block...)"
                        />
                      </div>
                    </div>

                    {/* Main Core Editor */}
                    <div className="md:col-span-2 relative h-full flex flex-col">
                      <div className="absolute top-2 right-2 z-10 flex gap-2">
                        {editingDraft && (
                          <button
                            onClick={() => handleCopyText(editingDraft)}
                            className="p-1 px-2 bg-slate-950/80 backdrop-blur border border-slate-850 hover:bg-slate-900 text-[10px] text-slate-400 font-bold rounded flex items-center gap-1 transition"
                            title="Copy clean narrative"
                          >
                            <Copy size={11} /> Copy Clean Text
                          </button>
                        )}
                      </div>
                      <textarea
                        value={isGenerating && !editingDraft ? generationOutput : editingDraft}
                        onChange={(e) => setEditingContent(e.target.value)}
                        className="w-full flex-1 h-full bg-slate-950/80 border border-slate-800 rounded-xl p-4 pr-10 font-mono text-xs text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-none leading-relaxed resize-none"
                        placeholder="Draft narrative flows here..."
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-500 mt-2 border-t border-slate-800/40 pt-2 font-semibold">
                  <span className="flex items-center gap-1.5">
                    Words: <strong className="font-mono text-slate-300">{editingDraft.length}</strong>
                  </span>
                  <span>Version history preserves automatically upon subsequent runs.</span>
                </div>
              </div>
            ) : (
              <div className="bg-slate-900/40 border border-slate-800 border-dashed rounded-xl p-16 text-center space-y-3">
                <Edit3 className="mx-auto text-slate-600" size={32} />
                <h4 className="font-bold text-slate-300 text-sm">No Active Chapter Active</h4>
                <p className="text-slate-500 text-xs max-w-xs mx-auto">Select a chapter from the indexes on the left list, or create a brand-new one to write.</p>
                <button
                  onClick={handleCreateNewChapter}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-semibold px-4 py-1.5 rounded-lg text-xs"
                >
                  Create New Chapter
                </button>
              </div>
            )}
          </div>

          {/* Dynamic Reviewer Right Column: Anti-Grease Warning + Logic Reviews */}
          <div className="xl:col-span-1 space-y-4">
            {/* 1. Client-Side Anti-Grease Warn Card */}
            {greaseWarnings.length > 0 && (
              <div className="bg-rose-950/20 border border-rose-900/50 p-4 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-rose-400">
                  <AlertTriangle size={15} />
                  <h3 className="text-xs font-bold uppercase tracking-wider">Style grease alert (去油警告)</h3>
                </div>
                <p className="text-[10px] text-rose-300/80 leading-normal">
                  Found typical repetitive AI clichés in your draft. Consider revising these segments representing author explanation or local organ overacting:
                </p>
                <ul className="space-y-1">
                  {greaseWarnings.map((warn, i) => (
                    <li key={i} className="text-[10px] text-slate-300 font-bold flex items-start gap-1.5 before:content-['•'] before:text-rose-400" >
                      {warn}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 2. Interactive Logic Checklist */}
            <div className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl space-y-4">
              <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
                <CheckSquare size={13} /> 逻辑自查 v3.2 Checklist
              </h3>
              <p className="text-[10px] text-slate-400 leading-normal">
                Strictly verify time, position, and physical item constraints specified under <strong>小说正文逻辑审查流程 v3.2</strong> rules:
              </p>

              <div className="space-y-2">
                {[
                  { key: 'timeline', label: '时间线审查 (时间锚点/转场完美咬合)' },
                  { key: 'place', label: '地点/行程检测 (无突然瞬移、场景重置)' },
                  { key: 'item_consistent', label: '道具名词同章绝对一致 (不突变)' },
                  { key: 'item_possession', label: '取用路径完整 (角色确实拥有该物品)' },
                  { key: 'avoid_omniscience', label: '严禁越界知道 (无越过信息的上帝视角)' },
                  { key: 'avoid_loop', label: '无重伤下一秒活蹦乱跳/违背材质逻辑' },
                  { key: 'stitched_start', label: '物理接合 (章开头与前尾无缝贴合并无断层)' }
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex items-start gap-2.5 bg-slate-950/20 border border-slate-805 hover:border-slate-700/40 p-2.5 rounded-lg cursor-pointer transition"
                  >
                    <input
                      type="checkbox"
                      checked={draftChecklist[item.key]}
                      onChange={(e) => setDraftChecklist({ ...draftChecklist, [item.key]: e.target.checked })}
                      className="rounded accent-indigo-500 shrink-0 mt-0.5 cursor-pointer"
                    />
                    <span className={`text-[11px] leading-tight ${
                      draftChecklist[item.key] ? 'text-slate-400 line-through' : 'text-slate-300'
                    }`}>
                      {item.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* STAGE 3: MARKETING KIT */}
      {/* ---------------------------------------------------- */}
      {pipelineTab === 'marketing' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {/* Blurb Generation cards */}
            <div className="bg-slate-900/40 border border-slate-700/30 rounded-xl p-5 space-y-4 shadow flex flex-col justify-between min-h-[460px]">
              <div className="space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                  <h3 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                    <Sparkles size={15} className="text-indigo-400" /> Viral Click-Catching Blurbs (简介/导语)
                  </h3>
                  <button
                    disabled={isGenerating}
                    onClick={handleGenerateMarketingKit}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition"
                  >
                    <Sparkles size={12} className={isGenerating ? 'animate-spin' : ''} />
                    Compile Marketing Shorts
                  </button>
                </div>

                <div className="flex-1">
                  {isGenerating && !blurbsOutput ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-500 space-y-2">
                      <RefreshCw size={24} className="animate-spin text-slate-600" />
                      <p className="text-xs">Applying viral text heuristics rules...</p>
                    </div>
                  ) : (
                    <textarea
                      readOnly
                      value={blurbsOutput}
                      className="w-full h-[320px] bg-slate-950/70 border border-slate-800 rounded-xl p-4 font-mono text-slate-300 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none leading-relaxed resize-none"
                      placeholder="Press compile button. The model will yield three variants of hyper-converting conflict snapshots following the two-act rule (Confrontation stage + Midnight down-on-knees segment)..."
                    />
                  )}
                </div>
              </div>

              {blurbsOutput && (
                <div className="flex justify-between items-center bg-slate-950/30 border border-slate-800/80 p-3 rounded-lg text-[10px] text-slate-400">
                  <span>✓ Standard Blurbs outputted beautifully.</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(blurbsOutput);
                      alert('All blurb variations copied!');
                    }}
                    className="text-indigo-400 hover:text-indigo-300 font-bold"
                  >
                    Copy All Outputs
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {/* Prompt Cover design block */}
            <div className="bg-slate-905 border border-slate-800 bg-slate-900/40 p-4 rounded-xl space-y-4 shadow-xl">
              <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest">
                Cover Art Prompt Generator
              </h3>
              <p className="text-[10px] text-slate-400 leading-normal">
                Standard high-impact structured prompt optimized for DALL-E / GPT Image / Midjourney generating vertical novel cover jackets:
              </p>

              {coverPrompt ? (
                <div className="space-y-3">
                  <textarea
                    readOnly
                    value={coverPrompt}
                    className="w-full h-32 bg-slate-950 border border-slate-800 rounded-lg p-2.5 font-mono text-[10px] text-slate-300 resize-none focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(coverPrompt);
                      alert('Cover prompt copied text!');
                    }}
                    className="w-full bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 text-center font-bold text-xs py-2 rounded-lg transition"
                  >
                    Copy Image Prompt
                  </button>
                </div>
              ) : (
                <div className="text-center py-8 text-slate-600 border border-slate-850 bg-slate-950/20 rounded-lg">
                  <span className="text-[10px] font-semibold block">Click Compile on Left panel to construct cover coordinates.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
