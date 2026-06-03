import { useState } from 'react';
import { parseOutlineChapters } from '../utils/pipeline';

interface CollapsibleOutlineProps {
  outline: string;
  onSelectChapter?: (chapterNumber: number) => void;
}

export default function CollapsibleOutline({ outline, onSelectChapter }: CollapsibleOutlineProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const chapters = parseOutlineChapters(outline);

  if (chapters.length === 0) {
    return (
      <div style={{ padding: 16, color: '#bbb', fontSize: 12, textAlign: 'center' }}>
        大纲中暂无章节结构
      </div>
    );
  }

  // 大纲前言（第一个章节之前的内容）
  const firstChapterIdx = outline.indexOf('###');
  const preamble = firstChapterIdx > 0 ? outline.slice(0, firstChapterIdx).trim() : '';

  const toggle = (num: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(num) ? next.delete(num) : next.add(num);
      return next;
    });
  };

  const toggleAll = () => {
    if (expanded.size === chapters.length) {
      setExpanded(new Set());
    } else {
      setExpanded(new Set(chapters.map(c => c.chapterNumber)));
    }
  };

  const wordCount = (text: string) => text.replace(/\s/g, '').length;

  return (
    <div style={{ fontSize: 12 }}>
      {/* 标题栏 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 0', borderBottom: '1px solid #eaeaea', marginBottom: 8,
      }}>
        <span style={{ fontWeight: 700, color: '#888', fontSize: 10, textTransform: 'uppercase' }}>
          大纲结构 · {chapters.length} 章
        </span>
        <button
          onClick={toggleAll}
          style={{
            fontSize: 10, color: '#888', background: 'none', border: 'none',
            cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          {expanded.size === chapters.length ? '全部折叠' : '全部展开'}
        </button>
      </div>

      {/* 前言 */}
      {preamble && (
        <div style={{ marginBottom: 8, color: '#666', fontSize: 11, lineHeight: 1.5 }}>
          {preamble.length > 200 ? preamble.slice(0, 200) + '...' : preamble}
        </div>
      )}

      {/* 章节列表 */}
      {chapters.map(ch => {
        const isExpanded = expanded.has(ch.chapterNumber);
        const wc = wordCount(ch.outlineSection);

        return (
          <div key={ch.chapterNumber} style={{ borderBottom: '1px solid #f0f0f0' }}>
            <button
              onClick={() => toggle(ch.chapterNumber)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '8px 4px',
                background: 'none', border: 'none', cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{
                fontSize: 10, color: '#bbb', transition: 'transform 0.15s',
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                display: 'inline-block',
              }}>
                ▶
              </span>
              <span style={{ fontWeight: 700, color: '#333', flex: 1 }}>
                第 {ch.chapterNumber} 章：{ch.title}
              </span>
              <span style={{ fontSize: 9, color: '#bbb' }}>{wc} 字</span>
            </button>

            {isExpanded && (
              <div style={{
                padding: '4px 4px 8px 20px',
                color: '#555', fontSize: 11, lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}>
                {ch.outlineSection.replace(/^###\s*第\s*\d+\s*章[：:]\s*[^\n]+\n?/, '').trim()}
                {onSelectChapter && (
                  <button
                    onClick={() => onSelectChapter(ch.chapterNumber)}
                    style={{
                      display: 'block', marginTop: 6, fontSize: 10,
                      color: '#1677ff', background: 'none', border: 'none',
                      cursor: 'pointer', textDecoration: 'underline',
                    }}
                  >
                    跳转到此章节写作 →
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
