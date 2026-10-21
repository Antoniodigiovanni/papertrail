# Verification record

Date: **2026-10-21**. The current project UX work is recorded first;
earlier reader/import evidence follows as historical context. Browser assertions
added here have not executed in this restricted environment.

## Project menu, rename and file-status changes

Inspected SPEC, client cards/sidebar/reader management, API validation, SQLite
labels/deletion, backup format and API/browser regressions before making changes.
The former left-hand PDF rectangle contained only text, an arrow and CSS styling;
there was no thumbnail image, loading state or rendering request to fix.

Implemented:

- A right-aligned vertical-ellipsis button per project opens Rename / Delete project.
  Each trigger/menu/action names its project. Enter/Space/arrow opening, arrow and
  Home/End movement, Tab exit, Escape with focus return, outside pointer/focus
  dismissal and 44 px touch targets are included. Mobile navigation now has a close
  control and Escape handling; a closed mobile sidebar is hidden from tab navigation.
- A native modal rename dialog provides focus containment, input selection and
  trigger focus return. Cancel, Escape and backdrop dismissal discard unsubmitted
  text. Submission trims and validates 1–100 characters; errors keep the draft.
  Pending requests disable submission/dismissal. Duplicate names are rejected
  exactly and case-sensitively, matching the existing label identity rules.
- `PATCH /api/projects/:id` requires `{ name, expectedName }`. Store validation and
  a transaction compare the current name before updating only `projects.name`.
  A changed name yields 409 with `PROJECT_NAME_CONFLICT`; the dialog requires
  explicit Reload latest project, which replaces its draft. Unknown/deleted IDs
  yield 404. This is value comparison, not a new monotonic project revision: a name
  changed away and then back compares equal. Project IDs and backup schema stay
  stable. Older in-flight library responses cannot revert the local rename.
- Headings, selected project display, paper labels and editors use the saved name.
  Rename changes no paper records, revisions, assignments, annotations or bytes.
  Project deletion keeps its existing named confirmation, ID confirmation and
  transactional data-preservation semantics; deletion restores focus to All papers.
- Compact file icons and visible PDF available / Reference only badges replace
  the fake thumbnail. A reference without bibliographic identifiers says No PDF
  attached rather than Local PDF. No thumbnail generation, infrastructure or preview promise
  was added. Reader rendering/gesture/annotation code remains unchanged.

Observed checks:

- `npm run verify` passed TypeScript, ESLint, all **43 tests** and the production
  build. Log: `test-results/project-ux-verify.log`. Final focus-handling changes
  also passed a separate type/lint check; the final availability-label build is
  recorded in `test-results/project-ux-build.log`. Two new API/store regressions
  cover trimmed/no-op names, validation, exact/case-sensitive duplicates, actual
  competing renames, unknown/deleted IDs, authentication, database reopening,
  backup restoration and unchanged complete paper/annotation/PDF snapshots.
  Existing 41 regressions continue to pass, including project-deletion safety,
  paper management, reader geometry, touch behavior and rendering cancellation.
- Both `npm run test:browser:library` and `npm run test:browser` rebuilt successfully
  and compiled the test fixtures, then failed before any UI assertion. Loopback
  binding returned `listen EPERM ... 127.0.0.1:3491`; Chromium exited at
  `sandbox_host_linux.cc` with operation not permitted and `SIGTRAP`.
  Logs: `test-results/project-ux-browser-library.log` and
  `test-results/project-ux-browser-full.log`. No browser screenshots or passed
  browser interactions are claimed for this change.
- Browser regression source passes syntax/lint checks. Rerun the same focused and
  full commands on a host permitting HTTP sockets and Chromium; they create
  isolated test storage. Physical-device, screen-reader and prior reader/production
  acceptance gaps remain outstanding. Production services, credentials, settings
  and library data were not accessed or changed; no restart, deployment, commit
  or push was performed.

