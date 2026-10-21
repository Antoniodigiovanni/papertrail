import { useEffect, useRef, useState } from 'react';
import { api, patch, type Label, type Library, type PaperDetail, type SavePaper } from './api';
import { ActionMenu } from './action-menu';
import { AssignmentCheckbox } from './assignment-checkbox';
import { normalizePdfFilename, pdfFilenameProblem } from '../server/filename';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export const deletePaper = (paper: PaperDetail) => api(`/api/papers/${paper.id}`, {
    method: 'DELETE', body: JSON.stringify({ confirmation: paper.id, revision: paper.revision }),
});

export function PdfFilenameEditor({ paper, onSave, disabled = false }: {
    paper: PaperDetail; onSave: SavePaper; disabled?: boolean;
}) {
    const [name, setName] = useState(paper.pdfFilename);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { setName(paper.pdfFilename); setError(''); }, [paper.pdfFilename]);
    if (!paper.pdfSha) return null;
    return <form className="pdf-filename-editor" onSubmit={event => {
        event.preventDefault();
        const invalid = pdfFilenameProblem(name);
        if (invalid) { setError(invalid); return; }
        setBusy(true); setError('');
        void onSave({ pdfFilename: normalizePdfFilename(name) }).catch(error => setError(message(error))).finally(() => setBusy(false));
    }}>
        <label>PDF filename<input aria-label="PDF filename" value={name} disabled={disabled || busy} onChange={event => { setName(event.target.value); setError(''); }}/></label>
        <p className="hint">Download name ending in .pdf. Paper title is edited separately.</p>
        <button type="submit" disabled={disabled || busy || name === paper.pdfFilename}>{busy ? 'Saving filename…' : 'Save PDF filename'}</button>
        <a href={`/api/papers/${paper.id}/pdf?download=1`}>Download PDF</a>
        {error && <p className="alert" role="alert">{error}</p>}
    </form>;
}

export function PaperActions({ paper, onSave, onDelete, onError, disabled = false }: {
    paper: PaperDetail; onSave: SavePaper; onDelete: () => Promise<void>;
    onError: (value: string) => void; disabled?: boolean;
}) {
    const [busy, setBusy] = useState(false);
    const run = async (action: () => Promise<unknown>) => {
        setBusy(true);
        try { await action(); } catch (error) { onError(message(error)); } finally { setBusy(false); }
    };
    return <div className="paper-actions">
        <button disabled={disabled || busy} onClick={() => void run(() => onSave({ archived: !paper.archived }))}>{paper.archived ? 'Return to library' : 'Archive paper'}</button>
        {paper.archived && <button className="danger" disabled={disabled || busy} onClick={() => {
            if (confirm(`Permanently delete “${paper.title}”? This irreversibly removes this paper, its original PDF, notes, highlights, reading position and all project/tag assignments. Projects, tags and other papers are kept. This cannot be undone.`))
                void run(onDelete);
        }}>Permanently delete</button>}
        <p className="hint">Archive keeps all paper data. Permanent deletion is available in Archive.</p>
    </div>;
}

export function PaperLabels({ paper, labels, onSave, onLabels, onError }: {
    paper: PaperDetail; labels: Library; onSave: SavePaper;
    onLabels: () => Promise<void>; onError: (value: string) => void;
}) {
    return <div className="paper-labels"><fieldset><legend>Projects</legend>
        <p className="hint">Choose any number of projects. Clear all to leave this paper Unassigned.</p>
        {labels.projects.map(label => <AssignmentCheckbox key={label.id} kind="projects" label={label} checked={paper.projectIds.includes(label.id)} onSave={onSave} onError={onError}/>)}
        {!labels.projects.length && <p className="hint">Create a project in the library sidebar to assign it here.</p>}
    </fieldset><TagEditor paper={paper} tags={labels.tags} onSave={onSave} onLabels={onLabels} onError={onError}/></div>;
}

