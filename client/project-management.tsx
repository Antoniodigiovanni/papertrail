import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError, patch, type Label, type Library } from './api';

export const projectActionsId = (id: string) => `project-actions-${id}`;

export function ProjectMenu({ project, disabled, onRename, onDelete }: {
    project: Label;
    disabled: boolean;
    onRename: () => void;
    onDelete: () => void;
}) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const items = useRef<HTMLDivElement>(null);
    const focusLast = useRef(false);
    const menuId = useId();
    const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
    useEffect(() => {
        if (!open) return;
        const buttons = items.current?.querySelectorAll('button');
        buttons?.[focusLast.current ? buttons.length - 1 : 0]?.focus();
        const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
    }, [open]);
    useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
    return <div className="project-actions" ref={root} onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
    }}>
        <button ref={trigger} id={projectActionsId(project.id)} className="project-menu-trigger" aria-label={`Actions for project ${project.name}`} title={`Actions for project ${project.name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={disabled} onClick={() => { focusLast.current = false; setOpen(value => !value); }} onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusLast.current = event.key === 'ArrowUp'; setOpen(true); }
        }}><span aria-hidden="true">⋮</span></button>
        {open && <div ref={items} id={menuId} role="menu" aria-label={`Actions for project ${project.name}`} className="project-menu" onKeyDown={event => {
            if (event.key === 'Tab') { close(true); return; }
            const buttons = [...(items.current?.querySelectorAll('button') || [])];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next]?.focus();
            }
        }}>
            <button role="menuitem" tabIndex={-1} aria-label={`Rename project ${project.name}`} onClick={() => { close(true); onRename(); }}>Rename</button>
            <button role="menuitem" tabIndex={-1} className="project-menu-delete" aria-label={`Delete project ${project.name}`} onClick={() => { close(true); onDelete(); }}>Delete project</button>
        </div>}
    </div>;
}

export function RenameProjectDialog({ project, onClose, onRenamed }: {
    project: Label;
    onClose: () => void;
    onRenamed: (label: Label) => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const titleId = useId(), hintId = useId(), errorId = useId();
    const [current, setCurrent] = useState(project);
    const [name, setName] = useState(project.name);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [conflict, setConflict] = useState(false);
    const [missing, setMissing] = useState(false);
    const trimmed = name.trim();
    const invalid = !trimmed ? 'Enter a project name.' : trimmed.length > 100 ? 'Use 100 characters or fewer.' : '';
    useEffect(() => {
        const element = dialog.current!;
        element.showModal(); input.current?.select();
        return () => { element.close(); document.getElementById(projectActionsId(project.id))?.focus(); };
    }, [project.id]);
    const submit = async () => {
        if (busy || conflict || missing) return;
        if (invalid) { setError(invalid); input.current?.focus(); return; }
        setBusy(true); setError('');
        try {
            const next = await api<Label>(`/api/projects/${project.id}`, patch({ name: trimmed, expectedName: current.name }));
            onRenamed(next); onClose();
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
            if (error instanceof ApiError) {
                setConflict((error.details as { code?: string } | undefined)?.code === 'PROJECT_NAME_CONFLICT');
                setMissing(error.status === 404);
            }
        } finally { setBusy(false); }
    };
    const reload = async () => {
        setBusy(true);
        try {
            const library = await api<Library>('/api/library');
            const latest = library.projects.find(p => p.id === project.id);
            if (!latest) { setMissing(true); setError('This project has been deleted. Close this dialog and refresh the library.'); return; }
            setCurrent(latest); setName(latest.name); setConflict(false); setError('');
            onRenamed(latest); input.current?.focus();
        } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
    };
    return createPortal(<dialog ref={dialog} className="modal rename-project-dialog" aria-labelledby={titleId} aria-describedby={hintId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => {
        const bounds = dialog.current!.getBoundingClientRect();
        if (!busy && event.target === dialog.current && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) onClose();
    }}>
        <form noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
            <h2 id={titleId}>Rename project</h2>
            <p id={hintId} className="hint">Use 1–100 characters. Names match exactly, including letter case. Papers and assignments stay the same.</p>
            <label>Project name<input ref={input} autoFocus aria-label="Project name" aria-invalid={!!error} aria-describedby={error ? `${hintId} ${errorId}` : hintId} value={name} readOnly={busy || missing} onChange={event => { setName(event.target.value); if (!conflict) setError(''); }}/></label>
            {error && <p id={errorId} className="alert" role="alert">{error}</p>}
            <div className="rename-project-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button>{conflict && !missing && <button type="button" disabled={busy} onClick={() => void reload()}>Reload latest project</button>}<button className="primary" type="submit" disabled={busy || conflict || missing}>{busy ? 'Saving…' : 'Save name'}</button></div>
        </form>
    </dialog>, document.body);
}