Browser assertions include keyboard/menu dismissal/focus, dialog cancellation,
blank/long/exact duplicate errors, injected rename/delete 503 failures, actual concurrent
rename conflict/reload, selected-heading and sidebar persistence, exact paper/
annotation/PDF comparisons, 320/390 px dialog and long-name layout, and compact
PDF/reference status. Reference status uses an intercepted library response fixture;
PDF status uses a real uploaded PDF. Existing management, deletion and reader
acceptance flows remain in the same commands. Device and assistive-technology
behavior still requires a capable browser host and physical-device follow-up.

## Earlier library-management changes (historical)

Existing capabilities inspected before implementation: the Details panel already
contained multi-project assignment, project/tag creation prompts, reading state,
archive and confirmed paper deletion. Assignment checkboxes already used functional
queued saves with optimistic local state and rollback. Project deletion was absent.
Tags were exposed as project-style sidebar creation and assignment checkboxes.

Implemented behavior:

- Library rows expose Organize paper and Archive paper; the reader header opens
  Organize directly. Archive rows and archived detail expose Return to library and
  confirmed permanent deletion, naming the irreversible scope. Deletion waits for
  queued writes and uses the latest confirmed revision. Failure remains visible
  and reload is available before retrying.
- Shared project checkboxes and per-paper tag chips use the existing functional
  assignment-save contract. Tags suggest existing library labels, create/reuse an
  exact trimmed name in context and remove a chip only from that paper. Input text
  typed while a save is pending is retained. Sidebar/dropdown filtering remains;
  sidebar tag creation is removed.
- `DELETE /api/projects/:id` validates both the route UUID and explicit matching ID
  confirmation. One SQLite transaction advances affected paper revisions and
  deletes only the project; foreign keys remove its membership rows. It never
  deletes papers, files, notes, annotations, tags or other memberships. Orphan
  active papers appear in Unassigned; archived papers remain archived. The UI
  clears a missing selected project and retains valid other filters. Library
  refreshes use current filters and ignore superseded responses.
- SPEC.md and README now describe this behavior. Reader gesture, selection, canvas
  rendering and virtualization code is unchanged. Reader acceptance still contains
  the earlier touch/geometry assertions; its assignment interactions use chips.

Validation:

- `npm run verify` passes TypeScript, ESLint, **41 tests**, and the production build.
  Four new API/persistence tests cover confirmed project deletion, contextual tag
  reuse/removal, post-import multi-project reassignment and isolated paper deletion.
  They check wrong/missing/extra confirmations, malformed/unknown IDs, archive
  requirements, stale revisions, invalid assignments, transactional rollback,
  database reopening, exact retained paper fields/annotations and original bytes.
  An unaffected reference and an archived reference are included in project
  preservation checks. The new delete endpoint is checked at the auth boundary.
  Existing touch/pinch/render/geometry regressions remain passing.
- Log: `test-results/library-management-verify.log`.
- Both `npm run test:browser:library` and the final `npm run test:browser` were
  attempted. Build and test compilation succeeded, but loopback `127.0.0.1:3491` binding returned `EPERM`; Chromium failed at
  `sandbox_host_linux.cc` with operation not permitted and `SIGTRAP`. No browser
  UI assertion executed. This is an environment failure, not a passing browser run.
  Full-run output: `test-results/library-management-browser.log`; server output:
  `test-results/browser-server.log`.
- Browser scripts pass syntax/lint checks. They add real interactions for chip
  creation/reuse/removal; delayed, rapid project/tag edits; reload persistence;
  actual 409 and injected 503 rollback; project-deletion cancellation and
  confirmation with exact paper/annotation/PDF comparisons; selected-project/tag
  filter recovery; Unassigned; a 390 px library layout; archive/restore; and
  cancelled/confirmed permanent deletion in library and detail. These are pending
  acceptance flows, not observed results. Library failure/mobile screenshots are
  captured when those stages can run.

Required host reruns (fresh isolated test storage; no production library access):

```sh
npm run test:browser:library
npm run test:browser
```

The focused command runs the management flows alone. The full command runs them
before the existing reader/touch acceptance. Physical iOS/iPadOS/Android,
Firefox/WebKit and production import behavior remain unverified by this change.
No production data/configuration, service restart, commit, push or publication was
performed.

## Earlier reader/import checks (historical)

