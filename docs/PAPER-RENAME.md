# Paper title and PDF filename

Each library row has the same Actions menu on desktop and mobile. Organize paper
opens projects, tags and the filename editor. Rename paper opens a focused title
dialog; Rename PDF focuses the independent download filename. Archive is reversible;
permanent deletion is offered only in Archive and requires confirmation.

Rename paper trims and validates 1–2000 characters, saves only `title` with the
current revision through the library queue, and refreshes the library. It changes
neither `pdfFilename` nor PDF bytes, identifiers, notes, annotations or assignments.
The reader header and bibliographic Title use the same persisted field. Cancel,
Escape and outside dismissal discard unsaved drafts; pending saves prevent closing.
Failures retain the draft and confirmed title. Reload latest paper explicitly loads
the current revision/title before another attempt. Closing restores the Actions
trigger, or library search if filtering removed the row.

The former desktop implementation hid the only explicit Rename PDF action with
`.mobile-paper-menu { display: none }`; desktop required opening Organize paper to
find its filename input. The shared menu removes that breakpoint restriction.

`scripts/paper-rename-checks.mjs` runs at 1482px desktop and 390px touch-emulated
viewports through the full, library-only and responsive browser runners. It checks
validation, focus containment/restoration, cancellation, a held request, failed-save
rollback, real revision conflicts, explicit reload, library/reader persistence,
independent filename editing and byte-identical downloads. API tests additionally
check invalid/stale title writes and preservation after reopening SQLite.

Run `npm run verify` and `npm run test:browser`. The latest retry passes API and
persistence regressions, but browser execution is blocked before scenarios by
localhost listen EPERM and Chromium sandbox startup failure. Earlier reported
browser acceptance predates the latest edits. The browser source covers
320/360/390/430px mobile, 1482px desktop and CSS-width zoom equivalents; those cases
need execution on a capable host. No physical Windows Chrome/Edge, mobile device
or native browser zoom pass is claimed. Existing metadata is not repaired by
renaming; see PDF-METADATA-INVESTIGATION.md for the separate extraction issue.
