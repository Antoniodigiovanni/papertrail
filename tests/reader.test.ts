import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readerPassages, textPdf } from './fixture.js';
import { canvasScale, pinchZoom, anchoredScroll } from '../client/reader-geometry.js';

test('browser selection oracles match actual fixture text and ink geometry from Poppler', async () => {
    const output = await new Promise<string>((resolve, reject) => {
        const child = execFile('pdftotext', ['-bbox', '-', '-'], { timeout: 10000, maxBuffer: 256000 }, (error, stdout) => {
            if (error) reject(error);
            else resolve(stdout);
        });
        child.stdin?.on('error', () => {});
        child.stdin?.end(textPdf());
    });
    const firstPage = output.match(/<page width="612\.000000" height="792\.000000">([\s\S]*?)<\/page>/)?.[1];
    assert.ok(firstPage);
    const words = [...firstPage.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)];
    for (const passage of readerPassages) {
        const line = words.filter(word => Number(word[2]) === passage.ink[1]);
        assert.equal(line.map(word => word[5]).join(' '), passage.quote);
        assert.deepEqual([Number(line[0][1]), Number(line[0][2]), Number(line.at(-1)![3]), Number(line.at(-1)![4])], passage.ink);
    }
});

test('pinch scales by finger distance, clamps extremes and retains fractional zoom', () => {
    assert.equal(pinchZoom(1, 100, 170), 1.7);
    assert.equal(pinchZoom(1.7, 170, 100), 1);
    assert.equal(pinchZoom(1, 100, 10), .5);
    assert.equal(pinchZoom(2, 100, 500), 3);
    assert.equal(pinchZoom(1, 0, 100), 3);
});

test('pinch anchor preserves the PDF point on both axes through zoom and midpoint translation', () => {
    // Before: the point .5 across / .25 down is underneath client (200, 300).
    // The new page is twice as large. Scroll by the exact displacement of that point.
    assert.equal(anchoredScroll(0, 12, 752, .5, 200), 188);
    assert.equal(anchoredScroll(100, 100, 1000, .25, 300), 150);
    assert.equal(anchoredScroll(100, 100, 1000, .25, 340), 110);
    // Zoom out and resize use the same geometry; no fixed timing or page offset guess.
    assert.equal(anchoredScroll(188, -176, 376, .5, 200), 0);
});

test('retina zoom canvases respect area and dimension budgets including long/landscape pages', () => {
    for (const [width, height, dpr] of [[376, 487, 3], [2100, 2718, 2], [5000, 1000, 3], [800, 20000, 2], [700, 900, 1]]) {
        const scale = canvasScale(width, height, dpr);
        assert.ok(Math.floor(width * scale) * Math.floor(height * scale) <= 8_000_000);
        assert.ok(width * scale <= 4096 && height * scale <= 4096);
        assert.ok(scale <= dpr && scale > 0);
    }
    assert.equal(canvasScale(376, 487, 3), 2);
    assert.equal(canvasScale(700, 900, 1), 1);
});

test('installed touch listeners allow native pan/selection, consume pinch, and commit cancel/end exactly once', async () => {
    const { bindReaderTouch } = await import('../client/reader-touch.js');
    const root = new EventTarget();
    let zoom = 1.5, commits = 0;
    const samples: { x: number; y: number }[] = [];
    const unbind = bindReaderTouch(root, { getZoom: () => zoom, start: p => samples.push(p),
        move: (next, p) => { zoom = next; samples.push(p); }, end: () => { commits++; } });
    const touch = (type: string, points: number[][]) => {
        const event = Object.assign(new Event(type, { cancelable: true }), { touches: points.map(([clientX, clientY]) => ({ clientX, clientY })) });
        root.dispatchEvent(event);
        return event.defaultPrevented;
    };
    assert.equal(touch('touchstart', [[100, 200]]), false);
    assert.equal(touch('touchmove', [[80, 170]]), false);
    assert.equal(zoom, 1.5);
    assert.equal(touch('touchstart', [[100, 200], [200, 200]]), true);
    assert.equal(touch('touchmove', [[80, 220], [240, 220]]), true);
    assert.ok(Math.abs(zoom - 2.4) < .0001);
    assert.deepEqual(samples, [{ x: 150, y: 200 }, { x: 160, y: 220 }]);
    touch('touchcancel', []);
    touch('touchend', []);
    assert.equal(commits, 1);
    assert.equal(touch('touchmove', [[80, 220], [240, 220]]), false);
    // A second pinch starts from current zoom, including a no-motion pinch.
    touch('touchstart', [[80, 220], [240, 220]]);
    touch('touchend', []);
    assert.equal(zoom, 2.4);
    assert.equal(commits, 2);
    unbind();
    assert.equal(touch('touchstart', [[100, 200], [200, 200]]), false);
});

