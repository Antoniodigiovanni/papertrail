import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { textPdf } from '../dist/tests/tests/fixture.js';
import { focused, paperAction, waitForReader } from './browser-ui-checks.mjs';

const json = async response => { assert.ok(response.ok(), await response.text()); return response.json(); };

export async function paperRenameChecks(browser, base) {
  for (const width of [1482, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, ...(width < 760 ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let id;
    try {
      const bytes = textPdf(`Rename fixture ${width}`);
      const result = await context.request.post(`${base}/api/upload`, { headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'paper-b1f1c8f8-3f3b-47f9-863f-9eb1c4fb901b.pdf' }, data: bytes }).then(json);
      id = result.paper.id;
      const url = `${base}/api/papers/${id}`;
      const detail = () => context.request.get(url).then(json);
      await context.request.post(`${url}/annotations`, { data: { page: 1, quote: 'Keep this passage', rects: [[.1, .1, .4, .2]], color: 'green', comment: 'Keep this comment' } }).then(json);
      const annotated = await detail();
      await context.request.patch(url, { data: { revision: annotated.revision, note: 'Keep notes', status: 'Reading', position: { page: 2, offset: .3 } } }).then(json);
      await page.goto(base);
      const row = page.locator(`#paper-row-${id}`), trigger = row.locator('.paper-menu-trigger');
      const dialog = page.getByRole('dialog', { name: 'Rename paper', exact: true });
      const input = dialog.getByLabel('Paper title', { exact: true });
      const save = dialog.getByRole('button', { name: 'Save title', exact: true });
      const titleIs = async title => {
        await page.waitForFunction(({ id, title }) => document.querySelector(`#paper-row-${id} .paper-title`)?.textContent === title, { id, title });
        assert.equal(await row.getAttribute('aria-label'), `Paper: ${title}`);
        assert.equal(await trigger.getAttribute('aria-label'), `Actions for paper ${title}`);
      };
      const unchangedFile = async before => {
        const after = await detail();
        assert.equal(after.pdfFilename, before.pdfFilename);
        assert.equal(after.pdfSha, before.pdfSha);
        assert.deepEqual(await (await context.request.get(`${url}/pdf`)).body(), bytes);
      };
      const before = await detail();
      await paperAction(row, 'Rename paper');
      await focused(input, 'Rename paper opens with the title selected');
      assert.equal(await input.inputValue(), before.title);
      assert.equal(await input.evaluate(el => el.selectionEnd - el.selectionStart), before.title.length);
      await save.focus(); await page.keyboard.press('Tab'); await focused(input);
      await page.keyboard.press('Shift+Tab'); await focused(save);
      await input.fill('Canceled title'); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog.waitFor({ state: 'detached' }); await focused(trigger);
      assert.deepEqual(await detail(), before);
      await paperAction(row, 'Rename paper'); await input.fill('Escape draft'); await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' }); await focused(trigger);
      assert.deepEqual(await detail(), before);
      await paperAction(row, 'Rename paper');
      for (const [value, error] of [['   ', /Enter a paper title/], ['x'.repeat(2001), /2000 characters/]]) {
        await input.fill(value); await save.click();
        assert.match(await dialog.getByRole('alert').innerText(), error);
        await focused(input); assert.deepEqual(await detail(), before);
      }
      const renamed = `Renamed research ${width}`;
      await input.fill(`  ${renamed}  `);
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const hold = async route => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        assert.deepEqual(route.request().postDataJSON(), { revision: before.revision, title: renamed });
        await gate; await route.continue();
      };
      await page.route(url, hold);
      try {
        const request = page.waitForRequest(req => req.url() === url && req.method() === 'PATCH');
        await save.click(); await request;
        assert.equal(await row.locator('.paper-title').innerText(), before.title, 'unconfirmed draft never replaces the title');
        await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true, 'pending save retains dialog');
        assert.deepEqual(await detail(), before);
      } finally { release(); }
      await dialog.waitFor({ state: 'detached' }); await page.unroute(url, hold);
      await titleIs(renamed); await focused(trigger);
      const after = await detail();
      assert.deepEqual(after, { ...before, title: renamed, revision: before.revision + 1, updated: after.updated });
      await unchangedFile(before);
      await page.reload(); await titleIs(renamed);

      // Failed saves keep the local draft and the confirmed row/server title.
      await paperAction(row, 'Rename paper'); await input.fill('Rejected title');
      const reject = route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, json: { error: 'Title storage unavailable' } }) : route.fallback();
      await page.route(url, reject); await save.click();
      assert.match(await dialog.getByRole('alert').innerText(), /Title storage unavailable/);
      assert.equal(await input.inputValue(), 'Rejected title'); assert.equal(await save.isDisabled(), true);
      await titleIs(renamed); assert.deepEqual(await detail(), after); await unchangedFile(before);
      await page.unroute(url, reject);
      await dialog.getByRole('button', { name: 'Reload latest paper', exact: true }).click();
      await page.waitForFunction(el => el.value.startsWith('Renamed research'), await input.elementHandle());
      await focused(input);

      // A real competing revision must never overwrite the newer title or notes.
      const competing = await context.request.patch(url, { data: { revision: after.revision, title: 'Title on another device', note: 'Newer remote notes' } }).then(json);
      await input.fill('Stale local title'); await save.click();
      assert.match(await dialog.getByRole('alert').innerText(), /changed on another device/);
      assert.equal(await input.inputValue(), 'Stale local title');
      assert.deepEqual(await detail(), competing);
      await titleIs(renamed);
      await dialog.getByRole('button', { name: 'Reload latest paper', exact: true }).click();
      await page.waitForFunction(el => el.value === 'Title on another device', await input.elementHandle());
      await titleIs('Title on another device');
      await input.fill(renamed); await save.click(); await dialog.waitFor({ state: 'detached' });
      await titleIs(renamed); assert.equal((await detail()).note, 'Newer remote notes');
      await unchangedFile(before);

      // Reader header/details and subsequent library reload use the same title.
      await row.locator('.paper-open').click(); await waitForReader(page, id, renamed);
      await page.getByRole('button', { name: 'Organize paper', exact: true }).click();
      assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), renamed);
      assert.equal(await page.getByLabel('PDF filename', { exact: true }).inputValue(), before.pdfFilename);
      const readerTitle = `${renamed} from reader`;
      await page.getByLabel('Title', { exact: true }).fill(readerTitle);
      await page.getByRole('button', { name: 'Save details', exact: true }).click();
      await page.waitForFunction(title => document.querySelector('.reader-heading strong')?.textContent === title, readerTitle);
      await page.getByRole('button', { name: 'Back to library', exact: true }).click(); await titleIs(readerTitle);
      await page.reload(); await titleIs(readerTitle); await unchangedFile(before);
      await paperAction(row, 'Rename PDF');
      const filename = row.getByLabel('PDF filename', { exact: true }); await focused(filename);
      await filename.fill(`Separate download ${width}.pdf`);
      await row.getByRole('button', { name: 'Save PDF filename', exact: true }).click();
      await row.locator('.paper-filename').filter({ hasText: `Separate download ${width}.pdf` }).waitFor();
      await titleIs(readerTitle);
      const downloadEvent = page.waitForEvent('download'); await row.getByRole('link', { name: 'Download PDF', exact: true }).click();
      const download = await downloadEvent;
      assert.equal(download.suggestedFilename(), `Separate download ${width}.pdf`);
      assert.deepEqual(await readFile(await download.path()), bytes);
      assert.deepEqual(errors, []);
    } finally {
      if (id) {
        let latest = await context.request.get(`${base}/api/papers/${id}`).then(json);
        if (!latest.archived) latest = await context.request.patch(`${base}/api/papers/${id}`, { data: { revision: latest.revision, archived: true } }).then(json);
        await context.request.delete(`${base}/api/papers/${id}`, { data: { confirmation: id, revision: latest.revision } }).then(json);
      }
      await context.close();
    }
  }
  console.log('PASS: desktop/mobile paper-title rename, dialog focus/validation/cancel, pending save, failure rollback, real revision conflict/reload, library-reader persistence and independent filename/download with identical PDF bytes.');
}
