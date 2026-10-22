import { pinchZoom } from './reader-geometry.js';
export type TouchPoint = { x: number; y: number };
// Leave one-finger scrolling and long-press text selection to the browser.
export function bindReaderTouch(root: EventTarget, handlers: {
    getZoom: () => number;
    start: (point: TouchPoint) => void;
    move: (zoom: number, point: TouchPoint) => void;
    end: () => void;
}) {
    let gesture: { distance: number; zoom: number } | null = null;
    const measure = (touches: TouchList) => {
        const a = touches[0], b = touches[1];
        return { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    };
    const start = (event: Event) => {
        const touch = event as TouchEvent;
        if (touch.touches.length !== 2) return;
        touch.preventDefault();
        const point = measure(touch.touches);
        gesture = { distance: point.distance, zoom: handlers.getZoom() };
        handlers.start({ x: point.x, y: point.y });
    };
    const move = (event: Event) => {
        const touch = event as TouchEvent;
        if (!gesture || touch.touches.length !== 2) return;
        touch.preventDefault();
        const point = measure(touch.touches);
        handlers.move(pinchZoom(gesture.zoom, gesture.distance, point.distance), { x: point.x, y: point.y });
    };
    const end = () => { if (gesture) { gesture = null; handlers.end(); } };
    // macOS Safari exposes trackpad pinch through GestureEvent, not ctrl+wheel.
    let safariZoom: number | null = null;
    const safariStart = (event: Event) => {
        event.preventDefault();
        if (gesture) return; // iOS may emit both touch and gesture events.
        const point = event as Event & { clientX: number; clientY: number };
        safariZoom = handlers.getZoom();
        handlers.start({ x: point.clientX, y: point.clientY });
    };
    const safariMove = (event: Event) => {
        if (safariZoom === null) return;
        event.preventDefault();
        const point = event as Event & { scale: number; clientX: number; clientY: number };
        if (!Number.isFinite(point.scale) || point.scale <= 0) return;
        handlers.move(pinchZoom(safariZoom, 1, point.scale), { x: point.clientX, y: point.clientY });
    };
    const safariEnd = (event: Event) => {
        if (safariZoom === null) return;
        event.preventDefault();
        safariZoom = null;
        handlers.end();
    };
    root.addEventListener('gesturestart', safariStart, { passive: false });
    root.addEventListener('gesturechange', safariMove, { passive: false });
    root.addEventListener('gestureend', safariEnd, { passive: false });
    root.addEventListener('touchstart', start, { passive: false });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', end);
    return () => {
        root.removeEventListener('gesturestart', safariStart);
        root.removeEventListener('gesturechange', safariMove);
        root.removeEventListener('gestureend', safariEnd);
        root.removeEventListener('touchstart', start);
        root.removeEventListener('touchmove', move);
        root.removeEventListener('touchend', end);
        root.removeEventListener('touchcancel', end);
    };
}
