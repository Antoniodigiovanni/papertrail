# Library PDF previews

Visible library entries render page 1 through the bundled same-origin PDF.js
5.5.207 main/worker pair and the authenticated `/api/papers/:id/pdf` endpoint.
The existing loader installs stream compatibility before importing PDF.js. No
external service, CDN, stored thumbnail, object URL or PDF mutation is used.
The existing self/connect/worker CSP permits these requests.

An IntersectionObserver with no prefetch margin queues visible entries only.
There is one loading/rendering document at a time, at most 12 retained canvases,
and at most 120 × 160 pixels per canvas (under 1 MiB combined RGBA backing memory).
PDF.js document memory is separate: one source PDF, subject to the upload limit,
is decoded at a time. Each completed task destroys its worker/document; only the
small canvas remains. Offscreen entries and unmounted components cancel pending
work and release canvas backing stores. Cancellation releases the queue slot
synchronously, even if PDF.js loading or destruction promises never settle. A late
completion cannot clear the slot belonging to a later task. Hidden tabs stop work. Opening the reader
cancels active previews and pauses the queue for the reader's entire lifetime.

Touch pointers wait 500 ms before scheduling; other pointers wait 150 ms. This
avoids work while quickly scrolling. A 12-second budget cancels stalled work.
Failure keeps a compact PDF fallback without repeated automatic retries. References
without a PDF display REF and retain the existing Reference only status. Layout is
42 × 56 CSS pixels on desktop and 32 × 44 on mobile, independent of page aspect ratio.

Run `npm run test:browser:thumbnails` for fixture ink/paper pixels, lazy requests,
responsive bounds, offscreen backing-store/worker cleanup, pending request
cancellation, fallback, object URL accounting and actual reader paint. The full
browser suite includes it. `npm run test:browser:responsive` includes the existing
management, title/filename, menu/focus and desktop geometry checks. Browser startup
must succeed before these checks constitute executed evidence. Physical Safari,
iOS, Android and Windows testing remains separate.

The twelve-canvas test requires all fifteen fixture PDFs to have painted before
checking exactly twelve retained canvases and zero workers. It also checks the
peak count never exceeds twelve. Cancellation/fallback progress is asserted before
that phase, with request history, states and geometry saved on failure. A separate
browser regression substitutes one never-settling PDF.js loading/destroy task and
requires a subsequent real thumbnail and reader to paint. The other pixel, cache,
worker, fallback and reader checks use the unmodified bundled PDF.js module.
Node regressions exercise production task cancellation and timeouts with unresolved
load/destroy promises and late module/render completion. They pass in the latest
retry. Browser scenarios still need execution: this retry fails before scenarios
at localhost listen EPERM and Chromium sandbox startup. No current browser pass is
claimed from earlier reported results.
