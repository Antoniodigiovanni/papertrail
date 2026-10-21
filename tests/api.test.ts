import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { backup, restore } from '../server/backup.js';
import { validatePdf } from '../server/pdf.js';
import { authBoundary } from '../server/auth.js';
import { normalizeArxiv, normalizeDoi } from '../server/schema.js';
import { importReference, publicAddress, validateProviderUrl } from '../server/providers.js';
import { bibtex, citationKey, markdownHtml } from '../server/exports.js';
import { textPdf, arxivXml, crossrefFixture } from './fixture.js';
import type { PaperDetail } from '../client/api.js';
import { importLibraryNotice, importLibraryView, type ImportResult } from '../client/library-import.js';
let directory: string;
let store: Store;
let app: ReturnType<typeof createApp>;
const temporaryRoot = path.resolve('test-results');
mkdirSync(temporaryRoot, { recursive: true });
const fetchProvider = async (url: string) => Buffer.from(url.includes('api.crossref.org') ? JSON.stringify(crossrefFixture()) : url.includes('/api/query') ? arxivXml() : textPdf());
beforeEach(() => { directory = mkdtempSync(path.join(temporaryRoot, 'unit-')); store = new Store(directory); app = createApp({ store, auth: { mode: 'development', host: '127.0.0.1' }, peerAddress: () => '127.0.0.1', fetchProvider }); });
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
async function request(route: string, method = 'GET', data?: unknown, headers: Record<string, string> = {}) {
    return app.request(`http://localhost${route}`, { method, headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
}
async function upload(bytes = textPdf(), projects: string[] = []) {
    return app.request(`http://localhost/api/upload?projects=${projects.join(',')}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'paper.pdf' }, body: new Uint8Array(bytes) });
}
async function paper(): Promise<PaperDetail> { const response = await upload(); assert.equal(response.status, 201, await response.clone().text()); return (await response.json()).paper; }
async function addLabel(kind: 'projects' | 'tags', name: string) { const r = await request(`/api/${kind}`, 'POST', { name }); assert.equal(r.status, 201); return await r.json() as {
    id: string;
    name: string;
}; }
test('project rename trims, persists and leaves every paper, assignment, annotation and PDF unchanged', async () => {
    const project = await addLabel('projects', 'Original');
    const other = await addLabel('projects', 'Other');
    const tag = await addLabel('tags', 'evidence');
    const p = (await (await upload(textPdf(), [project.id, other.id])).json()).paper;
    store.patch(p.id, { revision: p.revision, note: 'Keep all content', status: 'Reading', position: { page: 2, offset: .42 }, tagIds: [tag.id] });
    store.addAnnotation(p.id, { page: 1, quote: 'Keep passage', rects: [[.1, .1, .4, .2]], color: 'green', comment: 'Keep comment' });
    const archived = store.insert({ title: 'Archived reference' }, [project.id]).paper;
    store.patch(archived.id, { revision: archived.revision, archived: true });
    const before = backup(store);
    const response = await request(`/api/projects/${project.id}`, 'PATCH', { name: '  Renamed  ', expectedName: project.name });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: project.id, name: 'Renamed' });
    const after = backup(store);
    assert.deepEqual({ ...after, createdAt: before.createdAt, projects: before.projects }, before);
    assert.equal((await (await request(`/api/library?project=${project.id}`)).json()).projects.find((p: { id: string }) => p.id === project.id).name, 'Renamed');
    assert.equal((await (await request('/api/library?search=Renamed')).json()).papers.length, 1);
    const same = await request(`/api/projects/${project.id}`, 'PATCH', { name: 'Renamed', expectedName: 'Renamed' });
    assert.equal(same.status, 200);
    store.close(); store = new Store(directory);
    assert.deepEqual({ ...store.labels('projects').find(p => p.id === project.id) }, { id: project.id, name: 'Renamed' });
    assert.deepEqual(store.get(p.id), before.papers.find(paper => paper.id === p.id));
    assert.deepEqual(store.annotations(p.id), before.annotations);
    assert.deepEqual(store.pdfBytes(p.pdfSha), textPdf());
    const freshDirectory = mkdtempSync(path.join(temporaryRoot, 'rename-restore-'));
    const fresh = new Store(freshDirectory);
    try {
        await restore(fresh, after);
        assert.deepEqual(fresh.labels('projects'), store.labels('projects'));
        assert.deepEqual(fresh.list(), store.list());
    } finally { fresh.close(); rmSync(freshDirectory, { recursive: true, force: true }); }
});
test('project rename rejects invalid, duplicate and stale names atomically using exact label matching', async () => {
    const project = await addLabel('projects', 'Original');
    const other = await addLabel('projects', 'Taken');
    const route = `/api/projects/${project.id}`;
    const rename = (name: unknown, expectedName = project.name) => request(route, 'PATCH', { name, expectedName });
    for (const name of ['', '   ', 'x'.repeat(101), null, 42]) assert.equal((await rename(name)).status, 400);
    assert.equal((await request(route, 'PATCH', { name: 'Valid' })).status, 400);
    assert.equal((await request(route, 'PATCH', { name: 'Valid', expectedName: 'Original', extra: true })).status, 400);
    assert.equal((await request('/api/projects/not-an-id', 'PATCH', { name: 'Valid', expectedName: 'Original' })).status, 400);
    assert.equal((await request(`/api/projects/${randomUUID()}`, 'PATCH', { name: 'Valid', expectedName: 'Original' })).status, 404);
    assert.equal((await rename('  Taken  ')).status, 409);
    assert.deepEqual(new Set(store.labels('projects').map(p => p.name)), new Set(['Original', 'Taken']));
    assert.throws(() => store.renameProject(project.id, ' ', 'Original'));
    assert.throws(() => store.renameProject(project.id, 'Taken', 'Original'), /already exists/);
    assert.equal((await rename('taken')).status, 200, 'case variants are distinct, as in label creation');
    const stale = await rename('Lost update');
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).details.code, 'PROJECT_NAME_CONFLICT');
    assert.throws(() => store.renameProject(project.id, 'Lost update', 'Original'), /renamed elsewhere/);
    assert.deepEqual({ ...store.labels('projects').find(p => p.id === project.id) }, { id: project.id, name: 'taken' });
    const reused = await addLabel('projects', ' taken ');
    assert.equal(reused.id, project.id);
    assert.equal(store.labels('projects').find(p => p.id === other.id)?.name, 'Taken');
    await request(route, 'DELETE', { confirmation: project.id });
    assert.equal((await rename('Cannot resurrect', 'taken')).status, 404);
});
test('valid text PDF parses with actual pdfinfo; binary is preserved and deduplicated', async () => {
    const bytes = textPdf();
    const parsed = await validatePdf(bytes);
    assert.equal(parsed.pages, 3);
    assert.equal(parsed.title, 'The Architecture of Understanding');
    const p1 = await addLabel('projects', 'Reading systems'), p2 = await addLabel('projects', 'Connected ideas');
    const r1 = await upload(bytes, [p1.id]);
    const a = await r1.json();
    const r2 = await upload(bytes, [p2.id]);
    const b = await r2.json();
    assert.equal(r2.status, 200);
    assert.equal(b.duplicate, true);
    assert.equal(a.paper.id, b.paper.id);
    assert.deepEqual(new Set(b.paper.projectIds), new Set([p1.id, p2.id]));
    assert.equal(store.list().length, 1);
    assert.equal(readdirSync(store.files).length, 1);
    const tag=await addLabel('tags','connected');
    const tagged=await request(`/api/papers/${a.paper.id}`,'PATCH',{revision:b.paper.revision,tagIds:[tag.id]});
    assert.equal(tagged.status,200);
    assert.deepEqual(store.get(a.paper.id).tagIds,[tag.id]);
    assert.equal(store.get(a.paper.id).projectIds.length,2);
    assert.equal(readdirSync(store.files).length,1);
    const downloaded = await request(`/api/papers/${a.paper.id}/pdf`);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    assert.equal(downloaded.headers.get('content-type'), 'application/pdf');
    assert.match(downloaded.headers.get('content-disposition')!, /paper-[a-f0-9-]+\.pdf/);
    assert.match(downloaded.headers.get('content-disposition')!, /filename\*=UTF-8''paper\.pdf$/);
});
test('upload results reveal the chosen destination with cleared filters and reuse original paper data', async () => {
    const a = await addLabel('projects', 'Upload destination A'), b = await addLabel('projects', 'Upload destination B');
    const result: ImportResult = await (await upload(textPdf(), [a.id, b.id])).json();
    const view = importLibraryView(result.paper, [b.id, a.id], a.id);
    assert.deepEqual(view, { project: a.id, scope: 'active', search: '', tag: '', status: '' });
    const visible = await (await request(`/api/library?${new URLSearchParams(view)}`)).json();
    assert.deepEqual(visible.papers.map((p: PaperDetail) => p.id), [result.paper.id]);
    assert.match(importLibraryNotice(result), /Added.*Search and filters cleared/);
    store.patch(result.paper.id, { revision: result.paper.revision, note: 'Keep draft', status: 'Finished', position: { page: 2, offset: .5 } });
    store.addAnnotation(result.paper.id, { page: 1, quote: 'Preserve', rects: [[.1, .1, .4, .2]], color: 'yellow', comment: 'Keep' });
    const before = store.get(result.paper.id), anchors = store.annotations(result.paper.id);
    const duplicate: ImportResult = await (await upload(textPdf(), [b.id])).json();
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.paper.id, before.id);
    assert.equal(importLibraryView(duplicate.paper, [b.id], a.id).project, b.id);
    assert.equal(importLibraryView(duplicate.paper, [], a.id).project, '', 'no requested destination reveals All papers without removing assignments');
    assert.deepEqual(store.get(before.id), { ...before, revision: duplicate.paper.revision, updated: duplicate.paper.updated });
    assert.deepEqual(store.annotations(before.id), anchors);
    assert.deepEqual(store.pdfBytes(before.pdfSha!), textPdf());
    assert.equal(store.list().length, 1);
});
test('arXiv import results use a deterministic destination and reveal archived duplicates without unarchiving', async () => {
    const a = await addLabel('projects', 'arXiv A'), b = await addLabel('projects', 'arXiv B');
    const selected = [a.id, b.id];
    const response = await request('/api/import', 'POST', { reference: '2401.12345v1', projectIds: selected });
    assert.equal(response.status, 201);
    const result: ImportResult = await response.json();
    const view = importLibraryView(result.paper, selected, 'unassigned');
    assert.equal(view.project, [...selected].sort()[0]);
    assert.deepEqual(importLibraryView(result.paper, [...selected].reverse(), ''), view);
    const visible = await (await request(`/api/library?${new URLSearchParams(view)}`)).json();
    assert.equal(visible.papers[0].id, result.paper.id);
    store.patch(result.paper.id, { revision: result.paper.revision, archived: true, note: 'Keep archived', status: 'Reading' });
    const duplicate: ImportResult = await (await request('/api/import', 'POST', { reference: '2401.12345', projectIds: [a.id] })).json();
    const archive = importLibraryView(duplicate.paper, [a.id], b.id);
    assert.equal(archive.scope, 'archive'); assert.equal(archive.project, a.id);
    const archived = await (await request(`/api/library?${new URLSearchParams(archive)}`)).json();
    assert.equal(archived.papers[0].id, result.paper.id);
    assert.equal(store.get(result.paper.id).archived, true);
    assert.equal(store.get(result.paper.id).note, 'Keep archived');
    assert.equal(store.get(result.paper.id).status, 'Reading');
    assert.equal(store.list().length, 1);
    assert.match(importLibraryNotice(duplicate), /Existing paper reused.*remains in Archive/);
});
test('DOI metadata-only results reveal All papers and retain warnings; failed imports leave store unchanged', async () => {
    const response = await request('/api/import', 'POST', { reference: '10.1234/evidence', projectIds: [] });
    assert.equal(response.status, 201);
    const result: ImportResult = await response.json();
    assert.equal(result.paper.pdfSha, null);
    const view = importLibraryView(result.paper, [], randomUUID());
    assert.deepEqual(view, { project: '', scope: 'active', search: '', tag: '', status: '' });
    const visible = await (await request(`/api/library?${new URLSearchParams(view)}`)).json();
    assert.equal(visible.papers[0].id, result.paper.id);
    assert.ok(importLibraryNotice(result).includes('Reference saved without a PDF.'));
    if (result.warning) assert.ok(importLibraryNotice(result).includes(result.warning));
    const duplicate: ImportResult = await (await request('/api/import', 'POST', { reference: 'https://doi.org/10.1234/evidence', projectIds: [] })).json();
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.paper.id, result.paper.id);
    assert.match(importLibraryNotice(duplicate), /Existing paper reused.*Reference saved without a PDF/);
    const before = store.list();
    assert.equal((await request('/api/import', 'POST', { reference: 'not a reference', projectIds: [] })).status, 400);
    const invalid = await upload(Buffer.from('invalid PDF'));
    assert.equal(invalid.status, 400);
    assert.deepEqual(store.list(), before);
});
test('PDF filename editing is independent, revision-aware and preserves bytes, identity and annotations', async () => {
    const p = await paper();
    const project = await addLabel('projects', 'Filename project');
    const tag = await addLabel('tags', 'Filename tag');
    store.patch(p.id, { revision: p.revision, projectIds: [project.id], tagIds: [tag.id], note: 'Keep notes', status: 'Reading', position: { page: 2, offset: .4 } });
    store.addAnnotation(p.id, { page: 1, quote: 'Keep passage', rects: [[.1, .1, .4, .2]], color: 'blue', comment: 'Keep anchor' });
    const before = store.get(p.id), annotations = store.annotations(p.id);
    const filePath = store.pdfPath(p.pdfSha!), fileBytes = readFileSync(filePath);
    const route = `/api/papers/${p.id}`;
    const response = await request(route, 'PATCH', { revision: before.revision, pdfFilename: "  Étude d'algèbre (2026).PDF  " });
    assert.equal(response.status, 200, await response.clone().text());
    const renamed = await response.json();
    assert.equal(renamed.pdfFilename, "Étude d'algèbre (2026).pdf");
    assert.deepEqual(store.get(p.id), { ...before, pdfFilename: renamed.pdfFilename, revision: before.revision + 1, updated: renamed.updated });
    assert.deepEqual(store.annotations(p.id), annotations);
    assert.deepEqual(readFileSync(filePath), fileBytes);
    assert.deepEqual(readdirSync(store.files), [`${p.pdfSha}.pdf`]);
    for (const download of ['', '?download=1']) {
        const pdf = await request(`${route}/pdf${download}`);
        const disposition = pdf.headers.get('content-disposition')!;
        assert.ok(disposition.startsWith(download ? 'attachment;' : 'inline;'));
        assert.ok(disposition.includes(`filename="paper-${p.id}.pdf";`));
        assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), renamed.pdfFilename);
        assert.doesNotMatch(disposition, /[\r\n]|[éè]/u);
        assert.ok(disposition.includes('%27'));
        assert.equal(pdf.headers.get('etag'), `"${p.pdfSha}"`);
        assert.deepEqual(Buffer.from(await pdf.arrayBuffer()), fileBytes);
    }
    assert.equal((await request(route, 'PATCH', { revision: before.revision, pdfFilename: 'stale.pdf' })).status, 409);
    assert.equal((await request(route, 'PATCH', { revision: renamed.revision, title: 'Independent title' })).status, 200);
    assert.equal(store.get(p.id).pdfFilename, renamed.pdfFilename);
    const duplicate = await upload();
    assert.equal((await duplicate.json()).paper.pdfFilename, renamed.pdfFilename);
    store.close(); store = new Store(directory);
    assert.equal(store.get(p.id).pdfFilename, renamed.pdfFilename);
    assert.equal(store.get(p.id).title, 'Independent title');
    assert.deepEqual(store.annotations(p.id), annotations);
    assert.deepEqual(store.pdfBytes(p.pdfSha!), fileBytes);
});
test('paper title rename preserves filenames and related data, rejects stale edits and persists after reopening', async () => {
    const p = await paper(), project = await addLabel('projects', 'Title project'), tag = await addLabel('tags', 'Title tag');
    store.patch(p.id, { revision: p.revision, pdfFilename: 'Original download.pdf', projectIds: [project.id], tagIds: [tag.id], note: 'Keep notes', position: { page: 2, offset: .4 } });
    store.addAnnotation(p.id, { page: 1, quote: 'Keep passage', rects: [[.1, .1, .4, .2]], color: 'green', comment: 'Keep comment' });
    const before = store.get(p.id), annotations = store.annotations(p.id), bytes = store.pdfBytes(p.pdfSha!);
    const route = `/api/papers/${p.id}`;
    for (const title of ['', '   ', 'x'.repeat(2001)]) {
        assert.equal((await request(route, 'PATCH', { revision: before.revision, title })).status, 400);
        assert.deepEqual(store.get(p.id), before);
    }
    const response = await request(route, 'PATCH', { revision: before.revision, title: '  A bibliographic title  ' });
    assert.equal(response.status, 200);
    const renamed = await response.json();
    const expected = { ...before, title: 'A bibliographic title', revision: before.revision + 1, updated: renamed.updated };
    assert.deepEqual(store.get(p.id), expected);
    assert.equal((await request(route, 'PATCH', { revision: before.revision, title: 'Stale title' })).status, 409);
    assert.deepEqual(store.get(p.id), expected);
    assert.deepEqual((await (await request('/api/library')).json()).papers.find((paper: { id: string }) => paper.id === p.id), expected);
    assert.deepEqual(store.annotations(p.id), annotations);
    store.close(); store = new Store(directory);
    assert.deepEqual(store.get(p.id), expected);
    assert.deepEqual(store.annotations(p.id), annotations);
    assert.deepEqual(store.pdfBytes(p.pdfSha!), bytes);
    assert.deepEqual(readdirSync(store.files), [`${p.pdfSha}.pdf`]);
});
test('unsafe PDF filenames are rejected atomically at API and store boundaries', async () => {
    const p = await paper();
    for (const pdfFilename of ['', ' ', 'no-extension', '.pdf', '.hidden.pdf', '../escape.pdf', 'a/b.pdf', 'a\\b.pdf', 'bad..pdf', 'bad".pdf', 'bad:.pdf', 'bad?.pdf', 'bad*.pdf', 'bad|.pdf', 'bad<.pdf', 'bad>.pdf', 'bad\r\n.pdf', 'bad.pdf\n', 'bad\0.pdf', 'bad\u007f.pdf', 'bad\u0085.pdf', 'bad\u202e.pdf', 'bad\ud800.pdf', 'CON.pdf', 'lpt1.extra.pdf', 'trailing .pdf', 'x'.repeat(237) + '.pdf', 'é'.repeat(119) + '.pdf']) {
        const response = await request(`/api/papers/${p.id}`, 'PATCH', { revision: p.revision, title: 'Must not save', pdfFilename });
        assert.equal(response.status, 400, JSON.stringify(pdfFilename));
        assert.throws(() => store.patch(p.id, { revision: p.revision, pdfFilename }));
        assert.deepEqual(store.get(p.id), pWithoutDetails(p));
    }
    const fallback = await app.request('http://localhost/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Filename': encodeURIComponent('../unsafe.pdf') }, body: new Uint8Array(textPdf('Safe fallback')) });
    const uploaded = (await fallback.json()).paper;
    assert.equal(uploaded.pdfFilename, `paper-${uploaded.id}.pdf`);
    // The response boundary must also be safe if stored metadata is malformed.
    store.db.prepare('UPDATE papers SET pdfFilename=? WHERE id=?').run('bad.pdf\r\nInjected: value', p.id);
    const disposition = (await request(`/api/papers/${p.id}/pdf?download=1`)).headers.get('content-disposition')!;
    assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), `paper-${p.id}.pdf`);
    assert.doesNotMatch(disposition, /[\r\n]|Injected/);
    assert.deepEqual(store.pdfBytes(p.pdfSha!), textPdf());
});
function pWithoutDetails({ annotations: _annotations, noteHtml: _noteHtml, ...paper }: PaperDetail) { return paper; }

test('filename migration upgrades a legacy database additively and survives legacy version markers', async () => {
    const p = await paper();
    store.addAnnotation(p.id, { page: 1, quote: 'Original anchor', rects: [[.1, .1, .4, .2]], color: 'green', comment: 'Keep' });
    const before = store.get(p.id), annotations = store.annotations(p.id);
    // Reconstruct the baseline schema only in this disposable test database.
    store.db.exec('ALTER TABLE papers DROP COLUMN pdfFilename; PRAGMA user_version = 1;');
    store.close(); store = new Store(directory);
    assert.deepEqual(store.get(p.id), { ...before, pdfFilename: `paper-${p.id}.pdf` });
    assert.deepEqual(store.annotations(p.id), annotations);
    assert.deepEqual(store.pdfBytes(p.pdfSha!), textPdf());
    assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 2);
    const renamed = store.patch(p.id, { revision: before.revision, pdfFilename: 'Migration retained.pdf' });
    // The baseline constructor resets this marker; the column must not be re-added.
    store.db.pragma('user_version = 1');
    store.close(); store = new Store(directory);
    assert.deepEqual(store.get(p.id), renamed);
    assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 2);
});
test('version 2 backups retain filenames and version 1 backups restore with stable defaults', async () => {
    const p = await paper();
    store.patch(p.id, { revision: p.revision, pdfFilename: 'Backup étude.pdf' });
    const source = backup(store);
    assert.equal(source.version, 2);
    for (const legacy of ['current', 'missing', 'null'] as const) {
        const targetDirectory = mkdtempSync(path.join(temporaryRoot, 'filename-restore-'));
        const target = new Store(targetDirectory);
        try {
            const input = JSON.parse(JSON.stringify(source));
            if (legacy !== 'current') {
                input.version = 1;
                for (const paper of input.papers) {
                    if (legacy === 'null') paper.pdfFilename = null;
                    else delete paper.pdfFilename;
                }
            }
            await restore(target, input);
            assert.deepEqual(target.get(p.id), { ...store.get(p.id), pdfFilename: legacy === 'current' ? 'Backup étude.pdf' : `paper-${p.id}.pdf` });
            assert.deepEqual(target.pdfBytes(p.pdfSha!), textPdf());
        } finally { target.close(); rmSync(targetDirectory, { recursive: true, force: true }); }
    }
    const targetDirectory = mkdtempSync(path.join(temporaryRoot, 'invalid-filename-restore-'));
    const target = new Store(targetDirectory);
    try {
        for (const invalid of ['../escape.pdf', undefined, null]) {
            const input = JSON.parse(JSON.stringify(source)); input.papers[0].pdfFilename = invalid;
            await assert.rejects(restore(target, input));
            assert.equal(target.list().length, 0); assert.deepEqual(readdirSync(target.files), []);
        }
    } finally { target.close(); rmSync(targetDirectory, { recursive: true, force: true }); }
});
test('notes, reading state, assignments, annotations and geometry survive a reopened database', async () => {
    const p = await paper();
    const tag = await addLabel('tags', 'evidence');
    const response = await request(`/api/papers/${p.id}`, 'PATCH', { revision: p.revision, note: '# A thought\n\n**Evidence** connects ideas.', status: 'Reading', position: { page: 2, offset: .63 }, tagIds: [tag.id] });
    assert.equal(response.status, 200);
    const input = { page: 1, quote: 'Understanding grows when ideas connect.', rects: [[.1, .1, .7, .13], [.1, .14, .6, .17]], color: 'yellow', comment: 'A useful connection' };
    const added = await request(`/api/papers/${p.id}/annotations`, 'POST', input);
    assert.equal(added.status, 201);
    const a = await added.json();
    store.close();
    store = new Store(directory);
    app = createApp({ store, auth: { mode: 'development', host: '127.0.0.1' }, peerAddress: () => '127.0.0.1' });
    const restored = await (await request(`/api/papers/${p.id}`)).json();
    assert.equal(restored.note, '# A thought\n\n**Evidence** connects ideas.');
    assert.equal(restored.status, 'Reading');
    assert.deepEqual(restored.position, { page: 2, offset: .63 });
    assert.deepEqual(restored.tagIds, [tag.id]);
    assert.match(restored.noteHtml, /<strong>Evidence<\/strong>/);
    assert.deepEqual(restored.annotations[0].rects, input.rects);
    const edited = await request(`/api/papers/${p.id}/annotations/${a.id}`, 'PATCH', { revision: 0, color: 'blue', comment: 'Revised thought' });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).revision, 1);
    const stale = await request(`/api/papers/${p.id}/annotations/${a.id}`, 'PATCH', { revision: 0, comment: 'Old comment' });
    assert.equal(stale.status, 409);
    assert.equal(store.annotations(p.id)[0].comment, 'Revised thought');
});
test('optimistic revisions reject delayed, stale and concurrent saves without clobbering', async () => {
    const p = await paper();
    const responses = await Promise.all([request(`/api/papers/${p.id}`, 'PATCH', { revision: 0, note: 'New thought' }), request(`/api/papers/${p.id}`, 'PATCH', { revision: 0, note: 'Stale thought' })]);
    assert.deepEqual(responses.map(r => r.status), [200, 409]);
    assert.equal(store.get(p.id).note, 'New thought');
    const delayed = await request(`/api/papers/${p.id}`, 'PATCH', { revision: 0, position: { page: 3, offset: .5 } });
    assert.equal(delayed.status, 409);
    const conflict = await delayed.json();
    assert.equal(conflict.details.current.revision, 1);
    assert.equal(store.get(p.id).position.page, 1);
});
test('search combines projects, tags, metadata, notes and highlight comments', async () => {
    const p = await paper();
    const project = await addLabel('projects', 'Research');
    const tag = await addLabel('tags', 'bayesian');
    store.patch(p.id, { revision: 0, projectIds: [project.id], tagIds: [tag.id], note: 'A handwritten hypothesis', venue: 'Journal of Connections' });
    store.addAnnotation(p.id, { page: 1, quote: 'Evidence', rects: [[.1, .1, .3, .2]], color: 'green', comment: 'Uncertainty matters' });
    for (const search of ['Lovelace', 'bayesian', 'handwritten', 'Uncertainty', 'Connections']) {
        const r = await request(`/api/library?project=${project.id}&tag=${tag.id}&search=${search}`);
        assert.equal((await r.json()).papers.length, 1, search);
    }
    assert.equal((await (await request('/api/library?project=unassigned')).json()).papers.length, 0);
    assert.equal((await (await request('/api/library?tag=' + randomUUID())).json()).papers.length, 0);
    assert.equal((await (await request('/api/library?search=' + encodeURIComponent("' OR 1=1; --"))).json()).papers.length, 0);
});
test('archive is reversible; permanent deletion requires archive, matching ID and current revision', async () => {
    const p = await paper();
    assert.equal((await request(`/api/papers/${p.id}`, 'DELETE', { revision: 0, confirmation: p.id })).status, 400);
    const archived = await request(`/api/papers/${p.id}`, 'PATCH', { revision: 0, archived: true });
    assert.equal(archived.status, 200);
    assert.equal((await (await request('/api/library')).json()).papers.length, 0);
    assert.equal((await (await request('/api/library?scope=archive')).json()).papers.length, 1);
    assert.equal((await request(`/api/papers/${p.id}`, 'DELETE', { revision: 1, confirmation: randomUUID() })).status, 400);
    assert.equal((await request(`/api/papers/${p.id}`, 'DELETE', { revision: 0, confirmation: p.id })).status, 409);
    assert.equal((await request(`/api/papers/${p.id}`, 'DELETE', { revision: 1, confirmation: p.id })).status, 200);
    assert.equal(readdirSync(store.files).length, 0);
    assert.equal((await request(`/api/papers/${p.id}`)).status, 404);
});
test('DOI reference imports, normalized duplicates reuse and manual attachment works', async () => {
    const response = await request('/api/import', 'POST', { reference: 'https://doi.org/10.1234/EVIDENCE' });
    assert.equal(response.status, 201);
    const imported = await response.json();
    assert.equal(imported.paper.doi, '10.1234/evidence');
    assert.equal(imported.paper.pdfSha, null);
    assert.match(imported.warning, /does not bypass/);
    const project = await addLabel('projects', 'Thinking');
    const duplicate = await request('/api/import', 'POST', { reference: 'doi:10.1234/evidence', projectIds: [project.id] });
    assert.equal((await duplicate.json()).paper.id, imported.paper.id);
    const p = store.get(imported.paper.id);
    const attach = await app.request(`http://localhost/api/papers/${p.id}/pdf?revision=${p.revision}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: new Uint8Array(textPdf()) });
    assert.equal(attach.status, 200);
    assert.equal(store.get(p.id).pageCount, 3);
    assert.equal(store.list().length, 1);
    const replacement = await app.request(`http://localhost/api/papers/${p.id}/pdf?revision=${store.get(p.id).revision}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: new Uint8Array(textPdf('Changed document')) });
    assert.equal(replacement.status, 409);
});
test('arXiv adapter uses real-format Atom fixtures; versions do not replace anchored bytes', async () => {
    const result = await importReference('https://arxiv.org/abs/2401.12345v1', fetchProvider);
    assert.deepEqual(result.meta.authors, ['Ada Lovelace', 'Alan Turing']);
    assert.equal(result.meta.title, 'Understanding & Evidence');
    const p1 = store.insert(result.meta, [], { bytes: result.pdf!, pages: 3 }).paper;
    store.addAnnotation(p1.id, { page: 1, quote: 'Evidence', rects: [[.1, .1, .3, .2]], color: 'yellow', comment: 'Version one' });
    const p2 = store.insert({ ...result.meta, arxiv: '2401.12345v2' }, [], { bytes: textPdf('Version two'), pages: 3 }).paper;
    assert.notEqual(p1.id, p2.id);
    assert.equal(p1.arxivBase, p2.arxivBase);
    assert.equal(store.annotations(p1.id).length, 1);
    assert.equal(store.annotations(p2.id).length, 0);
    assert.equal(store.duplicate({ arxiv: '2401.12345v1' })?.id, p1.id);
    assert.ok(store.duplicate({ arxiv: '2401.12345' }));
});
test('provider failure never fabricates success; arXiv PDF failure retains honest metadata', async () => {
    await assert.rejects(importReference('10.1234/evidence', async () => { throw new Error('DNS unavailable'); }), /malformed metadata/);
    const result = await importReference('2401.12345v1', async (url) => { if (url.includes('/api/query'))
        return Buffer.from(arxivXml()); throw new Error('Download denied'); });
    assert.equal(result.pdf, undefined);
    assert.equal(result.meta.arxiv, '2401.12345v1');
    assert.match(result.warning!, /Download denied/);
    const failed = createApp({ store, auth: { mode: 'development', host: '127.0.0.1' }, peerAddress: () => '127.0.0.1', fetchProvider: async () => { throw new Error('Network unavailable'); } });
    const r = await failed.request('http://localhost/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: '10.1234/evidence' }) });
    assert.equal(r.status, 502);
    assert.equal(store.list().length, 0);
});
test('validation rejects malicious or malformed uploads, unsafe geometry and arbitrary paths', async () => {
    for (const bytes of [Buffer.from('<script>alert(1)</script>'), Buffer.from('%PDF-1.7\nnot a pdf\n%%EOF')])
        assert.equal((await upload(bytes)).status, 400);
    assert.equal((await app.request('http://localhost/api/upload', { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: '%PDF-1.7' })).status, 415);
    const p = await paper();
    const unsafe = [{ page: 99, quote: 'x', rects: [[.1, .1, .4, .4]], color: 'yellow' }, { page: 1, quote: 'x', rects: [[-1, .1, .4, .4]], color: 'yellow' }, { page: 1, quote: 'x', rects: [[.4, .1, .2, .3]], color: 'yellow' }];
    for (const input of unsafe)
        assert.equal((await request(`/api/papers/${p.id}/annotations`, 'POST', input)).status, 400);
    for (const input of [{ revision: 0, pdfSha: '../../etc/passwd' }, { revision: 0, status: 'Unknown' }, { revision: 0, position: { page: 4, offset: .1 } }, { revision: 0, url: 'javascript:alert(1)' }, { revision: 0, projectIds: [randomUUID()] }])
        assert.equal((await request(`/api/papers/${p.id}`, 'PATCH', input)).status, 400);
    assert.equal((await request('/api/papers/not-a-uuid/pdf')).status, 400);
    assert.equal((await request('/api/upload', 'POST', {}, { 'Content-Length': '999999999' })).status, 415);
    const tooLarge = await app.request('http://localhost/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'Content-Length': '999999999' }, body: new Uint8Array(textPdf()) });
    assert.equal(tooLarge.status, 413);
    assert.equal(store.get(p.id).revision, 0);
});
test('provider allowlist and public DNS rules reject local, IP, auth, port and redirect destinations', () => {
    for (const url of ['http://arxiv.org/pdf/x', 'https://localhost/a', 'https://127.0.0.1/x', 'https://169.254.169.254/latest/meta-data', 'https://arxiv.org.evil.test/x', 'https://user@arxiv.org/x', 'https://arxiv.org:8443/x', 'file:///etc/passwd', 'https://[::1]/', 'https://arxiv.org@evil.test/a'])
        assert.throws(() => validateProviderUrl(url));
    assert.equal(validateProviderUrl('https://arxiv.org/pdf/2401.12345').hostname, 'arxiv.org');
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.20.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '::1', '::ffff:127.0.0.1'])
        assert.equal(publicAddress(ip), false, ip);
    assert.equal(publicAddress('1.1.1.1'), true);
    assert.equal(normalizeArxiv('https://arxiv.org/pdf/hep-th/9901001v2.pdf'), 'hep-th/9901001v2');
    assert.equal(normalizeArxiv('https://evil.test/2401.12345'), null);
    assert.equal(normalizeDoi('HTTPS://DOI.ORG/10.1234/AbC'), '10.1234/abc');
    assert.equal(normalizeDoi('https://doi.org/10.1234/AbC%2FPart?utm_source=example#section'), '10.1234/abc/part');
    assert.equal(normalizeArxiv('https://arxiv.org/pdf/2401.12345v2.pdf?download=1'), '2401.12345v2');
});
test('Markdown preview escapes script, event handlers, unsafe links and raw HTML', () => {
    const output = markdownHtml('# Safe\n\n**bold**\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[bad](javascript:alert(1))\n[ok](https://example.org)');
    assert.match(output, /<h1>Safe<\/h1>/);
    assert.match(output, /<strong>bold<\/strong>/);
    assert.doesNotMatch(output, /<script|<img|href="javascript:/i);
    assert.match(output, /href="https:\/\/example.org"/);
});
test('BibTeX and Markdown exports cover selection/project/library, escaping and stable unique keys', async () => {
    const p1 = await paper();
    const p2 = store.insert({ title: p1.title, authors: p1.authors }, []).paper;
    const project = await addLabel('projects', 'Exports');
    store.patch(p1.id, { revision: 0, title: 'A {brace} & 50% #_ $ ~ ^ \\ title', authors: ['Ada Lovelace', 'Alan Turing'], projectIds: [project.id], note: '## My note\nKeep **evidence**.' });
    store.addAnnotation(p1.id, { page: 2, quote: 'Keep the passage', rects: [[.1, .1, .4, .2]], color: 'pink', comment: 'Check this claim' });
    const out = await (await request('/api/export?format=bibtex')).text();
    assert.equal((out.match(/@article\{/g) || []).length, 2);
    assert.match(out, /\\\{brace\\\}/);
    assert.match(out, /\\& 50\\% \\#\\_/);
    assert.match(out, /\\textbackslash\{\}/);
    // Parse balanced BibTeX entry and field braces, respecting backslash escapes.
    let depth = 0;
    for (let i = 0; i < out.length; i++) {
        if (out[i] === '\\') {
            i++;
            continue;
        }
        if (out[i] === '{')
            depth++;
        if (out[i] === '}')
            depth--;
        assert.ok(depth >= 0);
    }
    assert.equal(depth, 0);
    const keys = [...out.matchAll(/@article\{([^,]+),/g)].map(m => m[1]);
    assert.equal(new Set(keys).size, 2);
    assert.notEqual(citationKey(store.get(p1.id)), citationKey(p2));
    assert.equal(bibtex(store.list()), bibtex(store.list().reverse()));
    const single = await (await request(`/api/export?format=bibtex&ids=${p1.id}`)).text();
    assert.equal((single.match(/@article/g) || []).length, 1);
    const byProject = await (await request(`/api/export?format=markdown&project=${project.id}`)).text();
    assert.match(byProject, /PDF page 2/);
    assert.match(byProject, /Keep the passage/);
    assert.match(byProject, /Check this claim/);
    assert.match(byProject, /## My note/);
    assert.match(byProject, /Projects: Exports/);
});
test('full backup restores to fresh isolated storage with PDF checksum and all related records', async () => {
    const p = await paper();
    const project = await addLabel('projects', 'Backup project'), tag = await addLabel('tags', 'Backup tag');
    store.patch(p.id, { revision: 0, projectIds: [project.id], tagIds: [tag.id], note: 'Preserve me', status: 'Finished', position: { page: 3, offset: .57 }, archived: true });
    store.addAnnotation(p.id, { page: 2, quote: 'A passage', rects: [[.123456, .2, .8, .23]], color: 'blue', comment: 'A comment' });
    const download = await request('/api/backup');
    assert.equal(download.status,200);
    assert.match(download.headers.get('content-disposition')!,/attachment/);
    const source = await download.json() as ReturnType<typeof backup>;
    const targetDirectory = mkdtempSync(path.join(temporaryRoot, 'restore-'));
    const target = new Store(targetDirectory);
    try {
        const targetApp=createApp({store:target,auth:{mode:'development',host:'127.0.0.1'},peerAddress:()=> '127.0.0.1'});
        const restored=await targetApp.request('http://localhost/api/restore',{method:'POST',headers:{'Content-Type':'application/json','X-Restore-Confirmation':'RESTORE EMPTY LIBRARY'},body:JSON.stringify(source)});
        assert.equal(restored.status,200,await restored.clone().text());
        const result=await restored.json();
        assert.deepEqual(result, { papers: 1, annotations: 1, files: 1 });
        assert.deepEqual(target.list(), store.list());
        assert.deepEqual(target.annotations(p.id), store.annotations(p.id));
        assert.deepEqual(target.labels('projects'), store.labels('projects'));
        assert.deepEqual(target.labels('tags'), store.labels('tags'));
        const bytes = target.pdfBytes(target.get(p.id).pdfSha!);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), p.pdfSha);
        assert.deepEqual(bytes, textPdf());
        target.close();
        const reopened = new Store(targetDirectory);
        assert.equal(reopened.get(p.id).position.offset, .57);
        reopened.close();
    }
    finally {
        if (target.db)
            try {
                target.close();
            }
            catch { }
        rmSync(targetDirectory, { recursive: true, force: true });
    }
});
test('restore refuses populated storage, traversal, corrupt bytes, unknown fields and orphan references', async () => {
    const p = await paper();
    const original = backup(store);
    await assert.rejects(restore(store, original), /empty library/);
    const freshDirectory = mkdtempSync(path.join(temporaryRoot, 'invalid-'));
    const fresh = new Store(freshDirectory);
    try {
        for (const mutate of [
            (v: typeof original) => { v.files[0].sha = '../../outside'; },
            (v: typeof original) => { v.files[0].base64 = Buffer.from('changed').toString('base64'); },
            (v: typeof original) => { v.papers[0].projectIds = [randomUUID()]; },
            (v: typeof original) => { v.papers[0].pdfSha = null; },
            (v: typeof original) => { (v as unknown as Record<string, unknown>).path = '/tmp/outside'; },
        ]) {
            const value = structuredClone(original);
            mutate(value);
            await assert.rejects(restore(fresh, value));
            assert.equal(fresh.list().length, 0);
            assert.equal(readdirSync(fresh.files).length, 0);
        }
    }
    finally {
        fresh.close();
        rmSync(freshDirectory, { recursive: true, force: true });
    }
    assert.equal((await request('/api/restore', 'POST', original)).status, 400);
    assert.equal(store.get(p.id).pdfSha, p.pdfSha);
});
test('development boundary requires explicit loopback; cross-origin mutations fail', async () => {
    assert.throws(() => authBoundary({ mode: 'development', host: '0.0.0.0' }), /loopback/);
    const check = authBoundary({ mode: 'development', host: '127.0.0.1' });
    await assert.rejects(check(undefined, '203.0.113.9'), /loopback/);
    await check(undefined, '::ffff:127.0.0.1');
    assert.equal((await request('/api/projects', 'POST', { name: 'Bad' }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('/api/projects', 'POST', { name: 'Bad' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await request('/api/projects', 'POST', { name: 'Good' }, { Origin: 'http://localhost' })).status, 201);
});
test('validated Access JWT protects UI, static modules, PDFs, downloads, exports and every mutation', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256' };
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: 'https://papertrail-test.cloudflareaccess.com', aud: ['library'], sub: 'test-user', exp: now + 60, iat: now };
    const token = (payload: Record<string, unknown>, alg = 'RS256') => { const head = Buffer.from(JSON.stringify({ alg, kid: 'test-key' })).toString('base64url'); const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`; };
    const staticDirectory = path.join(directory, 'static');
    mkdirSync(staticDirectory);
    writeFileSync(path.join(staticDirectory, 'index.html'), '<h1>Private library</h1>');
    const secured = createApp({ store, auth: { mode: 'access', host: '0.0.0.0', teamDomain: 'papertrail-test.cloudflareaccess.com', audience: 'library', jwks: async () => [jwk] }, clientDirectory: staticDirectory });
    const p = await paper();
    for (const route of ['/', '/favicon.svg', '/vendor/pdfjs/pdf.mjs', '/api/config', '/api/library', `/api/papers/${p.id}/pdf`, `/api/papers/${p.id}/pdf?download=1`, '/api/export?format=bibtex', '/api/backup', '/api/missing']) {
        assert.equal((await secured.request(`http://localhost${route}`)).status, 401, route);
        assert.equal((await secured.request(`http://localhost${route}`, { headers: { 'Cf-Access-Authenticated-User-Email': 'spoof@example.org' } })).status, 401);
    }
    assert.equal((await secured.request(`http://localhost/api/projects/${randomUUID()}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await secured.request(`http://localhost/api/projects/${randomUUID()}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    for (const method of ['POST', 'PATCH', 'DELETE'])
        assert.equal((await secured.request('http://localhost/api/projects', { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    for (const bad of [token({ ...claims, exp: now - 60 }), token({ ...claims, aud: 'wrong' }), token({ ...claims, iss: 'https://evil.example' }), token({ ...claims, nbf: now + 60 }), token({ ...claims, iat: now + 60 }), token({ ...claims }, 'none'), token(claims).slice(0, -10) + 'not-valid'])
        assert.equal((await secured.request('http://localhost/api/library', { headers: { 'Cf-Access-Jwt-Assertion': bad } })).status, 401);
    const good = await secured.request('http://localhost/api/library', { headers: { 'Cf-Access-Jwt-Assertion': token(claims) } });
    assert.equal(good.status, 200);
    assert.equal((await good.json()).papers.length, 1);
    const cookie = await secured.request('http://localhost/api/library', { headers: { Cookie: `CF_Authorization=${token(claims)}` } });
    assert.equal(cookie.status, 200);
    const ui = await secured.request('http://localhost/', { headers: { 'Cf-Access-Jwt-Assertion': token(claims) } });
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /Private library/);
    assert.match(good.headers.get('content-security-policy')!, /object-src 'none'/);
    assert.equal(good.headers.get('cache-control'), 'no-store');
    assert.equal(good.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await secured.request('http://localhost/healthz')).status, 200);
    assert.throws(() => createApp({ store, auth: { mode: 'access', host: '0.0.0.0' } }), /requires/);
});

test('production-origin Access import route accepts the reported URL and keeps all failure responses JSON', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'route-key' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: 'https://route-test.cloudflareaccess.com', aud: ['test-library'], sub: 'synthetic-user', iat: now, exp: now + 300 })).toString('base64url');
    const jwt = `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')}`;
    const calls: string[] = [];
    let mode = 'success';
    const secured = createApp({ store, publicOrigin: 'https://read.antovanni.com', auth: {
        mode: 'access', host: '127.0.0.1', teamDomain: 'route-test.cloudflareaccess.com', audience: 'test-library',
        jwks: async () => [{ ...publicKey.export({ format: 'jwk' }), kid: 'route-key', alg: 'RS256' }],
    }, fetchProvider: async url => {
        calls.push(url);
        if (mode === 'failure') throw new (await import('../server/errors.js')).HttpError(502, 'Provider unavailable. Retry later.');
        return Buffer.from(url.includes('/api/query') ? arxivXml('2608.12594v1') : mode === 'invalid-pdf' ? '%PDF-not-complete' : textPdf());
    } });
    const headers = { 'Content-Type': 'application/json', Origin: 'https://read.antovanni.com', Cookie: `CF_Authorization=${jwt}` };
    const send = (override = {}, body = JSON.stringify({ reference: 'https://arxiv.org/abs/2608.12594' })) => secured.request('http://127.0.0.1:8350/api/import', { method: 'POST', headers: { ...headers, ...override }, body });
    const assertJson = async (response: Response, status: number) => {
        assert.equal(response.status, status);
        assert.match(response.headers.get('content-type')!, /^application\/json/);
        assert.match(response.headers.get('x-request-id')!, /^[a-f0-9-]{36}$/);
        return response.json();
    };
    assert.match((await assertJson(await send({ Cookie: '' }), 401)).error, /authentication/);
    assert.match((await assertJson(await send({ Origin: 'https://other.example' }), 403)).error, /origin/);
    await assertJson(await send({ 'Content-Type': 'text/plain' }), 415);
    await assertJson(await send({}, '{broken'), 400);
    mode = 'failure';
    assert.match((await assertJson(await send(), 502)).error, /Provider unavailable/);
    mode = 'invalid-pdf';
    const reference = await assertJson(await send(), 201);
    assert.equal(reference.paper.pdfSha, null);
    assert.match(reference.warning, /PDF attachment failed/);
    // Remove only this isolated test reference before exercising the full path.
    store.patch(reference.paper.id, { revision: reference.paper.revision, archived: true });
    store.remove(reference.paper.id, store.get(reference.paper.id).revision);
    mode = 'success';
    const originalTmp = process.env.TMPDIR;
    process.env.TMPDIR = path.join(directory, 'nonexistent-temp');
    try {
        const imported = await assertJson(await send(), 201);
        assert.equal(imported.paper.arxiv, '2608.12594v1');
        assert.equal(imported.paper.pageCount, 3);
        assert.deepEqual(store.pdfBytes(imported.paper.pdfSha), textPdf());
        assert.ok(calls.includes('https://export.arxiv.org/api/query?id_list=2608.12594'));
        assert.ok(calls.includes('https://arxiv.org/pdf/2608.12594v1'));
        const duplicate = await assertJson(await send(), 200);
        assert.equal(duplicate.duplicate, true);
        assert.equal(duplicate.paper.id, imported.paper.id);
    } finally {
        if (originalTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = originalTmp;
    }
});

test('import storage exceptions return safe JSON with a correlatable request ID', async () => {
    const original = store.writePdf;
    const log = console.error;
    const logs: unknown[][] = [];
    console.error = (...args: unknown[]) => { logs.push(args); };
    store.writePdf = () => { throw Object.assign(new Error('sensitive filesystem path or credentials'), { code: 'EROFS' }); };
    try {
        const response = await request('/api/import', 'POST', { reference: 'https://arxiv.org/abs/2401.12345' });
        assert.equal(response.status, 500);
        assert.match(response.headers.get('content-type')!, /^application\/json/);
        assert.match((await response.json()).error, /server could not complete/);
        assert.ok(JSON.stringify(logs).includes(response.headers.get('x-request-id')!));
        assert.match(JSON.stringify(logs), /EROFS/);
        assert.doesNotMatch(JSON.stringify(logs), /sensitive filesystem|credentials/);
        assert.equal(store.list().length, 0);
    } finally { store.writePdf = original; console.error = log; }
});

test('unavailable pdfinfo gives an actionable upload error and a JSON metadata-only import', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = path.join(directory, 'missing-executables');
    try {
        const uploaded = await upload();
        assert.equal(uploaded.status, 503);
        assert.match(uploaded.headers.get('content-type')!, /^application\/json/);
        assert.match((await uploaded.json()).error, /pdfinfo installation and execution permissions/);
        const imported = await request('/api/import', 'POST', { reference: '2401.12345' });
        assert.equal(imported.status, 201);
        assert.match(imported.headers.get('content-type')!, /^application\/json/);
        const result = await imported.json();
        assert.equal(result.paper.pdfSha, null);
        assert.match(result.warning, /Server PDF validation is unavailable/);
    } finally {
        if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    }
});


test('original SVG favicon is served locally with the correct MIME type and wired into the entrypoint', async () => {
    const ui = createApp({ store, auth: { mode: 'development', host: '127.0.0.1' }, peerAddress: () => '127.0.0.1', clientDirectory: path.resolve('public') });
    const response = await ui.request('http://localhost/favicon.svg');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, /^image\/svg\+xml/);
    const svg = await response.text();
    assert.match(svg, /<svg/);
    assert.doesNotMatch(svg, /<script|<image|href=/);
    assert.match(readFileSync('index.html', 'utf8'), /<link rel="icon" type="image\/svg\+xml" href="\/favicon.svg">/);
});

test('confirmed project deletion preserves every paper, file, note, highlight and other membership after reopening', async () => {
    const deleted = await addLabel('projects', 'Delete this project');
    const retained = await addLabel('projects', 'Keep this project');
    const tag = await addLabel('tags', 'Keep this tag');
    const first = (await (await upload(textPdf(), [deleted.id, retained.id])).json()).paper;
    const second = (await (await upload(textPdf('Orphan after project deletion'), [deleted.id])).json()).paper;
    const archived = store.insert({ title: 'Archived reference' }, [deleted.id]).paper;
    store.insert({ title: 'Unaffected reference' }, [retained.id]);
    store.patch(archived.id, { revision: archived.revision, archived: true, note: 'Archived notes' });
    store.patch(first.id, { revision: first.revision, note: '# Preserve everything', tagIds: [tag.id], position: { page: 2, offset: .42 }, status: 'Finished' });
    store.addAnnotation(first.id, { page: 2, quote: 'Keep this passage', rects: [[.1, .2, .4, .3]], color: 'pink', comment: 'Keep this comment' });
    const before = store.list();
    const highlights = store.annotations(first.id);
    const files = readdirSync(store.files).map(name => [name, readFileSync(path.join(store.files, name))] as const);
    const route = `/api/projects/${deleted.id}`;
    for (const body of [{}, { confirmation: retained.id }, { confirmation: deleted.id, cascade: true }, { confirmation: 'invalid' }])
        assert.equal((await request(route, 'DELETE', body)).status, 400);
    assert.deepEqual(store.list(), before);
    assert.equal((await request('/api/projects/not-a-uuid', 'DELETE', { confirmation: deleted.id })).status, 400);
    assert.equal((await request(`/api/projects/${randomUUID()}`, 'DELETE', { confirmation: deleted.id })).status, 400);
    const missing = randomUUID();
    assert.equal((await request(`/api/projects/${missing}`, 'DELETE', { confirmation: missing })).status, 404);
    assert.equal((await request(route, 'DELETE', { confirmation: deleted.id })).status, 200);
    assert.equal((await request(route, 'DELETE', { confirmation: deleted.id })).status, 404);
    // A previously opened editor must not silently reintroduce deleted memberships.
    assert.equal((await request(`/api/papers/${first.id}`, 'PATCH', { revision: before.find(p => p.id === first.id)!.revision, projectIds: [deleted.id] })).status, 409);
    store.close(); store = new Store(directory);
    app = createApp({ store, auth: { mode: 'development', host: '127.0.0.1' }, peerAddress: () => '127.0.0.1' });
    assert.deepEqual(store.labels('projects').map(label => ({ ...label })), [retained]);
    assert.deepEqual(store.labels('tags').map(label => ({ ...label })), [tag]);
    assert.equal(store.list().length, before.length);
    for (const previous of before) {
        const next = store.get(previous.id);
        assert.deepEqual({ ...next, revision: previous.revision, updated: previous.updated }, { ...previous, projectIds: previous.projectIds.filter(id => id !== deleted.id) });
        assert.equal(next.revision, previous.revision + (previous.projectIds.includes(deleted.id) ? 1 : 0));
    }
    assert.deepEqual(store.annotations(first.id), highlights);
    assert.deepEqual(readdirSync(store.files), files.map(([name]) => name));
    for (const [name, bytes] of files) assert.deepEqual(readFileSync(path.join(store.files, name)), bytes);
    assert.deepEqual((await (await request('/api/library?project=unassigned')).json()).papers.map((p: PaperDetail) => p.id), [second.id]);
    assert.equal((await (await request('/api/library?scope=archive&project=unassigned')).json()).papers[0].id, archived.id);
    assert.deepEqual(new Set((await (await request(`/api/library?project=${retained.id}`)).json()).papers.map((p: PaperDetail) => p.id)), new Set(before.filter(p => p.projectIds.includes(retained.id)).map(p => p.id)));
    assert.equal((await request(`/api/papers/${first.id}`, 'PATCH', { revision: store.get(first.id).revision, projectIds: [deleted.id] })).status, 400);
});

test('context tags reuse library labels, remove only per-paper chips and preserve changes after reopening', async () => {
    const first = await paper();
    const second = store.insert({ title: 'Another reference' }, []).paper;
    const tag = await addLabel('tags', '  evidence  ');
    assert.equal(tag.name, 'evidence');
    assert.deepEqual(await addLabel('tags', 'evidence'), tag);
    for (const name of ['', '   ', 'x'.repeat(101)]) assert.equal((await request('/api/tags', 'POST', { name })).status, 400);
    for (const p of [first, second]) assert.equal((await request(`/api/papers/${p.id}`, 'PATCH', { revision: p.revision, tagIds: [tag.id, tag.id] })).status, 200);
    const current = store.get(first.id);
    assert.equal((await request(`/api/papers/${first.id}`, 'PATCH', { revision: current.revision, tagIds: [randomUUID()] })).status, 400);
    assert.deepEqual(store.get(first.id), current);
    assert.equal((await request(`/api/papers/${first.id}`, 'PATCH', { revision: current.revision, tagIds: [] })).status, 200);
    assert.equal((await request(`/api/papers/${second.id}`, 'PATCH', { revision: second.revision, tagIds: [] })).status, 409);
    store.close(); store = new Store(directory);
    assert.deepEqual(store.get(first.id).tagIds, []);
    assert.deepEqual(store.get(second.id).tagIds, [tag.id]);
    assert.deepEqual(store.labels('tags').map(label => ({ ...label })), [tag]);
    const p = store.get(first.id);
    assert.deepEqual(store.patch(p.id, { revision: p.revision, tagIds: [tag.id] }).tagIds, [tag.id]);
    assert.equal(store.labels('tags').length, 1);
});

test('post-import multi-project reassignment is atomic, revision-aware and persists without duplicating files', async () => {
    const a = await addLabel('projects', 'Original');
    const b = await addLabel('projects', 'Second');
    const c = await addLabel('projects', 'Third');
    const original = (await (await upload(textPdf(), [a.id])).json()).paper;
    store.addAnnotation(original.id, { page: 1, quote: 'Preserve me', rects: [[.1, .1, .3, .2]], color: 'yellow', comment: 'Stable anchor' });
    let current = store.patch(original.id, { revision: original.revision, note: 'Stable note' });
    const changed = await request(`/api/papers/${current.id}`, 'PATCH', { revision: current.revision, projectIds: [b.id, c.id] });
    assert.equal(changed.status, 200); current = await changed.json();
    const before = store.get(current.id);
    assert.equal((await request(`/api/papers/${current.id}`, 'PATCH', { revision: current.revision, projectIds: [a.id], tagIds: [randomUUID()] })).status, 400);
    assert.deepEqual(store.get(current.id), before, 'invalid tag rolls back project changes too');
    assert.equal((await request(`/api/papers/${current.id}`, 'PATCH', { revision: current.revision - 1, projectIds: [] })).status, 409);
    assert.equal((await request(`/api/papers/${current.id}`, 'PATCH', { revision: current.revision, projectIds: [b.id, randomUUID()] })).status, 400);
    assert.deepEqual(store.get(current.id), before);
    store.close(); store = new Store(directory);
    current = store.get(current.id);
    assert.deepEqual(new Set(current.projectIds), new Set([b.id, c.id]));
    assert.equal(current.note, 'Stable note');
    assert.equal(current.pdfSha, original.pdfSha);
    assert.equal(store.annotations(current.id)[0].comment, 'Stable anchor');
    assert.equal(store.list().length, 1); assert.equal(readdirSync(store.files).length, 1);
    const unassigned = store.patch(current.id, { revision: current.revision, projectIds: [] });
    assert.deepEqual(unassigned.projectIds, []);
});

test('permanent paper deletion removes only its data and retains projects, tags and other paper data', async () => {
    const p = await paper();
    const project = await addLabel('projects', 'Retain project'), tag = await addLabel('tags', 'Retain tag');
    const other = store.insert({ title: 'Retain paper' }, [project.id], { bytes: textPdf('Retain paper'), pages: 3 }).paper;
    const preserved = store.patch(other.id, { revision: other.revision, note: 'Retain notes', tagIds: [tag.id] });
    store.addAnnotation(other.id, { page: 1, quote: 'Keep', rects: [[.1, .1, .3, .2]], color: 'blue', comment: 'Keep' });
    const archived = store.patch(p.id, { revision: p.revision, archived: true, projectIds: [project.id], tagIds: [tag.id], note: 'Remove notes' });
    store.addAnnotation(p.id, { page: 1, quote: 'Delete', rects: [[.1, .1, .3, .2]], color: 'yellow', comment: 'Delete' });
    assert.equal((await request(`/api/papers/${p.id}`, 'DELETE', { confirmation: p.id, revision: archived.revision })).status, 200);
    assert.deepEqual(store.get(other.id), preserved);
    assert.equal(store.annotations(other.id).length, 1);
    assert.deepEqual(store.annotations(p.id), []);
    assert.deepEqual(store.pdfBytes(preserved.pdfSha!), textPdf('Retain paper'));
    assert.deepEqual(store.labels('projects').map(label => ({ ...label })), [project]); assert.deepEqual(store.labels('tags').map(label => ({ ...label })), [tag]);
    assert.deepEqual(store.db.prepare('SELECT * FROM paper_projects WHERE paperId=?').all(p.id), []);
    assert.deepEqual(store.db.prepare('SELECT * FROM paper_tags WHERE paperId=?').all(p.id), []);
    assert.equal(readdirSync(store.files).length, 1);
});
