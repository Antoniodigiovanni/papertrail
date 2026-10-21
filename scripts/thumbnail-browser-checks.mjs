import assert from 'node:assert/strict';
import { textPdf } from '../dist/tests/tests/fixture.js';
import { assertPainted } from './reader-browser-checks.mjs';
import { writeFile } from 'node:fs/promises';

export async function thumbnailChecks(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ids = [];
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.thumbnailResources = { workers: 0, peak: 0, urls: new Set(), canvases: [], phasePaints: new Set(), peakCanvases: 0 };
    const stats = window.thumbnailResources;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); stats.workers++; stats.peak = Math.max(stats.peak, stats.workers); }
      terminate() { if (!this.stopped) { this.stopped = true; stats.workers--; } return super.terminate(); }
    };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = value => { const url = create(value); stats.urls.add(url); return url; };
    URL.revokeObjectURL = url => { stats.urls.delete(url); revoke(url); };
    new MutationObserver(() => {
      const canvases = [...document.querySelectorAll('.pdf-thumbnail canvas')];
      stats.peakCanvases = Math.max(stats.peakCanvases, canvases.length);
      canvases.forEach(canvas => {
        if (!stats.canvases.includes(canvas)) stats.canvases.push(canvas);
        stats.phasePaints.add(canvas.closest('.paper-row').dataset.paperId);
      });
    }).observe(document, { childList: true, subtree: true });
  });
  let stage = 'setup';
  const requested = [];
  page.on('request', request => { if (/\/api\/papers\/[^/]+\/pdf$/.test(request.url())) requested.push(request.url()); });
  try {
    for (let i = 0; i < 15; i++) {
      const response = await context.request.post(`${base}/api/upload`, { headers: { 'Content-Type': 'application/pdf', 'X-Filename': `preview-${i}.pdf` }, data: textPdf(`Thumbnail fixture ${i}`) });
      assert.equal(response.status(), 201);
      ids.push((await response.json()).paper.id);
    }
    const fallbackId = ids[14];
    const failPreview = route => route.fulfill({ status: 503, body: 'unavailable' });
    await page.route(`**/api/papers/${fallbackId}/pdf`, failPreview);
    // Keep fixture entries out of view before effects/observers run.
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.id = 'thumbnail-test-layout';
      style.textContent = '.paper-row{margin-top:2000px!important}';
      document.addEventListener('DOMContentLoaded', () => document.head.append(style));
    });
    stage = 'offscreen request suppression';
    await page.goto(base);
    await page.locator('.pdf-thumbnail').first().waitFor();
    await page.waitForTimeout(800);
    assert.equal(requested.length, 0, 'offscreen rows do not fetch PDFs');
    stage = 'actual first-page pixels';
    const row = page.locator(`#paper-row-${ids[2]}`);
    await row.scrollIntoViewIfNeeded();
    const canvas = row.locator('.pdf-thumbnail canvas');
    await canvas.waitFor();
    assert.equal(await canvas.evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0, white = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] && pixels[i] < 180) ink++;
        if (pixels[i] > 240 && pixels[i + 3]) white++;
      }
      return canvas.width <= 120 && canvas.height <= 160 && ink > 10 && white > 100;
    }), true, 'first-page fixture contains actual ink and paper pixels within the pixel budget');
    for (const width of [320, 360, 390, 430, 1482]) {
      await page.setViewportSize({ width, height: 844 });
      await row.scrollIntoViewIfNeeded();
      assert.equal(await row.locator('.pdf-thumbnail').evaluate(el => { const r = el.getBoundingClientRect(); return r.width <= 42 && r.height <= 56; }), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await row.locator('.pdf-thumbnail canvas').waitFor();
      await page.screenshot({ path: `test-results/thumbnail-${width}.png` });
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForFunction(() => !document.querySelector('.pdf-thumbnail canvas'));
    await page.waitForFunction(() => window.thumbnailResources.workers === 0);
    assert.equal(await page.evaluate(() => window.thumbnailResources.canvases.every(c => c.width === 0 && c.height === 0)), true, 'released canvases relinquish their backing store');
    stage = 'held PDF cancellation';
    let heldRoute;
    const hold = route => { heldRoute = route; };
    await page.route(`**/api/papers/${ids[1]}/pdf`, hold);
    const pendingRequest = page.waitForRequest(`**/api/papers/${ids[1]}/pdf`);
    await page.locator(`#paper-row-${ids[1]}`).scrollIntoViewIfNeeded();
    await page.waitForFunction(id => document.querySelector(`#paper-row-${id} .pdf-thumbnail`).dataset.state === 'loading', ids[1]);
    await page.waitForFunction(id => document.querySelector(`#paper-row-${id} .pdf-thumbnail`).dataset.state === 'loading' && window.thumbnailResources.workers === 1, ids[1]);
    await pendingRequest;
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForFunction(() => window.thumbnailResources.workers === 0);
    await heldRoute?.abort().catch(() => {});
    await page.unroute(`**/api/papers/${ids[1]}/pdf`, hold);
    stage = 'fallback after canceling held load';
    const fallbackRow = page.locator(`#paper-row-${fallbackId}`);
    const fallbackResponse = page.waitForResponse(response => response.url().endsWith(`/api/papers/${fallbackId}/pdf`) && response.status() === 503);
    await fallbackRow.scrollIntoViewIfNeeded();
    await fallbackResponse;
    await page.waitForFunction(id => document.querySelector(`#paper-row-${id} .pdf-thumbnail`).dataset.state === 'fallback', fallbackId);
    assert.equal(await fallbackRow.locator('.pdf-thumbnail').innerText(), 'PDF');
    await page.unroute(`**/api/papers/${fallbackId}/pdf`, failPreview);
    await row.locator('.paper-open').click();
    await assertPainted(page, 1);
    await page.waitForFunction(() => !document.querySelector('.pdf-thumbnail'));
    assert.ok(await page.evaluate(() => window.thumbnailResources.peak <= 2), 'one thumbnail worker and one priority reader worker at most');
    await page.getByRole('button', { name: 'Back to library', exact: true }).click();
    await page.waitForFunction(() => window.thumbnailResources.workers === 0);
    assert.equal(await page.evaluate(() => window.thumbnailResources.urls.size), 0, 'no retained object URLs');
    stage = 'fifteen visible PDFs and twelve retained canvases';
    await page.evaluate(() => { window.thumbnailResources.phasePaints.clear(); document.querySelector('#thumbnail-test-layout')?.remove(); });
    await page.setViewportSize({ width: 1482, height: 10000 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForFunction(() => window.thumbnailResources.phasePaints.size === 15
      && document.querySelectorAll('.pdf-thumbnail[data-state="ready"]').length === 12
      && window.thumbnailResources.workers === 0);
    const retained = await page.evaluate(() => {
      const canvases = [...document.querySelectorAll('.pdf-thumbnail canvas')];
      return { count: canvases.length, bytes: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0) };
    });
    assert.equal(await page.evaluate(() => window.thumbnailResources.peakCanvases <= 12), true, 'canvas count never exceeds twelve during eviction');
    assert.equal(retained.count, 12, 'the canvas cache evicts previews beyond its twelve-entry cap');
    assert.ok(retained.bytes <= 12 * 120 * 160 * 4, 'retained canvas backing memory stays below 12 small previews');
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.id = 'thumbnail-test-layout';
      style.textContent = '.paper-row{margin-top:2000px!important}';
      document.head.append(style); scrollTo(0, 0);
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => !document.querySelector('.pdf-thumbnail canvas'));
    await page.waitForFunction(() => window.thumbnailResources.workers === 0);
    assert.equal(await page.evaluate(() => window.thumbnailResources.canvases.every(c => c.width === 0 && c.height === 0)), true, 'evicted and offscreen previews release all canvas backing stores');
    await stalledThumbnailCheck(browser, base, ids[0], ids[1]);
    console.log('PASS: never-settling PDF.js load/destroy cancellation and next-job progress; thumbnail pixels, lazy requests, bounded layout/cache, offscreen canvas/worker cleanup, fallback and reader paint');
  } catch (error) {
    const evidence = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight, scrollY },
      workers: window.thumbnailResources.workers, peak: window.thumbnailResources.peak,
      paints: [...window.thumbnailResources.phasePaints],
      rows: [...document.querySelectorAll('.paper-row')].map(row => ({
        id: row.dataset.paperId, state: row.querySelector('.pdf-thumbnail')?.dataset.state,
        rect: row.getBoundingClientRect().toJSON(), canvas: !!row.querySelector('canvas'),
      })),
    })).catch(() => ({}));
    await writeFile('test-results/thumbnail-failure.json', JSON.stringify({ stage, error: error.message, requested, evidence }, null, 2));
    await page.screenshot({ path: 'test-results/thumbnail-failure.png' }).catch(() => {});
    throw error;
  } finally {
    await page.close();
    for (const id of ids) {
      const current = await (await context.request.get(`${base}/api/papers/${id}`)).json();
      const archived = await context.request.patch(`${base}/api/papers/${id}`, { data: { revision: current.revision, archived: true } });
      assert.equal(archived.ok(), true);
      const latest = await (await context.request.get(`${base}/api/papers/${id}`)).json();
      assert.equal((await context.request.delete(`${base}/api/papers/${id}`, { data: { confirmation: id, revision: latest.revision } })).ok(), true);
    }
    await context.close();

  }
}

