# Paper action menu focus lifecycle

Baseline: `0a0d9af`. The host full run reached the 360px paper menu after passing
imports and project/library management. Its JSONL shows Organize paper focused
through all three menu target measurements, then body focused at the failure.
The full-page screenshot runs between those measurements and Escape. There was
no post-screenshot menu/expanded-state observation, so this evidence does not
establish that Escape reached an open menu.

`ActionMenu.close()` already focuses the trigger synchronously. Escape bubbles
from the focused menu item to the root, prevents the default, stops propagation,
and calls close. Tab also calls close, then lets native Tab advance from the
trigger. Outside pointer/focus dismissal intentionally leaves focus at the new
destination. None of those paths needs a delayed focus callback, which could
steal focus from Tab's destination or an organizer opened by an action.

The separate resize listener unconditionally called `setOpen(false)` without
restoring focus. Removing its focused menu item leaves body focused; a subsequent
Escape on body cannot reach the menu root. This is a real lifecycle defect, not
something a longer wait for trigger focus can repair. A same-layout resize
reproduces this path deterministically in the regression. Mobile full-page
capture is the suspected source in the host run: installed Playwright 1.64.0
uses `Page.captureScreenshot` with `captureBeyondViewport` for this overflowing
page and re-enables touch emulation afterward. The original evidence has no
resize trace, and the sandbox cannot launch Chromium to confirm that native
event sequence. The new before/after-screenshot diagnostics resolve that gap on
the host rerun.

The menu now survives resize while its trigger has layout rectangles. CSS keeps
the menu anchored as mobile dimensions change. When a desktop breakpoint hides
the trigger, resize dismisses the menu and moves focus to the paper row if focus
was in the menu/trigger or has already fallen to body. An outside focus target is
left alone. Initial menu focus/listeners run in a layout effect, so keyboard input
cannot arrive between mounting the menu and establishing its focus. Clicking an
already-open trigger uses the same restoring close path, including in Safari,
which need not focus a button on pointer activation.

## Regression and later assertion audit

The responsive suite retains every target-size, screenshot and original Escape
focus requirement. It adds:

- Synthetic same-layout resize and actual height resize, with the real resize
  event observed and React allowed to commit before asserting preserved focus.
- Open/first-item-focus checks immediately before Escape, including after the
  full-page screenshot; menu removal, `aria-expanded=false`, removal of
  `aria-controls`, and exact trigger focus after Escape.
- Touch open/toggle-close; ArrowDown/ArrowUp/Enter/Space opening; Home/End and arrow
  wrapping; exact forward/backward Tab destinations; pointer and focus dismissal.
- Desktop breakpoint dismissal to the paper row, with no reopening on mobile
  return; keyboard activation of Organize and return focus when it closes.

The later organizer and filename checks previously observed an attached element
and immediately sampled focus, although focus is assigned in a passive effect.
Project menu/dialog checks had analogous snapshots. Their shared `focused`
helper now waits up to three seconds for the exact connected element to become
active, then asserts equality. It never focuses/clicks the expected target.
Closure checks wait for removal before checking ARIA/focus; missing restoration,
wrong focus, and a retained menu still fail. No target-size tolerance or sleeps
were added. Reader code, gestures and Safari stream compatibility are unchanged.

Test-only diagnostics retain the last 150 pointer/focus/key/resize events with
dimensions, event targets, active element and open menus. `uiEvidence` includes
that trace and current menu/trigger markup, in addition to existing geometry.
Look for resize/menu disappearance before the Escape keydown, and compare
`Paper menu before full-page screenshot`, `Paper menu after full-page screenshot,
before Escape`, and `Paper menu after Escape` records.

## Host rerun

Run sequentially; each browser runner resets the shared JSONL evidence:

```sh
npm run verify > test-results/menu-focus-verify.log 2>&1
npm run test:browser:responsive > test-results/menu-focus-responsive.log 2>&1
cp test-results/library-browser-evidence.jsonl test-results/menu-focus-responsive-evidence.jsonl
npm run test:browser > test-results/menu-focus-browser.log 2>&1
cp test-results/library-browser-evidence.jsonl test-results/menu-focus-full-evidence.jsonl
# Optional Safari-engine coverage where Playwright WebKit is installed:
PAPERTRAIL_WEBKIT=1 npm run test:browser:responsive > test-results/menu-focus-webkit.log 2>&1
```

Record each exit code and retain the logs, JSONL and failure PNG if any. The
regression's same-layout resize must fail with the old `ActionMenu` even when
the browser does not emit resize during screenshots.

Local validation on 2026-10-21: verify passed (71/71 tests). Responsive and full
browser validation cannot run scenarios in this sandbox: localhost listening
returns `EPERM`, and Chromium exits at `sandbox_host_linux.cc:41` with shutdown
Operation not permitted. No local browser pass, Safari-device pass or confirmed
native screenshot event order is claimed. Only disposable test data is used;
no production configuration/data, restart, deployment or push is involved.
