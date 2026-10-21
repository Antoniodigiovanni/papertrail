import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { readerPassages, textPdf } from '../dist/tests/tests/fixture.js';
import { assertNativeReaderPan } from './reader-pan-checks.mjs';

export async function readerEvidence(page, stage) {
  const evidence = await page.evaluate(() => {
    const rect = el => el ? el.getBoundingClientRect().toJSON() : null;
    const root = document.querySelector('.pdf-scroll');
    const selection = window.getSelection();
    return {
      viewport: { width: innerWidth, height: innerHeight, density: devicePixelRatio },
      zoom: document.querySelector('[aria-label="PDF zoom"]')?.value,
      pageInput: document.querySelector('[aria-label="PDF page"]')?.value,
      scroll: root && { box: rect(root), left: root.scrollLeft, top: root.scrollTop, width: root.clientWidth, height: root.clientHeight,
        scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight, touchAction: getComputedStyle(root).touchAction,
        overflowX: getComputedStyle(root).overflowX, overflowY: getComputedStyle(root).overflowY },
      selection: selection && { quote: selection.toString(), anchor: selection.anchorNode?.textContent, anchorOffset: selection.anchorOffset,
        focus: selection.focusNode?.textContent, focusOffset: selection.focusOffset,
        rects: selection.rangeCount ? [...selection.getRangeAt(0).getClientRects()].map(r => r.toJSON()) : [] },
      toolbar: document.querySelector('.selection-toolbar p')?.textContent,
      pages: [...document.querySelectorAll('.pdf-page')].map(el => ({ number: el.dataset.pageNumber, box: rect(el),
        prefetched: el.dataset.prefetched, prefetchMargin: el.dataset.prefetchMargin,
        distanceFromScrollport: root && Math.max(0, root.getBoundingClientRect().top + root.clientTop - el.getBoundingClientRect().bottom,
          el.getBoundingClientRect().top - (root.getBoundingClientRect().top + root.clientTop + root.clientHeight)),
        artworkChildren: el.querySelector('.page-artwork').childElementCount,
        rendered: el.dataset.rendered, renderWidth: el.dataset.renderWidth, artworkTransform: getComputedStyle(el.querySelector('.page-artwork')).transform,
        canvas: [...el.querySelectorAll('canvas')].map(c => ({ box: rect(c), width: c.width, height: c.height })),
        spans: [...el.querySelectorAll('.textLayer span')].map(span => {
          const box = span.getBoundingClientRect(), y = box.top + box.height / 2;
          return { text: span.textContent, box: box.toJSON(), fontSize: getComputedStyle(span).fontSize,
            transform: getComputedStyle(span).transform,
            endpointHits: [box.left + 2, box.right - 2].map(x => {
              const hit = document.elementFromPoint(x, y);
              return { x, y, target: hit?.className || hit?.tagName, text: hit?.textContent?.slice(0, 100), onSpan: hit === span || span.contains(hit) };
            }) };
        }) })),
    };
  });
  await appendFile('test-results/reader-browser-evidence.jsonl', JSON.stringify({ stage, ...evidence }) + '\n');
}

function assertFixtureRect(rect, passage, label) {
  const expected = passage.ink.map((v, i) => v / (i % 2 === 0 ? 612 : 792));
  // Font ascent/line boxes differ from ink bounds. Permit 4 PDF points vertically
  // and 1 horizontally, independent of zoom, density, or the element's own CSS.
  rect.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < (i % 2 === 0 ? 1 / 612 : 4 / 792),
    `${label} coordinate ${i}: ${value} vs fixture ${expected[i]}`));
}

export async function assertPassageHighlight(page, passage = readerPassages[0]) {
  const rect = await page.locator('.pdf-page[data-page-number="1"] .pdf-highlight').first().evaluate(el => {
    const parent = el.closest('.pdf-page').getBoundingClientRect(), box = el.getBoundingClientRect();
    return [(box.left - parent.left) / parent.width, (box.top - parent.top) / parent.height,
      (box.right - parent.left) / parent.width, (box.bottom - parent.top) / parent.height];
  });
  assertFixtureRect(rect, passage, 'Saved highlight');
}

