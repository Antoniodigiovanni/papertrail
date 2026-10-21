import type { PdfPage, Viewport, PdfJs } from './pdfjs.js';
// Subscribe to canvas rejection immediately, independently of text loading. Each
// caller owns fresh DOM nodes so cancellation cannot affect another generation.
export function renderPageLayers(page: PdfPage, viewport: Viewport, canvas: HTMLCanvasElement, container: HTMLElement, TextLayer: PdfJs['TextLayer'], pixelRatio: number) {
    let canceled = false;
    let layer: InstanceType<PdfJs['TextLayer']> | undefined;
    const render = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] });
    const cancel = () => { if (canceled) return; canceled = true; render.cancel(); layer?.cancel(); };
    const promise = Promise.all([render.promise, (async () => {
        const content = await page.getTextContent();
        if (canceled) return;
        layer = new TextLayer({ textContentSource: content, container, viewport });
        await layer.render();
    })()]).then(() => undefined).catch(error => { cancel(); throw error; });
    return { promise, cancel };
}
