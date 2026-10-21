import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderThumbnail } from '../client/thumbnail-task.js';
import type { PdfJs } from '../client/pdfjs.js';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const canvas = () => ({ width: 300, height: 150, isConnected: false, getContext: () => ({}) }) as unknown as HTMLCanvasElement;
const never = new Promise<never>(() => {});

test('cancel releases a thumbnail slot even when PDF.js loading and destroy never settle', async () => {
    let destroys = 0, finishes = 0, next = 0, paints = 0;
    const target = canvas();
    const load = async () => ({ getDocument: () => ({ promise: never, destroy: () => { destroys++; return never; } }) }) as unknown as PdfJs;
    let active = true;
    const stop = renderThumbnail({ canvas: target, url: '/api/papers/stalled/pdf', load,
        ready: () => { paints++; }, failed: () => assert.fail('cancellation is not failure'),
        finished: () => { finishes++; active = false; if (!active) next++; },
    });
    await flush(); stop();
    assert.equal(destroys, 1);
    assert.equal(finishes, 1); assert.equal(next, 1, 'the next queued job can start immediately');
    assert.equal(paints, 0);
    assert.equal(target.width * target.height, 0);
    stop(); await flush(); assert.equal(finishes, 1, 'repeated cancellation cannot release another job’s slot');
});

test('late PDF.js module completion cannot start a canceled document or finish a newer job', async () => {
    let resolve!: (module: PdfJs) => void;
    const module = new Promise<PdfJs>(done => { resolve = done; });
    let finishes = 0;
    const stop = renderThumbnail({ canvas: canvas(), url: '/pdf', load: () => module,
        ready: () => assert.fail('canceled job painted'), failed: () => assert.fail('canceled job failed'), finished: () => { finishes++; },
    });
    stop(); assert.equal(finishes, 1);
    resolve({ getDocument: () => assert.fail('canceled job opened a PDF') } as unknown as PdfJs);
    await flush(); assert.equal(finishes, 1);
});

test('thumbnail timeout releases a stalled slot even when destroy never settles', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let failed = 0, finished = 0, destroyed = 0;
    renderThumbnail({ canvas: canvas(), url: '/pdf',
        load: async () => ({ getDocument: () => ({ promise: never, destroy: () => { destroyed++; return never; } }) }) as unknown as PdfJs,
        ready: () => assert.fail('stalled job painted'), failed: () => { failed++; }, finished: () => { finished++; },
    });
    await flush(); t.mock.timers.tick(12000);
    assert.deepEqual({ failed, finished, destroyed }, { failed: 1, finished: 1, destroyed: 1 });
});

test('canceling a render releases its slot immediately and backing store after render settles', async () => {
    let finishRender!: () => void;
    const rendering = new Promise<void>(resolve => { finishRender = resolve; });
    let cancels = 0, finishes = 0, paints = 0;
    const target = canvas();
    const stop = renderThumbnail({ canvas: target, url: '/pdf', load: async () => ({
        getDocument: () => ({ destroy: async () => {}, promise: Promise.resolve({ getPage: async () => ({
            getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
            render: () => ({ promise: rendering, cancel: () => { cancels++; } }),
        }) }) }),
    }) as unknown as PdfJs, ready: () => { paints++; }, failed: () => assert.fail('canceled render failed'), finished: () => { finishes++; } });
    await flush(); assert.ok(target.width > 0 && target.width <= 120 && target.height <= 160);
    stop(); assert.equal(cancels, 1); assert.equal(finishes, 1);
    finishRender(); await flush();
    assert.equal(paints, 0); assert.equal(finishes, 1); assert.equal(target.width * target.height, 0);
});
