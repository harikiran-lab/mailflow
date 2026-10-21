import { parseFragment } from 'parse5';

const escapeText = value => String(value || '').replace(/([\\`*_[\]<>])/g, '\\$1').replace(/^(\s*)(#{1,6}\s|>|[-+]\s|\d+[.)]\s)/gm, '$1\\$2');
const skipped = new Set(['script', 'style', 'head', 'iframe', 'object', 'embed', 'svg', 'img', 'noscript', 'template']);
const plain = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(plain).join('');
const safeLink = value => {
  try { const u = new URL(value); return ['http:', 'https:', 'mailto:'].includes(u.protocol) && !u.username && !u.password ? u.href.replace(/[()\s]/g, c => encodeURIComponent(c)) : null; }
  catch { return null; }
};

export function emailToMarkdown({ html, text }) {
  if (!html) return escapeText(text).trim();
  const root = parseFragment(String(html));
  const walk = (node, depth = 0) => {
    if (depth > 100) return '';
    if (node.nodeName === '#text') return escapeText(node.value).replace(/\s+/g, ' ');
    const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
    if (skipped.has(node.tagName) || 'hidden' in attrs || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style || '')) return '';
    if (node.tagName === 'pre') {
      const code = plain(node);
      const fence = '`'.repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map(m => m[0].length + 1)));
      return `\n\n${fence}\n${code}\n${fence}\n\n`;
    }
    if (node.tagName === 'code') {
      const code = plain(node).replace(/\n/g, ' ');
      const fence = '`'.repeat(Math.max(1, ...[...code.matchAll(/`+/g)].map(m => m[0].length + 1)));
      return `${fence} ${code} ${fence}`;
    }
    const content = (node.childNodes || []).map(c => walk(c, depth + 1)).join('');
    const trimmed = content.trim();
    if (node.tagName === 'br') return '\n';
    if (node.tagName === 'hr') return '\n\n---\n\n';
    if (/^h[1-6]$/.test(node.tagName || '')) return `\n\n${'#'.repeat(Number(node.tagName[1]))} ${trimmed}\n\n`;
    if (['strong', 'b'].includes(node.tagName)) return trimmed ? `**${trimmed}** ` : '';
    if (['em', 'i'].includes(node.tagName)) return trimmed ? `*${trimmed}* ` : '';
    if (node.tagName === 'a') { const href = safeLink(attrs.href); return href ? `[${trimmed || escapeText(href)}](${href})` : content; }
    if (node.tagName === 'blockquote') return '\n\n' + trimmed.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
    if (node.tagName === 'li') {
      const marker = node.parentNode?.tagName === 'ol' ? '1.' : '-';
      return '\n' + trimmed.split('\n').map((line, i) => i ? ' '.repeat(marker.length + 1) + line : `${marker} ${line}`).join('\n');
    }
    if (['ul', 'ol'].includes(node.tagName)) return `\n${content}\n`;
    if (['td', 'th'].includes(node.tagName)) return trimmed.replace(/\|/g, '\\|').replace(/\n/g, ' ') + ' | ';
    if (node.tagName === 'tr') return `\n| ${trimmed}`;
    if (node.tagName === 'table') {
      const rows = trimmed.split('\n').filter(r => r.startsWith('|'));
      if (!rows.length) return '\n\n' + content + '\n\n';
      const columns = rows[0].split('|').length - 2;
      rows.splice(1, 0, '| ' + Array(Math.max(1, columns)).fill('---').join(' | ') + ' |');
      return '\n\n' + rows.join('\n') + '\n\n';
    }
    return ['p', 'div', 'section', 'article', 'header', 'footer'].includes(node.tagName) ? `\n\n${trimmed}\n\n` : content;
  };
  return walk(root).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
