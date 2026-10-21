import { useEffect, useState, useRef, useCallback, useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import { loadPdfJs, type PdfDocument } from './pdfjs';
import type { PaperDetail } from './api';
import type { Annotation } from '../server/store';
import type { AnnotationInput, Position } from '../server/schema';
import { renderPageLayers } from './pdf-render';
import { bindReaderTouch } from './reader-touch';
import { MIN_ZOOM, MAX_ZOOM, clampZoom, canvasScale, anchoredScroll } from './reader-geometry';
import { prioritizeReader } from './pdf-thumbnail';
const PAGE_PREFETCH_MARGIN = 900;
type SelectionDraft = {
    page: number;
    quote: string;
    rects: [
        number,
        number,
        number,
        number
    ][];
};
export function Reader({ paper, jump, onPosition, onHighlight, onSelectHighlight }: {
    paper: PaperDetail;
    jump: {
        page: number;
        offset: number;
        token: number;
    } | null;
    onPosition: (position: Position) => void;
    onHighlight: (a: AnnotationInput) => Promise<void>;
    onSelectHighlight: (a: Annotation) => void;
}) {
    const [doc, setDoc] = useState<PdfDocument | null>(null);
    const [error, setError] = useState('');
    const [width, setWidth] = useState(700);
    const [zoom, setZoom] = useState(1);
    const [renderZoom, setRenderZoom] = useState(1);
    const [gestureFrame, setGestureFrame] = useState(0);
    const zoomRef = useRef(1);
    type Anchor = { element: HTMLElement; x: number; y: number; clientX: number; clientY: number };
    const anchor = useRef<Anchor | null>(null);
    const pinching = useRef(false);
    const [page, setPage] = useState(paper.position.page);
    const [pageInput, setPageInput] = useState(String(page));
    const scroll = useRef<HTMLDivElement>(null);
    const positions = useRef(onPosition);
    positions.current = onPosition;
    const restored = useRef(false);
    const lastPosition = useRef(paper.position);
    const positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [selection, setSelection] = useState<SelectionDraft | null>(null);
    const [color, setColor] = useState<AnnotationInput['color']>('yellow');
    const [comment, setComment] = useState('');
    const [saving, setSaving] = useState(false);
    const [selectionError, setSelectionError] = useState('');
    const [search, setSearch] = useState('');
    const [searching, setSearching] = useState(false);
    const [matches, setMatches] = useState<number[]>([]);
    const [match, setMatch] = useState(0);
    useEffect(() => {
        prioritizeReader(true);
        let canceled = false;
        let loading: {
            destroy: () => Promise<void>;
        } | undefined;
        loadPdfJs().then(async (pdfjs) => {
            if (canceled)
                return;
            const task = pdfjs.getDocument({ url: `/api/papers/${paper.id}/pdf`, disableRange: true, disableStream: true, isEvalSupported: false, enableXfa: false, useSystemFonts: true, stopAtErrors: false });
            loading = task;
            const document = await task.promise;
            if (!canceled)
                setDoc(document);
        }).catch(e => { if (!canceled)
            setError(`Could not render PDF: ${e.message}. Retry loading or download the original PDF.`); });
        return () => { canceled = true; void loading?.destroy().catch(() => {}); prioritizeReader(false); };
    }, [paper.id]);
    const captureAnchor = useCallback((clientX?: number, clientY?: number): Anchor | null => {
        const root = scroll.current;
        if (!root) return null;
        const box = root.getBoundingClientRect();
        const x = clientX ?? box.left + root.clientWidth / 2;
        const y = clientY ?? box.top + Math.min(100, root.clientHeight / 2);
        const pages = [...root.querySelectorAll<HTMLElement>('.pdf-page')];
        const element = pages.find(el => el.getBoundingClientRect().bottom > y) || pages.at(-1);
        if (!element) return null;
        const pageBox = element.getBoundingClientRect();
        return { element, x: (x - pageBox.left) / pageBox.width, y: (y - pageBox.top) / pageBox.height, clientX: x, clientY: y };
    }, []);
    useLayoutEffect(() => {
        const root = scroll.current, point = anchor.current;
        if (!root || !point) return;
        const box = point.element.getBoundingClientRect();
        root.scrollLeft = anchoredScroll(root.scrollLeft, box.left, box.width, point.x, point.clientX);
        root.scrollTop = anchoredScroll(root.scrollTop, box.top, box.height, point.y, point.clientY);
        anchor.current = null;
    }, [zoom, width, gestureFrame]);
    useEffect(() => {
        const element = scroll.current;
        if (!element) return;
        const observer = new ResizeObserver(() => {
            anchor.current = captureAnchor();
            const style = getComputedStyle(element);
            setWidth(Math.max(1, element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [captureAnchor]);
    const changeZoom = useCallback((next: number) => {
        anchor.current = captureAnchor();
        zoomRef.current = clampZoom(next);
        setZoom(zoomRef.current);
        setRenderZoom(zoomRef.current);
        setSelection(null);
        window.getSelection()?.removeAllRanges();
    }, [captureAnchor]);
    useEffect(() => {
        const root = scroll.current;
        if (!root) return;
        let gestureAnchor: Anchor | null = null;
        let frame = 0;
        let pendingZoom = zoomRef.current;
        const apply = () => { frame = 0; setZoom(pendingZoom); setGestureFrame(n => n + 1); };
        const unbind = bindReaderTouch(root, {
            getZoom: () => zoomRef.current,
            start: point => {
                gestureAnchor = captureAnchor(point.x, point.y);
                pendingZoom = zoomRef.current;
                pinching.current = true;
                setSelection(null);
                window.getSelection()?.removeAllRanges();
            },
            move: (next, point) => {
                pendingZoom = next;
                zoomRef.current = next;
                anchor.current = gestureAnchor && { ...gestureAnchor, clientX: point.x, clientY: point.y };
                if (!frame) frame = requestAnimationFrame(apply);
            },
            end: () => {
                cancelAnimationFrame(frame);
                apply();
                setRenderZoom(zoomRef.current);
                pinching.current = false;
            },
        });
        // Trackpad pinch sends ctrl+wheel in Chromium and Firefox.
        const wheel = (event: WheelEvent) => {
            if (!event.ctrlKey) return;
            event.preventDefault();
            const point = captureAnchor(event.clientX, event.clientY);
            changeZoom(zoomRef.current * Math.exp(-event.deltaY * .01));
            anchor.current = point;
        };
        root.addEventListener('wheel', wheel, { passive: false });
        return () => {
            cancelAnimationFrame(frame);
            unbind();
            root.removeEventListener('wheel', wheel);
        };
    }, [captureAnchor, changeZoom]);
    const go = useCallback((pageNumber: number, offset = 0) => {
        const root = scroll.current;
        const target = root?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
        if (root && target) {
            root.scrollLeft = 0;
            root.scrollTop += target.getBoundingClientRect().top - root.getBoundingClientRect().top + offset * target.clientHeight;
            setPage(pageNumber);
            setPageInput(String(pageNumber));
        }
    }, []);
    useEffect(() => {
        if (!doc || restored.current)
            return;
        const timer = setTimeout(() => { go(Math.min(doc.numPages, paper.position.page), paper.position.offset); restored.current = true; }, 150);
        return () => clearTimeout(timer);
    }, [doc, go, paper.position.page, paper.position.offset]);
    useEffect(() => { if (jump && doc)
        go(jump.page, jump.offset); }, [jump, doc, go]);
    useEffect(() => {
        const root = scroll.current;
        if (!root)
            return;
        let frame = 0;
        const onScroll = () => {
            if (!restored.current || pinching.current)
                return;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const pages = [...root.querySelectorAll<HTMLElement>('.pdf-page')];
                const top = root.getBoundingClientRect().top;
                const visible = pages.find(el => el.getBoundingClientRect().bottom > top + 8);
                if (!visible)
                    return;
                const position = { page: Number(visible.dataset.pageNumber), offset: Math.min(1, Math.max(0, (top - visible.getBoundingClientRect().top) / visible.clientHeight)) };
                setPage(position.page);
                setPageInput(String(position.page));
                if (lastPosition.current.page === position.page && Math.abs(lastPosition.current.offset - position.offset) < .005)
                    return;
                lastPosition.current = position;
                if (positionTimer.current)
                    clearTimeout(positionTimer.current);
                positionTimer.current = setTimeout(() => positions.current(position), 500);
            });
        };
        root.addEventListener('scroll', onScroll, { passive: true });
        return () => { root.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); if (positionTimer.current) {
            clearTimeout(positionTimer.current);
            positions.current(lastPosition.current);
        } };
    }, [doc]);
    useEffect(() => {
        const selected = () => {
            if (pinching.current) return;
            const s = window.getSelection();
            if (!s?.rangeCount || s.isCollapsed)
                return;
            const nodeElement = (n: Node | null) => n instanceof Element ? n : n?.parentElement;
            const start = nodeElement(s.anchorNode)?.closest<HTMLElement>('.pdf-page');
            const end = nodeElement(s.focusNode)?.closest<HTMLElement>('.pdf-page');
            if (!start || start !== end || !scroll.current?.contains(start))
                return;
            const range = s.getRangeAt(0);
            const box = start.getBoundingClientRect();
            const rects: [
                number,
                number,
                number,
                number
            ][] = [];
            const clamp = (v: number) => Math.max(0, Math.min(1, Number(v.toFixed(6))));
            for (const r of range.getClientRects()) {
                const rect: [
                    number,
                    number,
                    number,
                    number
                ] = [clamp((r.left - box.left) / box.width), clamp((r.top - box.top) / box.height), clamp((r.right - box.left) / box.width), clamp((r.bottom - box.top) / box.height)];
                if (r.width > 1 && r.height > 1 && rect[0] < rect[2] && rect[1] < rect[3] && !rects.some(old => old.every((v, i) => Math.abs(v - rect[i]) < .0005)))
                    rects.push(rect);
            }
            const quote = s.toString().trim();
            if (quote && rects.length && rects.length <= 1000) {
                setSelection({ page: Number(start.dataset.pageNumber), quote: quote.slice(0, 20000), rects });
                setSelectionError('');
            }
        };
        let timer: ReturnType<typeof setTimeout>;
        const delayed = () => { clearTimeout(timer); timer = setTimeout(selected, 150); };
        document.addEventListener('selectionchange', delayed);
        document.addEventListener('pointerup', delayed);
        document.addEventListener('touchend', delayed);
        return () => { clearTimeout(timer); document.removeEventListener('selectionchange', delayed); document.removeEventListener('pointerup', delayed); document.removeEventListener('touchend', delayed); };
    }, []);
    useEffect(() => {
        let canceled = false;
        setMatches([]);
        setMatch(0);
        setSearching(false);
        if (!doc || !search.trim())
            return;
        const timer = setTimeout(async () => {
            setSearching(true);
            const results: number[] = [];
            try {
                for (let number = 1; number <= doc.numPages; number++) {
                    const content = await (await doc.getPage(number)).getTextContent();
                    if (canceled)
                        return;
                    const text = content.items.map(i => 'str' in i ? i.str : '').join(' ').toLocaleLowerCase();
                    if (text.includes(search.trim().toLocaleLowerCase()))
                        results.push(number);
                    if (number % 10 === 0)
                        setMatches([...results]);
                }
                if (!canceled) {
                    setMatches(results);
                    setSearching(false);
                    if (results.length)
                        go(results[0]);
                }
            }
            catch (e) {
                if (!canceled) {
                    setError(`PDF search failed: ${(e as Error).message}`);
                    setSearching(false);
                }
            }
        }, 350);
        return () => { canceled = true; clearTimeout(timer); };
    }, [search, doc, go]);
    const moveMatch = (direction: number) => { if (!matches.length)
        return; const next = (match + direction + matches.length) % matches.length; setMatch(next); go(matches[next]); };
    const addHighlight = async () => {
        if (!selection)
            return;
        setSaving(true);
        setSelectionError('');
        try {
            await onHighlight({ ...selection, color, comment });
            setSelection(null);
            setComment('');
            window.getSelection()?.removeAllRanges();
        }
        catch (e) {
            setSelectionError((e as Error).message);
        }
        finally {
            setSaving(false);
        }
    };
    return <div className="pdf-reader"><div className="pdf-toolbar"><div className="page-controls"><button aria-label="Previous page" disabled={!doc || page <= 1} onClick={() => go(page - 1)}>‹</button><input aria-label="PDF page" inputMode="numeric" value={pageInput} onChange={e => setPageInput(e.target.value)} onBlur={() => { const next = Math.min(doc?.numPages || 1, Math.max(1, Number(pageInput) || 1)); go(next); }} onKeyDown={e => { if (e.key === 'Enter')
        e.currentTarget.blur(); }}/><span>/ {doc?.numPages || '…'}</span><button aria-label="Next page" disabled={!doc || page >= doc.numPages} onClick={() => go(page + 1)}>›</button></div><div className="zoom-controls"><button aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => changeZoom(Math.max(.5, zoom - .25))}>−</button><select aria-label="PDF zoom" value={zoom} onChange={e => changeZoom(Number(e.target.value))}>{![.5, .75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].includes(zoom) && <option value={zoom}>{Math.round(zoom * 100)}%</option>}{[.5, .75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map(z => <option value={z} key={z}>{z === 1 ? 'Fit width' : `${Math.round(z * 100)}%`}</option>)}</select><button aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(Math.min(3, zoom + .25))}>＋</button></div><a href={`/api/papers/${paper.id}/pdf?download=1`} aria-label="Download original PDF">↓</a></div>
    <div className="pdf-find"><span>⌕</span><input aria-label="Search within PDF" value={search} maxLength={200} placeholder="Find in this paper…" onChange={e => setSearch(e.target.value)}/>{search && <><span role="status">{searching ? 'Searching…' : matches.length ? `${match + 1}/${matches.length} pages` : 'No matches'}</span><button aria-label="Previous search match" onClick={() => moveMatch(-1)}>↑</button><button aria-label="Next search match" onClick={() => moveMatch(1)}>↓</button><button aria-label="Clear PDF search" onClick={() => setSearch('')}>×</button></>}</div>
    {error && <div role="alert" className="alert">{error}<button onClick={() => location.reload()}>Reload PDF</button></div>}
    <div className="pdf-scroll" ref={scroll} tabIndex={0} aria-label="PDF pages"><div className="pdf-pages" style={{ width: Math.max(width, width * zoom) }}>{!doc && !error && <p className="loading">Opening your paper…</p>}{doc && Array.from({ length: doc.numPages }, (_, i) => <PdfPageView key={i + 1} doc={doc} pageNumber={i + 1} width={width * zoom} renderWidth={width * renderZoom} root={scroll} annotations={paper.annotations.filter(a => a.page === i + 1)} search={search} onSelectHighlight={onSelectHighlight}/>)}</div></div>
    {selection && <section className="selection-toolbar" aria-label="Create highlight"><div><small>KEEP A PASSAGE · PDF PAGE {selection.page}</small><p>{selection.quote.slice(0, 180)}{selection.quote.length > 180 ? '…' : ''}</p></div><div className="selection-options"><select aria-label="New highlight color" value={color} onChange={e => setColor(e.target.value as typeof color)}>{['yellow', 'green', 'blue', 'pink'].map(c => <option key={c}>{c}</option>)}</select><input aria-label="New highlight comment" placeholder="Add a thought (optional)" value={comment} maxLength={20000} onChange={e => setComment(e.target.value)}/><button className="primary" disabled={saving} onClick={() => void addHighlight()}>{saving ? 'Saving…' : 'Save highlight'}</button><button aria-label="Cancel highlight" disabled={saving} onClick={() => { setSelection(null); window.getSelection()?.removeAllRanges(); }}>×</button></div>{selectionError && <p className="alert" role="alert">{selectionError}</p>}</section>}
  </div>;
}
function PdfPageView({ doc, pageNumber, width, renderWidth, root, annotations, search, onSelectHighlight }: {
    doc: PdfDocument;
    pageNumber: number;
    width: number;
    renderWidth: number;
    root: RefObject<HTMLDivElement | null>;
    annotations: Annotation[];
    search: string;
    onSelectHighlight: (a: Annotation) => void;
}) {
    const container = useRef<HTMLDivElement>(null);
    const artwork = useRef<HTMLDivElement>(null);
    const [surfaceWidth, setSurfaceWidth] = useState(renderWidth);
    const [visible, setVisible] = useState(false);
    const [ratio, setRatio] = useState(792 / 612);
    const [rendered, setRendered] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => { if (!container.current)
        return; const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)), { root: root.current, rootMargin: `${PAGE_PREFETCH_MARGIN}px` }); observer.observe(container.current); return () => observer.disconnect(); }, [root]);
    useEffect(() => {
        const host = artwork.current;
        if (!host) return;
        if (!visible) {
            host.replaceChildren();
            setRendered(false);
            return;
        }
        setRendered(false);
        let canceled = false;
        let render: ReturnType<typeof renderPageLayers> | undefined;
        // Every generation owns its canvas/text nodes. Never resize a canvas still
        // owned by PDF.js or let an old cleanup erase a newer render.
        const surface = document.createElement('div');
        const target = document.createElement('canvas');
        const textLayer = document.createElement('div');
        textLayer.className = 'textLayer';
        target.setAttribute('aria-label', `PDF page ${pageNumber}`);
        surface.append(target, textLayer);
        (async () => {
            const pdfjs = await loadPdfJs();
            const page = await doc.getPage(pageNumber);
            if (canceled) return;
            const base = page.getViewport({ scale: 1 });
            setRatio(base.height / base.width);
            const viewport = page.getViewport({ scale: renderWidth / base.width });
            surface.style.width = `${viewport.width}px`;
            surface.style.height = `${viewport.height}px`;
            surface.style.setProperty('--total-scale-factor', String(viewport.scale));
            const pixelRatio = canvasScale(viewport.width, viewport.height, window.devicePixelRatio);
            target.width = Math.floor(viewport.width * pixelRatio);
            target.height = Math.floor(viewport.height * pixelRatio);
            target.style.width = `${viewport.width}px`;
            target.style.height = `${viewport.height}px`;
            render = renderPageLayers(page, viewport, target, textLayer, pdfjs.TextLayer, pixelRatio);
            await render.promise;
            if (canceled) return;
            host.replaceChildren(surface);
            setSurfaceWidth(renderWidth);
            setRendered(true);
            setError('');
        })().catch(e => {
            if (!canceled) {
                render?.cancel();
                setError(`Page ${pageNumber} could not render: ${e.message}`);
            }
        });
        return () => {
            canceled = true;
            render?.cancel();
            surface.remove();
            // Release backing memory only after PDF.js has stopped using it.
            void (render?.promise || Promise.resolve()).catch(() => {}).finally(() => {
                target.width = target.height = 0;
                textLayer.replaceChildren();
            });
        };
    }, [doc, pageNumber, renderWidth, visible]);
    useEffect(() => {
        const spans = artwork.current?.querySelectorAll('.textLayer span');
        const needle = search.trim().toLocaleLowerCase();
        spans?.forEach(span => span.classList.toggle('search-hit', !!needle && (span.textContent || '').toLocaleLowerCase().includes(needle)));
    }, [search, rendered, surfaceWidth]);
    return <div ref={container} className="pdf-page" data-page-number={pageNumber} data-prefetched={visible} data-prefetch-margin={PAGE_PREFETCH_MARGIN} data-rendered={rendered} data-render-width={surfaceWidth} style={{ width, height: width * ratio }}>
    {(!rendered || error) && <span className="page-placeholder" role={error ? 'alert' : undefined}>{error || `PDF page ${pageNumber}`}</span>}<div className="page-artwork" ref={artwork} style={{ transform: `scale(${width / surfaceWidth})` }}/>
    <div className="highlight-layer">{annotations.flatMap(a => a.rects.map((r, index) => <button key={`${a.id}-${index}`} className={`pdf-highlight ${a.color}`} data-annotation-id={a.id} aria-label={`Highlight on page ${a.page}: ${a.quote.slice(0, 80)}`} title={a.comment || a.quote} style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${(r[2] - r[0]) * 100}%`, height: `${(r[3] - r[1]) * 100}%` }} onClick={() => onSelectHighlight(a)}/>))}</div><span className="page-number">{pageNumber}</span>
  </div>;
}