| Check | Current result |
| --- | --- |
| `npm run verify` | Virtualization follow-up passes TypeScript, ESLint, all **37 tests**, and production build. Includes existing fixture geometry, post-pinch policy and render cancellation regressions. |
| `npm run test:browser` | Latest independent host rerun passes pinch and **all** native-pan checks, including after cancelled pinch, then times out at the former line 214 after `navigate(10)`. Captured page flags and geometry prove that assertion searches canvases across the entire document. The corrected virtualization/navigation acceptance needs a new host run. |
| `npm run check:import-route` | Built Access-mode handler returns **502 application/json**: `Could not reach export.arxiv.org…`; no PDF downloaded. Provider network access is unavailable here. |
| Authenticated production browser, physical iOS/iPadOS/Android, Firefox, WebKit | Not available/tested. |
| Actual systemd sandbox, Caddy and Cloudflare edge behavior | Not reproduced; configuration and relevant code paths inspected, isolated tests described below. |

No production library data, authentication settings, Caddy configuration or service
lifecycle was changed. No commit, push or deployment was performed. All route
reproductions use isolated storage and synthetic keys/tokens. Runtime secrets and
session cookies were not accessed.

## Virtualization assertion follow-up

The latest host evidence was preserved before running local browser checks as
`test-results/reader-browser-evidence.host-before-virtualization-followup.jsonl`.
Its `failure page 2` snapshot has zoom 1, scrollTop 4509, and a 390×691 scrollport
starting at viewport y=153. Page 10 starts at y=152.765625 (within one pixel of
the scrollport top) and is painted. Page 1 has `data-rendered="false"`, no canvas,
no text spans, and bottom y=-3870.359375. All pages 1–7 have released their layers;
pages 8–12 still have canvases. This matches the actual IntersectionObserver:
root `.pdf-scroll`, `rootMargin: '900px'` on all four sides, threshold 0. Page 8's
bottom y=-372.875 is inside the top prefetch boundary y=-747. Page 7's bottom
y=-872.515625 is beyond it.

The timed-out expression combined the **first page's** `dataset.rendered` with
`!document.querySelector('.pdf-page canvas')`. The second selector means there
must be **no canvas anywhere in any page**, including the painted destination
required immediately beforehand. It therefore remains false even with correct
offscreen cleanup. This is a selector-scope error in acceptance, not evidence of
a virtualization leak or a failed navigation.

The replacement requires page 1 to be beyond the 900px prefetch margin and checks
**every** far-offscreen page for `data-rendered="false"`, observer prefetch state
false, no canvas/text layer, and an empty artwork host. It separately requires
page 10's canvas to contain painted text. It repeats cleanup after reload at the
saved page-10 offset, then verifies page 10 is released and page 1 repainted on
return. The product's observer/render/cleanup behavior is unchanged; two data
attributes expose the existing observer state and configured margin for diagnostics.

Navigation now checks actual scroll alignment, horizontal reset, and toolbar page
number as well as paint, for page entry, Next, Previous, return and restoration.
Painting alone cannot establish navigation because prefetched pages also paint.
The 200px scroll waits for its matching successful PATCH response instead of a
fixed 900ms delay, compares the server's saved offset to actual page geometry,
then reloads and verifies restoration. These requests only target the isolated
browser fixture. All native-pan, selection, highlight and responsive acceptance
remains in place.

Navigation/cleanup stages append reader evidence on success and timeout. Snapshots
include page-input value, actual `data-rendered`/render-width/prefetch flags,
distance from the scrollport, artwork child count, canvas and text geometry;
the persistence stage records expected and saved offsets. Global failure
screenshots and per-page evidence remain enabled.

Local validation: `npm run verify` passes TypeScript, ESLint, all **37 tests** and
the production build. `node --check scripts/reader-browser-checks.mjs` also passes.
The already-built browser entrypoint `node scripts/browser-smoke.mjs` was attempted;
it fails before any UI assertion because loopback listen returns `EPERM` and
Chromium fails at `sandbox_host_linux.cc` with operation not permitted/SIGTRAP.
Output: `test-results/browser-virtualization-followup.log`. Thus the revised
browser assertions have not executed here. Required independent host rerun:
`npm run test:browser` (fresh isolated storage, no production-data access).

