import type { Paper, Store } from './store.js';
import sanitizeHtml from 'sanitize-html';
const html = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function markdownHtml(source: string): string {
    let fenced = false;
    const lines = source.split('\n').map(line => {
        if (line.startsWith('```')) {
            fenced = !fenced;
            return fenced ? '<pre><code>' : '</code></pre>';
        }
        if (fenced)
            return html(line) + '\n';
        let body = html(line).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
        body = body.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer noopener">$1</a>');
        const heading = /^(#{1,4})\s+(.+)$/.exec(body);
        if (heading)
            return `<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`;
        if (/^[-*]\s+/.test(body))
            return `<ul><li>${body.slice(2)}</li></ul>`;
        if (body.startsWith('&gt; '))
            return `<blockquote>${body.slice(5)}</blockquote>`;
        return body ? `<p>${body}</p>` : '';
    }).join('\n') + (fenced ? '</code></pre>' : '');
    return sanitizeHtml(lines, { allowedTags: ['p', 'h1', 'h2', 'h3', 'h4', 'strong', 'em', 'code', 'pre', 'ul', 'li', 'blockquote', 'a'], allowedAttributes: { a: ['href', 'rel'] }, allowedSchemes: ['http', 'https'], allowProtocolRelative: false });
}
export function bibEscape(value: string): string {
    return value.replace(/[\\{}%&#_$~^\r\n]/g, c => ({ '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '%': '\\%', '&': '\\&', '#': '\\#', '_': '\\_', '$': '\\$', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}', '\r': ' ', '\n': ' ' }[c]!));
}
export function citationKey(p: Paper): string {
    const slug = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const surname = p.authors[0]?.split(/\s+/).at(-1) || 'paper';
    return `${slug(surname).slice(0, 25) || 'paper'}${slug(p.year) || 'nd'}${slug(p.title.split(/\s+/)[0]).slice(0, 20)}_${p.id.replace(/-/g, '')}`;
}
export function bibtex(papers: Paper[]): string {
    return [...papers].sort((a, b) => a.id.localeCompare(b.id)).map(p => {
        const fields: Record<string, string> = { title: p.title, author: p.authors.join(' and '), year: p.year, journal: p.venue, doi: p.doi || '', url: p.url };
        if (p.arxiv) {
            fields.eprint = p.arxiv;
            fields.archivePrefix = 'arXiv';
        }
        return `@article{${citationKey(p)},\n${Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `  ${k} = {${bibEscape(v)}}`).join(',\n')}\n}`;
    }).join('\n\n') + '\n';
}
const md = (s: string) => s.replace(/[\\`*_[\]{}<>#!|]/g, '\\$&').replace(/\r?\n/g, ' ');
export function markdownExport(store: Store, papers: Paper[]): string {
    const projects = store.labels('projects'), tags = store.labels('tags');
    return papers.map(p => `# ${md(p.title)}\n\n${p.authors.map(md).join('; ')}\n\n` +
        `- Year: ${md(p.year)}\n- Venue: ${md(p.venue)}\n- DOI: ${md(p.doi || '')}\n- arXiv: ${md(p.arxiv || '')}\n- URL: ${md(p.url)}\n- Citation key: ${citationKey(p)}\n- Status: ${p.status}\n- Archived: ${p.archived}\n` +
        `- Projects: ${projects.filter(l => p.projectIds.includes(l.id)).map(l => md(l.name)).join(', ')}\n- Tags: ${tags.filter(l => p.tagIds.includes(l.id)).map(l => md(l.name)).join(', ')}\n\n` +
        `## Abstract\n\n${md(p.abstract)}\n\n## Notes\n\n${p.note.replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n\n## Highlights\n\n` +
        store.annotations(p.id).map(a => `### PDF page ${a.page} · ${a.color}\n\n> ${md(a.quote)}\n\n${md(a.comment)}\n`).join('\n')).join('\n---\n\n');
}
