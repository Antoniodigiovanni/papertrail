import assert from 'node:assert/strict';
import { textPdf } from '../dist/tests/tests/fixture.js';

export async function themeChecks(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(base);
    const toggle = page.getByRole('button', { name: 'Enable dark mode', exact: true });
    await toggle.waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await toggle.click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(19, 25, 22)');
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).color), 'rgb(226, 232, 224)');
    assert.equal(await page.locator('.sidebar').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(24, 32, 27)');
    assert.equal(await page.locator('.topbar').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(24, 32, 27)');
    await page.screenshot({ path: 'test-results/theme-dark-library.png', fullPage: true });
    assert.equal(await page.evaluate(() => localStorage.getItem('papertrail-theme')), 'dark');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.getByRole('button', { name: 'Add paper', exact: false }).click();
    assert.equal(await page.locator('.modal').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(24, 32, 27)');
    await page.getByLabel('Upload PDF', { exact: true }).setInputFiles({ name: 'night-reading.pdf', mimeType: 'application/pdf', buffer: textPdf() });
    await page.getByRole('button', { name: 'Add to library', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.locator('.paper-row.revealed .paper-open').click();
    const firstPage = page.locator('.pdf-page[data-page-number="1"]');
    await firstPage.locator('.textLayer span').first().waitFor();
    assert.equal(await page.locator('.paper-panel').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(24, 32, 27)');
    assert.equal(await page.locator('.note-editor').evaluate(el => getComputedStyle(el).color), 'rgb(226, 232, 224)');
    assert.equal(await firstPage.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    const beforeZoom = await page.getByLabel('PDF zoom', { exact: true }).inputValue();
    const gesture = await page.locator('.pdf-scroll').evaluate(root => {
      const bounds = root.getBoundingClientRect();
      const dispatch = (type, scale) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { scale: { value: scale }, clientX: { value: bounds.left + bounds.width / 2 }, clientY: { value: bounds.top + 100 } });
        root.dispatchEvent(event);
        return event.defaultPrevented;
      };
      return [dispatch('gesturestart', 1), dispatch('gesturechange', 1.5), dispatch('gestureend', 1.5)];
    });
    assert.deepEqual(gesture, [true, true, true], 'Safari gesture events are consumed within the PDF reader');
    await page.waitForFunction(previous => Number(document.querySelector('[aria-label="PDF zoom"]')?.value) > Number(previous), beforeZoom);
    await page.waitForFunction(() => document.querySelector('.pdf-page[data-page-number="1"] canvas')?.width > 0);
    await page.locator('.panel-tabs').screenshot({ path: 'test-results/theme-tabs-after.png' });
    assert.equal(await page.getByRole('button', { name: 'Highlights (0)', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'dark tabs must not inherit filled button backgrounds');
    await page.setViewportSize({ width: 390, height: 844 });
    const readerToggle = await page.getByRole('button', { name: 'Disable dark mode', exact: true }).boundingBox();
    assert.ok(readerToggle && readerToggle.width >= 44 && readerToggle.height >= 44, 'reader theme control meets the mobile touch target');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'dark reader fits a mobile viewport without horizontal overflow');
    await page.screenshot({ path: 'test-results/theme-dark-reader-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Disable dark mode', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await page.evaluate(() => localStorage.getItem('papertrail-theme')), 'light');
    await page.getByRole('button', { name: 'Back to library', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    console.log('PASS: dark mode toggle updates the library and reader palettes, keeps PDFs white, persists across reloads, and switches back to light mode');
  } finally {
    await context.close();
  }
}
