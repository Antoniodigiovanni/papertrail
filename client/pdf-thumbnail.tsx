import { useEffect, useRef } from 'react';
import { loadPdfJs } from './pdfjs';
import { renderThumbnail } from './thumbnail-task';

// One worker/document at a time; retained canvases are capped independently.
const jobs = new Set<() => void>();
const retained = new Set<() => void>();
let active = false;
let reading = false;
let stopActive: (() => void) | undefined;
function pump() {
    if (active || reading || document.hidden) return;
    jobs.values().next().value?.();
}
export function prioritizeReader(value: boolean) {
    reading = value;
    if (value) stopActive?.();
    else pump();
}
export function PdfThumbnail({ id, available }: { id: string; available: boolean }) {
    const host = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const element = host.current;
        if (!element || !available || !('IntersectionObserver' in window)) return;
        let visible = false, disposed = false, failed = false;
        let cancel: (() => void) | undefined;
        let timer: ReturnType<typeof setTimeout>;
        const release = () => {
            retained.delete(release);
            element.querySelectorAll('canvas').forEach(canvas => { canvas.width = canvas.height = 0; canvas.remove(); });
            element.dataset.state = failed ? 'fallback' : 'idle';
        };
        const enqueue = () => {
            if (!visible || disposed || failed || cancel || element.querySelector('canvas')) return;
            jobs.add(start); pump();
        };
        const start = () => {
            jobs.delete(start); active = true;
            const canvas = document.createElement('canvas');
            const stop = () => { stopTask(); release(); };
            const stopTask = renderThumbnail({
                canvas, url: `/api/papers/${id}/pdf`, load: loadPdfJs,
                ready: () => {
                    while (retained.size >= 12) retained.values().next().value?.();
                    retained.add(release);
                    element.append(canvas); element.dataset.state = 'ready';
                },
                failed: () => { failed = true; release(); },
                finished: () => {
                    if (stopActive === stop) stopActive = undefined;
                    if (cancel === stop) cancel = undefined;
                    active = false;
                    queueMicrotask(pump);
                },
            });
            cancel = stop; stopActive = stop;
            element.dataset.state = 'loading';
        };
        const observer = new IntersectionObserver(entries => {
            visible = entries.some(entry => entry.isIntersecting);
            clearTimeout(timer);
            if (visible) timer = setTimeout(enqueue, matchMedia('(pointer: coarse)').matches ? 500 : 150);
            else { jobs.delete(start); cancel?.(); release(); }
        }, { threshold: 0.01 });
        const visibility = () => { if (document.hidden) { jobs.delete(start); cancel?.(); release(); } else enqueue(); };
        document.addEventListener('visibilitychange', visibility);
        observer.observe(element);
        return () => { disposed = true; clearTimeout(timer); observer.disconnect(); document.removeEventListener('visibilitychange', visibility); jobs.delete(start); cancel?.(); release(); };
    }, [id, available]);
    return <span ref={host} className="pdf-thumbnail" aria-hidden="true" data-state="idle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 3H6v18h12V7l-4-4Z M14 3v5h4 M9 12h6 M9 16h6"/></svg><span>{available ? 'PDF' : 'REF'}</span></span>;
}