function TagEditor({ paper, tags, onSave, onLabels, onError }: {
    paper: PaperDetail; tags: Label[]; onSave: SavePaper;
    onLabels: () => Promise<void>; onError: (value: string) => void;
}) {
    const [text, setText] = useState('');
    const [creating, setCreating] = useState(false);
    const inputGeneration = useRef(0);
    const [created, setCreated] = useState<Label[]>([]);
    const [desired, setDesired] = useState<Record<string, boolean>>({});
    const operations = useRef<Record<string, number>>({});
    const known = [...tags, ...created.filter(label => !tags.some(t => t.id === label.id))];
    const assigned = (id: string) => desired[id] ?? paper.tagIds.includes(id);
    const assign = async (label: Label, selected: boolean) => {
        const operation = (operations.current[label.id] || 0) + 1;
        operations.current[label.id] = operation;
        setDesired(previous => ({ ...previous, [label.id]: selected }));
        try {
            await onSave(current => ({ tagIds: selected ? [...new Set([...current.tagIds, label.id])] : current.tagIds.filter(id => id !== label.id) }));
        } finally {
            if (operations.current[label.id] === operation)
                setDesired(previous => { const next = { ...previous }; delete next[label.id]; return next; });
        }
    };
    const add = async (existing?: Label) => {
        const name = text.trim();
        const generation = inputGeneration.current;
        if (!existing && !name) return;
        const isNew = !existing && !known.some(t => t.name === name);
        if (isNew) setCreating(true);
        try {
            const label = existing || known.find(t => t.name === name) || await api<Label>('/api/tags', { method: 'POST', body: JSON.stringify({ name }) });
            setCreated(previous => previous.some(t => t.id === label.id) ? previous : [...previous, label]);
            // The assignment uses the same queue as notes and project edits.
            await assign(label, true);
            if (generation === inputGeneration.current) setText('');
            await onLabels();
        } catch (error) { onError(message(error)); } finally { if (isNew) setCreating(false); }
    };
    return <fieldset className="tag-editor"><legend>Tags</legend>
        <div className="tag-chips" aria-label="Paper tags">{known.filter(t => assigned(t.id)).map(t => <button type="button" className="chip" key={t.id} aria-label={`Remove tag ${t.name}`} onClick={() => void assign(t, false).catch(error => onError(message(error)))}># {t.name} <span aria-hidden="true">×</span></button>)}</div>
        <form onSubmit={event => { event.preventDefault(); void add(); }}>
            <label>Add tag<input aria-label="Add tag" maxLength={100} value={text} onChange={event => { inputGeneration.current++; setText(event.target.value); }} placeholder="Find or create a tag"/></label>
            <button type="submit" disabled={creating || !text.trim()}>{creating ? 'Saving tag…' : 'Add tag'}</button>
        </form>
        <div className="tag-suggestions" aria-label="Suggested tags">{known.filter(t => !assigned(t.id) && t.name.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase())).map(t => <button type="button" className="chip" key={t.id} disabled={creating} onClick={() => void add(t)} aria-label={`Add tag ${t.name}`}># {t.name} +</button>)}</div>
        <p className="hint">Tags are shared across your library. Type to create one here; × removes it from this paper only.</p>
    </fieldset>;
}

// Library rows use the same functional, revision-aware queue contract as the reader.
export function LibraryPaperControls({ initial, labels, onChanged, onDeleted }: {
    initial: PaperDetail; labels: Library; onChanged: () => Promise<void>; onDeleted: () => void;
}) {
    const [paper, setPaper] = useState(initial);
    const current = useRef(initial);
    const queue = useRef(Promise.resolve());
    const failed = useRef(false);
    const pending = useRef(0);
    const [state, setState] = useState('Saved');
    const [error, setError] = useState('');
    const [expanded, setExpanded] = useState(false);
    const [removing, setRemoving] = useState(false);
    const editor = useRef<HTMLElement>(null);
    const editorFocus = useRef<'organize' | 'filename' | null>(null);
    useEffect(() => {
        if (!expanded || !editorFocus.current) return;
        const target = editorFocus.current === 'filename' ? editor.current?.querySelector<HTMLInputElement>('[aria-label="PDF filename"]') : editor.current;
        target?.focus(); editorFocus.current = null;
    }, [expanded]);
    const expand = (target: 'organize' | 'filename') => {
        if (expanded) {
            (target === 'filename' ? editor.current?.querySelector<HTMLInputElement>('[aria-label="PDF filename"]') : editor.current)?.focus();
        } else { editorFocus.current = target; setExpanded(true); }
    };
    const update = (value: PaperDetail) => { current.current = value; setPaper(value); };
    useEffect(() => {
        if (!pending.current && !failed.current && initial.revision > current.current.revision) {
            current.current = initial; setPaper(initial);
        }
    }, [initial]);
    const save: SavePaper = changes => {
        pending.current++;
        setState('Saving…');
        const task = queue.current.then(async () => {
            if (failed.current) throw new Error('Saving is paused. Reload the latest paper before trying again.');
            try {
                const fields = typeof changes === 'function' ? changes(current.current) : changes;
                update(await api<PaperDetail>(`/api/papers/${paper.id}`, patch({ revision: current.current.revision, ...fields })));
                setError('');
                await onChanged();
            } catch (error) { failed.current = true; setError(message(error)); throw error; }
        });
        queue.current = task.catch(() => {});
        return task.finally(() => { pending.current--; setState(failed.current ? 'Save error' : pending.current ? 'Saving…' : 'Saved'); });
    };
    const reload = async () => {
        await queue.current;
        try {
            update(await api<PaperDetail>(`/api/papers/${paper.id}`));
            failed.current = false; setError(''); setState('Saved'); await onChanged();
        } catch (error) { setError(message(error)); }
    };
    const remove = async () => {
        setRemoving(true);
        try {
            await queue.current;
            if (failed.current) throw new Error('Reload the latest paper before deleting.');
            await deletePaper(current.current); onDeleted(); await onChanged();
        } catch (error) { failed.current = true; setState('Save error'); throw error; }
        finally { setRemoving(false); }
    };
    return <div className="library-paper-controls">
        <div className="mobile-paper-menu"><ActionMenu label={`Actions for paper ${paper.title}`}>{close => <>
            <button role="menuitem" tabIndex={-1} onClick={() => { close(); expand('organize'); }}>Organize paper</button>
            {paper.pdfSha && <button role="menuitem" tabIndex={-1} onClick={() => { close(); expand('filename'); }}>Rename PDF</button>}
            <button role="menuitem" tabIndex={-1} disabled={failed.current || removing || state === 'Saving…'} onClick={() => { close(); void save({ archived: !paper.archived }).catch(error => setError(message(error))); }}>{paper.archived ? 'Return to library' : 'Archive paper'}</button>
            {paper.archived && <button role="menuitem" tabIndex={-1} className="danger" disabled={failed.current || removing || state === 'Saving…'} onClick={() => {
                close();
                if (confirm(`Permanently delete “${paper.title}”? This irreversibly removes this paper, its original PDF, notes, highlights, reading position and all project/tag assignments. Projects, tags and other papers are kept. This cannot be undone.`)) void remove().catch(error => setError(message(error)));
            }}>Permanently delete</button>}
        </>}</ActionMenu></div>
        <div className="library-direct-actions">
        <button aria-expanded={expanded} aria-controls={`organize-${paper.id}`} onClick={() => setExpanded(!expanded)}>Organize paper</button>
        <PaperActions paper={paper} onSave={save} disabled={failed.current} onError={setError} onDelete={remove}/>
        </div>
        <span role="status" data-save-state={state}>{state}</span>
        {error && <div className="alert" role="alert">{error}<button onClick={() => void reload()}>Reload latest</button></div>}
        {expanded && <section ref={editor} tabIndex={-1} id={`organize-${paper.id}`} aria-label={`Organize ${paper.title}`}><div className="mobile-organize-heading"><strong>Organize paper</strong><button aria-label="Close paper organizer" onClick={() => { setExpanded(false); document.getElementById(`paper-row-${paper.id}`)?.querySelector<HTMLButtonElement>('.paper-menu-trigger')?.focus(); }}>×</button></div><PdfFilenameEditor paper={paper} onSave={save} disabled={failed.current}/><PaperLabels paper={paper} labels={labels} onSave={save} onLabels={onChanged} onError={setError}/></section>}
    </div>;
}