export async function selectFixturePassage(page, passage, stage) {
  await assertPainted(page, 1);
  const span = page.locator('.pdf-page[data-page-number="1"] .textLayer span').filter({ hasText: passage.quote }).first();
  await readerEvidence(page, `${stage}: before reveal`);
  // A bounding box includes clipped pixels. Zoom intentionally preserves its focal
  // point; reveal the whole passage before issuing raw viewport mouse coordinates.
  await span.scrollIntoViewIfNeeded();
  const geometry = await span.evaluate(el => {
    const box = el.getBoundingClientRect(), parent = el.closest('.pdf-page').getBoundingClientRect();
    const root = el.closest('.pdf-scroll'), port = root.getBoundingClientRect();
    const y = box.top + box.height / 2, left = box.left + 2, right = box.right - 2;
    const hits = [left, right].map(x => {
      const target = document.elementFromPoint(x, y);
      return x > Math.max(0, port.left + root.clientLeft) && x < Math.min(innerWidth, port.left + root.clientLeft + root.clientWidth)
        && y > Math.max(0, port.top + root.clientTop) && y < Math.min(innerHeight, port.top + root.clientTop + root.clientHeight)
        && (target === el || el.contains(target));
    });
    return { left, right, y, hits, rect: [(box.left - parent.left) / parent.width, (box.top - parent.top) / parent.height,
      (box.right - parent.left) / parent.width, (box.bottom - parent.top) / parent.height] };
  });
  await readerEvidence(page, `${stage}: revealed`);
  assertFixtureRect(geometry.rect, passage, 'Selectable text');
  assert.deepEqual(geometry.hits, [true, true], 'Both drag endpoints are visible and hit the intended text');
  const ink = await page.locator('.pdf-page[data-page-number="1"] canvas').evaluate((canvas, bounds) => {
    const x = Math.floor(bounds[0] / 612 * canvas.width), y = Math.floor(bounds[1] / 792 * canvas.height);
    const width = Math.ceil((bounds[2] - bounds[0]) / 612 * canvas.width), height = Math.ceil((bounds[3] - bounds[1]) / 792 * canvas.height);
    const pixels = canvas.getContext('2d').getImageData(x, y, width, height).data;
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && pixels[i] < 180 && pixels[i + 1] < 180 && pixels[i + 2] < 180) dark++;
    return dark;
  }, passage.ink);
  assert.ok(ink > 20, 'The intended PDF passage has painted glyphs at its independent fixture coordinates');
  await page.mouse.move(geometry.left, geometry.y);
  await page.mouse.down();
  await page.mouse.move(geometry.right, geometry.y, { steps: 18 });
  await page.mouse.up();
  await page.getByRole('region', { name: 'Create highlight', exact: true }).waitFor();
  await readerEvidence(page, `${stage}: selected`);
  assert.equal(await page.evaluate(() => window.getSelection()?.toString().trim()), passage.quote, 'Native mouse selection includes the complete intended passage');
  assert.equal(await page.locator('.selection-toolbar p').first().innerText(), passage.quote, 'Reader captures the complete native selection');
  const rects = await span.evaluate(el => {
    const box = el.closest('.pdf-page').getBoundingClientRect();
    return [...window.getSelection().getRangeAt(0).getClientRects()].filter(r => r.width > 1 && r.height > 1)
      .map(r => [(r.left - box.left) / box.width, (r.top - box.top) / box.height, (r.right - box.left) / box.width, (r.bottom - box.top) / box.height]);
  });
  assert.equal(rects.length, 1, 'A single fixture line produces one selection rectangle');
  assertFixtureRect(rects[0], passage, 'Native selection');
}

export async function assertPainted(page, number) {
  const selector = `.pdf-page[data-page-number="${number}"]`;
  try {
  await page.waitForFunction(selector => {
    const el = document.querySelector(selector);
    return el?.dataset.rendered === 'true' && Math.abs(Number(el.dataset.renderWidth) - el.clientWidth) < 1 && el.querySelector('.textLayer span');
  }, selector);
  } catch (error) {
    await readerEvidence(page, `paint timeout page ${number}`);
    const errors = await page.locator(`${selector} [role=alert]`).allTextContents();
    error.message += `; page errors: ${JSON.stringify(errors)}`;
    throw error;
  }
  const ink = await page.locator(`${selector} canvas`).evaluate(canvas => {
    if (!canvas.width || !canvas.height) return false;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 16) if (data[i + 3] > 0 && data[i] < 180 && data[i + 1] < 180 && data[i + 2] < 180) return true;
    return false;
  });
  assert.equal(ink, true, `Page ${number} has actual painted text pixels`);
}