for (const finish of ['touchend', 'touchcancel', 'one finger remaining']) {
    test(`one-finger horizontal/vertical pan and selection remain uncancelled after pinch: ${finish}`, async () => {
        const { bindReaderTouch } = await import('../client/reader-touch.js');
        const root = new EventTarget();
        let starts = 0, moves = 0, ends = 0;
        const unbind = bindReaderTouch(root, { getZoom: () => 1, start: () => starts++, move: () => moves++, end: () => ends++ });
        const touch = (type: string, points: number[][]) => {
            const event = Object.assign(new Event(type, { cancelable: true }), { touches: points.map(([clientX, clientY]) => ({ clientX, clientY })) });
            root.dispatchEvent(event);
            return event.defaultPrevented;
        };
        try {
            assert.equal(touch('touchstart', [[100, 200], [200, 200]]), true);
            assert.equal(touch('touchmove', [[80, 200], [220, 200]]), true);
            assert.equal(touch(finish === 'one finger remaining' ? 'touchend' : finish,
                finish === 'one finger remaining' ? [[80, 200]] : []), false);
            if (finish === 'one finger remaining') {
                assert.equal(touch('touchmove', [[80, 180]]), false);
                assert.equal(touch('touchend', []), false);
            }
            // These are cancellation-policy checks. Only CDP/browser input can
            // prove actual native scroll and physical devices prove long-press UI.
            for (const end of [[120, 300], [280, 300], [200, 188], [200, 412]]) {
                assert.equal(touch('touchstart', [[200, 300]]), false);
                assert.equal(touch('touchmove', [end]), false);
                assert.equal(touch('touchend', []), false);
            }
            // Stationary long-press selection must also remain a native action.
            assert.equal(touch('touchstart', [[200, 300]]), false);
            assert.equal(touch('touchmove', [[200, 300]]), false);
            assert.equal(touch('touchend', []), false);
            assert.deepEqual({ starts, moves, ends }, { starts: 1, moves: 1, ends: 1 }, 'One-finger gestures cannot trigger zoom, anchor changes or pinch commits');
        } finally { unbind(); }
    });
}

test('canvas cancellation is handled while text is pending and stale layers never start', async () => {
    const { renderPageLayers } = await import('../client/pdf-render.js');
    let rejectRender!: (reason: Error) => void;
    let resolveText!: (content: import('../client/pdfjs.js').TextContent) => void;
    let layers = 0, canceled = 0;
    const unhandled: unknown[] = [];
    const listener = (error: unknown) => unhandled.push(error);
    process.on('unhandledRejection', listener);
    const page = { render: () => ({ promise: new Promise<void>((_, reject) => { rejectRender = reject; }), cancel: () => { canceled++; } }),
        getTextContent: () => new Promise<import('../client/pdfjs.js').TextContent>(resolve => { resolveText = resolve; }) };
    class TextLayer { constructor() { layers++; } render() { return Promise.resolve(); } cancel() {} }
    const canvas = { getContext: () => ({}) };
    // These doubles exercise scheduling/cancellation; actual paint/DOM/layout is in the browser suite.
    const task = renderPageLayers(page as unknown as import('../client/pdfjs.js').PdfPage, {} as import('../client/pdfjs.js').Viewport,
        canvas as unknown as HTMLCanvasElement, {} as HTMLElement, TextLayer as unknown as import('../client/pdfjs.js').PdfJs['TextLayer'], 1);
    const rejected = assert.rejects(task.promise, /cancelled/);
    try {
        task.cancel();
        rejectRender(new Error('cancelled'));
        await rejected;
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(unhandled, []);
        resolveText({ items: [], styles: {} });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(layers, 0);
        assert.ok(canceled >= 1);
    } finally { process.removeListener('unhandledRejection', listener); }
});

test('a superseded render cannot cancel the next canvas/text generation', async () => {
    const { renderPageLayers } = await import('../client/pdf-render.js');
    const pending = new Map<HTMLCanvasElement, { finish: () => void; reject: (error: Error) => void }>();
    const textContainers: HTMLElement[] = [];
    class TextLayer {
        constructor({ container }: { container: HTMLElement }) { textContainers.push(container); }
        render() { return Promise.resolve(); }
        cancel() {}
    }
    const page = {
        render: ({ canvas }: { canvas: HTMLCanvasElement }) => {
            const promise = new Promise<void>((finish, reject) => pending.set(canvas, { finish, reject }));
            return { promise, cancel: () => pending.get(canvas)!.reject(new Error('superseded')) };
        },
        getTextContent: async () => ({ items: [], styles: {} }),
    };
    const firstCanvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement;
    const nextCanvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement;
    const nextText = {} as HTMLElement;
    const paint = (canvas: HTMLCanvasElement, text: HTMLElement) => renderPageLayers(page as unknown as import('../client/pdfjs.js').PdfPage,
        {} as import('../client/pdfjs.js').Viewport, canvas, text, TextLayer as unknown as import('../client/pdfjs.js').PdfJs['TextLayer'], 2);
    const previous = paint(firstCanvas, {} as HTMLElement);
    const next = paint(nextCanvas, nextText);
    const rejected = assert.rejects(previous.promise, /superseded/);
    previous.cancel();
    pending.get(nextCanvas)!.finish();
    await Promise.all([rejected, next.promise]);
    assert.deepEqual(textContainers, [nextText]);
    assert.notEqual(firstCanvas, nextCanvas);
});
