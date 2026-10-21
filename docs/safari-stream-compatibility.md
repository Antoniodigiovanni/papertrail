# PDF stream compatibility investigation

Target report: macOS Safari **26.5, build 21624.2.5.11.4**, “Page 2 could not render: undefined is not a function (near '...value of readableStream...')”. This exact Safari build and the original failing PDF are unavailable in this Linux sandbox. No physical Safari pass is claimed.

## Grounded failure path

The unchanged, self-hosted PDF.js **5.5.207**, build **527964698**, uses `for await (const value of readableStream)` in `PDFPageProxy.getTextContent()` (`public/vendor/pdfjs/pdf.mjs`, around line 15030). Papertrail's `renderPageLayers()` awaits that text extraction alongside canvas rendering; a rejection cancels the render and the page component displays its page-numbered error. Disabling HTTP streaming does not remove the internal text-content stream. A separate signature decompression loop also uses async iteration. The worker's decompression loop catches failure and falls back to its decoder; no worker modification is needed for this text-content failure.

`scripts/pdfjs-text-regression.mjs` runs the real vendored main module and its matching worker against the repository's three-page PDF fixture. On page 2, it first extracts baseline content, deletes the stream async-iterator API, observes a TypeError from getTextContent, installs compatibility, and requires identical full text items and styles on that same page. It repeats with both the symbol and `values` removed. These are negative and positive controls, not a reproduction inferred only from a source string.

The Node-only regression supplies minimal DOMMatrix, Promise.try and Uint8Array.toHex shims because this browser build requires APIs absent from Node 22. Those shims never ship to the app; this regression does not paint or claim to emulate Safari. An additional loader check deletes both APIs and requires installation before the browser module import is attempted (that browser-root URL intentionally cannot resolve in Node).

## Compatibility contract and boundaries

`client/stream-compat.ts` installs missing stream iteration before `loadPdfJs()` initiates the dynamic import. It keeps callable native iteration unchanged and reuses callable native `values` when only the symbol is missing. Otherwise it implements iteration with getReader/read/cancel/releaseLock: eager exclusive lock, serialized next/return, exact chunk/error/reason propagation, cancellation on early return, preventCancel, and release on exhaustion, errors and cancellation (including rejected/pending cancellation). Startup failures return actionable update/reload messages through the loader promise. Assets, worker version, PDF bytes, CSP, text layers, selection, highlights and app behavior are preserved. No vendor files or production settings changed.

This is a fix for a confirmed **missing-capability** failure, not proof that the exact reported Safari build lacks that capability. The [WebKit Safari 26.4 release notes](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/) announce stream async iteration. Therefore a version number alone cannot establish this report's root cause. If the exact failing browser already has a working callable iterator, this guarded fix leaves it untouched; obtain its actual feature probe and stack before attributing any remaining failure to streams.

Fresh upstream review (2026-10-21): [PDF.js compatibility guidance](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions) describes modern and legacy builds and limited Safari support; [PDF.js issue 20973](https://github.com/mozilla/pdf.js/issues/20973) reports this same getTextContent regression in 5.5.207 even in the legacy build, with a maintainer recommending stream iteration compatibility. Switching distributions blindly would not establish a fix. The implementation follows [Streams Standard §4.2.5](https://streams.spec.whatwg.org/#rs-asynciterator), including releasing the reader before awaiting cancellation.

## Repeatable checks

- `npm run verify`: type checking, lint, all Node tests (including real PDF.js regression and native/fallback semantic comparisons), production build.
- `npm run test:browser`: original import/library/mobile/reader suite plus stream compatibility checks. Import harness fix is the preceding separate commit; its delayed-response and reveal assertions remain intact.
- `npm run test:browser:responsive`: original responsive suite.
- `npm run test:browser:pdf-compat`: focused Chromium compatibility suite.
- `npm run test:browser:pdf-compat:webkit`: same focused suite on an installed Playwright WebKit engine. This is not physical Safari.

The browser compatibility suite has a direct-PDF.js negative control in a fresh context with the APIs deleted. Positive contexts cover unmodified APIs, deleted symbol only, and deleted symbol plus values. It asserts support at the PDF.js module request before evaluation, page-2 canvas ink and text, zoom, search, native selection, persisted highlights and reload; native callable iteration retains identity. Screenshots are named `test-results/pdf-stream-<engine>-<mode>.png` only after actual execution.

## Validation environment

This sandbox denies branch writes to the source `.git`, local HTTP listening (`listen EPERM 127.0.0.1:3491`), Chromium startup (`sandbox_host_linux.cc:41`, shutdown Operation not permitted) and some child stdio pipe operations. The Node regression uses inherited subprocess output and an explicit completion report so a denied/empty subprocess cannot silently pass. Browser and responsive commands were attempted and stop on these environment restrictions. WebKit launch was attempted; `webkit-2370/pw_run.sh` is not installed. No browser scenarios or physical device passes are claimed here. Final `npm run verify` passed: typecheck, lint, **71/71 tests**, and build. Both missing-API PDF.js negative/positive controls and the loader ordering check passed. Browser, responsive and focused WebKit command exit codes were all 1 for the restrictions above. Raw logs are retained in `test-results/safari-*.log`.

## Exact Safari host acceptance

On an isolated local fixture server, record Safari 26.5 build 21624.2.5.11.4 and the actual macOS version. Before opening a paper, capture this probe in that tab (the loader intentionally runs only when the reader is used):

```js
({ userAgent: navigator.userAgent,
   iterator: typeof ReadableStream.prototype[Symbol.asyncIterator],
   values: typeof ReadableStream.prototype.values })
```

Open the original failing PDF and a fixture, navigate to page 2, confirm canvas and selectable text, then zoom, search, save a highlight and reload. Record the actual exception stack if anything fails. The release note makes this probe especially important: a callable native API means the missing-API reproduction alone does not explain that exact build. Re-run the full browser/responsive commands on the host; Playwright WebKit is additional engine coverage, not a substitute for this exact Safari acceptance.
