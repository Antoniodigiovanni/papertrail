import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

// Roving focus and outside dismissal are shared by every paper overflow menu.
export function ActionMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), items = useRef<HTMLDivElement>(null);
    const last = useRef(false);
    const id = useId();
    const close = () => { setOpen(false); trigger.current?.focus(); };
    useEffect(() => {
        if (!open) return;
        const buttons = items.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])');
        buttons?.[last.current ? buttons.length - 1 : 0]?.focus();
        const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        // A viewport change can hide the mobile trigger; do not retain an open menu.
        const resize = () => setOpen(false);
        window.addEventListener('resize', resize);
        return () => {
            document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside);
            window.removeEventListener('resize', resize);
        };
    }, [open]);
    return <div ref={root} className="action-menu" onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
        <button ref={trigger} className="paper-menu-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { last.current = false; setOpen(!open); }} onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); last.current = event.key === 'ArrowUp'; setOpen(true); }
        }}><span aria-hidden="true">⋮</span></button>
        {open && <div ref={items} id={id} role="menu" aria-label={label} className="paper-menu" onKeyDown={event => {
            if (event.key === 'Tab') { close(); return; }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const buttons = [...(items.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') || [])];
            const index = buttons.indexOf(document.activeElement as HTMLElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
        }}>{children(close)}</div>}
    </div>;
}
