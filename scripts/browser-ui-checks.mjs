import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';

// Capture the event order around dismissal, including capture-induced resize.
// Bounded and test-only: no application logging or production instrumentation.
export async function menuDiagnostics(page) {
  await page.addInitScript(() => {
    const describe = element => element instanceof Element ? ({ tag: element.tagName, id: element.id, className: element.className, role: element.getAttribute('role'), text: element.textContent?.slice(0, 100) }) : null;
    window.__papertrailMenuTrace = [];
    const record = event => {
      window.__papertrailMenuTrace.push({
        time: performance.now(), type: event.type, key: event.key,
        width: innerWidth, height: innerHeight, target: describe(event.target), focus: describe(document.activeElement),
        menus: [...document.querySelectorAll('.action-menu, .project-actions')].filter(root => root.querySelector('[aria-expanded=true], [role=menu]')).map(root => ({
          trigger: root.querySelector('[aria-haspopup=menu]')?.outerHTML, menu: !!root.querySelector('[role=menu]'),
        })),
      });
      if (window.__papertrailMenuTrace.length > 150) window.__papertrailMenuTrace.shift();
    };
    for (const type of ['pointerdown', 'focusin', 'focusout', 'keydown', 'keyup']) document.addEventListener(type, record, true);
    window.addEventListener('resize', record);
  });
}

// React's passive effects (organizer/dialog focus in particular) can run after a
// locator is attached. Wait for the exact focus contract, with bounded failure
// diagnostics; never click/focus the expected element to make an assertion pass.
export async function focused(locator, label = 'Expected keyboard focus') {
  const page = locator.page();
  const element = await locator.elementHandle();
  assert.ok(element, `${label}: element must exist`);
  try {
    await page.waitForFunction(el => el.isConnected && el === document.activeElement, element, { timeout: 3000 });
    assert.equal(await locator.evaluate(el => el === document.activeElement), true, label);
  } catch (error) {
    const evidence = await uiEvidence(page, label, locator);
    throw new Error(`${label}: ${JSON.stringify(evidence)}`, { cause: error });
  } finally { await element.dispose(); }
}

export async function menuClosed(trigger, menu, destination = trigger) {
  await menu.waitFor({ state: 'detached' });
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false', 'closed trigger exposes aria-expanded=false');
  assert.equal(await trigger.getAttribute('aria-controls'), null, 'closed trigger no longer controls a menu');
  await focused(destination, 'Menu dismissal focus');
}

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
      menus: [...document.querySelectorAll('.action-menu, .project-actions')].map(root => ({ trigger: root.querySelector('[aria-haspopup=menu]')?.outerHTML, menu: root.querySelector('[role=menu]')?.outerHTML })),
      menuTrace: window.__papertrailMenuTrace,
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

export async function paperAction(row, name) {
  await row.locator('.paper-menu-trigger').click();
  await row.getByRole('menuitem', { name, exact: true }).click();
}
