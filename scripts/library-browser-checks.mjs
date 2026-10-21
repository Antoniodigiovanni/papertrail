import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { textPdf } from '../dist/tests/tests/fixture.js';
import { focused, menuClosed, menuDiagnostics, openNavigation, touchTarget, uiEvidence, waitForReader } from './browser-ui-checks.mjs';

const waitSaved = page => page.waitForFunction(() => [...document.querySelectorAll('.library-paper-controls [role=status], .save-state')].every(el => el.textContent.includes('Saved')));
const json = async response => { assert.equal(response.ok(), true, await response.text()); return response.json(); };

export async function libraryManagementChecks(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await menuDiagnostics(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const library = () => context.request.get(`${base}/api/library`).then(json);
  const detail = id => context.request.get(`${base}/api/papers/${id}`).then(json);
  const projectNav = page.getByRole('navigation', { name: 'Projects', exact: true });
  const actions = name => projectNav.getByRole('button', { name: `Actions for project ${name}`, exact: true });
  const projectAction = async (name, action) => {
    await actions(name).click();
    await focused(page.getByRole('menuitem', { name: `Rename project ${name}`, exact: true }), 'Project menu opening focus');
    await page.getByRole('menuitem', { name: `${action} project ${name}`, exact: true }).click();
  };
  const row = title => page.locator('.paper-row').filter({ has: page.locator('.paper-title', { hasText: title }) });
  const addTag = async (container, name) => {
    await container.getByLabel('Add tag', { exact: true }).fill(name);
    await container.getByRole('button', { name: 'Add tag', exact: true }).click();
    await waitSaved(page);
    await container.getByRole('button', { name: `Remove tag ${name}`, exact: true }).waitFor();
    await container.getByRole('button', { name: 'Saving tag…', exact: true }).waitFor({ state: 'detached' });
  };
  const importPdf = async (title, project) => {
    await page.getByRole('button', { name: 'Add paper', exact: false }).first().click();
    await page.getByLabel('Upload PDF', { exact: true }).setInputFiles({ name: 'library.pdf', mimeType: 'application/pdf', buffer: textPdf(title) });
    for (const checkbox of await page.getByRole('dialog').getByRole('checkbox').all()) await checkbox.uncheck();
    if (project) await page.getByRole('dialog').getByLabel(project, { exact: true }).check();
    await page.getByRole('button', { name: 'Add to library', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    const added = row(title); await added.waitFor();
    const id = await added.getAttribute('data-paper-id');
    await page.waitForFunction(id => document.activeElement?.id === `paper-row-${id}`, id);
    assert.equal(new URL(page.url()).hash, '', 'import stays in the library');
    await page.getByRole('heading', { name: project || 'Your library', exact: true }).waitFor();
    // Existing assignment/reader checks intentionally continue from All papers.
    await page.getByRole('button', { name: 'All papers', exact: false }).click();
    await added.locator('.paper-open').click();
    await page.getByRole('button', { name: 'Back to library', exact: true }).waitFor();
    return id;
  };
  try {
    await page.goto(base);
    await page.getByRole('heading', { name: 'Your library', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'New tag', exact: true }).count(), 0);
    for (const name of ['Library original', 'Library shared', 'Library retained']) {
      page.once('dialog', dialog => dialog.accept(name));
      await page.getByRole('button', { name: 'New project', exact: true }).click();
      await projectNav.getByRole('button', { name, exact: true }).waitFor();
    }
    const firstId = await importPdf('Library first paper', 'Library original');
    await page.getByLabel('General note', { exact: true }).fill('Keep this note after deleting a project.');
    await page.getByRole('button', { name: 'Save note', exact: true }).click(); await waitSaved(page);
    await page.getByRole('button', { name: 'Organize paper', exact: true }).click();
    await addTag(page, 'library-evidence');
    await context.request.post(`${base}/api/papers/${firstId}/annotations`, { data: { page: 1, quote: 'Preserved passage', rects: [[.1, .1, .4, .2]], color: 'green', comment: 'Preserved annotation' } }).then(json);
    await page.getByRole('button', { name: 'Back to library', exact: true }).click();
    const first = row('Library first paper');
    await first.getByRole('button', { name: 'Organize paper', exact: true }).click();
    await addTag(first, 'library-reflection');
    const firstUrl = `${base}/api/papers/${firstId}`;
    // Filename edits are independent of title, storage identity and annotation anchors.
    const filenameBefore = await detail(firstId);
    const filenameBytes = await (await context.request.get(`${firstUrl}/pdf`)).body();
    await first.getByLabel('PDF filename', { exact: true }).fill('../unsafe.pdf');
    await first.getByRole('button', { name: 'Save PDF filename', exact: true }).click();
    await first.getByRole('alert').filter({ hasText: 'without paths' }).waitFor();
    assert.deepEqual(await detail(firstId), filenameBefore);
    const editedFilename = "Étude d'algèbre (2026).pdf";
    await first.getByLabel('PDF filename', { exact: true }).fill(editedFilename);
    await first.getByRole('button', { name: 'Save PDF filename', exact: true }).click();
    await first.locator('.paper-filename').filter({ hasText: editedFilename }).waitFor(); await waitSaved(page);
    const filenameAfter = await detail(firstId);
    assert.deepEqual(filenameAfter, { ...filenameBefore, pdfFilename: editedFilename, revision: filenameBefore.revision + 1, updated: filenameAfter.updated });
    const downloadEvent = page.waitForEvent('download');
    await first.getByRole('link', { name: 'Download PDF', exact: true }).click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), editedFilename);
    assert.deepEqual(await readFile(await download.path()), filenameBytes);
    await page.reload(); await first.getByRole('button', { name: 'Organize paper', exact: true }).click();
    assert.equal(await first.getByLabel('PDF filename', { exact: true }).inputValue(), editedFilename);
    await first.locator('.paper-open').click();
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    assert.equal(await page.getByLabel('PDF filename', { exact: true }).inputValue(), editedFilename);
    assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), filenameBefore.title);
    await page.getByRole('button', { name: 'Back to library', exact: true }).click();
    await first.getByRole('button', { name: 'Organize paper', exact: true }).click();
    // Hold a saved response and queue several independent memberships and chip edits.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let held = false;
    const hold = async route => {
      if (route.request().method() !== 'PATCH' || held) return route.fallback();
      held = true; const response = await route.fetch(); await gate; await route.fulfill({ response });
    };
    await page.route(firstUrl, hold);
    try {
      const request = page.waitForRequest(req => req.url() === firstUrl && req.method() === 'PATCH');
      await first.getByLabel('Library shared', { exact: true }).check(); await request;
      await first.getByLabel('Library retained', { exact: true }).check();
      await first.getByLabel('Library original', { exact: true }).uncheck();
      await first.getByLabel('Library shared', { exact: true }).uncheck();
      await first.getByLabel('Library shared', { exact: true }).check();
      await first.getByRole('button', { name: 'Remove tag library-evidence', exact: true }).click();
      await first.getByRole('button', { name: 'Add tag library-evidence', exact: true }).click();
      assert.equal(await first.getByLabel('Library retained', { exact: true }).isChecked(), true);
      assert.equal(await first.getByLabel('Library original', { exact: true }).isChecked(), false);
      await first.getByRole('button', { name: 'Remove tag library-evidence', exact: true }).waitFor();
    } finally { release(); }
    await waitSaved(page); await page.unroute(firstUrl, hold);
    const labels = await library();
    const shared = labels.projects.find(p => p.name === 'Library shared');
    const retained = labels.projects.find(p => p.name === 'Library retained');
    assert.deepEqual(new Set((await detail(firstId)).projectIds), new Set([shared.id, retained.id]));
    await page.reload(); await row('Library first paper').getByRole('button', { name: 'Organize paper', exact: true }).click();
    assert.equal(await first.getByLabel('Library shared', { exact: true }).isChecked(), true);
    assert.equal(await first.getByLabel('Library retained', { exact: true }).isChecked(), true);
    await first.getByRole('button', { name: 'Remove tag library-reflection', exact: true }).click(); await waitSaved(page);
    await page.reload(); await first.getByRole('button', { name: 'Organize paper', exact: true }).click();
    assert.equal(await first.getByRole('button', { name: 'Remove tag library-reflection', exact: true }).count(), 0);
    await first.getByRole('button', { name: 'Add tag library-reflection', exact: true }).waitFor();

    // Real revision conflict rolls back an optimistic project choice and requires reload.
    const beforeConflict = await detail(firstId);
    await context.request.patch(firstUrl, { data: { revision: beforeConflict.revision, venue: 'Changed on another device' } }).then(json);
    await first.getByLabel('Library retained', { exact: true }).uncheck();
    await first.getByRole('button', { name: 'Reload latest', exact: true }).waitFor();
    assert.match(await first.getByRole('alert').innerText(), /changed on another device/);
    assert.equal(await first.getByLabel('Library retained', { exact: true }).isChecked(), true);
    await first.getByRole('button', { name: 'Reload latest', exact: true }).click(); await waitSaved(page);
    // Transport/storage failure on a chip removal also rolls back without changing the server.
    const reject = async route => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Library assignment unavailable' }) });
    };
    await page.route(firstUrl, reject);
    await first.getByRole('button', { name: 'Remove tag library-evidence', exact: true }).click();
    await first.getByRole('button', { name: 'Reload latest', exact: true }).waitFor();
    await first.getByRole('button', { name: 'Remove tag library-evidence', exact: true }).waitFor();
    assert.match(await first.getByRole('alert').innerText(), /Library assignment unavailable/);
    await page.unroute(firstUrl, reject);
    await first.getByRole('button', { name: 'Reload latest', exact: true }).click(); await waitSaved(page);

    const secondId = await importPdf('Library orphan paper', 'Library shared');
    await page.getByRole('button', { name: 'Organize paper', exact: true }).click();
    await page.getByRole('button', { name: 'Add tag library-evidence', exact: true }).click(); await waitSaved(page);
    assert.equal((await library()).tags.filter(t => t.name === 'library-evidence').length, 1);
    await page.getByRole('button', { name: 'Back to library', exact: true }).click();
    const second = row('Library orphan paper');
    await page.setViewportSize({ width: 390, height: 844 });
    await second.getByRole('button', { name: 'Actions for paper Library orphan paper', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Organize paper', exact: true }).click();
    await second.getByRole('button', { name: 'Remove tag library-evidence', exact: true }).waitFor();
    await second.getByLabel('Library retained', { exact: true }).check(); await waitSaved(page);
    await second.getByLabel('Library retained', { exact: true }).uncheck(); await waitSaved(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile library does not overflow horizontally');
    await page.screenshot({ path: 'test-results/library-management-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1366, height: 900 });
    await second.getByRole('button', { name: 'Archive paper', exact: true }).click();
    await second.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Archive', exact: false }).first().click();
    await second.getByRole('button', { name: 'Permanently delete', exact: true }).waitFor();
    page.once('dialog', dialog => { assert.match(dialog.message(), /irreversibly.*original PDF.*notes.*highlights.*cannot be undone/); return dialog.dismiss(); });
    await second.getByRole('button', { name: 'Permanently delete', exact: true }).click();
    assert.equal((await detail(secondId)).archived, true);
    await second.getByRole('button', { name: 'Return to library', exact: true }).click(); await second.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'All papers', exact: false }).click();
    await second.waitFor();
    // Project menus use a separate, touch-sized trigger and never select the project.
    const renameBefore = await detail(firstId), renameOrphan = await detail(secondId);
    const renamePdf = await (await context.request.get(`${firstUrl}/pdf`)).body();
    await projectNav.getByRole('button', { name: 'Library shared', exact: true }).click();
    const trigger = actions('Library shared');
    assert.equal(await projectNav.getByRole('button', { name: /^Delete project/ }).count(), 0);
    await trigger.focus(); await page.keyboard.press('Enter');
    const renameItem = page.getByRole('menuitem', { name: 'Rename project Library shared', exact: true });
    const deleteItem = page.getByRole('menuitem', { name: 'Delete project Library shared', exact: true });
    await focused(renameItem, 'Project menu opening focus');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('ArrowDown'); await focused(deleteItem);
    await page.keyboard.press('Home'); await focused(renameItem);
    await page.keyboard.press('End'); await focused(deleteItem);
    await page.keyboard.press('Escape');
    await menuClosed(trigger, page.getByRole('menu'));
    await page.keyboard.press('ArrowUp'); await focused(deleteItem);
    await page.keyboard.press('Shift+Tab');
    await menuClosed(trigger, page.getByRole('menu'), projectNav.getByRole('button', { name: 'Library shared', exact: true }));
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('menu').count(), 0);
    await trigger.focus(); await page.keyboard.press('Space');
    await focused(renameItem); await page.keyboard.press('Tab');
    await page.getByRole('menu').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('menu').count(), 0, 'Tab leaves the menu');
    assert.equal(await trigger.evaluate(el => el === document.activeElement), false);
    await trigger.click(); await page.getByLabel('Search library', { exact: true }).focus();
    await page.getByRole('menu').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('menu').count(), 0, 'focus outside dismisses menu');
    await trigger.click(); await page.getByRole('heading', { name: 'Library shared', exact: true }).click();
    await page.getByRole('menu').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('menu').count(), 0, 'outside pointer dismisses menu');
    await projectAction('Library shared', 'Rename');
    const renameDialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
    const nameInput = renameDialog.getByLabel('Project name', { exact: true });
    await focused(nameInput, 'Rename dialog opening focus');
    const checkRenameFocus = async lastButton => {
      await lastButton.focus(); await page.keyboard.press('Tab');
      await focused(nameInput, 'Tab wraps to the first dialog control');
      await page.keyboard.press('Shift+Tab');
      await focused(lastButton, 'Shift+Tab wraps to the last enabled dialog control');
    };
    await checkRenameFocus(renameDialog.getByRole('button', { name: 'Save name', exact: true }));
    await nameInput.fill('Canceled draft');
    await renameDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await renameDialog.waitFor({ state: 'detached' });
    await focused(trigger, 'Rename dialog restores project trigger focus');
    assert.equal((await library()).projects.find(p => p.id === shared.id).name, 'Library shared');
    await projectAction('Library shared', 'Rename'); await nameInput.fill('Escape draft'); await page.keyboard.press('Escape');
    await renameDialog.waitFor({ state: 'detached' });
    assert.equal(await renameDialog.count(), 0);
    await projectAction('Library shared', 'Rename'); await nameInput.fill('Outside draft');
    await page.mouse.click(2, 2); await renameDialog.waitFor({ state: 'detached' }); assert.equal(await renameDialog.count(), 0);
    await projectAction('Library shared', 'Rename');
    await nameInput.fill('   '); await renameDialog.getByRole('button', { name: 'Save name', exact: true }).click();
    assert.match(await renameDialog.getByRole('alert').innerText(), /Enter a project name/);
    await nameInput.fill('x'.repeat(101)); await renameDialog.getByRole('button', { name: 'Save name', exact: true }).click();
    assert.match(await renameDialog.getByRole('alert').innerText(), /100 characters/);
    await nameInput.fill('  Library retained  '); await renameDialog.getByRole('button', { name: 'Save name', exact: true }).click();
    await renameDialog.getByRole('alert').filter({ hasText: 'already exists' }).waitFor();
    assert.equal(await nameInput.inputValue(), '  Library retained  ');
    assert.equal((await library()).projects.find(p => p.id === shared.id).name, 'Library shared');
    // A server failure retains the editable draft and allows safe cancellation.
    const projectUrl = `${base}/api/projects/${shared.id}`;
    const rejectRename = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Project storage unavailable' }) });
    await page.route(projectUrl, rejectRename);
    await nameInput.fill('Unsaved project'); await renameDialog.getByRole('button', { name: 'Save name', exact: true }).click();
    await renameDialog.getByRole('alert').filter({ hasText: 'Project storage unavailable' }).waitFor();
    assert.equal(await nameInput.inputValue(), 'Unsaved project');
    await page.unroute(projectUrl, rejectRename);
    await renameDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    // An actual competing rename must not be overwritten by the open dialog.
    await projectAction('Library shared', 'Rename');
    await context.request.patch(projectUrl, { data: { name: 'Library remote', expectedName: 'Library shared' } }).then(json);
    await nameInput.fill('Stale draft'); await renameDialog.getByRole('button', { name: 'Save name', exact: true }).click();
    await renameDialog.getByRole('button', { name: 'Reload latest project', exact: true }).waitFor();
    assert.equal(await nameInput.inputValue(), 'Stale draft');
    assert.equal(await renameDialog.getByRole('button', { name: 'Save name', exact: true }).isDisabled(), true);
    await checkRenameFocus(renameDialog.getByRole('button', { name: 'Reload latest project', exact: true }));
    await renameDialog.getByRole('button', { name: 'Reload latest project', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.rename-project-dialog input')?.value === 'Library remote');
    await nameInput.fill('  Library shared renamed  ');
    await renameDialog.getByRole('button', { name: 'Save name', exact: true }).click();
    await page.getByRole('heading', { name: 'Library shared renamed', exact: true }).waitFor();
    assert.equal((await library()).projects.find(p => p.id === shared.id).name, 'Library shared renamed');
    await page.reload(); await page.getByRole('heading', { name: 'Your library', exact: true }).waitFor();
    await projectNav.getByRole('button', { name: 'Library shared renamed', exact: true }).click();
    await page.getByRole('heading', { name: 'Library shared renamed', exact: true }).waitFor();
    await first.locator('.project-label').filter({ hasText: 'Library shared renamed' }).waitFor();
    assert.deepEqual(await detail(firstId), renameBefore);
    assert.deepEqual(await detail(secondId), renameOrphan);
    assert.deepEqual(await (await context.request.get(`${firstUrl}/pdf`)).body(), renamePdf);
    // Compact icons describe file availability, without pretending to render thumbnails.
    await first.getByText('PDF available', { exact: true }).waitFor();
    assert.equal(await first.locator('.paper-file-icon svg').count(), 1);
    const iconBounds = await first.locator('.paper-file-icon').boundingBox();
    assert.ok(iconBounds.width <= 28 && iconBounds.height <= 28);
    assert.equal(await first.locator('.paper-icon, img, canvas').count(), 0);
    const referenceFixture = async route => {
      const response = await route.fetch(); const data = await response.json();
      data.papers = data.papers.map(p => p.id === secondId ? { ...p, pdfSha: null, pageCount: null } : p);
      await route.fulfill({ response, json: data });
    };
    await page.route('**/api/library?*', referenceFixture);
    await page.reload(); await second.getByText('Reference only', { exact: true }).waitFor();
    assert.equal(await second.getByText('PDF available', { exact: true }).count(), 0);
    await second.getByText('No PDF attached', { exact: true }).waitFor();
    await page.unroute('**/api/library?*', referenceFixture); await page.reload();
    await second.getByText('PDF available', { exact: true }).waitFor();
    // Exercise a long name, dialog focus containment and actions at phone widths.
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await openNavigation(page);
      const mobileTrigger = actions('Library shared renamed');
      await touchTarget(mobileTrigger, `Project menu at ${width}px`);
      await touchTarget(projectNav.getByRole('button', { name: 'Library shared renamed', exact: true }), `Project selection at ${width}px`);
      await mobileTrigger.click();
      const mobileProjectMenu = page.getByRole('menu', { name: 'Actions for project Library shared renamed', exact: true });
      await mobileProjectMenu.waitFor();
      const mobileProjectItems = await mobileProjectMenu.getByRole('menuitem').all();
      assert.equal(mobileProjectItems.length, 2);
      for (const item of mobileProjectItems)
        await touchTarget(item, `Project menu item at ${width}px`);
      await page.keyboard.press('Escape');
      await menuClosed(mobileTrigger, mobileProjectMenu);
      await projectAction('Library shared renamed', 'Rename');
      await nameInput.fill('Long project name '.repeat(5).trim());
      await checkRenameFocus(renameDialog.getByRole('button', { name: 'Save name', exact: true }));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await renameDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await renameDialog.waitFor({ state: 'detached' });
      await focused(mobileTrigger, 'Mobile rename dialog restores trigger focus');
      await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
    }
    const longName = 'A long project name with room for deeper research and useful connections';
    await page.setViewportSize({ width: 320, height: 844 });
    await openNavigation(page);
    await projectNav.getByRole('button', { name: 'Library shared renamed', exact: true }).click();
    await openNavigation(page);
    await projectAction('Library shared renamed', 'Rename'); await nameInput.fill(longName);
    await renameDialog.getByRole('button', { name: 'Save name', exact: true }).click();
    await actions(longName).waitFor();
    await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
    await page.getByRole('heading', { name: longName, exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'long project name fits a 320px library');
    await page.screenshot({ path: 'test-results/project-rename-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1366, height: 900 });
    await projectAction(longName, 'Rename');
    await nameInput.fill('Library shared'); await renameDialog.getByRole('button', { name: 'Save name', exact: true }).click();
    await actions('Library shared').waitFor();
    const preserved = await detail(firstId), orphan = await detail(secondId);
    const pdfBefore = await (await context.request.get(`${firstUrl}/pdf`)).body();
    await projectNav.getByRole('button', { name: 'Library shared', exact: true }).click();
    const evidenceTag = (await library()).tags.find(t => t.name === 'library-evidence');
    await page.getByLabel('Filter by tag', { exact: true }).selectOption(evidenceTag.id);
    const rejectDelete = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Project deletion unavailable' }) });
    await page.route(`${base}/api/projects/${shared.id}`, rejectDelete);
    page.once('dialog', dialog => dialog.accept()); await projectAction('Library shared', 'Delete');
    await page.getByRole('alert').filter({ hasText: 'Project deletion unavailable' }).waitFor();
    assert.deepEqual(await detail(firstId), preserved); assert.deepEqual(await detail(secondId), orphan);
    assert.equal((await library()).projects.some(p => p.id === shared.id), true);
    await page.unroute(`${base}/api/projects/${shared.id}`, rejectDelete);
    page.once('dialog', dialog => { assert.match(dialog.message(), /only the project.*All papers.*kept/); return dialog.dismiss(); });
    await projectAction('Library shared', 'Delete');
    assert.equal((await library()).projects.some(p => p.id === shared.id), true);
    assert.deepEqual(await detail(firstId), preserved); assert.deepEqual(await detail(secondId), orphan);
    await focused(actions('Library shared'), 'Canceled project deletion restores trigger focus');
    page.once('dialog', dialog => dialog.accept());
    await projectAction('Library shared', 'Delete');
    await page.getByRole('heading', { name: 'Your library', exact: true }).waitFor();
    assert.equal(await projectNav.getByRole('button', { name: 'Library shared', exact: true }).count(), 0);
    assert.equal(await page.getByLabel('Filter by tag', { exact: true }).inputValue(), evidenceTag.id);
    const after = await detail(firstId), afterOrphan = await detail(secondId);
    assert.deepEqual({ ...after, revision: preserved.revision, updated: preserved.updated }, { ...preserved, projectIds: [retained.id] });
    assert.deepEqual({ ...afterOrphan, revision: orphan.revision, updated: orphan.updated }, { ...orphan, projectIds: [] });
    assert.deepEqual(await (await context.request.get(`${firstUrl}/pdf`)).body(), pdfBefore);
    await page.getByRole('button', { name: 'Unassigned', exact: false }).click();
    await page.waitForFunction(() => { const rows = [...document.querySelectorAll('.paper-row')]; return rows.length === 1 && rows[0].textContent.includes('Library orphan paper'); });
    assert.equal(await first.count(), 0);
    // Clear all memberships in the reader without another import.
    await page.getByRole('button', { name: 'All papers', exact: false }).click();
    await first.locator('.paper-open').click();
    await page.getByRole('button', { name: 'Organize paper', exact: true }).click();
    await page.getByLabel('Library retained', { exact: true }).uncheck(); await waitSaved(page);
    assert.deepEqual((await detail(firstId)).projectIds, []);
    // Reload initially renders the library while the hash-selected reader loads.
    // Hold the detail response so this check always exercises that intermediate
    // frame, even when the local API would otherwise respond immediately.
    let releaseReader;
    const readerGate = new Promise(resolve => { releaseReader = resolve; });
    const holdReader = async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch(); await readerGate; await route.fulfill({ response });
    };
    await page.route(firstUrl, holdReader);
    try {
      const readerRequest = page.waitForRequest(request => request.url() === firstUrl && request.method() === 'GET');
      await page.reload(); await readerRequest;
      await first.waitFor();
      assert.equal(await page.locator('.workspace').count(), 0, 'reader is pending during the initial library frame');
      await uiEvidence(page, 'Reload: reader pending, initial library frame');
    } finally { releaseReader(); }
    const reloadedReader = await waitForReader(page, firstId, 'Library first paper');
    await page.unroute(firstUrl, holdReader);
    await reloadedReader.getByRole('button', { name: 'Organize paper', exact: true }).click();
    assert.equal(await page.getByLabel('Library retained', { exact: true }).isChecked(), false);
    await page.getByRole('button', { name: 'Archive paper', exact: true }).click();
    await page.getByRole('button', { name: 'Permanently delete', exact: true }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Permanently delete', exact: true }).click();
    await page.getByRole('heading', { name: 'Your library', exact: true }).waitFor();
    assert.equal((await context.request.get(firstUrl)).status(), 404);
    assert.equal((await context.request.get(`${firstUrl}/pdf`)).status(), 404);
    assert.equal((await detail(secondId)).note, orphan.note);
    // Delete from the library Archive too, then clean up only this isolated fixture's projects.
    await page.getByRole('button', { name: 'All papers', exact: false }).click();
    await second.getByRole('button', { name: 'Archive paper', exact: true }).click(); await second.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Archive', exact: false }).first().click();
    page.once('dialog', dialog => dialog.accept());
    await second.getByRole('button', { name: 'Permanently delete', exact: true }).click(); await second.waitFor({ state: 'detached' });
    assert.equal((await context.request.get(`${base}/api/papers/${secondId}`)).status(), 404);
    for (const p of (await library()).projects.filter(p => p.name.startsWith('Library ')))
      await context.request.delete(`${base}/api/projects/${p.id}`, { data: { confirmation: p.id } }).then(json);
    assert.deepEqual(errors, []);
    console.log('PASS: keyboard/touch project menus, rename validation/duplicates/cancellation/errors/conflicts/reload persistence with unchanged paper data, compact PDF/reference status icons; library/reader contextual tag creation, reuse and removal; delayed multi-project reassignment; reload persistence; conflict/error rollback; confirmed project deletion preserves paper data/PDF/annotations and clears selected project; orphan Unassigned; archive/restore; cancelled and confirmed permanent paper deletion from library and detail.');
  } catch (error) {
    await uiEvidence(page, `Library failure: ${error.message}`).catch(() => {});
    await page.screenshot({ path: 'test-results/library-management-failure.png', fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}
