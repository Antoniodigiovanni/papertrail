# PDF.js

Mozilla PDF.js, version **5.5.207**, build **527964698**.

The original `pdf.mjs` distribution and matching `pdf.worker.mjs` are vendored so the
reader works without a CDN. Both retain their upstream Apache 2.0 notices.
The distribution was recovered from an existing local package cache when registry
DNS was unavailable. No application code from that package is included.

Upstream: https://github.com/mozilla/pdf.js
Distribution: https://www.npmjs.com/package/pdfjs-dist/v/5.5.207

When upgrading, replace both files from the same `pdfjs-dist` release and rerun the
reader checks. Keep the version match and license notices. Optional external CMap,
standard-font and image-codec assets are not included in this distribution.
