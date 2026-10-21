import { z } from 'zod';
import { createHash } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { Store } from './store.js';
import { paperPatch, pdfFilename, annotation, uuid, label, normalizeArxiv, normalizeDoi } from './schema.js';
import { defaultPdfFilename } from './filename.js';
import { HttpError } from './errors.js';
import { validatePdf } from './pdf.js';
export const MAX_BACKUP = 128 * 1024 * 1024;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const record = paperPatch.required({ title: true, authors: true, year: true, venue: true, abstract: true, url: true, note: true, status: true, archived: true, position: true, projectIds: true, tagIds: true }).extend({
    id: uuid, doi: z.string().max(300).nullable(), arxiv: z.string().max(100).nullable(), arxivBase: z.string().max(100).nullable(),
    pdfSha: sha.nullable(), pageCount: z.number().int().min(1).max(10000).nullable(), created: z.string().datetime(), updated: z.string().datetime(),
    pdfFilename: pdfFilename.nullish(),
}).strict();
const backupSchema = z.object({
    format: z.literal('papertrail'), version: z.union([z.literal(1), z.literal(2)]), createdAt: z.string().datetime(),
    projects: z.array(z.object({ id: uuid, name: label }).strict()).max(10000), tags: z.array(z.object({ id: uuid, name: label }).strict()).max(10000),
    papers: z.array(record).max(10000), annotations: z.array(annotation.extend({ id: uuid, paperId: uuid, revision: z.number().int().nonnegative(), created: z.string().datetime() }).strict()).max(100000),
    files: z.array(z.object({ sha, base64: z.string().max(56 * 1024 * 1024) }).strict()).max(10000),
}).strict().superRefine((data, context) => {
    if (data.version === 2 && data.papers.some(paper => paper.pdfFilename == null))
        context.addIssue({ code: 'custom', message: 'Version 2 backups require PDF filenames.' });
});
export function backup(store: Store) {
    return store.db.transaction(() => {
        const papers = store.list();
        return { format: 'papertrail' as const, version: 2 as const, createdAt: new Date().toISOString(), projects: store.labels('projects'), tags: store.labels('tags'), papers,
            annotations: papers.flatMap(p => store.annotations(p.id)), files: [...new Set(papers.map(p => p.pdfSha).filter((s): s is string => !!s))].map(sha => ({ sha, base64: store.pdfBytes(sha).toString('base64') })) };
    })();
}
export async function restore(store: Store, input: unknown) {
    const data = backupSchema.parse(input);
    const unique = (values: string[]) => new Set(values).size === values.length;
    for (const rows of [data.projects, data.tags, data.papers, data.annotations])
        if (!unique(rows.map(r => r.id)))
            throw new HttpError(400, 'Backup contains duplicate record IDs.');
    for (const rows of [data.projects, data.tags])
        if (!unique(rows.map(r => r.name)))
            throw new HttpError(400, 'Backup contains duplicate label names.');
    if (!unique(data.files.map(f => f.sha)))
        throw new HttpError(400, 'Backup contains duplicate files.');
    const files = new Map<string, {
        bytes: Buffer;
        pages: number;
    }>();
    for (const f of data.files) {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.base64))
            throw new HttpError(400, 'Backup contains invalid file encoding.');
        const bytes = Buffer.from(f.base64, 'base64');
        if (createHash('sha256').update(bytes).digest('hex') !== f.sha)
            throw new HttpError(400, 'Backup PDF checksum mismatch.');
        files.set(f.sha, { bytes, pages: (await validatePdf(bytes)).pages });
    }
    const paperMap = new Map(data.papers.map(p => [p.id, p]));
    for (const p of data.papers) {
        if (p.doi && normalizeDoi(p.doi) !== p.doi)
            throw new HttpError(400, 'Backup has a noncanonical DOI.');
        if (p.arxiv && (normalizeArxiv(p.arxiv) !== p.arxiv || p.arxivBase !== p.arxiv.replace(/v\d+$/, '')))
            throw new HttpError(400, 'Backup has an invalid arXiv identity.');
        if (!p.arxiv && p.arxivBase)
            throw new HttpError(400, 'Backup has an orphan version family.');
        if (p.pdfSha ? files.get(p.pdfSha)?.pages !== p.pageCount : !!p.pageCount)
            throw new HttpError(400, 'Backup has missing or inconsistent PDF records.');
        if (p.pageCount && p.position.page > p.pageCount)
            throw new HttpError(400, 'Backup reading position exceeds the PDF.');
        if (!unique(p.projectIds) || !unique(p.tagIds) || p.projectIds.some(id => !data.projects.some(l => l.id === id)) || p.tagIds.some(id => !data.tags.some(l => l.id === id)))
            throw new HttpError(400, 'Backup has invalid assignments.');
    }
    if (data.files.some(f => !data.papers.some(p => p.pdfSha === f.sha)))
        throw new HttpError(400, 'Backup contains unreferenced PDFs.');
    for (const a of data.annotations) {
        const p = paperMap.get(a.paperId);
        if (!p?.pageCount || a.page > p.pageCount)
            throw new HttpError(400, 'Backup contains an orphan or invalid highlight.');
    }
    const written: string[] = [];
    try {
        store.db.transaction(() => {
            if (store.list().length || store.labels('projects').length || store.labels('tags').length)
                throw new HttpError(409, 'Restore requires an empty library, including projects and tags. Use fresh isolated storage.');
            for (const kind of ['projects', 'tags'] as const)
                for (const l of data[kind])
                    store.db.prepare(`INSERT INTO ${kind} (id,name) VALUES (?,?)`).run(l.id, l.name);
            for (const [sha, file] of files) {
                store.writePdf(sha, file.bytes);
                written.push(sha);
            }
            for (const p of data.papers) {
                const { projectIds, tagIds, ...fields } = p;
                const entries = Object.entries({ ...fields, pdfFilename: p.pdfFilename ?? defaultPdfFilename(p.id) }).map(([k, v]) => [k, k === 'authors' || k === 'position' ? JSON.stringify(v) : k === 'archived' ? Number(v) : v]);
                store.db.prepare(`INSERT INTO papers (${entries.map(([k]) => k).join(',')}) VALUES (${entries.map(() => '?').join(',')})`).run(...entries.map(([, v]) => v));
                store.setLinks(p.id, 'projects', projectIds);
                store.setLinks(p.id, 'tags', tagIds);
            }
            for (const a of data.annotations)
                store.db.prepare('INSERT INTO annotations (id,paperId,page,quote,rects,color,comment,revision,created) VALUES (?,?,?,?,?,?,?,?,?)').run(a.id, a.paperId, a.page, a.quote, JSON.stringify(a.rects), a.color, a.comment, a.revision, a.created);
        })();
    }
    catch (error) {
        for (const sha of written)
            try {
                unlinkSync(store.pdfPath(sha));
            }
            catch { }
        throw error;
    }
    return { papers: data.papers.length, annotations: data.annotations.length, files: data.files.length };
}