## Desktop selection follow-up

The full browser scripts, fixture PDF instructions, zoom anchor math, text-layer
CSS and vendored PDF.js text layout were inspected. The failing script used
`boundingBox()` followed by raw `page.mouse` coordinates without revealing the
target or checking clipping/hit targets. A span bounding box includes offscreen
pixels; raw mouse commands do not scroll it into view.

The fixture is a 612×792-point PDF. Actual `pdfinfo` and `pdftotext -bbox` checks
confirm that “Highlights should stay anchored across devices.” has ink bounds
`[60, 118.384, 316.104, 129.484]` in top-left PDF coordinates. At the configured
1440×1000 desktop viewport with a 330 px panel and 24 px reader padding, available
page width is approximately 1062 px. Center-preserving zoom to 150% leaves
approximately 265.5 px horizontal scroll. The target starts near
`24 - 265.5 + 60/612 * 1593 = -85.3 px`, outside the viewport. Scrollbars and
rounding can shift these values slightly. Thus the old test has an invalid
selection-coordinate assumption even when the zoom anchor works correctly.
This calculation is **not** a captured failing browser trace and does not establish
the precise event sequence that produced `es`. No product anchor/render change
is justified by the supplied failure alone.

The browser regression now reveals the entire target span, checks that both
mouse endpoints lie inside the scrollport/viewport and hit the intended span,
then performs a real mouse drag. It requires the **complete exact quote** both
from native selection and the reader toolbar. It also checks text and native
range geometry against independent fixture ink bounds, painted pixels at that
passage, and saved highlight geometry before/after zoom, reload, mobile pinch,
return from virtualization and responsive resizing. Existing cancellation,
normalized-style persistence and mobile acceptance checks remain. Ctrl-wheel
focal-point preservation now has its own two-axis assertion before any reveal
scroll, so correcting test visibility cannot hide broken zoom anchoring.

`tests/reader.test.ts` checks the geometry oracles against actual Poppler extraction
from the generated PDF. This is a fixture regression, not proof of browser selection.
The desktop browser assertions passed in the latest reported host rerun. Each selection writes before-
reveal, revealed and selected snapshots to
`test-results/reader-browser-evidence.jsonl`: zoom, scrollport/page/text/canvas
rectangles, transforms, endpoint hit targets, native quote/endpoints/range rectangles
and toolbar quote. Failures append state for every open page and capture
`test-results/reader-failure-<index>.png` before teardown. Existing host evidence was
preserved as `test-results/reader-browser-evidence.host-before-pan-followup.jsonl`
before the local rerun reset the normal evidence file.

**Current execution blocker:** `npm run test:browser` was attempted for this
follow-up. Production build passes; the isolated test listener fails with
`listen EPERM: operation not permitted 127.0.0.1:3491`, and Chromium exits with
`sandbox_host_linux.cc … Operation not permitted (1), SIGTRAP`. The fresh output
is in `test-results/browser-pan-followup.log`; `browser-server.log` now records
this attempt's EPERM. No browser assertions executed locally. These restrictions
are separate from the host's native-pan failure. No sandbox bypass was attempted.

## Native touch pan follow-up

