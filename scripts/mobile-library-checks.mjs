import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { textPdf } from '../dist/tests/tests/fixture.js';
import { focused, menuClosed, menuDiagnostics, openNavigation, touchTarget, uiEvidence } from './browser-ui-checks.mjs';

const json = async response => { assert.equal(response.ok(), true, await response.text()); return response.json(); };
const saved = row => row.locator('[data-save-state="Saved"]').waitFor({ state: 'attached' });
const withinViewport = async locator => {
  const box = await locator.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= await locator.page().evaluate(() => innerWidth) + 1, 'control stays inside the viewport');
};
const bounds = async page => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal page overflow');
  for (const element of await page.locator('.paper-title:visible, .paper-authors:visible, .row-tags:visible, .paper-menu-trigger:visible').all()) await withinViewport(element);
};
const menuAction = async (row, action) => {
  await row.locator('.paper-menu-trigger').click();
  await focused(row.getByRole('menuitem').first(), 'Paper menu opening focus');
  await row.getByRole('menuitem', { name: action, exact: true }).click();
};
const navigate = async (page, name) => {
  await openNavigation(page);
  await page.getByRole('navigation', { name: 'Library navigation', exact: true }).getByRole('button', { name, exact: false }).click();
};
const resizeMenuViewport = async (page, viewport) => {
  const since = await page.evaluate(() => performance.now());
  await page.setViewportSize(viewport);
  // Device metrics can be acknowledged before the page receives resize. Observe
  // the real event and let its React update commit before checking preserved focus.
  await page.waitForFunction(({ since, width, height }) => window.__papertrailMenuTrace.some(event =>
    event.type === 'resize' && event.time >= since && event.width === width && event.height === height), { since, ...viewport });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};

