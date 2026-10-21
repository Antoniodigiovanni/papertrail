import { z } from 'zod';
export const uuid = z.string().uuid();
export const label = z.string().trim().min(1).max(100);
export const ids = z.array(uuid).max(100);
export const position = z.object({ page: z.number().int().min(1).max(100000), offset: z.number().min(0).max(1) }).strict();
export const paperPatch = z.object({
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(2000).optional(),
    authors: z.array(z.string().trim().min(1).max(300)).max(200).optional(),
    doi: z.string().max(300).nullable().optional(),
    arxiv: z.string().max(100).nullable().optional(),
    year: z.string().max(20).optional(), venue: z.string().max(1000).optional(),
    abstract: z.string().max(30000).optional(), url: z.string().max(2000).refine(v => !v || /^https?:\/\//i.test(v), 'Use an HTTP(S) URL').optional(),
    note: z.string().max(200000).optional(), status: z.enum(['Inbox', 'Reading', 'Finished']).optional(),
    archived: z.boolean().optional(), position: position.optional(),
    projectIds: ids.optional(), tagIds: ids.optional(),
}).strict();
const rect = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
    .refine(r => r[0] < r[2] && r[1] < r[3], 'Empty rectangle');
export const annotation = z.object({
    page: z.number().int().min(1).max(100000), quote: z.string().trim().min(1).max(20000),
    rects: z.array(rect).min(1).max(1000), color: z.enum(['yellow', 'green', 'blue', 'pink']), comment: z.string().max(20000).default(''),
}).strict();
export const annotationPatch = z.object({ revision: z.number().int().nonnegative(), color: z.enum(['yellow', 'green', 'blue', 'pink']).optional(), comment: z.string().max(20000).optional() }).strict();
export type PaperPatch = z.infer<typeof paperPatch>;
export type AnnotationInput = z.infer<typeof annotation>;
export type Position = z.infer<typeof position>;
export function normalizeDoi(value: string): string {
    let raw = value.trim().replace(/^doi:\s*/i, '');
    if (/^https?:\/\//i.test(raw)) {
        try {
            const url = new URL(raw);
            if (!['doi.org', 'dx.doi.org'].includes(url.hostname) || url.username || url.password || url.port) throw new Error();
            raw = decodeURIComponent(url.pathname.slice(1));
        } catch { throw new Error('Enter a DOI such as 10.1000/example or a doi.org URL.'); }
    }
    const doi = raw.toLowerCase();
    if (!/^10\.\d{4,9}\/[^\s<>"{}]+$/.test(doi) || doi.length > 300)
        throw new Error('Enter a DOI such as 10.1000/example or a doi.org URL.');
    return doi;
}
export function normalizeArxiv(value: string): string | null {
    let raw = value.trim().replace(/^arxiv:\s*/i, '');
    if (/^https?:\/\//i.test(raw)) {
        try {
            const url = new URL(raw);
            if (!['arxiv.org', 'export.arxiv.org'].includes(url.hostname) || url.username || url.password || url.port || !/^\/(abs|pdf)\//.test(url.pathname)) return null;
            raw = decodeURIComponent(url.pathname.replace(/^\/(abs|pdf)\//, ''));
        } catch { return null; }
    }
    raw = raw.replace(/\.pdf$/i, '');
    return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v[1-9]\d*)?$/.test(raw) ? raw : null;
}