The old test sent eight single-finger moves of `(-10, -14)` then required both
`scrollLeft > before.left + 30` **and** `scrollTop > before.top + 40`. This assumes
native scrolling must preserve both components of a diagonal drag. `pan-x pan-y`
permits horizontal and vertical panning; it does not prescribe simultaneous
two-axis scrolling. The browser decides gesture recognition. Touch-action also
does not control text-selection behavior. See [W3C Pointer Events, touch-action](https://www.w3.org/TR/pointerevents/#the-touch-action-css-property).

Chromium's [SnapScrollController](https://github.com/chromium/chromium/blob/main/ui/events/gesture_detection/snap_scroll_controller.cc)
can choose a vertical rail when initial `dy/dx > 1.25` after crossing touch slop,
while `dx` is still below twice the slop. Here `14/10 = 1.4`. Its rail-release
logic accumulates off-axis motion but clears accumulated distances when along-axis
motion exceeds the channel first. Thus a continuing 10:14 drag can remain railed;
its total 80 px horizontal finger displacement does not guarantee 80 px horizontal
scroll. [GestureProvider](https://github.com/chromium/chromium/blob/main/ui/events/gesture_detection/gesture_provider.cc)
subtracts initial touch slop and either zeroes the off-axis component or sends the
rail mode to the renderer, depending on the feature configuration. These are
upstream source mechanics, not a trace of the host's internal recognizer state.

The preserved host failure snapshot shows zoom 2.2, scroll `(220, 356)`, scrollport
`390 × 691` at viewport y=153, and first page width 805.1875 at x=-208. With 12 px
padding, fit width is 366; a center pinch to 2.2 predicts horizontal scroll
`12 + (366 * 2.2)/2 - 195 = 219.6`, rounded to 220. There is horizontal headroom
in both directions. This is consistent with vertical native railing, rather than
horizontal movement during that diagonal. The old artifact contains no pre-pan
snapshot/event trace, so it cannot establish the exact delta or prove native
horizontal panning works. The old desktop failure is resolved by the supplied
host rerun and is not the current failure.

Implementation review found no one-finger pan cancellation: `bindReaderTouch`
calls `preventDefault()` only for a two-touch start or an active two-touch move.
`touchend`/`touchcancel` clear pinch state; the reader's scroll listener tracks
position without assigning either scroll axis. Zoom anchor assignments run when
zoom/width/gesture frame changes. The CSS keeps `overflow:auto`, `pan-x pan-y`,
and selectable text spans. No product touch handling, touch-action, zoom anchoring
or text-selection CSS was changed for this correction.

The browser regression retains the original diagonal (either native axis may
move) and separately requires horizontal **and** vertical CDP touch drags, each
in both directions, with signed displacement above the original 30/40 px
thresholds. It repeats independent horizontal and vertical drags after a cancelled
pinch. Every gesture uses its own actual starting scroll position, validates
scroll headroom and a fully visible touch path, uses frame-paced input, holds
before release to suppress flings, waits for settling, and checks the final
displacement. No scroll assignment, mouse drag, wheel event or DOM-dispatched
touch event can satisfy these pan checks. A broken axis still fails even when
the diagonal passes on the other axis.

`scripts/reader-pan-checks.mjs` writes pre/post positions and scroll limits,
zoom, hit-target ancestor CSS (touch-action, user-select, overflow), sent CDP
coordinates/times, trusted touch/pointer cancellation events, default-prevention
state and scroll samples into the normal reader evidence file, including on
gesture timeout. Passive observers run after reader touch handlers and never
cancel events. Each gesture must keep zoom unchanged, leave native one-finger
events uncancelled, and avoid creating a selection/highlight toolbar. Desktop
native exact-quote selection and independent ink/range geometry checks remain.

Three unit regressions cover normal pinch end, cancelled pinch, and lifting one
finger. They exercise both pan axes/directions and stationary one-finger events,
requiring no cancellation or pinch callbacks after the pinch finishes. These test
listener policy, not browser scrolling or physical long-press selection. Required
next check on a capable host: `npm run test:browser`, then inspect the independent
pan stages in `test-results/reader-browser-evidence.jsonl`. Physical touch text
selection and browser/device coverage remain unverified here.

## Reader investigation and changes

The previous reader had no reader-controlled touch pinch handler. Zoom used a fixed
70 ms timeout to restore a saved position instead of preserving the PDF point
under the fingers. The scrollport reserved 48 px even on a narrow phone. Mobile
notes started open as an absolutely positioned overlay over the PDF.

Rendering also had observable lifecycle defects: cancellation could reject the
canvas promise while code was still awaiting text content, before a rejection
handler was installed. Offscreen cleanup cleared the canvas without clearing its
`rendered` flag. Canvas sizing bounded dimensions but not total pixel area. These
are code findings and covered failure cases; they do not identify which exact
failure occurred on the reported physical phone. The vendored PDF.js releases its
canvas lock synchronously on cancellation, so a purported asynchronous canvas-lock
collision is **not** asserted as the cause.

Changes in `client/reader.tsx`, `client/reader-touch.ts`, `client/reader-geometry.ts`
and `client/pdf-render.ts`:

- Two-touch pinch preserves page-relative focal coordinates and follows the touch
  midpoint on both axes. It previews by scaling existing canvas/text together,
  then renders at the settled zoom. End and cancellation commit the current zoom.
- One-finger scrolling/panning and long-press selection remain native. Trackpad
  ctrl-wheel pinch, existing zoom buttons/select, search and navigation remain.
- Layout-based anchoring replaces the fixed zoom timeout. Available width accounts
  for actual padding and scrollbars. Magnified content retains a reachable left edge.
- Each render owns fresh canvas/text nodes and publishes both together. Previous
  imagery stays visible during redraw. Offscreen layers are removed and their
  readiness state reset. Render rejection handling starts before text loading.
- Backing canvases are capped at 8 million pixels, 4096 px per side and density 2.
  PDF-space highlight fractions continue to scale with the page.

Changes in `client/main.tsx` and `client/style.css`: at widths up to 900 px, notes
start closed and open in reserved space below the reader. There is an explicit
**× Close**, an expanded-state header toggle, and Escape dismissal with focus
return. Following a passage closes the mobile panel to reveal the destination.
Desktop retains the side panel. Dynamic viewport height, safe-area padding, larger
mobile inputs and a two-row toolbar at 320 px avoid unintended clipping/overflow.
`public/favicon.svg` is an original local paper/passage mark, wired in `index.html`.

Executed reader regressions test pinch distance/clamping, two-axis anchor math,
canvas dimension/area budgets, installed touch listener dispatch, native-event
pass-through, pinch end/cancel, immediate canvas rejection while text is pending,
and isolation of a superseded generation from its successor. These use real
EventTarget dispatch and deterministic rendering doubles, **not** a browser layout
or rasterizer. The favicon test checks the served SVG MIME type, local contents,
entrypoint link, and the existing authentication-boundary test covers its URL.

## Earlier browser coverage and sandbox attempts

`scripts/browser-smoke.mjs` retains real desktop text selection/highlight creation,
notes and annotation persistence, rapid assignment/conflict checks, search,
separate contexts, archive and deletion. `scripts/reader-browser-checks.mjs` adds:

1. Rapid zoom changes and ctrl-wheel pinch; wait for final-resolution rendering,
   inspect actual nonwhite canvas pixels, select a different text passage after
   zoom, and check highlight pixel geometry against normalized anchors.
2. A 12-page text PDF and a touch context with device density 3; CDP sends real
   two-contact start/move/end and cancellation events. Assert zoom amount and
   focal-point preservation, then single-finger pan and scroll displacement on
   both axes.
3. Navigate beyond the prefetch margin; require page one's canvas/text to unmount,
   render page ten/eleven, scroll and check persisted position, then return and
   require painted/selectable layers again.
4. Tap a highlight, assert the notes panel does not intersect the PDF scrollport,
   follow a passage, save a phone note, dismiss via Close and Escape, reload, and
   check persistence/default closed state.
5. Resize to 320×568, 844×390 and 390×844; assert fit-width has no accidental
   horizontal overflow and that panel/reader occupy separate bounded rectangles.
6. Assert the favicon's HTTP status, MIME type and entrypoint link.

The 12-page browser fixture separately passed actual `pdfinfo` validation.
Earlier sandbox browser commands were attempted before and after implementation. Both attempts failed
before any UI assertion could execute:

```text
listen EPERM: operation not permitted 127.0.0.1:3491
Chromium: sandbox_host_linux.cc … Operation not permitted (1), SIGTRAP
```

The subsequently reported independent host run reached the selection assertion
described above. Existing screenshots are not evidence for this follow-up.
The expanded interactions need a host allowing HTTP/Chromium and then physical
Safari/Android checks, especially native selection handles and keyboard behavior.

## Production import investigation

The reported reference is `https://arxiv.org/abs/2608.12594`. A previously observed
standalone built `importReference` call succeeded with title **What Makes a Peer?
Valuation-Anchored Similarity in Private Markets**, arXiv **2608.12594v1** and
**871307 PDF bytes**. That proves provider behavior for that call only; it does not
prove `/api/import`, PDF validation, storage, Caddy, Access or browser success.

The original client message was thrown when `response.json()` failed. It establishes
an unparseable response, without identifying HTTP status, whether it was HTML,
truncated JSON, an Access redirect, a proxy response or another source. No one of
those is declared the production cause.

Inspection of the native service description and code found:

- `AUTH_MODE=access` validates JWT signature/issuer/audience/expiry; development
  mode has different peer checks. Tests use ephemeral signed JWTs, not a bypass.
- `PUBLIC_ORIGIN=https://read.antovanni.com` is necessary when the internal request
  URL is loopback HTTP. Missing/invalid auth and origin mismatch return JSON
  401/403 inside the handler.
- `validatePdf` streams bytes to `pdfinfo -`. The application does not create a PDF
  temp file in the repository. Storage writes target the configured data directory.
  `ProtectSystem=strict`, `PrivateTmp=true`, `ProtectHome=read-only`, and the data
  `ReadWritePaths` restriction were considered, but the actual namespace was not
  reproduced. No extra write path or security relaxation was introduced.
- Import catches PDF-validation failures and retains metadata with a warning.
  Store exceptions are caught by the route error handler and return JSON 500.
  Neither tested case produces HTML. Proxy/edge errors remain outside that handler.

`tests/api.test.ts` sends the exact URL through the actual handler with synthetic
Access JWT cookie auth, production HTTPS Origin and internal
`http://127.0.0.1:8350/api/import` request URL. Fixture Atom metadata deliberately has
a fixture title, arXiv `2608.12594v1`, and a generated real text PDF. This exercises
normalization, provider URLs, real Poppler parsing, SQLite/file insertion and
duplicate reuse. It succeeds even with `TMPDIR` pointing to a nonexistent directory.
This is evidence about this PDF/parser path, not proof of all Poppler behavior or
the full systemd namespace.

The same tests assert JSON status/content type for missing auth, wrong origin,
wrong request content type, malformed JSON, provider 502, invalid PDF metadata-only
success, and an injected EROFS storage failure. An actual missing `pdfinfo`
executable now returns an actionable JSON 503 for upload, while import returns
201 metadata-only success with a validation-unavailable warning. Tests execute
that missing-executable case with an isolated PATH.

`scripts/check-import-route.mjs` repeats the built-handler path using real providers
and fresh storage, then removes its storage. Its local result was **502
application/json**, with a generated request ID and the provider-unreachable
message above. It performs no actual production request and opens no HTTP socket.

Diagnostic changes in `client/api.ts` and `server/app.ts`:

- Enforce JSON response media types; report HTTP status and HTML/text/non-JSON,
  malformed-JSON or unexpected-JSON format. Keep safe application JSON messages
  and revision-conflict details. A network failure reports unconfirmed persistence.
- Never echo raw response HTML, status text, redirected URLs, cookies or arbitrary
  header values. Accept only validated native UUID/Cloudflare edge references.
- Generate native request IDs and log unexpected errors with method, matched route,
  status and a small allowlist of storage codes. Raw errors, request bodies and
  credentials are excluded. Regression tests check these boundaries.

**Outstanding production blocker:** capture a failing authenticated browser request's
status, response format and safe request/edge reference, then correlate it with the
native/proxy/edge failure. This environment has no authenticated production browser
and production data must remain untouched. The original import failure is unresolved;
it is not presented as fixed by the diagnostics or by successful fixture/provider calls.

## Remaining acceptance limits

Run `npm run test:browser` on a capable host and test iOS/iPadOS Safari and Android
Chrome directly. Verify touch selection/highlight handles, pinch/pan, long/image-heavy
and mixed-page-size PDFs, notes with the software keyboard, Firefox/WebKit and laptop
trackpads. Full Caddy/Cloudflare/systemd import success requires separate operational
verification. Docker build/runtime and cold-volume restore were not rerun. Existing
backup/export/security/persistence regressions remain in `npm run verify`; they do
not substitute for these missing browser/device/production checks.

## Project rename dialog focus regression (2026-10-21)

The reported host browser failure at `library-browser-checks.mjs:242` occurred
when Tab from Save name did not return to Project name. The dialog previously
relied entirely on native `showModal()` focus behavior. It now explicitly wraps
Tab and Shift+Tab between the first and last enabled controls. Disabled Save name
is excluded during conflict recovery. Browser regression assertions cover both
directions on desktop, after a conflict, and at 320/390 px widths.

Validation: `npm run verify` passes all 43 tests, typecheck, lint and build.
`npm run test:browser` and the initial `npm run test:browser:library` attempt
could not reach UI assertions: local listen on 127.0.0.1:3491 returned `EPERM`,
and Chromium exited with `sandbox_host_linux.cc` / Operation not permitted.
The reported host failure was not reproduced or confirmed fixed in this sandbox;
the updated browser regression must be rerun on a capable host. No schema changes.

## Independent PDF filename editing (2026-10-21)

Library Organize and reader Details now edit `pdfFilename` separately from title.
Safe local upload names initialize it; legacy/provider defaults use the stable
paper ID. Both inline and attachment responses send an ASCII fallback plus an
encoded Unicode `filename*`. Names require `.pdf` and reject paths, traversal,
controls, format characters, reserved punctuation/device names and oversized UTF-8.
API and store validation run before metadata changes. The response boundary also
falls back safely if stored filename metadata is malformed.

The additive, idempotent migration adds a nullable column and schema version 2;
legacy rows are not rewritten. Backup version 2 includes names; restore accepts
version 1 with missing/null names and validates names before any writes. README
records code rollback and backup-version caveats. Keep the added column on rollback.

Regressions compare bytes, checksum/path, IDs, annotations, notes, assignments and
position through filename edits; test independent title edits, stale revisions,
duplicate reuse, reopening, legacy migration/version markers and both backup
formats. Browser coverage adds invalid-name recovery, persisted display/editor
values in library and reader, and a real Unicode-named download with byte comparison.

Validation: `npm run verify` passes typecheck, lint, 47 tests and build.
Browser execution remains blocked before UI assertions by loopback `EPERM` and
Chromium's sandbox permission error; no host browser pass is claimed. Rerun
`npm run test:browser` on a capable host. Production was not accessed or changed.

## Stay in the library after imports (2026-10-21)

Upload, arXiv and DOI success share one library reveal handler. It clears
search/tag/status filters and bulk selection, chooses the current requested
project or a deterministic selected project (sorted ID), and uses All papers
when no destination was requested. Archive scope follows the returned record;
reusing an archived paper never unarchives it. The row is marked, scrolled into
view and focused once; Enter or title activation explicitly opens the reader.
Success retains duplicate and metadata-only/provider notices. The confirmed
returned paper is shown immediately even if a subsequent library refresh fails.
Earlier filtered responses and errors cannot replace the new state. Import
errors retain the dialog, source and selected destinations for retry.

API/store regressions exercise new local, arXiv and DOI results with real SQLite
and fixture providers, destination queries, deterministic multiple targets,
duplicate identity/data preservation, metadata-only warnings, archived duplicates
and failures without store changes. Browser regressions seed remote identities
via a version 1 backup into the empty disposable server and exercise actual
import duplicate routes without external provider calls. They check desktop and
mobile visibility/focus, destinations and filters, late filtered responses,
reference warnings, retained retry inputs and confirmed success during a list
refresh outage. Existing library/reader checks now open papers explicitly.

Validation: `npm run verify` passes typecheck, lint, all 50 tests and build.
`npm run test:browser` cannot reach UI assertions in this sandbox: loopback
listen returns `EPERM` and Chromium exits with the sandbox permission error.
The focus fix and new browser assertions still require a capable host run;
there is no claimed host browser pass or physical-device verification. The
previous production import failure remains unresolved and production was untouched.

The additional UX requirements from `NEXT-CHANGES.md` are implemented with
regressions and specification updates; the untracked requirements note was removed.
This feature adds no migration and is reversible independently of filename data.
