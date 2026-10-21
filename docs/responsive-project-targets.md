# Responsive project targets and reader reload checks

Base: `fd40b84` (includes the Safari stream compatibility and import reveal fixes).

The original assertion measured a project trigger immediately after clicking
Toggle navigation. The trigger declares `width:44px; min-height:44px`, its action
wrapper does not shrink, and the mobile sidebar animates `translateX` for 200ms.
Visibility is enabled at the start of opening. Playwright's Chromium bounding box
comes from `DOM.getBoxModel` border coordinates and subtracts their extrema, so it
includes the ancestor transform; it is not the declared CSS width. Measuring during
opening can observe partial offscreen targets and fractional coordinates. The
retained failure screenshot shows the opened sidebar, but a screenshot taken after
the assertion cannot establish the geometry at the failing instant. The original
failure did not print its dimensions. A real undersized target versus transient
geometry cannot be conclusively distinguished from that evidence alone.

Project action wrappers now reserve a nonshrinking 44px slot, and project/paper
triggers explicitly retain a 44px minimum width without shrinking. The existing
44px minimum heights and menu item sizing remain. Browser checks wait for the open
sidebar's actual animations to finish and its transform to reach identity before
measuring. Both Playwright and DOM rectangles must independently be at least
44 by 44 CSS pixels, with no rounding, epsilon or size retries. Tests still fail
on an undersized settled target. Normal animation remains enabled.

The responsive-only suite now exercises long project names, separate selection
and action hit areas, menu item sizes, touch opening, Escape/focus restoration,
viewport containment and nonoverlap at 320/390px, with both normal and reduced
motion. Existing paper/import/menu/reader checks are retained.

On reader reload, App initially has `paper=null`; its mount effect requests the
hash-selected paper, while the independent library request may finish first.
Therefore the library can briefly expose multiple Organize paper buttons. The
reload check holds the real paper detail GET response, observes that intermediate
library frame, releases the response, then waits for the reader workspace and
library removal and verifies the expected paper hash/title before using the
reader-scoped Organize action. The membership persistence assertion remains.

## Rerun and retain evidence

Run sequentially on a host allowing localhost listening and Playwright Chromium:

```sh
npm run verify > test-results/touch-verify.log 2>&1
npm run test:browser:responsive > test-results/touch-responsive.log 2>&1
# Retain before the next command resets the shared evidence file:
cp test-results/library-browser-evidence.jsonl test-results/touch-responsive-evidence.jsonl
npm run test:browser > test-results/touch-browser.log 2>&1
cp test-results/library-browser-evidence.jsonl test-results/touch-full-evidence.jsonl
```

Record each command's exit status. For a failure, retain its complete error (which
includes target geometry), both JSONL files and the failure PNG. Each JSONL record
includes browser version, viewport, URL, timestamp, focus, library/reader state,
DOM rectangles, offset dimensions, computed min/actual sizes, flex settings,
ancestor transforms and animation timing. Target assertions also record the raw
Playwright box. Navigation records geometry before and after settling. New
`library-project-{320,390}-{no-preference,reduce}.png` files show project menus;
existing library failure and reader screenshots remain available. Compare the
opening and settled records rather than inferring dimensions from a screenshot.

Local `npm run verify` passed: typecheck, lint, 71/71 tests and production build.
Both browser commands built successfully and exited 1 before scenarios ran:
`listen EPERM 127.0.0.1:3491` and Chromium `sandbox_host_linux.cc:41` shutdown
Operation not permitted. No browser pass or confirmed live transition geometry
is claimed from these sandbox attempts.
