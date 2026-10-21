import assert from 'node:assert/strict';
import { textPdf, readerPassages } from '../dist/tests/tests/fixture.js';
import { assertPainted, assertPassageHighlight, selectFixturePassage } from './reader-browser-checks.mjs';

export async function pdfStreamCompatibilityChecks(browser, base) {
  const setup = await browser.newContext();
  const response = await setup.request.post(`${base}/api/upload`, { headers: { 'Content-Type': 'application/pdf' }, data: textPdf('Stream compatibility fixture') });
  assert.equal(response.status(), 201);
  const { paper } = await response.json();
  try {
    // Real PDF.js negative control: bypass the app loader in a fresh context.
    const control = await browser.newContext();
    try {
      await control.addInitScript(() => {
        delete ReadableStream.prototype[Symbol.asyncIterator];
        delete ReadableStream.prototype.values;
      });
      const page = await control.newPage(); await page.goto(base);
      const error = await page.evaluate(async id => {
        const pdfjs = await import('/vendor/pdfjs/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
        const task = pdfjs.getDocument({ url: `/api/papers/${id}/pdf`, disableRange: true, disableStream: true, isEvalSupported: false, useSystemFonts: true });
        try { const doc = await task.promise; await (await doc.getPage(2)).getTextContent(); return null; }
        catch (error) { return error.message; }
        finally { await task.destroy(); }
      }, paper.id);
      assert.ok(error && /async|function/i.test(error), `missing API must reproduce PDF.js failure: ${error}`);
    } finally { await control.close(); }
    for (const mode of ['native', 'missing-symbol', 'missing-both']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      try {
        await context.addInitScript(mode => {
          if (mode !== 'native') delete ReadableStream.prototype[Symbol.asyncIterator];
          if (mode === 'missing-both') delete ReadableStream.prototype.values;
          globalThis.streamBeforePdf = ReadableStream.prototype[Symbol.asyncIterator];
        }, mode);
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        // Check ordering at the actual module request, before PDF.js evaluates.
        let imports = 0;
        await page.route('**/vendor/pdfjs/pdf.mjs', async route => {
          assert.equal(await page.evaluate(() => typeof ReadableStream.prototype[Symbol.asyncIterator]), 'function');
          imports++;
          await route.continue();
        });
        await page.goto(`${base}/#paper=${paper.id}`);
        await assertPainted(page, 1);
        await page.getByLabel('PDF page', { exact: true }).fill('2');
        await page.getByLabel('PDF page', { exact: true }).press('Enter');
        await assertPainted(page, 2);
        await page.getByLabel('PDF zoom', { exact: true }).selectOption('1.5');
        await assertPainted(page, 2);
        await page.getByLabel('Search within PDF', { exact: true }).fill('deeper reading');
        await page.waitForFunction(() => document.querySelector('.pdf-find [role=status]')?.textContent?.includes('1/1'));
        await page.getByLabel('Clear PDF search', { exact: true }).click();
        await page.getByLabel('PDF page', { exact: true }).fill('1');
        await page.getByLabel('PDF page', { exact: true }).press('Enter');
        await selectFixturePassage(page, readerPassages[0], `stream ${mode}`);
        await page.getByRole('button', { name: 'Save highlight', exact: true }).click();
        await page.locator('.pdf-page[data-page-number="1"] .pdf-highlight').waitFor();
        await assertPassageHighlight(page);
        await page.reload(); await assertPainted(page, 1); await assertPassageHighlight(page);
        assert.equal(await page.getByRole('alert').count(), 0);
        assert.deepEqual(errors, []);
        assert.ok(imports >= 2, 'compatibility is ready before PDF.js loads, including reload');
        if (mode === 'native') assert.equal(await page.evaluate(() => typeof globalThis.streamBeforePdf !== 'function' || globalThis.streamBeforePdf === ReadableStream.prototype[Symbol.asyncIterator]), true);
        await page.screenshot({ path: `test-results/pdf-stream-${browser.browserType().name()}-${mode}.png` });
        console.log(`PASS: ${browser.browserType().name()} stream ${mode}: page 2 canvas/text, zoom, search, native selection, persisted highlight, reload and pre-import feature detection.`);
      } finally { await context.close(); }
      // Each mode starts without another mode's saved highlights.
      const detail = await (await setup.request.get(`${base}/api/papers/${paper.id}`)).json();
      for (const annotation of detail.annotations) {
        const deleted = await setup.request.delete(`${base}/api/papers/${paper.id}/annotations/${annotation.id}`, { data: { revision: annotation.revision } });
        assert.equal(deleted.ok(), true);
      }
    }
  } finally {
    const detail = await (await setup.request.get(`${base}/api/papers/${paper.id}`)).json();
    const archived = await (await setup.request.patch(`${base}/api/papers/${paper.id}`, { data: { revision: detail.revision, archived: true } })).json();
    assert.equal((await setup.request.delete(`${base}/api/papers/${paper.id}`, { data: { revision: archived.revision, confirmation: paper.id } })).ok(), true);
    await setup.close();
  }
}
