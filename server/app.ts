import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { z, ZodError } from 'zod';
import { Store } from './store.js';
import { authBoundary, type AuthConfig } from './auth.js';
import { HttpError } from './errors.js';
import { annotation, annotationPatch, ids, label, normalizeArxiv, normalizeDoi, paperPatch, uuid } from './schema.js';
import { importReference, type FetchProvider } from './providers.js';
import { MAX_PDF, validatePdf } from './pdf.js';
import { bibtex, markdownExport, markdownHtml } from './exports.js';
import { backup, restore, MAX_BACKUP } from './backup.js';
export type AppOptions = {
    store: Store;
    auth: AuthConfig;
    clientDirectory?: string;
    fetchProvider?: FetchProvider;
    peerAddress?: (c: Context) => string | undefined;
    publicOrigin?: string;
};
async function body(c: Context, limit: number): Promise<Buffer> {
    if (Number(c.req.header('Content-Length') || 0) > limit)
        throw new HttpError(413, 'Request exceeds the size limit.');
    const reader = c.req.raw.body?.getReader();
    if (!reader)
        return Buffer.alloc(0);
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            length += value.byteLength;
            if (length > limit) {
                await reader.cancel();
                throw new HttpError(413, 'Request exceeds the size limit.');
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks);
}
async function json(c: Context, limit = 512000): Promise<unknown> {
    if (!c.req.header('Content-Type')?.startsWith('application/json'))
        throw new HttpError(415, 'Use application/json.');
    try {
        return JSON.parse((await body(c, limit)).toString());
    }
    catch (e) {
        if (e instanceof HttpError)
            throw e;
        throw new HttpError(400, 'Request contains invalid JSON.');
    }
}
export function createApp(options: AppOptions) {
    const { store } = options;
    const app = new Hono();
    const authorize = authBoundary(options.auth);
    const detail = (id: string) => { const paper = store.get(id); return { ...paper, annotations: store.annotations(id), noteHtml: markdownHtml(paper.note) }; };
    app.use('*', async (c, next) => {
        c.header('X-Request-Id', randomUUID());
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('Referrer-Policy', 'no-referrer');
        c.header('X-Frame-Options', 'DENY');
        c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        c.header('Cache-Control', 'no-store');
        await next();
    });
    app.get('/healthz', c => c.json({ status: 'ok' }));
    app.use('*', async (c, next) => {
        const cookie = c.req.header('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('CF_Authorization='))?.slice(17);
        let peer: string | undefined;
        try {
            peer = options.peerAddress ? options.peerAddress(c) : getConnInfo(c).remote.address;
        }
        catch {
            peer = undefined;
        }
        await authorize(c.req.header('Cf-Access-Jwt-Assertion') || cookie, peer);
        if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
            const site = c.req.header('Sec-Fetch-Site');
            if (site === 'cross-site')
                throw new HttpError(403, 'Cross-site mutations are not permitted.');
            const origin = c.req.header('Origin');
            const expected = options.publicOrigin || new URL(c.req.url).origin;
            if (origin && origin !== expected)
                throw new HttpError(403, 'Request origin does not match this application.');
        }
        await next();
    });
    app.get('/api/config', c => c.json({ authMode: options.auth.mode, onlineOnly: true, maxPdfBytes: MAX_PDF }));
    app.get('/api/library', c => {
        const query = c.req.query();
        const search = (query.search || '').toLocaleLowerCase().slice(0, 1000);
        const projects = store.labels('projects'), tags = store.labels('tags');
        const papers = store.list().filter(p => {
            if (query.scope === 'archive' ? !p.archived : p.archived)
                return false;
            if (query.project === 'unassigned' && p.projectIds.length)
                return false;
            if (query.project && query.project !== 'unassigned' && !p.projectIds.includes(query.project))
                return false;
            if (query.tag && !p.tagIds.includes(query.tag))
                return false;
            if (query.status && p.status !== query.status)
                return false;
            if (!search)
                return true;
            const labels = [...projects.filter(l => p.projectIds.includes(l.id)), ...tags.filter(l => p.tagIds.includes(l.id))].map(l => l.name).join(' ');
            const notes = store.annotations(p.id).map(a => `${a.quote} ${a.comment}`).join(' ');
            return [p.title, ...p.authors, p.doi, p.arxiv, p.year, p.venue, p.abstract, p.url, p.note, labels, notes].join(' ').toLocaleLowerCase().includes(search);
        });
        return c.json({ papers, projects, tags, total: store.list().filter(p => !p.archived).length });
    });
    for (const kind of ['projects', 'tags'] as const)
        app.post(`/api/${kind}`, async (c) => {
            const { name } = z.object({ name: label }).strict().parse(await json(c));
            return c.json(store.addLabel(kind, name), 201);
        });
    app.patch('/api/projects/:id', async c => {
        const id = uuid.parse(c.req.param('id'));
        const { name, expectedName } = z.object({ name: label, expectedName: label }).strict().parse(await json(c));
        return c.json(store.renameProject(id, name, expectedName));
    });
    app.delete('/api/projects/:id', async c => {
        const id = uuid.parse(c.req.param('id'));
        const { confirmation } = z.object({ confirmation: uuid }).strict().parse(await json(c));
        if (confirmation !== id)
            throw new HttpError(400, 'Project deletion requires explicit confirmation of this project.');
        store.removeProject(id);
        return c.json({ deleted: true });
    });
    app.get('/api/papers/:id', c => c.json(detail(uuid.parse(c.req.param('id')))));
    app.patch('/api/papers/:id', async (c) => { const p = store.patch(uuid.parse(c.req.param('id')), paperPatch.parse(await json(c))); return c.json(detail(p.id)); });
    app.post('/api/upload', async (c) => {
        if (c.req.header('Content-Type')?.split(';')[0] !== 'application/pdf')
            throw new HttpError(415, 'Upload a PDF with application/pdf content type.');
        const projectIds = ids.parse((c.req.query('projects') || '').split(',').filter(Boolean));
        const bytes = await body(c, MAX_PDF);
        const parsed = await validatePdf(bytes);
        const filename = (c.req.header('X-Filename') || '').slice(0, 2000);
        let title = 'Untitled paper';
        try {
            title = decodeURIComponent(filename).replace(/.*[\\/]/, '').replace(/\.pdf$/i, '').trim() || title;
        }
        catch { }
        const result = store.insert({ title: parsed.title || title, authors: parsed.authors }, projectIds, { bytes, pages: parsed.pages });
        return c.json({ ...result, paper: detail(result.paper.id) }, result.duplicate ? 200 : 201);
    });
    app.post('/api/import', async (c) => {
        const input = z.object({ reference: z.string().trim().min(1).max(2000), projectIds: ids.default([]) }).strict().parse(await json(c));
        // An existing identity is usable even when a provider is temporarily unreachable.
        const arxiv = normalizeArxiv(input.reference);
        let doi: string | undefined;
        if (!arxiv)
            try {
                doi = normalizeDoi(input.reference);
            }
            catch { }
        const existing = store.duplicate({ arxiv, doi });
        if (existing) {
            store.assign(existing.id, input.projectIds);
            return c.json({ paper: detail(existing.id), duplicate: true, warning: 'Existing paper reused; project assignments added.' });
        }
        const imported = await importReference(input.reference, options.fetchProvider);
        let pdf: {
            bytes: Buffer;
            pages: number;
        } | undefined;
        let warning = imported.warning;
        if (imported.pdf)
            try {
                pdf = { bytes: imported.pdf, pages: (await validatePdf(imported.pdf)).pages };
            }
            catch (e) {
                warning = `Reference saved. PDF attachment failed: ${(e as Error).message}`;
            }
        const result = store.insert(imported.meta, input.projectIds, pdf);
        return c.json({ ...result, paper: detail(result.paper.id), warning }, result.duplicate ? 200 : 201);
    });
    app.post('/api/papers/:id/pdf', async (c) => {
        if (c.req.header('Content-Type')?.split(';')[0] !== 'application/pdf')
            throw new HttpError(415, 'Upload a PDF.');
        const revision = z.coerce.number().int().nonnegative().parse(c.req.query('revision'));
        const bytes = await body(c, MAX_PDF);
        const parsed = await validatePdf(bytes);
        const p = store.attach(uuid.parse(c.req.param('id')), revision, bytes, parsed.pages);
        return c.json(detail(p.id));
    });
    app.get('/api/papers/:id/pdf', c => {
        const p = store.get(uuid.parse(c.req.param('id')));
        if (!p.pdfSha)
            throw new HttpError(404, 'No PDF attached.');
        c.header('Content-Type', 'application/pdf');
        c.header('Content-Disposition', `${c.req.query('download') ? 'attachment' : 'inline'}; filename="paper-${p.id}.pdf"`);
        c.header('ETag', `"${p.pdfSha}"`);
        return c.body(new Uint8Array(store.pdfBytes(p.pdfSha)));
    });
    app.post('/api/papers/:id/annotations', async (c) => c.json(store.addAnnotation(uuid.parse(c.req.param('id')), annotation.parse(await json(c))), 201));
    app.patch('/api/papers/:id/annotations/:annotationId', async (c) => {
        const { revision, ...fields } = annotationPatch.parse(await json(c));
        return c.json(store.changeAnnotation(uuid.parse(c.req.param('id')), uuid.parse(c.req.param('annotationId')), revision, fields));
    });
    app.delete('/api/papers/:id/annotations/:annotationId', async (c) => {
        const { revision } = z.object({ revision: z.number().int().nonnegative() }).strict().parse(await json(c));
        store.changeAnnotation(uuid.parse(c.req.param('id')), uuid.parse(c.req.param('annotationId')), revision, {}, true);
        return c.json({ deleted: true });
    });
    app.delete('/api/papers/:id', async (c) => {
        const { confirmation, revision } = z.object({ confirmation: uuid, revision: z.number().int().nonnegative() }).strict().parse(await json(c));
        const id = uuid.parse(c.req.param('id'));
        if (confirmation !== id)
            throw new HttpError(400, 'Permanent deletion requires explicit confirmation of this paper.');
        store.remove(id, revision);
        return c.json({ deleted: true });
    });
    app.get('/api/export', c => {
        const format = z.enum(['bibtex', 'markdown']).parse(c.req.query('format'));
        let papers = store.list();
        if (c.req.query('ids')) {
            const selected = ids.parse(c.req.query('ids')!.split(','));
            papers = papers.filter(p => selected.includes(p.id));
        }
        else if (c.req.query('project')) {
            const id = uuid.parse(c.req.query('project'));
            papers = papers.filter(p => p.projectIds.includes(id));
        }
        c.header('Content-Type', 'text/plain; charset=utf-8');
        c.header('Content-Disposition', `attachment; filename="papertrail.${format === 'bibtex' ? 'bib' : 'md'}"`);
        return c.body(format === 'bibtex' ? bibtex(papers) : markdownExport(store, papers));
    });
    app.get('/api/backup', c => {
        const snapshot = JSON.stringify(backup(store));
        if (Buffer.byteLength(snapshot) > MAX_BACKUP)
            throw new HttpError(413, 'This library exceeds the 128 MiB portable backup limit. Stop the service and back up the complete data volume as described in README.');
        c.header('Content-Disposition', 'attachment; filename="papertrail-backup.json"');
        c.header('Content-Type', 'application/json');
        return c.body(snapshot);
    });
    app.post('/api/restore', async (c) => {
        if (c.req.header('X-Restore-Confirmation') !== 'RESTORE EMPTY LIBRARY')
            throw new HttpError(400, 'Explicit restore confirmation required.');
        return c.json(await restore(store, await json(c, MAX_BACKUP)));
    });
    if (options.clientDirectory) {
        app.use('*', serveStatic({ root: options.clientDirectory }));
        app.get('/', serveStatic({ path: `${options.clientDirectory}/index.html` }));
    }
    app.notFound(c => c.json({ error: 'Route not found.' }, 404));
    app.onError((error, c) => {
        if (error instanceof HttpError)
            return c.json({ error: error.message, details: error.details }, error.status as 400);
        if (error instanceof ZodError)
            return c.json({ error: 'Validation failed.', details: error.issues.map(i => ({ path: i.path, message: i.message })) }, 400);
        if ((error as Error).message?.includes('UNIQUE constraint failed'))
            return c.json({ error: 'This identity or PDF already belongs to an existing paper. Reuse that paper.' }, 409);
        if ((error as Error).message?.startsWith('Enter a DOI'))
            return c.json({ error: error.message }, 400);
        // Do not log request headers, tokens, note bodies or provider payloads.
        const code = (error as NodeJS.ErrnoException).code;
        console.error('Request failed:', JSON.stringify({ requestId: c.res.headers.get('X-Request-Id'), method: c.req.method,
            route: c.req.routePath, status: 500, code: ['EACCES', 'EROFS', 'ENOSPC', 'ENOENT', 'SQLITE_FULL', 'SQLITE_READONLY', 'SQLITE_IOERR'].includes(code || '') ? code : 'INTERNAL_ERROR' }));
        return c.json({ error: 'The server could not complete this operation. Check storage and retry; your unsaved text remains in this browser.' }, 500);
    });
    return app;
}
