import { Sqlite } from './sqlite.js';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { HttpError } from './errors.js';
import { label, normalizeDoi, normalizeArxiv, type PaperPatch, type AnnotationInput } from './schema.js';
export type Paper = {
    id: string;
    title: string;
    authors: string[];
    doi: string | null;
    arxiv: string | null;
    arxivBase: string | null;
    year: string;
    venue: string;
    abstract: string;
    url: string;
    pdfSha: string | null;
    pageCount: number | null;
    status: 'Inbox' | 'Reading' | 'Finished';
    archived: boolean;
    note: string;
    position: {
        page: number;
        offset: number;
    };
    revision: number;
    created: string;
    updated: string;
    projectIds: string[];
    tagIds: string[];
};
export type Annotation = AnnotationInput & {
    id: string;
    paperId: string;
    revision: number;
    created: string;
};
export type Metadata = Partial<Pick<Paper, 'title' | 'authors' | 'doi' | 'arxiv' | 'year' | 'venue' | 'abstract' | 'url'>>;
export class Store {
    db: Sqlite;
    files: string;
    constructor(public directory: string) {
        mkdirSync(directory, { recursive: true });
        this.files = path.join(directory, 'pdfs');
        mkdirSync(this.files, { recursive: true });
        this.db = new Sqlite(path.join(directory, 'library.sqlite'));
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('busy_timeout = 5000');
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, authors TEXT NOT NULL, doi TEXT UNIQUE, arxiv TEXT UNIQUE, arxivBase TEXT,
        year TEXT NOT NULL, venue TEXT NOT NULL, abstract TEXT NOT NULL, url TEXT NOT NULL,
        pdfSha TEXT, pageCount INTEGER, status TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL, position TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS unique_pdf ON papers(pdfSha) WHERE pdfSha IS NOT NULL;
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS paper_projects (paperId TEXT REFERENCES papers(id) ON DELETE CASCADE, projectId TEXT REFERENCES projects(id) ON DELETE CASCADE, PRIMARY KEY(paperId,projectId));
      CREATE TABLE IF NOT EXISTS paper_tags (paperId TEXT REFERENCES papers(id) ON DELETE CASCADE, tagId TEXT REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(paperId,tagId));
      CREATE TABLE IF NOT EXISTS annotations (id TEXT PRIMARY KEY, paperId TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE, page INTEGER NOT NULL,
        quote TEXT NOT NULL, rects TEXT NOT NULL, color TEXT NOT NULL, comment TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
    }
    close() { this.db.close(); }
    labels(kind: 'projects' | 'tags') { return this.db.prepare(`SELECT * FROM ${kind} ORDER BY name COLLATE NOCASE`).all() as {
        id: string;
        name: string;
    }[]; }
    addLabel(kind: 'projects' | 'tags', name: string) {
        this.db.prepare(`INSERT OR IGNORE INTO ${kind} (id,name) VALUES (?,?)`).run(randomUUID(), name);
        return this.db.prepare(`SELECT * FROM ${kind} WHERE name=?`).get(name) as {
            id: string;
            name: string;
        };
    }
    renameProject(id: string, name: string, expectedName: string) {
        name = label.parse(name);
        expectedName = label.parse(expectedName);
        return this.db.transaction(() => {
            const current = this.db.prepare('SELECT id,name FROM projects WHERE id=?').get(id) as { id: string; name: string } | undefined;
            if (!current) throw new HttpError(404, 'Project not found.');
            if (current.name !== expectedName)
                throw new HttpError(409, 'This project was renamed elsewhere. Reload the latest project before saving.', { code: 'PROJECT_NAME_CONFLICT' });
            if (this.db.prepare('SELECT id FROM projects WHERE name=? AND id<>?').get(name, id))
                throw new HttpError(409, 'A project with this exact name already exists. Choose another name.');
            this.db.prepare('UPDATE projects SET name=? WHERE id=?').run(name, id);
            return { id, name };
        })();
    }
    removeProject(id: string) {
        return this.db.transaction(() => {
            if (!this.db.prepare('SELECT id FROM projects WHERE id=?').get(id))
                throw new HttpError(404, 'Project not found.');
            // Invalidate open editors before cascading only the membership rows.
            this.db.prepare('UPDATE papers SET revision=revision+1,updated=? WHERE id IN (SELECT paperId FROM paper_projects WHERE projectId=?)').run(new Date().toISOString(), id);
            this.db.prepare('DELETE FROM projects WHERE id=?').run(id);
        })();
    }
    get(id: string): Paper {
        const row = this.db.prepare('SELECT * FROM papers WHERE id=?').get(id) as Record<string, unknown> | undefined;
        if (!row)
            throw new HttpError(404, 'Paper not found.');
        return { ...row, authors: JSON.parse(row.authors as string), position: JSON.parse(row.position as string), archived: !!row.archived,
            projectIds: (this.db.prepare('SELECT projectId AS id FROM paper_projects WHERE paperId=?').all(id) as {
                id: string;
            }[]).map(x => x.id),
            tagIds: (this.db.prepare('SELECT tagId AS id FROM paper_tags WHERE paperId=?').all(id) as {
                id: string;
            }[]).map(x => x.id),
        } as Paper;
    }
    list() { return (this.db.prepare('SELECT id FROM papers ORDER BY updated DESC,id').all() as {
        id: string;
    }[]).map(r => this.get(r.id)); }
    annotations(id: string): Annotation[] {
        return (this.db.prepare('SELECT * FROM annotations WHERE paperId=? ORDER BY page,created,id').all(id) as (Omit<Annotation, 'rects'> & {
            rects: string;
        })[]).map(a => ({ ...a, rects: JSON.parse(a.rects) }));
    }
    setLinks(id: string, kind: 'projects' | 'tags', values: string[]) {
        const column = kind === 'projects' ? 'projectId' : 'tagId';
        for (const value of values)
            if (!this.db.prepare(`SELECT id FROM ${kind} WHERE id=?`).get(value))
                throw new HttpError(400, `Unknown ${kind} assignment.`);
        this.db.prepare(`DELETE FROM paper_${kind} WHERE paperId=?`).run(id);
        const insert = this.db.prepare(`INSERT OR IGNORE INTO paper_${kind} (paperId,${column}) VALUES (?,?)`);
        for (const value of values)
            insert.run(id, value);
    }
    assign(id: string, projectIds: string[]) {
        const p = this.get(id);
        if (!projectIds.length)
            return p;
        return this.patch(id, { revision: p.revision, projectIds: [...new Set([...p.projectIds, ...projectIds])] });
    }
    duplicate(meta: Metadata, sha?: string): Paper | undefined {
        let found: {
            id: string;
        } | undefined;
        if (sha)
            found = this.db.prepare('SELECT id FROM papers WHERE pdfSha=?').get(sha) as {
                id: string;
            } | undefined;
        if (!found && meta.doi)
            found = this.db.prepare('SELECT id FROM papers WHERE doi=?').get(meta.doi) as {
                id: string;
            } | undefined;
        if (!found && meta.arxiv) {
            found = (/v\d+$/.test(meta.arxiv)
                ? this.db.prepare('SELECT id FROM papers WHERE arxiv=?').get(meta.arxiv)
                : this.db.prepare('SELECT id FROM papers WHERE arxivBase=? ORDER BY created DESC LIMIT 1').get(meta.arxiv)) as {
                id: string;
            } | undefined;
        }
        return found ? this.get(found.id) : undefined;
    }
    insert(meta: Metadata, projectIds: string[], pdf?: {
        bytes: Buffer;
        pages: number;
    }) {
        return this.db.transaction(() => {
            for (const projectId of projectIds)
                if (!this.db.prepare('SELECT id FROM projects WHERE id=?').get(projectId))
                    throw new HttpError(400, 'Unknown project assignment.');
            const sha = pdf ? createHash('sha256').update(pdf.bytes).digest('hex') : undefined;
            const existing = this.duplicate(meta, sha);
            if (existing)
                return { paper: this.assign(existing.id, projectIds), duplicate: true };
            const now = new Date().toISOString();
            const id = randomUUID();
            if (pdf && sha)
                this.writePdf(sha, pdf.bytes);
            this.db.prepare(`INSERT INTO papers (id,title,authors,doi,arxiv,arxivBase,year,venue,abstract,url,pdfSha,pageCount,status,archived,note,position,revision,created,updated)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, meta.title || 'Untitled paper', JSON.stringify(meta.authors || []), meta.doi || null, meta.arxiv || null, meta.arxiv?.replace(/v\d+$/, '') || null, meta.year || '', meta.venue || '', meta.abstract || '', meta.url || '', sha || null, pdf?.pages || null, 'Inbox', 0, '', JSON.stringify({ page: 1, offset: 0 }), 0, now, now);
            this.setLinks(id, 'projects', projectIds);
            return { paper: this.get(id), duplicate: false };
        })();
    }
    patch(id: string, patch: PaperPatch): Paper {
        return this.db.transaction(() => {
            const paper = this.get(id);
            if (paper.revision !== patch.revision)
                throw new HttpError(409, 'This paper changed on another device. Reload the latest version before saving again.', { current: paper });
            const { revision: _revision, projectIds, tagIds, ...fields } = patch;
            if (fields.doi)
                fields.doi = normalizeDoi(fields.doi);
            const extra: Record<string, unknown> = {};
            if (fields.arxiv !== undefined) {
                if (fields.arxiv) {
                    const identity = normalizeArxiv(fields.arxiv);
                    if (!identity)
                        throw new HttpError(400, 'Enter a valid arXiv identity.');
                    fields.arxiv = identity;
                    extra.arxivBase = identity.replace(/v\d+$/, '');
                }
                else
                    extra.arxivBase = null;
            }
            if (fields.position && paper.pageCount && fields.position.page > paper.pageCount)
                throw new HttpError(400, 'Position exceeds PDF page count.');
            if (projectIds)
                this.setLinks(id, 'projects', projectIds);
            if (tagIds)
                this.setLinks(id, 'tags', tagIds);
            const entries = Object.entries({ ...fields, ...extra }).map(([k, v]) => [k, k === 'authors' || k === 'position' ? JSON.stringify(v) : k === 'archived' ? Number(v) : v]);
            const assignments = entries.map(([k]) => `${k}=?`);
            this.db.prepare(`UPDATE papers SET ${assignments.length ? assignments.join(',') + ',' : ''} revision=revision+1,updated=? WHERE id=?`).run(...entries.map(([, v]) => v), new Date().toISOString(), id);
            return this.get(id);
        })();
    }
    writePdf(sha: string, bytes: Buffer) { const target = this.pdfPath(sha); if (!existsSync(target))
        writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 }); }
    pdfPath(sha: string) { if (!/^[a-f0-9]{64}$/.test(sha))
        throw new HttpError(400, 'Invalid PDF checksum.'); return path.join(this.files, `${sha}.pdf`); }
    pdfBytes(sha: string) { return readFileSync(this.pdfPath(sha)); }
    attach(id: string, revision: number, bytes: Buffer, pages: number) {
        return this.db.transaction(() => {
            const paper = this.get(id);
            if (paper.revision !== revision)
                throw new HttpError(409, 'Paper changed. Reload before attaching a PDF.');
            if (paper.pdfSha)
                throw new HttpError(409, 'This paper already has a PDF. Import a new arXiv version as a separate paper to preserve anchors.');
            const sha = createHash('sha256').update(bytes).digest('hex');
            const dupe = this.duplicate({}, sha);
            if (dupe && dupe.id !== id)
                throw new HttpError(409, `This PDF already belongs to “${dupe.title}”. Open that paper in your library to add project assignments. This reference has been kept.`, { existingPaperId: dupe.id });
            this.writePdf(sha, bytes);
            this.db.prepare('UPDATE papers SET pdfSha=?,pageCount=?,revision=revision+1,updated=? WHERE id=?').run(sha, pages, new Date().toISOString(), id);
            return this.get(id);
        })();
    }
    addAnnotation(id: string, input: AnnotationInput) {
        const p = this.get(id);
        if (!p.pdfSha || !p.pageCount || input.page > p.pageCount)
            throw new HttpError(400, 'Annotation requires a valid PDF page.');
        const annotationId = randomUUID();
        this.db.prepare('INSERT INTO annotations (id,paperId,page,quote,rects,color,comment,revision,created) VALUES (?,?,?,?,?,?,?,?,?)').run(annotationId, id, input.page, input.quote, JSON.stringify(input.rects), input.color, input.comment, 0, new Date().toISOString());
        return this.annotations(id).find(a => a.id === annotationId)!;
    }
    changeAnnotation(paperId: string, id: string, revision: number, fields: {
        color?: string;
        comment?: string;
    }, remove = false) {
        const a = this.annotations(paperId).find(a => a.id === id);
        if (!a)
            throw new HttpError(404, 'Highlight not found.');
        if (a.revision !== revision)
            throw new HttpError(409, 'This highlight changed on another device. Reload to edit it.');
        if (remove)
            this.db.prepare('DELETE FROM annotations WHERE id=?').run(id);
        else
            this.db.prepare('UPDATE annotations SET color=?,comment=?,revision=revision+1 WHERE id=?').run(fields.color ?? a.color, fields.comment ?? a.comment, id);
        return this.annotations(paperId).find(a => a.id === id);
    }
    remove(id: string, revision: number) {
        const p = this.get(id);
        if (!p.archived)
            throw new HttpError(400, 'Archive the paper before permanently deleting it.');
        if (p.revision !== revision)
            throw new HttpError(409, 'Paper changed. Reload before deleting.');
        this.db.prepare('DELETE FROM papers WHERE id=?').run(id);
        if (p.pdfSha)
            try {
                unlinkSync(this.pdfPath(p.pdfSha));
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
            }
    }
}
