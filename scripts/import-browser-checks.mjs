import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { textPdf } from '../dist/tests/tests/fixture.js';

const json = async response => { assert.equal(response.ok(), true, await response.text()); return response.json(); };

export async function importLibraryChecks(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const projects = ['Import Alpha', 'Import Beta'].map(name => ({ id: randomUUID(), name }));
  const hiddenTag = { id: randomUUID(), name: 'import-hidden-filter' };
  const bytes = textPdf('Import arXiv fixture'), sha = createHash('sha256').update(bytes).digest('hex');
  const now = new Date().toISOString();
  const fixture = (title, extra) => ({ id: randomUUID(), title, authors: [], doi: null, arxiv: null, arxivBase: null, year: '', venue: '', abstract: '', url: '', pdfSha: null, pageCount: null, status: 'Inbox', archived: false, note: 'Keep import fixture notes', position: { page: 1, offset: 0 }, revision: 0, created: now, updated: now, projectIds: [], tagIds: [], ...extra });
  const arxiv = fixture('Import arXiv fixture', { arxiv: '2401.54321v2', arxivBase: '2401.54321', pdfSha: sha, pageCount: 3 });
  const doi = fixture('Import DOI reference', { doi: '10.1234/stay-in-library', projectIds: [projects[1].id] });
  const library = scope => context.request.get(`${base}/api/library${scope ? '?scope=archive' : ''}`).then(json);
  const detail = id => context.request.get(`${base}/api/papers/${id}`).then(json);
  const dialog = page.getByRole('dialog', { name: 'Add a paper', exact: true });
  const begin = async targets => {
    await page.getByRole('button', { name: 'Add paper', exact: false }).first().click();
    for (const p of projects) await dialog.getByLabel(p.name, { exact: true }).setChecked(targets.includes(p.id));
  };
  const submit = () => dialog.getByRole('button', { name: 'Add to library', exact: true }).click();
  const assertReveal = async (id, heading) => {
    await dialog.waitFor({ state: 'detached' });
    const row = page.locator(`#paper-row-${id}`); await row.waitFor();
    await page.waitForFunction(id => {
      const row = document.getElementById(`paper-row-${id}`), bounds = row?.getBoundingClientRect();
      return row === document.activeElement && bounds.top < innerHeight && bounds.bottom > 0;
    }, id);
    assert.equal(await row.getAttribute('aria-current'), 'true');
    assert.equal(await row.evaluate(el => el.classList.contains('revealed')), true);
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(await page.locator('.workspace').count(), 0);
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    for (const label of ['Search library', 'Filter by tag', 'Filter by reading state'])
      assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), '');
    return row;
  };
  let releaseStale = () => {};
  let releaseReveal = () => {};
  try {
    // Seed remote identities into the disposable empty server, avoiding provider
    // network calls. Real new-provider responses are covered by the API fixtures.
    const empty = await context.request.get(`${base}/api/backup`).then(json);
    assert.equal(empty.papers.length + empty.projects.length + empty.tags.length, 0);
    await context.request.post(`${base}/api/restore`, { headers: { 'X-Restore-Confirmation': 'RESTORE EMPTY LIBRARY' }, data: {
      format: 'papertrail', version: 1, createdAt: now, projects, tags: [hiddenTag], papers: [arxiv, doi], annotations: [], files: [{ sha, base64: bytes.toString('base64') }],
    } }).then(json);
    await page.goto(base); await page.getByRole('heading', { name: 'Your library', exact: true }).waitFor();
    await page.getByLabel(`Select ${arxiv.title}`, { exact: true }).check();
    await page.getByRole('navigation', { name: 'Projects', exact: true }).getByRole('button', { name: projects[0].name, exact: true }).click();
    await page.getByLabel('Filter by tag', { exact: true }).selectOption(hiddenTag.id);
    await page.getByLabel('Filter by reading state', { exact: true }).selectOption('Finished');
    const stale = await context.request.get(`${base}/api/library?search=obsolete-import-filter`).then(json);
    const staleGate = new Promise(resolve => { releaseStale = resolve; });
    const holdStale = async route => {
      if (new URL(route.request().url()).searchParams.get('search') !== 'obsolete-import-filter') return route.fallback();
      await staleGate; await route.fulfill({ json: stale });
    };
    await page.route('**/api/library?*', holdStale);
    const oldRequest = page.waitForRequest(request => request.url().includes('search=obsolete-import-filter'));
    await page.getByLabel('Search library', { exact: true }).fill('obsolete-import-filter'); await oldRequest;
    await begin(projects.map(p => p.id));
    const localBytes = textPdf('Import local paper');
    await dialog.getByLabel('Upload PDF', { exact: true }).setInputFiles({ name: 'import-local.pdf', mimeType: 'application/pdf', buffer: localBytes });
    const uploaded = page.waitForResponse(response => response.url().includes('/api/upload?') && response.request().method() === 'POST');
    await submit(); const local = (await (await uploaded).json()).paper;
    await assertReveal(local.id, projects[0].name);
    assert.doesNotMatch(await page.locator('.list-caption').innerText(), /selected/);
    const oldResponse = page.waitForResponse(response => response.url().includes('search=obsolete-import-filter'));
    releaseStale(); await oldResponse; await page.unroute('**/api/library?*', holdStale);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.locator(`#paper-row-${local.id}`).count(), 1, 'stale filtered response cannot hide the saved row');

    const arxivBefore = await detail(arxiv.id);
    await begin([projects[1].id]);
    await dialog.getByLabel('arXiv ID, DOI, or provider URL', { exact: true }).fill(arxiv.arxiv);
    await submit(); await assertReveal(arxiv.id, projects[1].name);
    assert.match(await page.locator('.notice').innerText(), /Existing paper reused/);
    const arxivAfter = await detail(arxiv.id);
    assert.deepEqual(arxivAfter, { ...arxivBefore, projectIds: [projects[1].id], revision: arxivAfter.revision, updated: arxivAfter.updated });
    assert.deepEqual(await (await context.request.get(`${base}/api/papers/${arxiv.id}/pdf`)).body(), bytes);
    await page.getByRole('button', { name: 'Unassigned', exact: false }).click();
    await begin(projects.map(p => p.id));
    await dialog.getByLabel('arXiv ID, DOI, or provider URL', { exact: true }).fill(arxiv.arxiv);
    await submit(); await assertReveal(arxiv.id, [...projects].sort((a, b) => a.id.localeCompare(b.id))[0].name);

    // Unassigned imports return to All papers; reference-only warnings stay visible.
    await page.getByRole('navigation', { name: 'Library navigation', exact: true }).getByRole('button', { name: 'Archive', exact: false }).click();
    await begin([]);
    const reference = dialog.getByLabel('arXiv ID, DOI, or provider URL', { exact: true });
    await reference.fill(doi.doi);
    const rejectReference = route => route.fulfill({ status: 503, json: { error: 'Import fixture unavailable' } });
    await page.route('**/api/import', rejectReference); await submit();
    await dialog.getByRole('alert').filter({ hasText: 'Import fixture unavailable' }).waitFor();
    assert.equal(await reference.inputValue(), doi.doi);
    assert.equal(await dialog.isVisible(), true);
    await page.unroute('**/api/import', rejectReference);
    // A confirmed import first paints a temporary one-row list. Hold the real
    // refresh, then put the DOI after tall preceding rows to reproduce the race
    // independently of network speed and viewport height.
    const revealGate = new Promise(resolve => { releaseReveal = resolve; });
    const holdReveal = async route => { const response = await route.fetch(); await revealGate; await route.fulfill({ response }); };
    await page.route('**/api/library?*', holdReveal);
    const revealRefresh = page.waitForRequest(request => request.url().includes('/api/library?') && new URL(request.url()).searchParams.get('scope') === 'active');
    await submit(); await revealRefresh;
    await dialog.waitFor({ state: 'detached' });
    await page.addStyleTag({ content: '.paper-row { min-height: 500px !important; } .paper-list { overflow-anchor: none; }' });
    const refreshed = page.waitForResponse(response => response.url().includes('/api/library?') && new URL(response.url()).searchParams.get('scope') === 'active');
    releaseReveal(); await refreshed;
    await page.waitForFunction(() => document.querySelectorAll('.paper-row').length === 3);
    const referenceRow = await assertReveal(doi.id, 'Your library');
    await page.unroute('**/api/library?*', holdReveal);
    assert.equal(await referenceRow.evaluate(el => el.getBoundingClientRect().top >= 0 && el.getBoundingClientRect().top < innerHeight), true, 'the final DOI row is revealed after preceding rows arrive');
    await page.locator('style').filter({ hasText: '.paper-row { min-height: 500px !important; } .paper-list { overflow-anchor: none; }' }).evaluate(el => el.remove());
    await referenceRow.getByText('Reference only', { exact: true }).waitFor();
    assert.match(await page.locator('.notice').innerText(), /Existing paper reused.*Reference saved without a PDF/);
    assert.deepEqual((await detail(doi.id)).projectIds, [projects[1].id], 'no requested projects leaves existing assignments intact');

    // A failed PDF upload retains its file and destinations for retry on mobile.
    await page.setViewportSize({ width: 390, height: 844 });
    await begin([projects[0].id]);
    await dialog.getByLabel('Upload PDF', { exact: true }).setInputFiles({ name: 'import-local.pdf', mimeType: 'application/pdf', buffer: localBytes });
    const rejectUpload = route => route.fulfill({ status: 503, json: { error: 'Upload fixture unavailable' } });
    await page.route('**/api/upload?*', rejectUpload); await submit();
    await dialog.getByRole('alert').filter({ hasText: 'Upload fixture unavailable' }).waitFor();
    assert.equal(await dialog.getByLabel('Upload PDF', { exact: true }).evaluate(el => el.files[0].name), 'import-local.pdf');
    assert.equal(await dialog.getByLabel(projects[0].name, { exact: true }).isChecked(), true);
    await page.unroute('**/api/upload?*', rejectUpload); await submit();
    await assertReveal(local.id, projects[0].name);
    assert.equal((await library()).papers.filter(p => p.id === local.id).length, 1);
    assert.equal((await library()).total, 3);
    const current = await detail(local.id);
    await context.request.patch(`${base}/api/papers/${local.id}`, { data: { revision: current.revision, archived: true } }).then(json);
    await begin([]);
    await dialog.getByLabel('Upload PDF', { exact: true }).setInputFiles({ name: 'duplicate.pdf', mimeType: 'application/pdf', buffer: localBytes });
    await submit(); await assertReveal(local.id, 'Your archive');
    assert.equal((await detail(local.id)).archived, true);
    assert.match(await page.locator('.notice').innerText(), /remains in Archive/);
    await page.screenshot({ path: 'test-results/import-reveal-mobile.png', fullPage: true });
    // A confirmed import remains visible even when the subsequent list refresh fails.
    const rejectList = route => route.fulfill({ status: 503, json: { error: 'Library refresh unavailable' } });
    await page.route('**/api/library?*', rejectList);
    await begin([]);
    await dialog.getByLabel('Upload PDF', { exact: true }).setInputFiles({ name: 'list-outage.pdf', mimeType: 'application/pdf', buffer: textPdf('Import during list outage') });
    const savedResponse = page.waitForResponse(response => response.url().includes('/api/upload?') && response.request().method() === 'POST');
    await submit(); const saved = (await (await savedResponse).json()).paper;
    await assertReveal(saved.id, 'Your library');
    await page.getByRole('alert').filter({ hasText: 'Library refresh unavailable' }).waitFor();
    assert.ok((await page.locator('.notice').innerText()).includes(saved.title));
    await page.unroute('**/api/library?*', rejectList);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('alert').waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
    console.log('PASS: uploads/arXiv/DOI stay in library; destination selection, filter clearing, stale responses, focused/scrolled rows, metadata-only warnings, duplicate/archive preservation and recoverable import errors.');
  } catch (error) {
    await page.screenshot({ path: 'test-results/import-reveal-failure.png', fullPage: true }).catch(() => {});
    throw error;
  } finally {
    releaseStale(); releaseReveal();
    // Only this disposable server's Import fixtures are removed.
    for (const paper of [...(await library()).papers, ...(await library('archive')).papers].filter(p => p.title.startsWith('Import '))) {
      const archived = paper.archived ? paper : await context.request.patch(`${base}/api/papers/${paper.id}`, { data: { revision: paper.revision, archived: true } }).then(json);
      await context.request.delete(`${base}/api/papers/${paper.id}`, { data: { revision: archived.revision, confirmation: paper.id } }).then(json);
    }
    for (const p of (await library()).projects.filter(p => projects.some(fixture => fixture.id === p.id)))
      await context.request.delete(`${base}/api/projects/${p.id}`, { data: { confirmation: p.id } }).then(json);
    await context.close();
  }
}