export async function mobileLibraryChecks(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await menuDiagnostics(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const ids = [];
  let project;
  try {
    project = await context.request.post(`${base}/api/projects`, { data: { name: `Mobile project ${'connected research '.repeat(4).trim()}` } }).then(json);
    const tag = await context.request.post(`${base}/api/tags`, { data: { name: `mobile-${'longtag'.repeat(12)}` } }).then(json);
    for (const title of [`Mobile long title: ${'Evidence connects ideas across disciplines. '.repeat(4)}${'UnbrokenTitle'.repeat(12)}`, 'Mobile reading collection']) {
      const result = await context.request.post(`${base}/api/upload?projects=${project.id}`, { headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'mobile-research.pdf' }, data: textPdf(title) }).then(json);
      ids.push(result.paper.id);
      await context.request.patch(`${base}/api/papers/${result.paper.id}`, { data: { revision: result.paper.revision, tagIds: [tag.id], status: 'Reading' } }).then(json);
    }
    await page.goto(base);
    const row = page.locator(`#paper-row-${ids[1]}`), longRow = page.locator(`#paper-row-${ids[0]}`);
    await row.waitFor();
    // Exercise project geometry here too: the responsive-only runner skips the
    // longer library management suite. Include actual touch and reduced motion.
    for (const reducedMotion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion });
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await openNavigation(page);
        const projects = page.getByRole('navigation', { name: 'Projects', exact: true });
        const selectProject = projects.getByRole('button', { name: project.name, exact: true });
        const projectMenu = projects.getByRole('button', { name: `Actions for project ${project.name}`, exact: true });
        const label = `${width}px, motion=${reducedMotion}`;
        await touchTarget(selectProject, `Long project selection: ${label}`);
        await touchTarget(projectMenu, `Long project menu trigger: ${label}`);
        await withinViewport(selectProject); await withinViewport(projectMenu);
        const selectBox = await selectProject.boundingBox(), menuBox = await projectMenu.boundingBox();
        assert.ok(selectBox.x + selectBox.width <= menuBox.x, `project selection and actions do not overlap: ${JSON.stringify({ selectBox, menuBox })}`);
        await projectMenu.tap();
        const menu = projects.getByRole('menu'); await menu.waitFor(); await withinViewport(menu);
        const items = await menu.getByRole('menuitem').all();
        assert.equal(items.length, 2);
        for (const item of items) await touchTarget(item, `Project menu action ${await item.innerText()}: ${label}`);
        await page.getByRole('heading', { name: 'Your library', exact: true }).waitFor();
        await page.screenshot({ path: `test-results/library-project-${width}-${reducedMotion}.png`, fullPage: true });
        await page.keyboard.press('Escape');
        await menuClosed(projectMenu, menu);
        await page.getByRole('button', { name: 'Close navigation', exact: true }).tap();
      }
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await bounds(page);
      assert.equal(await page.locator('.page-heading .eyebrow').isVisible(), false);
      assert.equal(await page.locator('.page-heading .subtitle').isVisible(), false);
      assert.equal(await row.locator('[data-save-state="Saved"]').isVisible(), false);
      assert.equal(await row.locator('.paper-selection').isVisible(), false);
      const firstTitle = await row.locator('.paper-title').boundingBox();
      assert.ok(firstTitle.y < 330, `first title appears near the top at ${width}px (${firstTitle.y})`);
      const titleSize = await row.locator('.paper-title').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      const authorsSize = await row.locator('.paper-authors').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(titleSize >= 18 && authorsSize >= 13, 'titles and authors remain readable');
      for (const [locator, label] of [
        [page.getByRole('button', { name: 'Add paper', exact: false }).first(), 'Add paper'],
        [page.getByRole('button', { name: 'Toggle navigation', exact: true }), 'Navigation'],
        [page.getByLabel('Search library', { exact: true }), 'Search'],
        [page.getByLabel('Filter by tag', { exact: true }), 'Tag filter'],
        [page.getByLabel('Filter by reading state', { exact: true }), 'Reading filter'],
        [page.getByRole('button', { name: 'Select papers', exact: true }), 'Selection'],
        [row.locator('.paper-menu-trigger'), 'Paper menu'],
      ]) await touchTarget(locator, label);
      await row.locator('.paper-menu-trigger').click();
      const menu = row.getByRole('menu'); await withinViewport(menu);
      const trigger = row.locator('.paper-menu-trigger');
      const firstItem = menu.getByRole('menuitem').first();
      await focused(firstItem, 'Pointer opening moves focus into the paper menu');
      for (const item of await menu.getByRole('menuitem').all()) await touchTarget(item, 'Menu action');
      // A resize with a still-visible trigger must not silently remove the
      // focused item. This deterministically fails the old unconditional close.
      await page.evaluate(() => new Promise(resolve => {
        window.dispatchEvent(new Event('resize'));
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true', 'same-layout resize retains the open menu');
      await focused(firstItem, 'Same-layout resize retains menu focus');
      await resizeMenuViewport(page, { width, height: 800 });
      await focused(firstItem, 'Height resize retains menu focus');
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
      await resizeMenuViewport(page, { width, height: 844 });
      await uiEvidence(page, 'Paper menu before full-page screenshot', trigger);
      await page.screenshot({ path: `test-results/library-mobile-${width}-menu.png`, fullPage: true });
      await uiEvidence(page, 'Paper menu after full-page screenshot, before Escape', trigger);
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true', 'screenshot must not dismiss the paper menu');
      await focused(firstItem, 'Menu is still focused before Escape');
      await page.keyboard.press('Escape');
      await menuClosed(trigger, menu);
      await uiEvidence(page, 'Paper menu after Escape', trigger);
      await page.screenshot({ path: `test-results/library-mobile-${width}.png`, fullPage: true });
    }
    // Keyboard menu navigation and outside dismissal still work in a touch context.
    const trigger = row.locator('.paper-menu-trigger'), menu = row.getByRole('menu');
    const organize = row.getByRole('menuitem', { name: 'Organize paper', exact: true });
    const archive = row.getByRole('menuitem', { name: 'Archive paper', exact: true });
    await trigger.tap(); await focused(organize);
    await trigger.tap(); await menuClosed(trigger, menu);
    for (const key of ['ArrowDown', 'Enter', 'Space']) {
      await trigger.focus(); await page.keyboard.press(key);
      await focused(organize, `${key} opens at the first action`);
      await page.keyboard.press('End'); await focused(archive);
      await page.keyboard.press('ArrowDown'); await focused(organize, 'ArrowDown wraps');
      await page.keyboard.press('ArrowUp'); await focused(archive, 'ArrowUp wraps');
      await page.keyboard.press('Home'); await focused(organize);
      await page.keyboard.press('Escape'); await menuClosed(trigger, menu);
    }
    await page.keyboard.press('ArrowUp'); await focused(archive, 'ArrowUp opens at the last action');
    await page.keyboard.press('Shift+Tab'); await menuClosed(trigger, menu, row.locator('.paper-open'));
    await trigger.focus(); await page.keyboard.press('ArrowDown'); await focused(organize);
    await page.keyboard.press('Tab'); await menuClosed(trigger, menu, longRow.locator('.paper-open'));
    const search = page.getByLabel('Search library', { exact: true });
    await trigger.click(); await focused(organize); await search.click();
    await menuClosed(trigger, menu, search);
    await trigger.click(); await focused(organize); await search.focus();
    await menuClosed(trigger, menu, search);
    // The same actions stay visible and retain focus across the desktop breakpoint.
    await trigger.click(); await focused(organize);
    await resizeMenuViewport(page, { width: 768, height: 844 });
    await focused(organize, 'Desktop breakpoint keeps the same focused menu');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    await resizeMenuViewport(page, { width: 430, height: 844 });
    await focused(organize, 'Return to mobile keeps the focused menu');
    await page.keyboard.press('Escape'); await menuClosed(trigger, menu);
    // Search and both real API-backed filters; include an empty result.
    await page.getByLabel('Search library', { exact: true }).fill('Mobile reading collection');
    await longRow.waitFor({ state: 'detached' }); await row.waitFor();
    await page.getByLabel('Search library', { exact: true }).fill(''); await longRow.waitFor();
    await page.getByLabel('Filter by tag', { exact: true }).selectOption(tag.id);
    await row.waitFor();
    await page.getByLabel('Filter by reading state', { exact: true }).selectOption('Finished');
    await row.waitFor({ state: 'detached' }); await page.getByRole('heading', { name: 'No papers found', exact: true }).waitFor();
    await page.getByLabel('Filter by reading state', { exact: true }).selectOption('Reading'); await row.waitFor();
    await page.getByLabel('Filter by tag', { exact: true }).selectOption('');
    // Explicit selection preserves the actual export IDs and bytes from the server.
    await page.getByRole('button', { name: 'Select papers', exact: true }).click();
    await touchTarget(row.locator('.paper-selection'), 'Selection label');
    await row.getByRole('checkbox').check();
    await page.locator('.mobile-export summary').click();
    const bib = page.locator('.mobile-export').getByRole('link', { name: 'BibTeX ↗', exact: true });
    const markdown = page.locator('.mobile-export').getByRole('link', { name: 'Markdown ↗', exact: true });
    for (const link of [bib, markdown]) {
      await touchTarget(link, 'Export link'); await withinViewport(link);
      assert.equal(new URL(await link.getAttribute('href'), base).searchParams.get('ids'), ids[1]);
      const download = page.waitForEvent('download'); await link.click();
      const exported = await download;
      assert.equal(await exported.failure(), null);
      const content = await readFile(await exported.path(), 'utf8');
      assert.match(content, /Mobile reading collection/);
      assert.doesNotMatch(content, /Mobile long title/);
    }
    await page.locator('.mobile-export summary').focus(); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await row.getByRole('checkbox').isVisible(), false);
    // Organize long projects/tags through the menu; revision-aware saves and filename download.
    await trigger.focus(); await page.keyboard.press('ArrowDown'); await focused(organize);
    await page.keyboard.press('Enter');
    await row.getByRole('region', { name: 'Organize Mobile reading collection', exact: true }).waitFor();
    await focused(row.getByRole('region'), 'Organize action moves focus into the organizer');
    await row.getByLabel(project.name, { exact: true }).uncheck(); await saved(row);
    assert.deepEqual((await context.request.get(`${base}/api/papers/${ids[1]}`).then(json)).projectIds, []);
    await row.getByLabel(project.name, { exact: true }).check(); await saved(row);
    await bounds(page);
    await page.screenshot({ path: 'test-results/library-mobile-organize.png', fullPage: true });
    await row.getByRole('button', { name: 'Close paper organizer', exact: true }).click();
    await row.getByRole('region').waitFor({ state: 'detached' });
    await focused(trigger, 'Closing organizer returns to paper actions');
    await menuAction(row, 'Rename PDF');
    const filename = row.getByLabel('PDF filename', { exact: true });
    await focused(filename, 'Rename PDF action focuses the filename');
    await filename.fill('Mobile evidence.pdf');
    await row.getByRole('button', { name: 'Save PDF filename', exact: true }).click(); await saved(row);
    assert.equal((await context.request.get(`${base}/api/papers/${ids[1]}`).then(json)).pdfFilename, 'Mobile evidence.pdf');
    await row.getByRole('button', { name: 'Close paper organizer', exact: true }).click();
    // Real mobile import and reveal, then reader entry/back; no credentials or providers.
    await page.getByRole('button', { name: 'Add paper', exact: false }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add a paper', exact: true });
    await dialog.getByLabel('Upload PDF', { exact: true }).setInputFiles({ name: 'mobile-import.pdf', mimeType: 'application/pdf', buffer: textPdf('Mobile imported paper') });
    await dialog.getByLabel(project.name, { exact: true }).check();
    await bounds(page);
    await page.screenshot({ path: 'test-results/library-mobile-import.png', fullPage: true });
    const uploaded = page.waitForResponse(response => response.url().includes('/api/upload?') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Add to library', exact: true }).click();
    const imported = (await (await uploaded).json()).paper; ids.push(imported.id);
    const added = page.locator(`#paper-row-${imported.id}`); await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(id => document.activeElement?.id === `paper-row-${id}`, imported.id);
    const importedBounds = await added.boundingBox(); assert.ok(importedBounds.y < 844 && importedBounds.y + importedBounds.height > 0);
    await page.getByRole('heading', { name: project.name, exact: true }).waitFor();
    await page.locator('.mobile-export summary').click();
    assert.equal(new URL(await page.locator('.mobile-export').getByRole('link', { name: 'BibTeX ↗', exact: true }).getAttribute('href'), base).searchParams.get('project'), project.id);
    await page.locator('.mobile-export summary').focus(); await page.keyboard.press('Escape');
    await added.locator('.paper-open').click(); await page.getByRole('button', { name: 'Back to library', exact: true }).click();
    await added.waitFor();
    await navigate(page, 'All papers'); await row.waitFor();
    // Archive, restore, and guarded permanent deletion from the mobile menu.
    await menuAction(added, 'Archive paper'); await added.waitFor({ state: 'detached' });
    await navigate(page, 'Archive'); await added.waitFor();
    await menuAction(added, 'Return to library'); await added.waitFor({ state: 'detached' });
    await navigate(page, 'All papers'); await added.waitFor();
    await menuAction(added, 'Archive paper'); await added.waitFor({ state: 'detached' });
    await navigate(page, 'Archive'); await added.waitFor();
    page.once('dialog', dialog => dialog.dismiss()); await menuAction(added, 'Permanently delete');
    assert.equal((await context.request.get(`${base}/api/papers/${imported.id}`)).status(), 200);
    page.once('dialog', dialog => dialog.accept()); await menuAction(added, 'Permanently delete');
    await added.waitFor({ state: 'detached' });
    assert.equal((await context.request.get(`${base}/api/papers/${imported.id}`)).status(), 404);
    await navigate(page, 'All papers'); await row.waitFor();
    // Tablet/desktop retain full actions, selection and exports, with bounded long content.
    for (const width of [768, 1024, 1366]) {
      await page.setViewportSize({ width, height: 1000 });
      await bounds(page);
      await trigger.click();
      for (const action of ['Organize paper', 'Rename paper', 'Rename PDF', 'Archive paper'])
        assert.equal(await row.getByRole('menuitem', { name: action, exact: true }).isVisible(), true);
      await page.keyboard.press('Escape');
      assert.equal(await row.locator('.paper-selection').isVisible(), true);
      assert.equal(await row.locator('.paper-menu-trigger').isVisible(), true);
      assert.equal(await page.locator('.export-actions').isVisible(), true);
      await page.screenshot({ path: `test-results/library-responsive-${width}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('PASS: mobile 360/390/430px bounds; 320/390px project/menu 44px targets with normal and reduced motion, long project names and touch input; long titles/tags, keyboard/touch menus, selection and real exports, filters/search, organize/filename saves, upload/reveal, reader entry, archive/restore/delete; tablet/desktop regression. Geometry: test-results/library-browser-evidence.jsonl. Screenshots are browser emulation, not physical devices.');
  } catch (error) {
    await uiEvidence(page, `Responsive failure: ${error.message}`).catch(() => {});
    await page.screenshot({ path: 'test-results/library-responsive-failure.png', fullPage: true }).catch(() => {});
    throw error;
  } finally {
    // This function only mutates its own records in the disposable smoke server.
    for (const id of ids) {
      const response = await context.request.get(`${base}/api/papers/${id}`);
      if (response.status() === 404) continue;
      let paper = await response.json();
      if (!paper.archived) paper = await context.request.patch(`${base}/api/papers/${id}`, { data: { revision: paper.revision, archived: true } }).then(json);
      await context.request.delete(`${base}/api/papers/${id}`, { data: { revision: paper.revision, confirmation: id } }).then(json);
    }
    if (project) await context.request.delete(`${base}/api/projects/${project.id}`, { data: { confirmation: project.id } }).then(json);
    await context.close();
  }
}
