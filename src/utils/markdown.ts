function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyInline(s: string): string {
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  s = s.replace(/`([^`\n]+?)`/g, '<code class="bg-[#f9f9f9] border border-[#eaeaea] px-1 font-mono text-[10px] rounded-sm">$1</code>');
  return s;
}

export function renderMarkdown(text: string): { __html: string } {
  const lines = escapeHtml(text).split('\n');
  const chunks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trimEnd();
    if (/^-{3,}$/.test(line) || /^={3,}$/.test(line)) {
      chunks.push('<hr class="border-[#eaeaea] my-2" />');
      i++; continue;
    }
    const hMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (hMatch) {
      const sizes = ['text-sm font-black', 'text-sm font-bold', 'text-xs font-bold', 'text-xs font-semibold', 'text-xs font-semibold', 'text-xs font-semibold'];
      chunks.push(`<p class="${sizes[hMatch[1].length - 1]} text-[#171717] mt-3 mb-1">${applyInline(hMatch[2])}</p>`);
      i++; continue;
    }
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trimEnd())) {
        items.push(`<li class="ml-4" style="list-style-type:disc">${applyInline(lines[i].trimEnd().slice(2))}</li>`);
        i++;
      }
      chunks.push(`<ul class="space-y-0.5 my-1">${items.join('')}</ul>`);
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trimEnd())) {
        items.push(`<li class="ml-4" style="list-style-type:decimal">${applyInline(lines[i].trimEnd().replace(/^\d+\.\s/, ''))}</li>`);
        i++;
      }
      chunks.push(`<ol class="space-y-0.5 my-1">${items.join('')}</ol>`);
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^[-*]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !/^-{3,}$/.test(lines[i])
    ) {
      paraLines.push(applyInline(lines[i].trimEnd()));
      i++;
    }
    if (paraLines.length > 0) {
      chunks.push(`<p class="leading-relaxed">${paraLines.join('<br/>')}</p>`);
    }
  }
  return { __html: chunks.join('\n') };
}
