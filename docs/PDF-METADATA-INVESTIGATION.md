# Empty PDF metadata fields

The reported `Subject:` title and `Creator: LaTeX with hyperref` author are
reproducible without opening or changing an existing library record.

After building application and test fixtures, run:

```sh
node scripts/inspect-empty-pdf-metadata.mjs
```

The script creates a valid synthetic PDF in memory with empty Title, Subject and
Author fields and Creator `LaTeX with hyperref`. It runs actual Poppler `pdfinfo`
and the application's `validatePdf`. Observed output on 2026-10-21:

```text
pdfinfo:
Title:
Subject:
Author:
Creator:         LaTeX with hyperref
Pages:           3

validatePdf:
{ "pages": 3, "title": "Subject:",
  "authors": ["Creator:         LaTeX with hyperref"] }
```

`server/pdf.ts` uses `/^Title:\s+(.+)/m` and `/^Author:\s+(.+)/m`.
JavaScript `\s` includes newlines. For an empty field the match crosses into the
next output line, so it treats a field label as bibliographic content. Upload then
uses that nonempty title instead of its filename fallback. This directly explains
the strings in the brief; it does not prove what the original PDF's correct title
or authors should be. No original source PDF or existing record was inspected.

The mobile feature changes neither extraction nor stored records. A separate fix
should restrict field matching to horizontal whitespace and same-line content,
cover empty/missing fields with real-PDF tests, preserve the filename fallback,
and avoid fabricating authors. Existing records need explicit, source-backed
correction; changing parser behavior alone does not repair them.