async function assertReaderNavigation(page, number, offset = 0) {
  try {
    // A prefetched page can be painted without being the navigation destination.
    // Check actual scroll geometry and toolbar state, including scroll-end clamping.
    await page.waitForFunction(({ number, offset }) => {
      const root = document.querySelector('.pdf-scroll');
      const target = root?.querySelector(`[data-page-number="${number}"]`);
      if (!target) return false;
      const desired = root.scrollTop + target.getBoundingClientRect().top
        - root.getBoundingClientRect().top - root.clientTop + offset * target.clientHeight;
      const clamped = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, desired));
      return Math.abs(root.scrollTop - clamped) < 1 && Math.abs(root.scrollLeft) < 1
        && document.querySelector('[aria-label="PDF page"]').value === String(number);
    }, { number, offset });
    await assertPainted(page, number);
  } finally { await readerEvidence(page, `mobile: navigation page ${number}, offset ${offset}`); }
}

async function assertOffscreenReleased(page, releasedNumber, stage) {
  try {
    await page.waitForFunction(releasedNumber => {
      const root = document.querySelector('.pdf-scroll');
      if (!root) return false;
      const top = root.getBoundingClientRect().top + root.clientTop;
      // Independent acceptance bound from the reader's 900px observer policy.
      // Leave one pixel for boundary rounding; nearby prefetched canvases may stay.
      const far = [...root.querySelectorAll('.pdf-page')].filter(el => {
        const box = el.getBoundingClientRect();
        return box.bottom < top - 901 || box.top > top + root.clientHeight + 901;
      });
      return far.some(el => el.dataset.pageNumber === String(releasedNumber)) && far.every(el =>
        el.dataset.prefetchMargin === '900' && el.dataset.prefetched === 'false' && el.dataset.rendered === 'false'
        && !el.querySelector('canvas, .textLayer') && el.querySelector('.page-artwork').childElementCount === 0);
    }, releasedNumber);
  } finally { await readerEvidence(page, stage); }
}

export async function desktopZoomChecks(page) {
  for (const value of ['3', '.75', '2', '1.25', '1.5']) await page.getByLabel('PDF zoom', { exact: true }).selectOption(value === '.75' ? '0.75' : value);
  await assertPainted(page, 1);
  const before = await page.locator('.pdf-page').first().boundingBox();
  const root = await page.locator('.pdf-scroll').boundingBox();
  const point = { x: root.x + root.width / 2, y: root.y + 100 };
  const fraction = box => ({ x: (point.x - box.x) / box.width, y: (point.y - box.y) / box.height });
  const beforePoint = fraction(before);
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -20);
  await page.keyboard.up('Control');
  await page.waitForFunction(oldWidth => document.querySelector('.pdf-page').clientWidth > oldWidth + 20, before.width);
  await assertPainted(page, 1);
  const afterPoint = fraction(await page.locator('.pdf-page').first().boundingBox());
  assert.ok(Math.abs(afterPoint.x - beforePoint.x) < .005, 'Ctrl-wheel zoom preserves horizontal focal point');
  assert.ok(Math.abs(afterPoint.y - beforePoint.y) < .005, 'Ctrl-wheel zoom preserves vertical focal point');
  await page.getByLabel('PDF zoom', { exact: true }).selectOption('1.5');
  await assertPainted(page, 1);
  await selectFixturePassage(page, readerPassages[1], 'after rapid zoom and ctrl-wheel');
  await page.getByLabel('Cancel highlight', { exact: true }).click();
  await assertPassageHighlight(page);
  const aligned = await page.locator('.pdf-highlight').first().evaluate(el => {
    const parent = el.closest('.pdf-page').getBoundingClientRect(), box = el.getBoundingClientRect();
    return Math.abs(box.width / parent.width * 100 - parseFloat(el.style.width)) < .1 && Math.abs((box.top - parent.top) / parent.height * 100 - parseFloat(el.style.top)) < .1;
  });
  assert.equal(aligned, true, 'Highlight pixel geometry follows page zoom');
}

