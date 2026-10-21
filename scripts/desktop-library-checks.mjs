import assert from 'node:assert/strict';
import { textPdf } from '../dist/tests/tests/fixture.js';
import { focused, menuClosed, paperAction, uiEvidence } from './browser-ui-checks.mjs';

const json = async response => { assert.ok(response.ok(), await response.text()); return response.json(); };
const box = async locator => { const rect = await locator.boundingBox(); assert.ok(rect); return rect; };
const right = rect => rect.x + rect.width, bottom = rect => rect.y + rect.height;
const inside = (inner, outer, label) => assert.ok(inner.x >= outer.x - 1 && right(inner) <= right(outer) + 1 && inner.y >= outer.y - 1 && bottom(inner) <= bottom(outer) + 1, `${label}: ${JSON.stringify({ inner, outer })}`);

export async function desktopLibraryChecks(browser, base) {
  const setup = await browser.newContext();
  const ids = [];
  const labels = [];
  try {
    for (const [kind, name] of [['projects', 'Desktop project'], ['tags', 'desktop-evidence']])
      labels.push({ kind, ...await setup.request.post(`${base}/api/${kind}`, { data: { name } }).then(json) });
    for (const title of ['Desktop paper', `Desktop long title ${'UnbrokenResearchTitle'.repeat(60)}`]) {
      const result = await setup.request.post(`${base}/api/upload`, { headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'paper-b1f1c8f8-3f3b-47f9-863f-9eb1c4fb901b.pdf' }, data: textPdf(title) }).then(json);
      ids.push(result.paper.id);
      const isLong = ids.length === 2;
      await setup.request.patch(`${base}/api/papers/${result.paper.id}`, { data: {
        revision: result.paper.revision, projectIds: [labels[0].id], tagIds: [labels[1].id],
        ...(isLong ? { pdfFilename: `${'LongDownload'.repeat(18)}.pdf`, authors: ['LongUnbrokenAuthor'.repeat(15)], venue: 'LongUnbrokenVenue'.repeat(40) } : {}),
      } }).then(json);
    }
    // CSS viewports model the available space at 100/125/150/200% zoom on a
    // 1482px display. DPR cases also cover fractional display scaling; they do
    // not assert a physical OS/browser or native zoom interaction was tested.
    for (const [width, dpr] of [[1920, 1], [1482, 1], [1482, 1.25], [1366, 1], [1186, 1.25], [1024, 1], [988, 1.5], [900, 1], [768, 1.25], [741, 2]]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: dpr });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(base);
        const normal = page.locator(`#paper-row-${ids[0]}`), long = page.locator(`#paper-row-${ids[1]}`);
        await normal.waitFor(); await long.waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        for (const row of [normal, long]) {
          const rowBox = await box(row), summary = await box(row.locator('.paper-row-summary'));
          const open = await box(row.locator('.paper-open')), trigger = await box(row.locator('.paper-menu-trigger'));
          const info = await box(row.locator('.paper-info'));
          inside(summary, rowBox, 'summary fits the row'); inside(open, summary, 'open button fits the summary');
          inside(trigger, rowBox, 'actions fit the row'); inside(info, open, 'text fits its open button');
          assert.ok(right(open) <= trigger.x + 1, 'paper text and actions have separate columns');
          assert.ok(trigger.width >= 44 && trigger.height >= 44, 'actions retain a usable target');
          assert.equal(await row.locator('[data-save-state=Saved]').isVisible(), false, 'Saved adds no second row');
          assert.equal(await row.getByRole('button', { name: 'Archive paper', exact: true }).count(), 0, 'archive is in the menu');
          if (width > 760) {
            assert.equal(await row.evaluate(el => getComputedStyle(el).display), 'grid');
            assert.ok(Math.abs(summary.y - trigger.y) <= 1, 'summary and actions start on the same row');
            const state = await box(row.locator('.desktop-state')), selection = await box(row.locator('.paper-selection'));
            inside(state, summary, 'reading state stays in the summary');
            assert.ok(right(selection) <= open.x && right(open) <= state.x, 'selection, title and reading state never overlap');
            for (const selector of ['.paper-title', '.paper-authors', '.paper-meta']) {
              const element = row.locator(selector);
              if (!await element.isVisible()) continue;
              const rect = await box(element);
              const lineHeight = await element.evaluate(el => parseFloat(getComputedStyle(el).lineHeight));
              assert.ok(rect.height <= lineHeight * 2 + 1, `${selector} stays within two lines`);
              inside(rect, info, `${selector} fits its text column`);
            }
            assert.equal(await row.locator('.paper-filename').evaluate(el => getComputedStyle(el).textOverflow), 'ellipsis');
          }
          const triggerLocator = row.locator('.paper-menu-trigger');
          await triggerLocator.focus(); await page.keyboard.press('ArrowDown');
          const menu = row.getByRole('menu');
          await focused(menu.getByRole('menuitem').first());
          const menuBox = await box(menu);
          assert.ok(menuBox.x >= 0 && right(menuBox) <= width, 'open menu is inside the viewport');
          for (const name of ['Organize paper', 'Rename paper', 'Rename PDF', 'Archive paper']) {
            const item = menu.getByRole('menuitem', { name, exact: true });
            const itemBox = await box(item); inside(itemBox, menuBox, 'menu item stays inside menu');
            assert.equal(await item.evaluate(el => { const rect = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); }), true, 'menu item is not obscured by another row');
          }
          await page.keyboard.press('Escape'); await menuClosed(triggerLocator, menu);
        }
        const normalBox = await box(normal), longBox = await box(long);
        assert.ok(normalBox.height <= (width > 760 ? 180 : 230), `normal row stays compact at ${width}px: ${normalBox.height}`);
        assert.ok(longBox.height <= (width > 760 ? 360 : 1600), `long row is bounded at ${width}px: ${longBox.height}`);
        assert.ok(bottom(longBox) <= normalBox.y || bottom(normalBox) <= longBox.y, 'adjacent rows do not overlap');
        if (width > 760) {
          await normal.getByRole('checkbox').check();
          assert.equal(await normal.getByRole('checkbox').isChecked(), true, 'desktop selection stays available');
        }
        await paperAction(normal, 'Organize paper');
        const organizer = normal.getByRole('region'); await focused(organizer);
        const organizerBox = await box(organizer), expanded = await box(normal);
        inside(organizerBox, expanded, 'expanded organizer fits the row');
        assert.ok(organizerBox.width >= expanded.width - 12, 'organizer spans the available row width');
        assert.ok(organizerBox.y >= bottom(await box(normal.locator('.paper-row-summary'))), 'organizer sits below the summary');
        assert.equal(await normal.getByLabel(labels[0].name, { exact: true }).isChecked(), true);
        await normal.getByRole('button', { name: 'Close paper organizer', exact: true }).click();
        await focused(normal.locator('.paper-menu-trigger'));
        assert.ok(Math.abs((await box(normal)).height - normalBox.height) <= 1, 'closing organizer restores the compact row');
        await paperAction(normal, 'Rename PDF'); await focused(normal.getByLabel('PDF filename', { exact: true }));
        await normal.getByRole('button', { name: 'Close paper organizer', exact: true }).click();
        await uiEvidence(page, `Desktop library ${width}px DPR ${dpr}`, page.locator('.paper-row'));
        await page.screenshot({ path: `test-results/library-desktop-${width}-${dpr}.png`, fullPage: true });
        assert.deepEqual(errors, []);
      } catch (error) {
        await uiEvidence(page, `Desktop layout failure ${width}px DPR ${dpr}: ${error.message}`, page.locator('.paper-row')).catch(() => {});
        await page.screenshot({ path: `test-results/library-desktop-failure-${width}-${dpr}.png`, fullPage: true }).catch(() => {});
        throw error;
      } finally { await context.close(); }
    }
  } finally {
    for (const id of ids) {
      let paper = await setup.request.get(`${base}/api/papers/${id}`).then(json);
      if (!paper.archived) paper = await setup.request.patch(`${base}/api/papers/${id}`, { data: { revision: paper.revision, archived: true } }).then(json);
      await setup.request.delete(`${base}/api/papers/${id}`, { data: { confirmation: id, revision: paper.revision } }).then(json);
    }
    for (const label of labels.filter(label => label.kind === 'projects'))
      await setup.request.delete(`${base}/api/projects/${label.id}`, { data: { confirmation: label.id } }).then(json);
    await setup.close();
  }
  console.log('PASS: bounded desktop grid geometry, compact rows, long metadata, unobscured menus, selection and full-width organizer at 1920/1482/1366/1186/1024/988/900/768px, plus 741px responsive zoom equivalent and fractional DPR. Browser emulation only; physical Windows Chrome/Edge not tested.');
}
