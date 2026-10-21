import type { PdfJs, RenderTask } from './pdfjs.js';

// Cancellation releases the scheduler independently of PDF.js promise settlement.
export function renderThumbnail({ canvas, url, load, ready, failed, finished }: {
    canvas: HTMLCanvasElement; url: string; load: () => Promise<PdfJs>;
    ready: () => void; failed: () => void; finished: () => void;
}): () => void {
    let canceled = false, released = false;
    let loading: ReturnType<PdfJs['getDocument']> | undefined;
    let render: RenderTask | undefined;
    let destruction: Promise<void> | undefined;
    const destroy = () => destruction ??= loading ? loading.destroy().catch(() => {}) : Promise.resolve();
    const clearCanvas = () => { if (!canvas.isConnected) canvas.width = canvas.height = 0; };
    const finish = () => {
        if (released) return;
        released = true;
        clearTimeout(timeout);
        finished();
    };
    const cancel = () => {
        if (canceled || released) return;
        canceled = true;
        render?.cancel();
        void destroy();
        if (render) void render.promise.catch(() => {}).finally(clearCanvas);
        else clearCanvas();
        finish();
    };
    const timeout = setTimeout(() => { failed(); cancel(); }, 12000);
    void (async () => {
        const pdfjs = await load();
        if (canceled) return;
        loading = pdfjs.getDocument({ url, disableRange: true, disableStream: true, isEvalSupported: false, enableXfa: false, useSystemFonts: true });
        const doc = await loading.promise;
        if (canceled) return;
        const page = await doc.getPage(1);
        if (canceled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(120 / base.width, 160 / base.height) });
        canvas.width = Math.max(1, Math.min(120, Math.ceil(viewport.width)));
        canvas.height = Math.max(1, Math.min(160, Math.ceil(viewport.height)));
        render = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport });
        await render.promise;
        if (!canceled) ready();
    })().catch(() => { if (!canceled) failed(); }).finally(async () => {
        await destroy();
        clearCanvas();
        finish();
    });
    return cancel;
}
