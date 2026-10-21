import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { api, patch, type Library, type PaperDetail, type Label, type SavePaper } from './api';
import type { PaperPatch } from '../server/schema';
import type { Annotation } from '../server/store';
import { Reader } from './reader';
import { LibraryPaperControls, PaperActions, PaperLabels, PdfFilenameEditor, deletePaper } from './paper-management';
import { ProjectMenu, RenameProjectDialog, projectActionsId } from './project-management';
import { importLibraryNotice, importLibraryView, type ImportResult } from './library-import';
import './style.css';
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
function App() {
    const [library, setLibrary] = useState<Library>({ papers: [], projects: [], tags: [], total: 0 });
    const [project, setProject] = useState('');
    const [tag, setTag] = useState('');
    const [scope, setScope] = useState('active');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [paper, setPaper] = useState<PaperDetail | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [menu, setMenu] = useState(false);
    const [renaming, setRenaming] = useState<Label | null>(null);
    const [selected, setSelected] = useState<string[]>([]);
    const [dev, setDev] = useState(false);
    const [ready, setReady] = useState(false);
    const [revealed, setRevealed] = useState('');
    const pendingReveal = useRef<string | null>(null);
    const libraryRequest = useRef(0);
    const filters = useRef({ project, tag, scope, search, status });
    filters.current = { project, tag, scope, search, status };
    const refresh = useCallback(async () => {
        const request = ++libraryRequest.current;
        const { project, tag, scope, search, status } = filters.current;
        const q = new URLSearchParams({ project, tag, scope, search, status });
        try {
            const next = await api<Library>(`/api/library?${q}`);
            if (request !== libraryRequest.current) return;
            setLibrary(next);
            if (project && project !== 'unassigned' && !next.projects.some(p => p.id === project)) setProject('');
            if (tag && !next.tags.some(t => t.id === tag)) setTag('');
            setReady(true);
        }
        catch (e) {
            if (request === libraryRequest.current) setError(message(e));
        }
    }, []);
    useEffect(() => { void refresh(); }, [refresh, project, tag, scope, search, status]);
    useEffect(() => {
        if (importOpen || pendingReveal.current !== revealed) return;
        const row = document.getElementById(`paper-row-${revealed}`);
        if (!row) return;
        pendingReveal.current = null;
        row.focus({ preventScroll: true });
        row.scrollIntoView({ block: 'center' });
    }, [library.papers, importOpen, revealed]);
    const imported = (result: ImportResult, requestedProjects: string[]) => {
        const view = importLibraryView(result.paper, requestedProjects, project);
        // Invalidate older filter responses before revealing confirmed import data.
        libraryRequest.current++;
        filters.current = view;
        setProject(view.project); setScope(view.scope); setSearch(''); setTag(''); setStatus('');
        setSelected([]); setError(''); setMenu(false); setImportOpen(false);
        setNotice(importLibraryNotice(result));
        setLibrary(current => ({ ...current, papers: [result.paper], total: current.total + (!result.duplicate && !result.paper.archived ? 1 : 0) }));
        setRevealed(result.paper.id); pendingReveal.current = result.paper.id;
        void refresh();
    };
    useEffect(() => { api<{
        authMode: string;
    }>('/api/config').then(c => setDev(c.authMode === 'development')).catch(() => { }); }, []);
    const open = async (id: string) => { setError(''); try {
        setPaper(await api<PaperDetail>(`/api/papers/${id}`));
        window.history.replaceState(null, '', `#paper=${id}`);
    }
    catch (e) {
        setError(message(e));
    } };
    useEffect(() => { const id = new URLSearchParams(location.hash.slice(1)).get('paper'); if (id)
        void open(id); }, []);
    const addProject = async () => { const name = window.prompt('New project name'); if (!name?.trim())
        return; try {
        await api('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
        await refresh();
    }
    catch (e) {
        setError(message(e));
    } };
    const removeProject = async (label: Label) => {
        if (!confirm(`Delete project “${label.name}”? This removes only the project and its assignments. All papers, original PDFs, notes, highlights and reading positions are kept. Papers with no remaining projects appear in Unassigned.`)) return;
        setBusy(true); setError('');
        try {
            await api(`/api/projects/${label.id}`, { method: 'DELETE', body: JSON.stringify({ confirmation: label.id }) });
            setNotice(`Project “${label.name}” deleted. All paper data was kept.`);
            document.getElementById('all-papers-navigation')?.focus();
            await refresh();
        } catch (error) { setError(message(error)); await refresh(); } finally {
            setBusy(false);
            requestAnimationFrame(() => document.getElementById(projectActionsId(label.id))?.focus());
        }
    };
    const renamedProject = (label: Label) => {
        // Discard older library responses so they cannot restore an obsolete name.
        libraryRequest.current++;
        setLibrary(current => ({ ...current, projects: current.projects.map(p => p.id === label.id ? label : p) }));
        void refresh();
    };
    const exportHref = (format: string) => `/api/export?${new URLSearchParams({ format, ...(selected.length ? { ids: selected.join(',') } : project && project !== 'unassigned' ? { project } : {}) })}`;
    const restoreFile = async (file: File) => {
        if (!confirm('Restore into this empty library? Existing libraries are never overwritten. The backup must come from a trusted source.'))
            return;
        setBusy(true);
        setError('');
        try {
            const result = await api<{
                papers: number;
                files: number;
            }>('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Restore-Confirmation': 'RESTORE EMPTY LIBRARY' }, body: file });
            setNotice(`Restored ${result.papers} papers and ${result.files} original PDFs.`);
            await refresh();
        }
        catch (e) {
            setError(message(e));
        }
        finally {
            setBusy(false);
        }
    };
    if (paper)
        return <PaperWorkspace key={paper.id} initial={paper} initialNotice={notice} labels={library} onClose={() => { setPaper(null); window.history.replaceState(null, '', location.pathname); void refresh(); }} onLabels={refresh}/>;
    return <div className="shell">
    <aside id="library-sidebar" className={`sidebar ${menu ? 'is-open' : ''}`} onKeyDown={event => { if (event.key === 'Escape' && menu) { event.preventDefault(); setMenu(false); document.getElementById('navigation-toggle')?.focus(); } }}>
      <button className="mobile-nav-close" aria-label="Close navigation" onClick={() => { setMenu(false); document.getElementById('navigation-toggle')?.focus(); }}>×</button>
      <a className="brand" href="/" aria-label="Papertrail home"><span className="brand-mark">P<span>↗</span></span>papertrail<span className="brand-dot">.</span></a>
      <p className="eyebrow">YOUR PERSONAL ARCHIVE</p>
      <nav aria-label="Library navigation">
        <button id="all-papers-navigation" className={!project && scope === 'active' ? 'nav active' : 'nav'} onClick={() => { setProject(''); setScope('active'); setMenu(false); }}>▤ <span>All papers</span><small>{library.total}</small></button>
        <button className={project === 'unassigned' ? 'nav active' : 'nav'} onClick={() => { setProject('unassigned'); setScope('active'); setMenu(false); }}>⌑ <span>Unassigned</span></button>
        <button className={scope === 'archive' ? 'nav active' : 'nav'} onClick={() => { setScope('archive'); setProject(''); setMenu(false); }}>▧ <span>Archive</span></button>
      </nav>
      <div className="section-label"><span>PROJECTS</span><button aria-label="New project" onClick={() => void addProject()}>+</button></div>
      <nav aria-label="Projects">{library.projects.map(p => <div className="project-navigation" key={p.id}><button key={p.id} className={project === p.id ? 'nav active' : 'nav'} onClick={() => { setProject(p.id); setScope('active'); setMenu(false); }}><span className="project-dot"/><span>{p.name}</span></button><ProjectMenu project={p} disabled={busy} onRename={() => setRenaming(p)} onDelete={() => void removeProject(p)}/></div>)}</nav>
      {!library.projects.length && <p className="side-hint">Make room for a new line of thought. Create your first project.</p>}
      <div className="section-label"><span>FILTER BY TAG</span></div>
      {!library.tags.length && <p className="side-hint">Set tags with Organize paper on any paper.</p>}
      <div className="tag-cloud">{library.tags.map(t => <button key={t.id} className={tag === t.id ? 'chip selected' : 'chip'} onClick={() => setTag(tag === t.id ? '' : t.id)}># {t.name}</button>)}</div>
      <div className="sidebar-bottom"><span className="online-dot"/> {dev ? 'Local development' : 'Private library'}<p>Online-first · Saved on your server</p><a href="/api/backup">Download backup</a><label className="text-link">Restore backup<input aria-label="Restore backup" type="file" accept=".json" hidden disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f)
        void restoreFile(f); e.target.value = ''; }}/></label></div>
    </aside>
    <main className="library-main">
      <header className="topbar"><div className="topbar-left"><button id="navigation-toggle" className="mobile-menu" onClick={() => setMenu(!menu)} aria-label="Toggle navigation" aria-expanded={menu} aria-controls="library-sidebar">☰</button><span>Library <span className="slash">/</span> {scope === 'archive' ? 'Archive' : project === 'unassigned' ? 'Unassigned' : library.projects.find(p => p.id === project)?.name || 'All papers'}</span></div><span className="quiet">A little more understanding, every day.</span></header>
      <div className="content">
        <div className="page-heading"><div><p className="eyebrow">COLLECT. CONNECT. UNDERSTAND.</p><h1>{scope === 'archive' ? 'Your archive' : project === 'unassigned' ? 'Unassigned papers' : library.projects.find(p => p.id === project)?.name || 'Your library'}</h1><p className="subtitle">Good ideas deserve a place to stay.</p></div><button className="primary" onClick={() => setImportOpen(true)}>＋ Add paper</button></div>
        {error && <div className="alert" role="alert">{error}<button onClick={() => { setError(''); void refresh(); }}>Retry</button></div>}{notice && <div className="notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}
        <div className="filterbar"><label className="search-box"><span>⌕</span><input aria-label="Search library" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search papers, notes, and ideas…"/></label><select aria-label="Filter by tag" value={tag} onChange={e => setTag(e.target.value)}><option value="">All tags</option>{library.tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><select aria-label="Filter by reading state" value={status} onChange={e => setStatus(e.target.value)}><option value="">All reading states</option>{['Inbox', 'Reading', 'Finished'].map(s => <option key={s}>{s}</option>)}</select></div>
        <div className="list-caption"><span>{library.papers.length} {library.papers.length === 1 ? 'paper' : 'papers'}{selected.length ? ` · ${selected.length} selected` : ''}</span><div className="export-actions"><span>Export {selected.length ? 'selection' : project && project !== 'unassigned' ? 'project' : 'library'}</span><a href={exportHref('bibtex')}>BibTeX ↗</a><a href={exportHref('markdown')}>Markdown ↗</a></div></div>
        <div className="paper-list">{library.papers.map(p => <article id={`paper-row-${p.id}`} data-paper-id={p.id} className={`paper-row${revealed === p.id ? ' revealed' : ''}`} tabIndex={-1} aria-current={revealed === p.id ? 'true' : undefined} aria-label={`Paper: ${p.title}`} key={p.id} onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); void open(p.id); } }}><div className="paper-row-summary">
          <input aria-label={`Select ${p.title}`} type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))}/>
          <button className="paper-open" onClick={() => void open(p.id)}><span className="paper-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 3H6v18h12V7l-4-4Z M14 3v5h4 M9 12h6 M9 16h6"/></svg></span><span className="paper-info"><span className="paper-title">{p.title}</span><span className="paper-file-status">{p.pdfSha ? 'PDF available' : 'Reference only'}</span>{p.pdfSha && <span className="paper-filename">{p.pdfFilename}</span>}<span className="paper-authors">{p.authors.join(', ') || 'Author not yet added'}{p.year ? ` · ${p.year}` : ''}</span><span className="paper-meta">{p.venue || p.arxiv || p.doi || (p.pdfSha ? 'Local PDF' : 'No PDF attached')}{p.arxiv ? ` · ${p.arxiv}` : ''}</span><span className="row-tags">{library.projects.filter(l => p.projectIds.includes(l.id)).map(l => <span key={l.id} className="project-label">{l.name}</span>)}{library.tags.filter(l => p.tagIds.includes(l.id)).map(l => <span key={l.id} className="tag-label"># {l.name}</span>)}</span></span></button><span className={`state-badge ${p.status.toLowerCase()}`}>{p.status}</span><span className="row-arrow">↗</span></div>
          <LibraryPaperControls initial={{ ...p, annotations: [], noteHtml: '' }} labels={library} onChanged={refresh} onDeleted={() => setSelected(current => current.filter(id => id !== p.id))}/>
        </article>)}</div>
        {!library.papers.length && ready && <div className="empty"><span className="empty-icon">▤</span><h2>{search || tag || status ? 'No papers found' : 'A home for your next discovery.'}</h2><p>{search || tag || status ? 'Try another search or clear your filters.' : 'Add a PDF, an arXiv paper, or a DOI. Your notes and connections will grow from here.'}</p><button onClick={() => setImportOpen(true)} className="primary">＋ Add your first paper</button></div>}
        <footer className="library-footer"><span>Built for a slower, deeper kind of reading.</span><span>PAPERTRAIL / PERSONAL ARCHIVE</span></footer>
      </div>
    </main>
    {renaming && <RenameProjectDialog project={renaming} onClose={() => setRenaming(null)} onRenamed={renamedProject}/>}
    {importOpen && <ImportDialog projects={library.projects} project={project} onClose={() => setImportOpen(false)} onImported={imported}/>}
  </div>;
}
function ImportDialog({ projects, project, onClose, onImported }: {
    projects: Label[];
    project: string;
    onClose: () => void;
    onImported: (result: ImportResult, requestedProjects: string[]) => void;
}) {
    const [reference, setReference] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [projectIds, setProjectIds] = useState(projects.some(p => p.id === project) ? [project] : []);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const submit = async () => {
        setBusy(true);
        setError('');
        try {
            const result = await api<ImportResult>(file ? `/api/upload?projects=${projectIds.join(',')}` : '/api/import', file ? { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Filename': encodeURIComponent(file.name) }, body: file } : { method: 'POST', body: JSON.stringify({ reference, projectIds }) });
            onImported(result, projectIds);
        }
        catch (e) {
            setError(message(e));
        }
        finally {
            setBusy(false);
        }
    };
    return <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="import-title" className="modal"><button className="close-button" aria-label="Close import" disabled={busy} onClick={onClose}>×</button><p className="eyebrow">GROW YOUR LIBRARY</p><h2 id="import-title">Add a paper</h2><label className="dropzone"><span>↑</span><strong>{file ? file.name : 'Choose a PDF'}</strong><small>Original bytes preserved · Up to 40 MiB</small><input aria-label="Upload PDF" type="file" accept="application/pdf,.pdf" onChange={e => { setFile(e.target.files?.[0] || null); setReference(''); }}/></label><div className="or-divider">or import a reference</div><label>arXiv ID, DOI, or provider URL<input value={reference} onChange={e => { setReference(e.target.value); setFile(null); }} placeholder="2401.12345v2 or 10.1000/example"/></label><p className="hint">A reference stays useful even without a PDF. DOI import does not bypass publisher restrictions. A different arXiv version gets its own paper and highlights.</p><fieldset><legend>Add to projects <span className="quiet">(optional)</span></legend>{projects.map(p => <label className="check-label" key={p.id}><input type="checkbox" checked={projectIds.includes(p.id)} onChange={e => setProjectIds(e.target.checked ? [...projectIds, p.id] : projectIds.filter(id => id !== p.id))}/>{p.name}</label>)}{!projects.length && <p className="hint">You can assign projects after importing.</p>}</fieldset>{error && <p className="alert" role="alert">{error}</p>}<button className="primary wide" disabled={busy || (!file && !reference.trim())} onClick={() => void submit()}>{busy ? 'Importing…' : 'Add to library'}</button></section></div>;
}
function PaperWorkspace({ initial, initialNotice, labels, onClose, onLabels }: {
    initial: PaperDetail;
    initialNotice: string;
    labels: Library;
    onClose: () => void;
    onLabels: () => Promise<void>;
}) {
    const [paper, setPaper] = useState(initial);
    const current = useRef(paper);
    const [saveState, setSaveState] = useState('Saved');
    const [error, setError] = useState('');
    const [panel, setPanel] = useState(() => !window.matchMedia('(max-width: 900px)').matches);
    useEffect(() => {
        const narrow = window.matchMedia('(max-width: 900px)');
        const resize = () => { if (narrow.matches) setPanel(false); };
        narrow.addEventListener('change', resize);
        return () => narrow.removeEventListener('change', resize);
    }, []);
    const closePanel = useCallback(() => { setPanel(false); document.getElementById('paper-panel-toggle')?.focus(); }, []);
    useEffect(() => {
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && panel) closePanel(); };
        window.addEventListener('keydown', escape);
        return () => window.removeEventListener('keydown', escape);
    }, [panel, closePanel]);
    const [tab, setTab] = useState('notes');
    const [conflict, setConflict] = useState(false);
    const [editorEpoch, setEditorEpoch] = useState(0);
    const queue = useRef(Promise.resolve());
    const failed = useRef(false);
    const pending = useRef(0);
    const [jump, setJump] = useState<{
        page: number;
        offset: number;
        token: number;
    } | null>(null);
    const [activeHighlight, setActiveHighlight] = useState<string | null>(null);
    const [draftNote, setDraftNote] = useState(paper.note);
    const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const noteDirty = useRef(false);
    const noteGeneration = useRef(0);
    const update = (p: PaperDetail) => { current.current = p; setPaper(p); };
    const save: SavePaper = useCallback(changes => {
        pending.current++;
        setSaveState('Saving…');
        const task = queue.current.then(async () => {
            if (failed.current)
                throw new Error('Saving is paused. Reload the latest paper before trying again. Copy any unsaved text first.');
            try {
                const fields = typeof changes === 'function' ? changes(current.current) : changes;
                const next = await api<PaperDetail>(`/api/papers/${initial.id}`, patch({ revision: current.current.revision, ...fields }));
                update(next);
                setError('');
            }
            catch (e) {
                failed.current = true;
                setConflict(true);
                setError(message(e));
                throw e;
            }
        });
        queue.current = task.catch(() => { });
        return task.finally(() => { pending.current--; setSaveState(failed.current ? 'Save error' : pending.current ? 'Saving…' : 'Saved'); });
    }, [initial.id]);
    const safeSave = (fields: Omit<PaperPatch, 'revision'>) => { void save(fields).catch(() => { }); };
    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => { if (noteDirty.current || pending.current || failed.current) {
            event.preventDefault();
            event.returnValue = '';
        } };
        window.addEventListener('beforeunload', warn);
        return () => { window.removeEventListener('beforeunload', warn); if (noteTimer.current)
            clearTimeout(noteTimer.current); };
    }, []);
    const saveNote = async () => { if (noteTimer.current)
        clearTimeout(noteTimer.current); const generation = noteGeneration.current; try {
        await save({ note: draftNote });
        if (generation === noteGeneration.current)
            noteDirty.current = false;
    }
    catch { } };
    const noteChange = (value: string) => { setDraftNote(value); noteDirty.current = true; setSaveState(failed.current ? 'Save error' : 'Unsaved…'); const generation = ++noteGeneration.current; if (noteTimer.current)
        clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => { void save({ note: value }).then(() => { if (generation === noteGeneration.current) {
        noteDirty.current = false;
        if (!pending.current && !failed.current)
            setSaveState('Saved');
    } }).catch(() => { }); }, 650); };
    const back = async () => { if (noteDirty.current)
        await saveNote(); await queue.current; if (failed.current && !confirm('Some changes are unsaved. Leave this paper? Copy your unsaved note first.'))
        return; onClose(); };
    const reload = async () => { if (!confirm('Load the latest server version? Copy unsaved notes or comments first; reloading discards local edits.'))
        return; if (noteTimer.current)
        clearTimeout(noteTimer.current); noteGeneration.current++; try {
        await queue.current;
        const latest = await api<PaperDetail>(`/api/papers/${paper.id}`);
        update(latest);
        setDraftNote(latest.note);
        setEditorEpoch(n => n + 1);
        failed.current = false;
        noteDirty.current = false;
        setConflict(false);
        setError('');
        setSaveState('Saved');
    }
    catch (e) {
        setError(message(e));
    } };
    const attach = async (file: File) => { setSaveState('Saving…'); try {
        await queue.current;
        update(await api<PaperDetail>(`/api/papers/${paper.id}/pdf?revision=${current.current.revision}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file }));
        setSaveState('Saved');
    }
    catch (e) {
        setSaveState('Save error');
        setError(message(e));
    } };
    const annotationChange = async (action: () => Promise<unknown>) => { setSaveState('Saving…'); try {
        await action();
        const latest = await api<PaperDetail>(`/api/papers/${paper.id}`);
        update({ ...current.current, annotations: latest.annotations });
        setSaveState(failed.current ? 'Save error' : 'Saved');
        setError('');
    }
    catch (e) {
        setSaveState('Save error');
        setError(message(e));
        throw e;
    } };
    const navigate = (a: Annotation, fromList = false) => { setJump({ page: a.page, offset: Math.max(0, Math.min(...a.rects.map(r => r[1])) - .08), token: Date.now() }); setActiveHighlight(a.id); setPanel(!(fromList && window.matchMedia('(max-width: 900px)').matches)); setTab('highlights'); };
    return <div className="workspace"><header className="reader-header"><button onClick={() => void back()} aria-label="Back to library">← Library</button><div className="reader-heading"><strong>{paper.title}</strong><span>{paper.authors.join(', ') || 'Personal archive'}</span></div><span className={`save-state ${saveState === 'Save error' ? 'error' : ''}`} role="status">{saveState === 'Saved' ? '✓ ' : ''}{saveState}</span><button aria-controls="paper-panel" aria-expanded={panel && tab === 'details'} onClick={() => { setPanel(true); setTab('details'); }}>Organize paper</button><button id="paper-panel-toggle" onClick={() => setPanel(!panel)} aria-label="Toggle paper panel" aria-expanded={panel} aria-controls="paper-panel">{panel ? 'Close notes' : 'Notes'}</button></header>
    {error && <div className="workspace-alert alert" role="alert">{error}{conflict && <button onClick={() => void reload()}>Reload latest</button>}</div>}{initialNotice && <div className="workspace-notice notice" role="status">{initialNotice}</div>}
    <div className="workspace-body"><main className="reader-main">{paper.pdfSha ? <Reader paper={paper} jump={jump} onPosition={(position) => { if (!failed.current)
        safeSave({ position }); }} onHighlight={input => annotationChange(() => api(`/api/papers/${paper.id}/annotations`, { method: 'POST', body: JSON.stringify(input) }))} onSelectHighlight={a => navigate(a)}/> : <div className="reference-empty"><span className="empty-icon">↗</span><p className="eyebrow">A REFERENCE WORTH KEEPING</p><h1>{paper.title}</h1><p>{paper.abstract || 'This reference is in your library. Attach a PDF to start reading and highlighting.'}</p><label className="primary file-button">Attach PDF<input type="file" accept="application/pdf,.pdf" aria-label="Attach PDF" onChange={e => { const f = e.target.files?.[0]; if (f)
        void attach(f); }} hidden/></label><p className="hint">Use a PDF you have permission to access. Up to 40 MiB.</p>{paper.url && <a href={paper.url} target="_blank" rel="noreferrer">Open reference ↗</a>}</div>}</main>
    {panel && <aside className="paper-panel" id="paper-panel" aria-label="Paper notes and details"><div className="panel-tabs">{['notes', 'highlights', 'details'].map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t === 'highlights' ? `Highlights (${paper.annotations.length})` : t[0].toUpperCase() + t.slice(1)}</button>)}<button className="panel-close" aria-label="Close paper panel" onClick={closePanel}>× Close</button></div>
      <div className="panel-content" key={editorEpoch}>{tab === 'notes' && <><div className="section-label"><span>YOUR THINKING SPACE</span><span>Markdown</span></div><textarea className="note-editor" aria-label="General note" placeholder="What stands out? Connect the dots here…" value={draftNote} onChange={e => noteChange(e.target.value)} onBlur={() => { if (noteDirty.current)
            void saveNote(); }}/><div className="note-actions"><span className="hint">Saves automatically while online</span><button onClick={() => void saveNote()} disabled={failed.current}>Save note</button></div><details className="note-preview"><summary>Preview saved note</summary><div className="markdown" dangerouslySetInnerHTML={{ __html: paper.noteHtml }}/></details><div className="note-tip"><span>✳</span><p>Read with a question in mind.<br />Select a passage in the PDF to keep it with a highlight and a thought.</p></div></>}
      {tab === 'highlights' && <><p className="hint">Select a highlight or a passage below to edit it. Page numbers refer to PDF pages.</p>{!paper.annotations.length && <p className="panel-empty">The passages you keep will appear here.</p>}{paper.annotations.map(a => <HighlightEditor key={`${a.id}:${a.revision}`} annotation={a} active={activeHighlight === a.id} onNavigate={() => navigate(a, true)} onSave={fields => annotationChange(() => api(`/api/papers/${paper.id}/annotations/${a.id}`, patch({ revision: a.revision, ...fields })))} onDelete={() => annotationChange(() => api(`/api/papers/${paper.id}/annotations/${a.id}`, { method: 'DELETE', body: JSON.stringify({ revision: a.revision }) }))}/>)}</>}
      {tab === 'details' && <Details paper={paper} labels={labels} onSave={save} onLabels={onLabels} onDelete={async () => {
          if (noteDirty.current) await saveNote();
          await queue.current;
          if (failed.current) throw new Error('Reload the latest paper before deleting.');
          try { await deletePaper(current.current); onClose(); }
          catch (error) { failed.current = true; setConflict(true); setSaveState('Save error'); throw error; }
      }} onError={setError} disabled={conflict}/>}
      </div>
    </aside>}</div></div>;
}
function HighlightEditor({ annotation: a, active, onNavigate, onSave, onDelete }: {
    annotation: Annotation;
    active: boolean;
    onNavigate: () => void;
    onSave: (fields: {
        color: string;
        comment: string;
    }) => Promise<void>;
    onDelete: () => Promise<void>;
}) {
    const [comment, setComment] = useState(a.comment);
    const [color, setColor] = useState(a.color);
    const [error, setError] = useState('');
    return <article className={`highlight-card ${active ? 'active' : ''}`} style={{ borderLeftColor: `var(--highlight-${color})` }}><button className="passage" onClick={onNavigate}><small>PDF PAGE {a.page} ↗</small><blockquote>{a.quote}</blockquote></button><label>Comment<textarea aria-label={`Highlight comment page ${a.page}`} value={comment} onChange={e => setComment(e.target.value)}/></label><div className="highlight-actions"><select aria-label="Highlight color" value={color} onChange={e => setColor(e.target.value as typeof color)}>{['yellow', 'green', 'blue', 'pink'].map(c => <option key={c}>{c}</option>)}</select><button onClick={() => void onSave({ color, comment }).catch(e => setError(message(e)))}>Save highlight</button><button aria-label="Delete highlight" onClick={() => { if (confirm('Delete this highlight and comment?'))
        void onDelete().catch(e => setError(message(e))); }}>×</button></div>{error && <p className="alert">{error}</p>}</article>;
}
function Details({ paper, labels, onSave, onLabels, onDelete, onError, disabled }: {
    paper: PaperDetail;
    labels: Library;
    onSave: SavePaper;
    onLabels: () => Promise<void>;
    onDelete: () => Promise<void>;
    disabled: boolean;
    onError: (s: string) => void;
}) {
    const [draft, setDraft] = useState({ title: paper.title, authors: paper.authors.join('; '), doi: paper.doi || '', arxiv: paper.arxiv || '', year: paper.year, venue: paper.venue, abstract: paper.abstract, url: paper.url });
    const submit = () => onSave({ ...draft, authors: draft.authors.split(';').map(a => a.trim()).filter(Boolean), doi: draft.doi || null, arxiv: draft.arxiv || null }).catch(e => onError(message(e)));
    return <><label>Reading state<select aria-label="Reading state" value={paper.status} onChange={e => void onSave({ status: e.target.value as typeof paper.status }).catch(e => onError(message(e)))}>{['Inbox', 'Reading', 'Finished'].map(s => <option key={s}>{s}</option>)}</select></label>
    <PaperLabels paper={paper} labels={labels} onSave={onSave} onLabels={onLabels} onError={onError}/>
    <PaperActions paper={paper} onSave={onSave} onDelete={onDelete} onError={onError} disabled={disabled}/>
    <PdfFilenameEditor paper={paper} onSave={onSave} disabled={disabled}/>
    <h3>Bibliographic details</h3>{Object.entries(draft).map(([key, value]) => <label key={key}>{key === 'authors' ? 'Authors (separate with semicolons)' : key === 'doi' ? 'DOI' : key[0].toUpperCase() + key.slice(1)}{key === 'abstract' ? <textarea aria-label="Abstract" value={value} onChange={e => setDraft({ ...draft, [key]: e.target.value })}/> : <input aria-label={key === 'doi' ? 'DOI' : key[0].toUpperCase() + key.slice(1)} value={value} onChange={e => setDraft({ ...draft, [key]: e.target.value })}/>}</label>)}<button className="primary wide" onClick={() => void submit()}>Save details</button>
    {paper.arxiv && <p className="hint">arXiv {paper.arxiv}<br />Version family: {paper.arxivBase}. Changing metadata never changes PDF bytes. Import another explicit version to read it separately.</p>}
    <div className="paper-exports"><a href={`/api/export?format=bibtex&ids=${paper.id}`}>BibTeX ↗</a><a href={`/api/export?format=markdown&ids=${paper.id}`}>Markdown ↗</a>{paper.pdfSha && <a href={`/api/papers/${paper.id}/pdf?download=1`}>Original PDF ↗</a>}</div>
    <p className="hint">Paper {paper.id}<br />Revision {paper.revision} · Updated {new Date(paper.updated).toLocaleString()}</p>
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
