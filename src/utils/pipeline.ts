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

/**
 * 中文数字转阿拉伯数字
 * 支持：一二三四五六七八九十百 单字和组合（如 十二、二十三、一百）
 */
function chineseToArabic(num: string): number {
  const map: Record<string, number> = {
    '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
    '十': 10, '百': 100,
  };

  // 纯数字情况
  if (/^\d+$/.test(num)) return parseInt(num, 10);

  // 单字情况
  if (num.length === 1 && map[num] !== undefined) return map[num];

  // 复合中文数字解析（简化处理：十X, X十, X十X, X百X十X）
  let result = 0;
  let current = 0;
  for (const char of num) {
    const val = map[char];
    if (val === undefined) continue;
    if (val === 10) {
      result += (current || 1) * 10;
      current = 0;
    } else if (val === 100) {
      result += (current || 1) * 100;
      current = 0;
    } else {
      current = val;
    }
  }
  return result + current;
}

// 从大纲文本解析章节
// 支持格式：### 第 1 章：标题、## 第一章：标题、#### 第三章-标题 等
export function parseOutlineChapters(
  outline: string
): { chapterNumber: number; title: string; outlineSection: string }[] {
  // 支持 ## ~ #### 标题层级，中文数字或阿拉伯数字，多种分隔符
  const pattern = /(#{2,4})\s*第\s*(\d+|[一二三四五六七八九十百]+)\s*章[：:\-\s]\s*([^\n]+)/g;
  const positions: { num: number; title: string; start: number }[] = [];
  let match;
  while ((match = pattern.exec(outline)) !== null) {
    const num = chineseToArabic(match[2]);
    if (num > 0) {
      positions.push({ num, title: match[3].trim(), start: match.index });
    }
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
// 返回 { count, staleChapters }，staleChapters 是大纲已变但已有正文的章节号列表
export async function syncOutlineChaptersToDb(outline: string, projectId: number): Promise<{ count: number; staleChapters: number[] }> {
  const parsed = parseOutlineChapters(outline);
  if (parsed.length === 0) return { count: 0, staleChapters: [] };
  const staleChapters: number[] = [];
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
        // 大纲有变且章节已有正文 → 标记为过期
        if (needsOutlineUpdate && existing.content && existing.content.length >= 100) {
          staleChapters.push(p.chapterNumber);
        }
        const patch: Partial<Pick<typeof existing, 'title' | 'outlineSection' | 'lastEdited'>> = { lastEdited: Date.now() };
        if (needsTitleUpdate) patch.title = newTitle;
        if (needsOutlineUpdate) patch.outlineSection = p.outlineSection;
        await db.chapters.update(existing.id!, patch);
      }
    }
  }

  // 删除大纲中已不存在的**空**章节（有内容的章节保留，避免误删）
  const parsedNumbers = new Set(parsed.map(p => p.chapterNumber));
  const existingChapters = await db.chapters
    .where('projectId').equals(projectId)
    .toArray();
  for (const ch of existingChapters) {
    if (ch.id && !parsedNumbers.has(ch.chapterNumber)) {
      // 有内容的章节不自动删除，只删除空章节
      if (!ch.content || ch.content.length < 50) {
        await db.chapters.delete(ch.id);
        await db.chatMessages.where('chapterId').equals(ch.id).delete();
      }
    }
  }

  return { count: parsed.length, staleChapters };
}
