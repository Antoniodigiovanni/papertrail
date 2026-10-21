# Empty PDF metadata fields

The reported `Subject:` title and `Creator: LaTeX with hyperref` author are
reproducible without opening or changing an existing library record.

After building application and test fixtures, run:

```sh
node scripts/inspect-empty-pdf-metadata.mjs
```

The script creates a valid synthetic PDF in memory with empty Title, Subject and
Author fields and Creator `LaTeX with hyperref`. It runs actual Poppler `pdfinfo`
and the application's `validatePdf`. Historical output before the parser repair on 2026-10-21:

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

Before the repair, `server/pdf.ts` used `/^Title:\s+(.+)/m` and `/^Author:\s+(.+)/m`.
JavaScript `\s` includes newlines. For an empty field the match crosses into the
next output line, so it treats a field label as bibliographic content. Upload then
uses that nonempty title instead of its filename fallback. This directly explains
the strings in the brief; it does not prove what the original PDF's correct title
or authors should be. No original source PDF or existing record was inspected.

The ingestion parser now restricts field matching to horizontal whitespace and
same-line content, rejects field labels and common tool markers, and prefers
meaningful namespace-aware XMP title/creator lists. The first meaningful default-language XMP title
is preferred when available; duplicate exact creator names are retained once. Malformed, oversized or unavailable XMP falls back to
usable Info fields, then the existing upload filename fallback. Authors are never
inferred from the filename or page text. The original safe filename remains
independent of the bibliographic title.

The reproduction script now requires absent title/authors for this empty-field
fixture. Tests cover actual Poppler output, missing/empty fields, malformed XMP,
meaningful XMP preference, valid CDATA, duplicate Info/XMP keys, common tool markers,
upload filename/byte preservation, and unchanged existing metadata on duplicate upload.
This affects new ingestion only. Existing records and original PDF bytes are not
rewritten; their correct bibliographic content cannot be established from the
corrupted strings alone.
