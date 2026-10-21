import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Roving focus and outside dismissal are shared by every paper overflow menu.
export function ActionMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), items = useRef<HTMLDivElement>(null);
    const last = useRef(false);
    const id = useId();
    const close = () => { setOpen(false); trigger.current?.focus(); };
    useLayoutEffect(() => {
        if (!open) return;
        const position = () => {
            const rect = trigger.current?.getBoundingClientRect(), menu = items.current;
            if (!rect || !menu) return;
            const below = innerHeight - rect.bottom - 8, above = rect.top - 8;
            const upwards = below < menu.scrollHeight && above > below;
            menu.style.top = upwards ? 'auto' : '100%';
            menu.style.bottom = upwards ? '100%' : 'auto';
            menu.style.maxHeight = `${Math.max(44, upwards ? above : below)}px`;
        };
        position();
        const buttons = items.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])');
        buttons?.[last.current ? buttons.length - 1 : 0]?.focus();
        const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        // Mobile browser chrome and full-page capture can resize the viewport
        // without hiding the trigger. Keep the menu (and its keyboard focus) in
        // that case. Only dismiss when responsive CSS actually hides it.
        const resize = () => {
            const active = document.activeElement;
            // Some engines blur a display:none descendant before resize runs.
            const hadFocus = root.current?.contains(active) || active === document.body;
            if (trigger.current?.getClientRects().length) { position(); return; }
            setOpen(false);
            // The trigger is now hidden. Preserve a keyboard user's place in the
            // library instead of leaving focus on body when the item is removed.
            if (hadFocus) root.current?.closest<HTMLElement>('[tabindex]')?.focus({ preventScroll: true });
        };
        window.addEventListener('resize', resize);
        window.addEventListener('scroll', position, true);
        return () => {
            document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside);
            window.removeEventListener('resize', resize);
            window.removeEventListener('scroll', position, true);
        };
    }, [open]);
    return <div ref={root} className="action-menu" onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
        <button ref={trigger} className="paper-menu-trigger" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { last.current = false; if (open) close(); else setOpen(true); }} onKeyDown={event => {
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
