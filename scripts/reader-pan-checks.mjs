import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';

// Observe after the reader's listeners, without changing gesture arbitration.
// A DOM-dispatched TouchEvent cannot test native scrolling; callers send CDP input.
export async function assertNativeReaderPan(page, touch, { stage, point, delta, minimum }) {
  const root = page.locator('.pdf-scroll');
  const before = await root.evaluate((el, point) => {
    const describe = target => {
      const style = getComputedStyle(target);
      return { tag: target.tagName, class: target.className, touchAction: style.touchAction,
        userSelect: style.userSelect, overflowX: style.overflowX, overflowY: style.overflowY };
    };
    const hit = document.elementFromPoint(point.x, point.y);
    const path = [];
    for (let target = hit; target; target = target.parentElement) {
      path.push(describe(target));
      if (target === el) break;
    }
    const box = el.getBoundingClientRect();
    const position = () => ({ left: el.scrollLeft, top: el.scrollTop });
    const events = [];
    const record = event => {
      if (events.length >= 200) return;
      events.push({ type: event.type, time: performance.now(), cancelable: event.cancelable,
        prevented: event.defaultPrevented, trusted: event.isTrusted,
        target: event.target?.className || event.target?.nodeName,
        touches: event.touches && [...event.touches].map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY })),
        pointerType: event.pointerType, ...position() });
    };
    const types = ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointercancel'];
    for (const type of types) document.addEventListener(type, record, { passive: true });
    el.addEventListener('scroll', record, { passive: true });
    el.__readerPanTrace = { events, stop: () => {
      for (const type of types) document.removeEventListener(type, record);
      el.removeEventListener('scroll', record);
    } };
    return { ...position(), maxLeft: el.scrollWidth - el.clientWidth, maxTop: el.scrollHeight - el.clientHeight,
      width: el.clientWidth, height: el.clientHeight, box: box.toJSON(), path, hitReader: !!hit && el.contains(hit),
      viewport: { width: innerWidth, height: innerHeight },
      zoom: document.querySelector('[aria-label="PDF zoom"]').value };
  }, point);
  const sent = [];
  const send = async (type, points) => {
    sent.push({ type, points, time: Date.now() });
    await touch(type, points);
  };
  let active = false;
  let failure;
  let after;
  try {
    assert.equal(before.hitReader, true, `${stage}: touch starts inside the reader`);
    // Check the whole physical path, not just the scroll range. A clipped gesture
    // or boundary-clamped scroll must fail with its precondition in the evidence.
    for (const p of [point, { x: point.x + delta.x, y: point.y + delta.y }]) {
      assert.ok(p.x > Math.max(0, before.box.left) && p.x < Math.min(before.viewport.width, before.box.right)
        && p.y > Math.max(0, before.box.top) && p.y < Math.min(before.viewport.height, before.box.bottom),
      `${stage}: entire touch path is inside the visible scrollport`);
    }
    if (delta.x) assert.ok((delta.x < 0 ? before.maxLeft - before.left : before.left) >= Math.abs(delta.x), `${stage}: horizontal scroll headroom`);
    if (delta.y) assert.ok((delta.y < 0 ? before.maxTop - before.top : before.top) >= Math.abs(delta.y), `${stage}: vertical scroll headroom`);
    active = true;
    await send('touchStart', [point]);
    for (let i = 1; i <= 8; i++) {
      await send('touchMove', [{ x: point.x + delta.x * i / 8, y: point.y + delta.y * i / 8 }]);
      // Real frame cadence avoids batching the entire drag into one compositor frame.
      await page.waitForTimeout(16);
    }
    // Let velocity decay before release so a fling cannot leak into the next test.
    await page.waitForTimeout(150);
    await send('touchEnd', []);
    active = false;
    await page.waitForFunction(({ before, delta, minimum }) => {
      const el = document.querySelector('.pdf-scroll');
      const movedX = (el.scrollLeft - before.left) * -Math.sign(delta.x);
      const movedY = (el.scrollTop - before.top) * -Math.sign(delta.y);
      // A diagonal is allowed to rail to either axis. Axis checks below are
      // independent requirements: neither can be satisfied by the other axis.
      if (minimum.x && minimum.y) return movedX > minimum.x || movedY > minimum.y;
      return minimum.x ? movedX > minimum.x : movedY > minimum.y;
    }, { before, delta, minimum }, { timeout: 3000 });
    // Wait for a stable compositor result; movement after this gesture must not
    // satisfy the following gesture's acceptance. No scroll assignment is used.
    await root.evaluate(el => new Promise((resolve, reject) => {
      let left = el.scrollLeft, top = el.scrollTop, stable = 0;
      const deadline = performance.now() + 3000;
      const frame = () => {
        stable = Math.abs(el.scrollLeft - left) < .1 && Math.abs(el.scrollTop - top) < .1 ? stable + 1 : 0;
        left = el.scrollLeft; top = el.scrollTop;
        if (stable >= 8) resolve();
        else if (performance.now() > deadline) reject(new Error('Native pan did not settle'));
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }));
  } catch (error) { failure = error; }
  finally {
    if (active) {
      try { await send('touchCancel', []); }
      catch (error) { failure ||= error; }
    }
    after = await root.evaluate(el => {
      const trace = el.__readerPanTrace;
      trace.stop();
      delete el.__readerPanTrace;
      return { left: el.scrollLeft, top: el.scrollTop, maxLeft: el.scrollWidth - el.clientWidth,
        maxTop: el.scrollHeight - el.clientHeight, events: trace.events,
        zoom: document.querySelector('[aria-label="PDF zoom"]').value, selection: getSelection()?.toString(),
        toolbar: !!document.querySelector('.selection-toolbar') };
    });
    await appendFile('test-results/reader-browser-evidence.jsonl', JSON.stringify({ stage, gesture: { point, delta, minimum, sent },
      before, after, movement: { left: after.left - before.left, top: after.top - before.top }, failure: failure?.message }) + '\n');
  }
  const detail = `${stage}: scroll (${before.left}, ${before.top}) -> (${after.left}, ${after.top}); see reader-browser-evidence.jsonl`;
  if (failure) throw new Error(`${detail}; ${failure.message}`, { cause: failure });
  const movedX = (after.left - before.left) * -Math.sign(delta.x);
  const movedY = (after.top - before.top) * -Math.sign(delta.y);
  assert.ok(minimum.x && minimum.y ? movedX > minimum.x || movedY > minimum.y
    : minimum.x ? movedX > minimum.x : movedY > minimum.y, `${detail}; required pan displacement must remain after settling`);
  assert.equal(after.zoom, before.zoom, `${detail}; one-finger pan must not change PDF zoom`);
  assert.equal(after.selection, '', `${detail}; pan must not create a selection`);
  assert.equal(after.toolbar, false, `${detail}; pan must not open highlight creation`);
  const touches = after.events.filter(event => event.type.startsWith('touch'));
  assert.ok(touches.some(event => event.type === 'touchstart' && event.touches.length === 1), `${detail}; native one-finger touch reached DOM`);
  assert.ok(touches.every(event => event.trusted && !event.prevented), `${detail}; reader must leave one-finger default actions alone`);
}
