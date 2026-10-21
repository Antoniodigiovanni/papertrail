import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';

// Keep the unrounded browser geometry: a failure must distinguish layout size,
// clipping and an ancestor's in-flight transform from the settled target.
export async function uiEvidence(page, label, locator = page.locator('.sidebar, .workspace'), details = {}) {
  const targets = await locator.evaluateAll(elements => elements.map(element => {
    const describe = el => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return {
        tag: el.tagName, id: el.id, className: el.className,
        rect: rect.toJSON(), offsetWidth: el.offsetWidth, offsetHeight: el.offsetHeight,
        style: Object.fromEntries(['width', 'height', 'minWidth', 'minHeight', 'flex', 'flexShrink', 'padding', 'borderWidth', 'boxSizing', 'display', 'visibility', 'overflow', 'transform', 'transition'].map(key => [key, style[key]])),
        animations: el.getAnimations().map(animation => ({ playState: animation.playState, currentTime: animation.currentTime, timing: animation.effect?.getComputedTiming() })),
      };
    };
    const ancestors = [];
    for (let parent = element.parentElement; parent && ancestors.length < 5; parent = parent.parentElement) ancestors.push(describe(parent));
    return { element: describe(element), ancestors };
  }));
  const evidence = {
    label, time: new Date().toISOString(), browser: page.context().browser()?.version(),
    url: page.url(), viewport: page.viewportSize(), targets, ...details,
    state: await page.evaluate(() => ({
      innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth,
      reader: !!document.querySelector('.workspace'), library: !!document.querySelector('.shell'),
      readerTitle: document.querySelector('.reader-heading strong')?.textContent,
      focus: document.activeElement?.outerHTML.slice(0, 500),
    })),
  };
  await appendFile('test-results/library-browser-evidence.jsonl', `${JSON.stringify(evidence)}\n`);
  return evidence;
}

export async function touchTarget(locator, label) {
  const page = locator.page();
  const box = await locator.boundingBox();
  const evidence = await uiEvidence(page, label, locator, { playwrightBox: box });
  const rect = evidence.targets[0]?.element.rect;
  assert.ok(box && box.width >= 44 && box.height >= 44 && rect && rect.width >= 44 && rect.height >= 44,
    `${label} must be at least 44×44 CSS px: ${JSON.stringify(evidence)}`);
}

export async function openNavigation(page) {
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  const sidebar = page.locator('.sidebar.is-open');
  await sidebar.waitFor();
  const targets = page.locator('.sidebar.is-open, .sidebar.is-open .project-navigation > .nav, .sidebar.is-open .project-menu-trigger');
  const openingBoxes = await Promise.all((await targets.all()).map(target => target.boundingBox()));
  await uiEvidence(page, 'Navigation opened, before settling', targets, { playwrightBoxes: openingBoxes });
  // Visibility alone does not mean the translated drawer is in its final place.
  // Wait for the real transition, including reduced motion, without sleeping,
  // cancelling animations or relaxing the minimum target size.
  await page.waitForFunction(() => {
    const sidebar = document.querySelector('.sidebar.is-open');
    if (!sidebar || sidebar.getAnimations().some(animation => animation.playState !== 'finished')) return false;
    const transform = new DOMMatrixReadOnly(getComputedStyle(sidebar).transform);
    return transform.isIdentity;
  });
  await uiEvidence(page, 'Navigation settled', targets);
}

export async function waitForReader(page, id, title) {
  const workspace = page.locator('.workspace');
  await workspace.waitFor();
  await page.locator('.shell').waitFor({ state: 'detached' });
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('paper'), id);
  assert.equal(await workspace.locator('.reader-heading strong').innerText(), title);
  await uiEvidence(page, 'Reader ready', workspace);
  return workspace;
}
