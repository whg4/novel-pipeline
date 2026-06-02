import { db } from '../db';

// Strip non-narrative content: logic review (after ---) and optional content sections
export function stripLogicReview(content: string): string {
  // Strip at first horizontal rule used as separator
  let result = content;
  const hrIndex = content.indexOf('\n---');
  if (hrIndex !== -1) result = content.substring(0, hrIndex);
  else if (content.startsWith('---')) result = '';

  // Also strip any trailing optional content blocks
  const optionalPatterns = [
    /\n可选[：:：]/,
    /\n（可选）/,
    /\n【可选[^】]*】/,
    /\n\[可选[^\]]*\]/,
    /\n可选内容[：:：\s]/,
    /\n可选场景[：:：\s]/,
  ];
  for (const pat of optionalPatterns) {
    const m = pat.exec(result);
    if (m) result = result.substring(0, m.index);
  }

  return result.trim();
}

// 将大纲拆成主体（一~三）、自检清单（四）、可选附录（五）三部分
export function splitOutlineSections(outline: string): { preamble: string; main: string; checklist: string; appendix: string } {
  const idxOne  = outline.search(/\n##\s*一[、,，.]/);
  const idxFour = outline.search(/\n##\s*四[、,，.]/);
  const idxFive = outline.search(/\n##\s*五[、,，.]/);
  const preamble = idxOne > 0 ? outline.slice(0, idxOne).trim() : '';
  const mainStart = idxOne > 0 ? idxOne : 0;
  if (idxFour === -1) return { preamble, main: outline.slice(mainStart).trim(), checklist: '', appendix: '' };
  const main = outline.slice(mainStart, idxFour).trim();
  if (idxFive === -1) return { preamble, main, checklist: outline.slice(idxFour).trim(), appendix: '' };
  return {
    preamble,
    main,
    checklist: outline.slice(idxFour, idxFive).trim(),
    appendix: outline.slice(idxFive).trim(),
  };
}

export function sanitizeMarkdownFileName(name: string): string {
  return (name || '小说正文')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '小说正文';
}

// 从大纲文本解析章节（格式：### 第 X 章：标题 或 ### 第X章:标题）
export function parseOutlineChapters(
  outline: string
): { chapterNumber: number; title: string; outlineSection: string }[] {
  const pattern = /###\s*第\s*(\d+)\s*章[：:]\s*([^\n]+)/g;
  const positions: { num: number; title: string; start: number }[] = [];
  let match;
  while ((match = pattern.exec(outline)) !== null) {
    positions.push({ num: parseInt(match[1], 10), title: match[2].trim(), start: match.index });
  }
  return positions.map((pos, i) => {
    const end = i + 1 < positions.length ? positions[i + 1].start : outline.length;
    return {
      chapterNumber: pos.num,
      title: pos.title,
      outlineSection: outline.slice(pos.start, end).trim(),
    };
  });
}

// 将解析结果写入数据库（已存在的章节同步 title + outlineSection，不覆盖 content）
export async function syncOutlineChaptersToDb(outline: string, projectId: number): Promise<number> {
  const parsed = parseOutlineChapters(outline);
  if (parsed.length === 0) return 0;
  for (const p of parsed) {
    const existing = await db.chapters
      .where('projectId').equals(projectId)
      .and(c => c.chapterNumber === p.chapterNumber)
      .first();
    if (!existing) {
      await db.chapters.add({
        projectId,
        chapterNumber: p.chapterNumber,
        title: `第 ${p.chapterNumber} 章：${p.title}`,
        outlineSection: p.outlineSection,
        content: '',
        isCompleted: false,
        versionHistory: [],
        lastEdited: Date.now(),
      });
    } else {
      // 已存在 — 始终同步 title 和 outlineSection，保留 content/versionHistory 等
      const newTitle = `第 ${p.chapterNumber} 章：${p.title}`;
      const needsTitleUpdate = existing.title !== newTitle;
      const needsOutlineUpdate = existing.outlineSection !== p.outlineSection;
      if (needsTitleUpdate || needsOutlineUpdate) {
        const patch: Partial<Pick<typeof existing, 'title' | 'outlineSection' | 'lastEdited'>> = { lastEdited: Date.now() };
        if (needsTitleUpdate) patch.title = newTitle;
        if (needsOutlineUpdate) patch.outlineSection = p.outlineSection;
        await db.chapters.update(existing.id!, patch);
      }
    }
  }
  return parsed.length;
}