export async function mobileReaderChecks(browser, base, request, annotation) {
  // More pages than the prefetch margin: scrolling must actually unmount/rebuild layers.
  const uploaded = await request.post(`${base}/api/upload`, { headers: { 'Content-Type': 'application/pdf' }, data: textPdf('Touch reader regression', 12) });
  assert.equal(uploaded.status(), 201);
  const { paper } = await uploaded.json();
  const added = await request.post(`${base}/api/papers/${paper.id}/annotations`, { data: { page: 1, quote: annotation.quote, rects: annotation.rects, color: annotation.color, comment: annotation.comment } });
  assert.equal(added.status(), 201);
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await mobile.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/#paper=${paper.id}`);
  await assertPainted(page, 1);
  await assertPassageHighlight(page);
  assert.equal(await page.locator('.paper-panel').count(), 0, 'Phone starts with the PDF unobscured');
  assert.equal(await page.getByRole('button', { name: 'Toggle paper panel', exact: true }).getAttribute('aria-expanded'), 'false');
  const cdp = await mobile.newCDPSession(page);
  const root = await page.locator('.pdf-scroll').boundingBox();
  const point = { x: root.x + root.width / 2, y: root.y + 170 };
  const fractions = () => page.locator('.pdf-page').first().evaluate((el, point) => {
    const box = el.getBoundingClientRect(); return { x: (point.x - box.x) / box.width, y: (point.y - box.y) / box.height };
  }, point);
  const originalPoint = await fractions();
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ ...p, id, radiusX: 2, radiusY: 2 })) });
  await touch('touchStart', [{ x: point.x - 40, y: point.y }, { x: point.x + 40, y: point.y }]);
  for (let i = 1; i <= 8; i++) {
    const distance = 40 + i * 6;
    await touch('touchMove', [{ x: point.x - distance, y: point.y }, { x: point.x + distance, y: point.y }]);
  }
  await touch('touchEnd', []);
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="PDF zoom"]').value) > 2);
  await assertPainted(page, 1);
  await assertPassageHighlight(page);
  const afterPoint = await fractions();
  assert.ok(Math.abs(afterPoint.x - originalPoint.x) < .025, 'Pinch preserves horizontal focal point');
  assert.ok(Math.abs(afterPoint.y - originalPoint.y) < .025, 'Pinch preserves vertical focal point');
  assert.ok(Math.abs(Number(await page.getByLabel('PDF zoom', { exact: true }).inputValue()) - 2.2) < .01);
  await readerEvidence(page, 'mobile: after pinch, before native pan');
  // Chromium's SnapScrollController can rail the original 10:14 diagonal
  // vertically (14/10 > 1.25). pan-x pan-y permits both axes but does not
  // require simultaneous movement. Keep the diagonal and require independent
  // horizontal AND vertical drags, including reverse directions, after pinch.
  // https://github.com/chromium/chromium/blob/main/ui/events/gesture_detection/snap_scroll_controller.cc
  for (const gesture of [
    { stage: 'mobile: diagonal native pan', delta: { x: -80, y: -112 }, minimum: { x: 30, y: 40 } },
    { stage: 'mobile: horizontal native pan', delta: { x: -80, y: 0 }, minimum: { x: 30 } },
    { stage: 'mobile: reverse horizontal native pan', delta: { x: 80, y: 0 }, minimum: { x: 30 } },
    { stage: 'mobile: vertical native pan', delta: { x: 0, y: -112 }, minimum: { y: 40 } },
    { stage: 'mobile: reverse vertical native pan', delta: { x: 0, y: 112 }, minimum: { y: 40 } },
  ]) await assertNativeReaderPan(page, touch, { ...gesture, point });
  // A cancelled pinch must still settle and redraw, then allow normal navigation.
  await touch('touchStart', [{ x: point.x - 40, y: point.y }, { x: point.x + 40, y: point.y }]);
  await touch('touchMove', [{ x: point.x - 48, y: point.y }, { x: point.x + 48, y: point.y }]);
  await touch('touchCancel', []);
  await assertPainted(page, 1);
  await assertNativeReaderPan(page, touch, { stage: 'mobile: horizontal pan after cancelled pinch', point,
    delta: { x: -80, y: 0 }, minimum: { x: 30 } });
  await assertNativeReaderPan(page, touch, { stage: 'mobile: vertical pan after cancelled pinch', point,
    delta: { x: 0, y: -112 }, minimum: { y: 40 } });
  await page.getByLabel('PDF zoom', { exact: true }).selectOption('1');
  await assertPainted(page, 1);
  const navigate = async number => {
    await page.getByLabel('PDF page', { exact: true }).fill(String(number));
    await page.getByLabel('PDF page', { exact: true }).press('Enter');
    await assertReaderNavigation(page, number);
  };
  await navigate(10);
  // Scope release to far pages: a document-wide canvas query also matches the
  // destination's required painted canvas and makes this acceptance impossible.
  await assertOffscreenReleased(page, 1, 'mobile: page 1 and all far pages released after navigate(10)');
  await assertPainted(page, 10);
  await page.getByLabel('Next page', { exact: true }).tap();
  await assertReaderNavigation(page, 11);
  await page.getByLabel('Previous page', { exact: true }).tap();
  await assertReaderNavigation(page, 10);
  // Scroll events as well as toolbar navigation must update the visible page and persisted position.
  const expectedOffset = await page.locator('.pdf-scroll').evaluate(el => {
    const target = el.querySelector('[data-page-number="10"]');
    return (el.getBoundingClientRect().top + el.clientTop - target.getBoundingClientRect().top + 200) / target.clientHeight;
  });
  const positionSaved = page.waitForResponse(response => {
    if (response.url() !== `${base}/api/papers/${paper.id}` || response.request().method() !== 'PATCH') return false;
    const position = response.request().postDataJSON()?.position;
    return position?.page === 10 && Math.abs(position.offset - expectedOffset) < .01;
  });
  await page.locator('.pdf-scroll').evaluate(el => { el.scrollTop += 200; });
  assert.equal((await positionSaved).ok(), true, 'The within-page scroll position save succeeds');
  await assertReaderNavigation(page, 10, expectedOffset);
  const saved = await (await request.get(`${base}/api/papers/${paper.id}`)).json();
  await appendFile('test-results/reader-browser-evidence.jsonl', JSON.stringify({ stage: 'mobile: saved scroll position', expectedOffset, saved: saved.position }) + '\n');
  assert.equal(saved.position.page, 10);
  assert.ok(saved.position.offset > .25);
  assert.ok(Math.abs(saved.position.offset - expectedOffset) < .01, 'Saved offset matches actual scroll geometry');
  await page.waitForFunction(() => document.querySelector('.save-state')?.textContent?.trim() === '✓ Saved');
  await page.reload();
  await assertReaderNavigation(page, 10, saved.position.offset);
  await assertOffscreenReleased(page, 1, 'mobile: restored page 10 position and offscreen release');
  await navigate(1);
  await assertOffscreenReleased(page, 10, 'mobile: page 10 and all far pages released after return to page 1');
  await assertPainted(page, 1);
  await assertPassageHighlight(page);
  await page.locator('.pdf-highlight').first().tap();
  await page.getByLabel('Highlight comment page 1', { exact: true }).waitFor();
  const assertSplit = async () => {
    const [pdf, panel] = await Promise.all([page.locator('.pdf-scroll').boundingBox(), page.locator('.paper-panel').boundingBox()]);
    assert.ok(pdf.y + pdf.height <= panel.y + 1, 'Notes occupy their own space without covering the PDF');
    assert.ok(pdf.height > 60 && panel.height > 90);
    const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, bodyWidth: document.body.scrollWidth, bodyHeight: document.body.scrollHeight }));
    assert.ok(dimensions.bodyWidth <= dimensions.width + 1 && dimensions.bodyHeight <= dimensions.height + 1);
  };
  await assertSplit();
  await page.locator('.highlight-card .passage').click();
  assert.equal(await page.locator('.paper-panel').count(), 0, 'Passage navigation reveals the PDF');
  await page.getByRole('button', { name: 'Toggle paper panel', exact: true }).tap();
  await page.getByRole('button', { name: 'Notes', exact: true }).tap();
  await page.getByLabel('General note', { exact: true }).fill('A phone note, saved while reading.');
  await page.getByRole('button', { name: 'Save note', exact: true }).tap();
  await page.waitForFunction(() => document.querySelector('.save-state').textContent.includes('Saved'));
  await page.getByRole('button', { name: 'Close paper panel', exact: true }).tap();
  assert.equal(await page.locator('.paper-panel').count(), 0);
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await assertPainted(page, 1);
    await assertPassageHighlight(page);
    const dimensions = await page.locator('.pdf-scroll').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.client + 1, 'Fit width has no accidental horizontal overflow');
    await page.getByRole('button', { name: 'Toggle paper panel', exact: true }).tap();
    await assertSplit();
    await page.getByRole('button', { name: 'Close paper panel', exact: true }).tap();
  }
  await page.getByRole('button', { name: 'Toggle paper panel', exact: true }).tap();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.paper-panel').count(), 0);
  await page.screenshot({ path: 'test-results/reader-mobile-emulation.png' });
  await page.reload();
  await assertPainted(page, 1);
  assert.equal(await page.locator('.paper-panel').count(), 0);
  await page.getByRole('button', { name: 'Toggle paper panel', exact: true }).tap();
  assert.equal(await page.getByLabel('General note', { exact: true }).inputValue(), 'A phone note, saved while reading.');
  assert.deepEqual(errors, []);
  await mobile.close();
}
