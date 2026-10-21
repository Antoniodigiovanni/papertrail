// Node 22 lacks these unrelated browser APIs. These test-only shims allow the
// unchanged browser PDF.js build to load; this test extracts text, never paints.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { textPdf } from '../dist/tests/tests/fixture.js';
import { ensureStreamAsyncIteration } from '../dist/tests/client/stream-compat.js';
import { loadPdfJs } from '../dist/tests/client/pdfjs.js';
globalThis.DOMMatrix = class {};
Promise.try ??= (fn, ...args) => new Promise(resolve => resolve(fn(...args)));
Uint8Array.prototype.toHex ??= function () { return Buffer.from(this).toString('hex'); };

const pdfjs = await import('../public/vendor/pdfjs/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../public/vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
const text = async callback => {
    const task = pdfjs.getDocument({ data: new Uint8Array(textPdf()), useSystemFonts: true });
    try { const doc = await task.promise; return await callback(await doc.getPage(2)); }
    finally { await task.destroy(); }
};
for (const removeValues of [false, true]) {
    await text(async page => {
        const expected = await page.getTextContent();
        assert.ok(expected.items.some(item => item.str?.includes('Second page:')));
        assert.equal(delete ReadableStream.prototype[Symbol.asyncIterator], true);
        if (removeValues) assert.equal(delete ReadableStream.prototype.values, true);
        assert.equal(typeof ReadableStream.prototype[Symbol.asyncIterator], 'undefined');
        await assert.rejects(page.getTextContent(), /async iterable/);
        console.log(`PASS negative control: unchanged PDF.js page 2 fails without asyncIterator (values removed: ${removeValues})`);
        ensureStreamAsyncIteration();
        assert.deepEqual(await page.getTextContent(), expected);
        console.log(`PASS: identical PDF.js page-2 text after compatibility install (values removed: ${removeValues})`);
    });
}
// The browser-only URL cannot resolve in Node; the loader must install support
// synchronously before attempting that import, and return its failure as a promise.
delete ReadableStream.prototype[Symbol.asyncIterator];
delete ReadableStream.prototype.values;
const loading = loadPdfJs();
assert.equal(typeof ReadableStream.prototype[Symbol.asyncIterator], 'function');
await assert.rejects(loading, { code: 'ERR_MODULE_NOT_FOUND' });
console.log('PASS: app loader installs stream iteration before attempting the PDF.js import');
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify({ negativeControls: 2, recovered: 2, loaderStartup: true }));
