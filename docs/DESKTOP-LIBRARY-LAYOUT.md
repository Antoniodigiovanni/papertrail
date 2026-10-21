# Desktop library rows

The reported screenshot at 1482px showed a tall row with desktop Organize/Archive
buttons, archive help and Saved below the summary. The help-hiding selector
expected PaperActions as a direct child, but a new `.library-direct-actions`
wrapper broke that selector. The desktop Rename PDF menu was also hidden by a
mobile-only wrapper. The shared actions feature removes the duplicate controls.

At CSS widths above 760px, rows now use a `minmax(0,1fr) 44px` grid. Summary and
Actions start on the same row, while an expanded organizer or save error spans
both columns. Idle Saved feedback occupies no row. Titles, authors and venue
metadata have two-line bounds; long download filenames use ellipsis with their
full name in the hover title and filename editor. Projects/tags wrap within the
text column. PDF availability and the ellipsized filename share one compact line; the
availability badge remains visible and the redundant Local PDF line is omitted.
Selection and reading state stay visible.

Mobile keeps its existing reading layout, touch targets, selection mode and
reader behavior, using the same Actions menu. Menus choose available space above
or below the trigger and scroll internally when needed; they retain focus across
viewport resize while their trigger stays visible. Organize and Rename PDF move
focus to the region/input, and closing the organizer returns to Actions.

`scripts/desktop-library-checks.mjs` checks actual bounding rectangles, including
row height, summary/actions alignment, non-overlap of selection/open/state/menu,
text line bounds, unobscured menu items and a full-width organizer. Cases include
1920, 1482, 1366, 1186, 1024, 988, 900 and 768 CSS px and fractional DPR. A 741px
case covers the responsive transition. 1186/988/741px model available CSS space
at 125/150/200% zoom on a 1482px display; DPR alone is not browser zoom.

`npm run test:browser` and `npm run test:browser:responsive` exercise these checks.
The latest retry could not execute browser geometry: localhost binding returns
EPERM and Chromium exits at sandbox startup. Earlier reported Chromium acceptance
predates the current thumbnail/cancellation edits and does not verify them. Run the
commands above on a host that permits the test server/browser. Physical Windows
Chrome/Edge and native browser zoom remain untested.
