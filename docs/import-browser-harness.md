# Import reveal browser harness

The timeout at `scripts/import-browser-checks.mjs:118` on f50751a is a selector error. The installed Playwright 1.64.0 `shouldSkipForTextMatching` explicitly skips STYLE, SCRIPT, NOSCRIPT and document.head descendants. A STYLE element cannot match `filter({ hasText: css })`, even while connected with identical textContent.

The import flow has no document navigation/reload between addStyleTag and cleanup: it releases a held `/api/library?scope=active` response and React refreshes the rows. Retain addStyleTag's ElementHandle, check it remains connected and its 500px min-height is applied through reveal, then remove that exact node. All original delayed-response, final-row focus, scroll, selection and notice assertions remain.

2026-10-21 sandbox validation: the installed Playwright matcher was executed against STYLE and DIV inputs (STYLE skipped, DIV eligible). `npm run test:browser` builds successfully but cannot run the scenario here: localhost listen returns EPERM and Chromium exits at sandbox_host_linux.cc with shutdown Operation not permitted. Host rerun is required; no browser pass is claimed.