// Only this regression substitutes a deliberately broken loading task. All pixel,
// worker/cache/fallback and reader checks above use the unmodified bundled module.
async function stalledThumbnailCheck(browser, base, stalledId, nextId) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.addInitScript(id => {
      window.thumbnailStall = { id, started: 0, destroyed: 0 };
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '.paper-row{margin-top:2000px!important}';
        document.head.append(style);
      });
    }, stalledId);
    await page.route(/\/vendor\/pdfjs\/pdf\.mjs$/, route => route.fulfill({ contentType: 'text/javascript', body: `
      export * from '/vendor/pdfjs/pdf.mjs?actual';
      import { getDocument as actual } from '/vendor/pdfjs/pdf.mjs?actual';
      export function getDocument(options) {
        const state = window.thumbnailStall;
        if (options.stopAtErrors !== false && options.url === '/api/papers/' + state.id + '/pdf') {
          state.started++;
          return { promise: new Promise(() => {}), destroy: () => { state.destroyed++; return new Promise(() => {}); } };
        }
        return actual(options);
      }
    ` }));
    await page.goto(base);
    const stalled = page.locator(`#paper-row-${stalledId}`), next = page.locator(`#paper-row-${nextId}`);
    await stalled.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => window.thumbnailStall.started === 1);
    await next.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => window.thumbnailStall.destroyed === 1);
    await next.locator('.pdf-thumbnail[data-state="ready"] canvas').waitFor();
    assert.equal(await stalled.locator('.pdf-thumbnail canvas').count(), 0);
    await stalled.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => window.thumbnailStall.started === 2);
    await stalled.locator('.paper-open').click(); await assertPainted(page, 1);
    await page.waitForFunction(() => window.thumbnailStall.destroyed === 2);
  } finally { await context.close(); }
}
