# Papertrail

A private, self-hosted paper library and browser PDF reader. One shared library,
with Cloudflare Access authentication and no application accounts. Online-first:
reading, annotations and synchronization require a connection to your server.

**Verification status:** `npm run verify` passes type/lint checks, all **43 tests**,
and the production build. Project rename and library-management changes add API/persistence
regressions and real browser acceptance flows. Browser execution was attempted;
loopback HTTP binding fails with `EPERM` and Chromium exits with a sandbox
permission error before UI assertions. Run `npm run test:browser:library` and
`npm run test:browser` on a host that permits them. Physical-device verification
and the previously recorded reader browser follow-up remain outstanding.
The production import failure remains unresolved; this change does not touch
production data, configuration or services. See [VERIFICATION.md](VERIFICATION.md)
for exact check results and outstanding checks.

## Native setup

Requires Node **22.22.1** (Node 22's built-in SQLite is experimental), npm, and
Poppler's `pdfinfo` on PATH (`pdftotext` is also required for tests). On Debian/Ubuntu,
install `poppler-utils`. No Python or
external database is needed. The Dockerfile installs these runtime requirements.

```sh
npm ci
npm run verify
AUTH_MODE=development HOST=127.0.0.1 DATA_DIR=./data npm start
```

Open `http://127.0.0.1:3000`. Development mode must be explicitly enabled, binds only
to loopback, and checks the actual socket peer. Do not proxy this mode to the public
internet. Without `AUTH_MODE=development`, missing Access configuration stops startup.

For UI development, run these in separate terminals:

```sh
AUTH_MODE=development HOST=127.0.0.1 PUBLIC_ORIGIN=http://127.0.0.1:5173 npm run dev
npm run dev:ui
```

Open `http://127.0.0.1:5173`. The Vite development UI is loopback-only. The native
server does not load `.env` automatically; export variables explicitly. Production
serves the built frontend and API through the same authenticated server.

## Docker deployment

The Compose configuration targets `linux/amd64`, pins the Node release, uses the
npm lockfile, runs checks during the build, and keeps SQLite and PDFs in one durable
named volume. OS security packages are installed from the base image's Debian
repositories during build. A build needs access to those repositories and npm.

```sh
cp .env.example .env
# Edit .env with your HTTPS origin, Cloudflare team domain, and application audience.
docker compose build
docker compose up -d
docker compose ps
```

The service runs as the unprivileged `node` user, with a read-only root filesystem,
temporary `/tmp`, dropped capabilities and a 2 GiB memory limit. The host port binds
to `127.0.0.1` only. `/healthz` is a minimal, unauthenticated liveness check that
returns no library information. All other routes, including static JS, the root UI,
PDF bytes, downloads, exports, backups and unknown routes, require authentication.

Configure a Cloudflare Access self-hosted application covering the **entire hostname
and all paths**. Set an allow policy for yourself. `ACCESS_TEAM_DOMAIN` is the team
domain such as `your-team.cloudflareaccess.com`, without scheme or path.
`ACCESS_AUDIENCE` is the application's audience identifier; neither is a secret.
Set `PUBLIC_ORIGIN` to the exact HTTPS origin, without a trailing slash.

Point a separately managed Cloudflare Tunnel at the loopback port. Keep the origin
inaccessible from the public internet: do not open/forward port 3000, do not bind it
to a public interface, and do not publish the data volume or a second static server.
If using a reverse proxy, firewall the origin to that proxy and ensure that every
route passes through this server. Tunnel credentials remain outside this repository.
Configuring Access and the tunnel is an operator task; nothing is provisioned here.

The server cryptographically validates an Access assertion header or the signed
`CF_Authorization` cookie using the configured team's HTTPS JWKS. It pins RS256,
issuer, audience and signature, requires subject/issued-at/expiry, and checks expiry,
issued-at and not-before with five seconds of clock tolerance. It ignores identity
email headers. JWKS is cached for five minutes; an unknown rotated key can require
up to five minutes before a session succeeds. Failure to retrieve keys fails closed.
Keep the host clock synchronized. Cross-site mutations are rejected; there is no
permissive CORS policy. `PUBLIC_ORIGIN` also checks browser mutation origins.

## Using the library

- Add a local PDF, arXiv ID/URL, or DOI/doi.org URL. Select any number of projects
  while importing. Use **Organize paper** on any library row or in the reader
  header to change project memberships afterward; check multiple projects or clear
  all to leave the paper Unassigned. These edits save automatically without
  reimporting or duplicating files. Details also edits metadata and reading state.
  All papers and Unassigned are independent of Inbox/Reading/Finished.
- In Organize, tags appear as removable chips. Type a name and choose **Add tag**,
  or choose an existing suggested library tag. Existing exact, trimmed names are
  reused. The chip's **×** removes the tag from this paper only; other papers keep
  it and it remains available for reuse. The sidebar and dropdown filter by tags;
  tags are created in the paper editor, without a separate sidebar creation action.
- Use the **⋮** button beside a sidebar project for **Rename** or **Delete project**.
  It has a descriptive accessible name; Enter/Space or Up/Down opens the menu,
  arrows/Home/End move between actions, Tab leaves it, and Escape returns focus to
  its button. Clicking or focusing outside dismisses the menu. Mobile controls
  provide 44 px targets; Close navigation or Escape dismisses the sidebar.
- Rename opens a focused dialog. Enter a name and choose **Save name** (or Enter);
  Cancel, Escape or a backdrop click discards the draft before submission. Names
  are trimmed and must contain 1–100 characters. Existing exact names are rejected
  without merging projects; letter case remains significant, as in label creation.
  The selected project stays selected and its name updates in headings, paper
  labels, filters and editors. No paper data, revisions or assignments change.
  Failed saves keep the draft and display an error. A concurrent rename requires
  **Reload latest project**, which replaces the draft with the current name before
  another save. Dismissal pauses while a request is pending so its outcome is clear.
- **Delete project** retains explicit confirmation. Deletion removes
  only that project and its memberships. Papers, original PDFs, notes, highlights,
  tags, reading state and positions are preserved. Other memberships remain;
  papers with none appear in Unassigned. Archived papers stay in Archive.
  Deleting the selected project returns to All papers and keeps valid tag/search/
  reading-state filters. Open editors with stale memberships must reload.
- The small file icon and **PDF available** / **Reference only** badge on each row
  report whether a PDF is attached. The old empty PDF tile was decorative, with
  no thumbnail image or loading path. Actual thumbnail previews are not implemented;
  choose a paper with a PDF to open the existing reader.
- Library search covers bibliographic fields, projects, tags, general notes,
  highlighted passages and comments. Project, tag and reading-state filters combine.
- Open a PDF, select text **within one PDF page**, choose a color, add an optional
  comment, and save the highlight. Tap a highlight or select its list entry to jump
  and edit. Zoom, page navigation, selectable PDF.js text and within-paper search
  work in the reader. Pinch within the PDF to zoom around your fingers, then swipe
  to pan in either direction. Single-finger scrolling and long-press text selection
  use the browser's native behavior. Zoom buttons, Fit width, and trackpad pinch
  are also available. Search reports matching pages; arrows move between them.
- General notes save after 650 ms and on blur; reading position saves after a
  500 ms scroll debounce. The header reports Saving, Saved or Save error. The panel
  starts closed at widths up to 900 px. Opening Notes reserves a bottom panel
  without covering the PDF; **× Close**, the header toggle, or Escape dismisses it.
  Choosing a passage in the highlights list closes the mobile panel and reveals
  that passage. Laptops retain the side panel.
- **Archive paper** is available directly on library rows and in Organize in the
  reader. Archive keeps all paper data; **Return to library** restores it.
  **Permanently delete** is available only for archived papers, both in library
  Archive rows and in the paper's Organize panel. Confirmation names the paper and
  the irreversible scope: its original PDF, notes, highlights, position and all
  assignments. Other papers, projects and library tags are kept. Canceling keeps
  everything. Permanent deletion checks the current paper revision.
- BibTeX and Markdown links export checked selections, the selected project, or
  the whole library. Whole-library and project exports include archived papers.
  Markdown includes metadata, notes, passages, comments, colors and PDF page numbers.

PDF imports retain embedded title/author metadata where present. Crossref supplies
DOI metadata; arXiv supplies Atom metadata and its PDF. DOI PDF retrieval is limited
to an arXiv PDF link supplied by Crossref. Other DOI references remain usable without
a PDF and accept a later manual attachment. There is no publisher scraping, paywall
bypass, or implied entitlement to a DOI's content. Provider failures are displayed.

Duplicates reuse a paper by normalized DOI, arXiv identity, or PDF SHA-256 and add
the requested project assignments. Existing files, notes and highlights are retained.
Explicit arXiv versions with different PDF bytes create separate papers linked by
the `arxivBase` family; an unversioned import reuses a stored member of that family
if one exists. To fetch a later version deliberately, import its explicit version.
If versions have identical bytes, hash deduplication reuses the existing paper and
reports this. A paper with a PDF cannot have that PDF replaced. Editing an identity
only changes metadata. Attaching a PDF already owned by another paper returns a
conflict with that paper's ID; automatic reference merging is intentionally avoided.

## Save and conflict behavior

Paper metadata, note and reading position share a monotonic revision. Each highlight
has its own revision. A mutation must supply the current revision; the SQLite
transaction rejects stale or out-of-order saves with HTTP 409 and keeps the newer
record. Writes from one reader are queued. This is whole-record conflict detection:
concurrent edits to different paper fields can still conflict. There is no silent
last-writer-wins merge. Other devices load the latest state when they reopen; live
push updates are not implemented.

Project checkboxes and tag chips show the latest local choice immediately while
saving in both the library and reader. Queued assignment changes apply to the
latest saved IDs, preserving other assignment changes. A rejected save rolls back
the affected checkbox/chip to its confirmed state and shows a save error; local
appearance alone does not confirm persistence. Further saves pause until
**Reload latest**. Creating a tag uses the existing library label API, then queues
its paper assignment; if assignment fails the reusable label may exist without a
paper membership. The input draft is kept on failure. Project rename sends `{ name, expectedName }` to `PATCH /api/projects/:id`.
The store validates and compares the last loaded name in a transaction; a changed
name returns 409 and a deleted project returns 404. This compares the current value
rather than adding project revisions or changing the backup schema. Renaming back
to the same value makes that name current again. Duplicate exact names return 409;
rename never reuses another project's ID. Project deletion advances
revisions of affected papers so other open editors receive a conflict.

On paper save failure, automatic saves pause and local note text stays visible.
Copy unsaved notes/comments before choosing **Reload latest**, which explicitly
discards local edits. A subsequent edit can then save against the latest revision.
Highlights retain their draft after an error and can be retried. Reopen the paper
before retrying an annotation revision conflict. The leave-page guard warns about
unsaved note state; browsers may suppress such dialogs. Sudden tab termination can
lose the current debounce window. There is no offline queue or offline persistence.

## Backups and restore

Use **Download backup** in the sidebar. The versioned JSON snapshot includes original
PDFs as base64, SHA-256 hashes, all papers (including archived), metadata, stable IDs,
revisions, projects, tags, assignments, notes, highlight anchors/comments, and reading
positions. Download over the authenticated UI and keep the file private. Backups are
not encrypted; use encrypted storage for them.

To restore, start a separate instance with **fresh isolated data storage**, then use
**Restore backup** and confirm. Projects and tags must also be empty. Restore
validates the entire schema, IDs, assignments, identities, annotation page bounds,
PDF parsing, and every checksum before a database transaction imports anything.
It never accepts filesystem paths or extracts archives, so zip traversal is absent.
Existing libraries are refused rather than replaced.

For a disposable native restore rehearsal:

```sh
AUTH_MODE=development HOST=127.0.0.1 PORT=3001 DATA_DIR=./data/restore-rehearsal npm start
# Open http://127.0.0.1:3001 and restore the downloaded JSON through the sidebar.
```

For container restore, use a separate Compose project/volume and loopback host port;
never delete the original volume to rehearse. Verify paper counts, open PDFs, notes,
positions and highlights before switching storage. The test suite performs this
restore into a fresh temporary directory, reopens SQLite and compares every related
record and original PDF checksum.

Backups are buffered JSON; restore requests are capped at **128 MiB**. Base64 adds
roughly one third to PDF size. For a larger library use a cold volume backup: stop
the service, copy the entire data directory/volume including SQLite and PDFs, and
restore that copy to isolated storage with the same application version. Never copy
only the live `.sqlite` file while WAL writes are active. The cold volume procedure
has not been exercised in this environment. Keep multiple dated backups and test
restores regularly. Container recreation preserves the named volume; `down -v`
destroys it and must not be used as routine maintenance.

## Architecture and limits

React/TypeScript + Vite, a Hono API on Node, SQLite in WAL mode, and content-addressed
files under `DATA_DIR/pdfs/<sha256>.pdf`. Projects and tags use join tables; highlights
are separate stable-ID records. SQL uses bound values. PDF filenames never determine
a storage path. PDFs are limited to 40 MiB and 10,000 pages, checked by signature/EOF
and `pdfinfo` with a ten-second parsing timeout. Encrypted PDFs are rejected. PDF.js
does not execute PDF JavaScript, and evaluation/XFA are disabled. The original
download remains an original file and should be handled as such by external viewers.

Anchors store page number, selected text and normalized PDF page rectangles
`[left, top, right, bottom]`, using top-left coordinates on the intrinsic rotated
CropBox. The numbers are fractions of page dimensions, independent of zoom, CSS
pixels and device pixel ratio. No PDF rewriting occurs. Cross-page selections must
be saved as separate highlights. Pinch previews scale the existing image/text
together, then redraw both layers at
settled zoom. Render generations own separate canvases; cancelled or offscreen
renders cannot erase newer layers. Canvas backing stores are limited to 8 million
pixels and 4096 pixels per side to bound mobile memory use. Only nearby pages render
canvas/text layers; page
placeholders remain in the scroll view. A text-based PDF is needed for selection
and search; OCR and a whole-library PDF-text index are out of scope.

Provider requests allow HTTPS on fixed arXiv/Crossref hosts, recheck every redirect,
resolve public IPv4 addresses at socket lookup, block local/private/reserved targets,
and limit redirects, total time and response bytes. IPv6 provider requests are
deliberately disabled. Metadata is plain text, React escapes UI values, and a small
Markdown subset (headings, paragraphs, emphasis, code, lists, blockquotes, HTTP(S)
links) is escaped and sanitized before preview. No raw HTML is rendered.

PDF.js 5.5.207 and its matching worker are vendored with upstream notices in
`public/vendor/pdfjs`. No CDN is required. Optional CMap, standard-font and special
image-codec assets are not bundled; unusual documents relying on those assets need
additional validation or an upstream asset update. Modern browser releases with
PDF.js-compatible APIs are required. iOS/iPadOS Safari, Android Chrome and laptop
Chrome/Firefox still need the browser/device verification described below.

This v1 targets a personal library and modest concurrent use, with a single server
process. It buffers imports/backups and searches notes in SQLite-backed records;
it does not implement a large-library full-text index, OCR, live collaboration,
freehand drawing, accounts, telemetry, paid integrations or offline sync.

## Verification commands

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run check:providers
npm run check:import-route
npx playwright install chromium
npm run test:browser:library
npm run test:browser
docker compose --env-file .env.example config --quiet
docker compose --env-file .env.example build
```

`npm run verify` runs type/lint checks, tests and the production build. Tests run
with Node test isolation disabled so individual cases and failures are visible in
restricted process environments. `test:browser` rebuilds the API and UI before
starting an isolated live instance. It first runs the library-management flows
also available independently through `npm run test:browser:library`: project
menu keyboard/focus/outside dismissal, rename cancellation, blank/long/duplicate
validation, injected save failure, actual competing rename/reload recovery, selected
project display and reload persistence, exact paper/PDF preservation, compact file
status (reference status uses an intercepted library response fixture), and 320/390 px
project dialog/layout checks. It also covers contextual
tag creation/reuse/removal, delayed multi-project edits, reload persistence,
conflict/error rollback, cancelled and confirmed project deletion with exact
paper/annotation/PDF preservation, selected-filter recovery and Unassigned,
archive/restore, and permanent deletion from library and detail. These are browser
assertions to run, not claims of completion in this restricted environment.
The full suite then uploads a generated valid text PDF, performs real selection/highlight interactions,
and attempts reload, zoom, notes, PDF search, another context, conflicts, touch
pinch/pan/cancellation events through CDP, offscreen virtualization with a 12-page
PDF, actual canvas ink and selectable text after zoom, 320/390 px portrait and
844 px landscape fit-width/layout assertions, non-overlapping notes, archive and
deletion. It also holds save responses to check
immediate checkbox/chip state, rapid assignment changes, reload persistence and visible
rollback on a rejected assignment. Selection checks reveal clipped passages before
dragging, require exact native/toolbar quotes, and compare text/highlight rectangles
to fixture ink bounds checked independently with Poppler. Selection diagnostics go
to `test-results/reader-browser-evidence.jsonl`; a failure also captures screenshots
as `test-results/reader-failure-<index>.png` before closing open pages. Success
screenshots are recorded after those steps execute. Emulation is not physical-device testing.

See [VERIFICATION.md](VERIFICATION.md) for the exact observed results and acceptance
gaps. No credentials, tunnel, remote repository, commit or deployment are required
to run local tests.

## Diagnosing an import response

API failures include HTTP status and JSON/HTML/text format. Non-JSON responses
never display the returned HTML, redirect URL or cookies. A native `X-Request-Id`
or a validated Cloudflare edge reference can identify the request. Unexpected
server exceptions log only that ID, method, route, status and an allowlisted
storage error code. Keep unsaved text and check the library before retrying an
import whose result was not confirmed; a dropped response can follow a saved write.

`npm run check:import-route` builds the application and exercises the exact
`https://arxiv.org/abs/2608.12594` import through the built handler, real providers,
ephemeral signed test JWTs, production HTTPS Origin and fresh temporary storage.
It removes that storage afterward and never uses runtime credentials or the
production library. This is an in-process HTTP-handler check, not a Caddy/Access
edge test. Production's non-JSON response still needs its status, format and
request reference captured from a failing authenticated session. Do not copy
cookies, tokens, raw HTML responses or runtime environment files into diagnostics.
