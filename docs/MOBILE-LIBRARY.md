# Mobile library

At 760 CSS px and below, the library uses a compact heading and Add paper control,
search and two bounded filters, then a results/selection/export toolbar. Marketing
copy is hidden. Titles use 18 px type, authors 13 px, and status/project/tag labels
are grouped beneath the title metadata. Normal Saved indicators, duplicate PDF
availability labels, and decorative file icons are hidden on phones. Download
filenames and Reference only warnings remain available.

Each paper's 44 px overflow trigger opens Organize paper, Rename PDF (for PDFs),
and Archive paper. Archive offers Return to library and confirmed permanent delete.
Organize and rename use the same revision-aware save queue as desktop. The editor
receives focus and has a close control returning focus to its menu trigger. Menu
keyboard controls include Enter/Space, Up/Down, Home/End, Escape and Tab exit;
outside pointer/focus dismisses it. Pending/error save feedback remains visible.

Select papers enables 44 px selection labels; Done clears selection. Export opens
BibTeX and Markdown downloads using the existing selection/project/library export
rules. Desktop retains direct actions, checkboxes and export links. Sidebar backup
controls scroll with navigation on phones instead of covering projects and tags.
Safe-area padding and wrapping accommodate long filenames, titles and labels.
Reader gesture and rendering code, access controls, server behavior and schema are
unchanged by this feature.

## Browser regression and visual review

Run against the disposable server and generated PDFs:

```sh
npm run verify
npm run test:browser:responsive
npm run test:browser
```

The responsive command runs actual Playwright/HTTP interactions at 360/390/430 px,
then checks tablet/desktop widths 768/1024/1366. It asserts page/content bounds,
44 px touch targets, readable type, first-title placement, long unbroken titles,
long tags/projects, menu focus/dismissal, search and both filters, real selection
exports and downloaded content, organizing, filename saves, upload/focused reveal,
reader entry/back, archive/restore and cancelled/confirmed deletion. Existing full
browser coverage continues to exercise project rename, import retries, filename
byte preservation and PDF reader gestures. All data is isolated from production.

On a capable host it writes these visual-review artifacts under `test-results/`:

- `library-mobile-{360,390,430}.png` and corresponding `-menu.png` images
- `library-mobile-organize.png` and `library-mobile-import.png`
- `library-responsive-{768,1024,1366}.png`
- `library-responsive-failure.png` if an assertion fails

These are browser emulations, never physical-device evidence. In the implementation
environment Chromium exits before opening a page (sandbox_host_linux.cc,
Operation not permitted) and the disposable HTTP server cannot bind loopback
(listen EPERM). **No new screenshots or executed browser-layout results could be
produced here.** The assertions and capture paths are implemented but require the
host rerun and visual inspection before deployment. Build/unit success does not
establish screenshot quality or device success.

## Separate metadata finding

See [PDF metadata investigation](PDF-METADATA-INVESTIGATION.md). No parser or stored
metadata rewrite is included in the mobile feature.
