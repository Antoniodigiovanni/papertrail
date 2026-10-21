// Independent ink bounds in PDF points (top-left origin), checked with Poppler.
// Browser tests use these to catch displaced text/highlights, not just CSS ratios.
export const readerPassages = [
    { quote: 'Understanding grows when ideas connect.', ink: [60, 80.512, 361.472, 95.312] },
    { quote: 'Highlights should stay anchored across devices.', ink: [60, 118.384, 316.104, 129.484] },
] as const;

// A deterministic, valid three-page text PDF, including a real cross-reference table.
export function textPdf(title = 'The Architecture of Understanding', pageCount = 3): Buffer {
    const escape = (s: string) => s.replace(/[\\()]/g, '\\$&');
    const pages = [
        ['Understanding grows when ideas connect.', 'Highlights should stay anchored across devices.', 'Collect evidence. Connect ideas. Revisit your notes.'],
        ['Second page: a space for deeper reading.', 'Reading position includes a relative within-page offset.', 'A passage worth keeping is worth finding again.'],
        ['Third page: conclusions and open questions.', 'Searchable text belongs to the PDF, not a screenshot.', 'Preserve the original document and every annotation.'],
    ];
    while (pages.length < pageCount) pages.push([`Page ${pages.length + 1}: keep reading.`, 'More evidence and connected ideas.', 'Virtual pages must redraw when revisited.']);
    const objects: string[] = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] >>`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    for (let i = 0; i < pages.length; i++) {
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`);
        const text = `BT /F1 16 Tf 60 700 Td (${escape(pages[i][0])}) Tj 0 -35 Td /F1 12 Tf (${escape(pages[i][1])}) Tj 0 -35 Td (${escape(pages[i][2])}) Tj 0 -380 Td (Lower on page ${i + 1}: continue reading here.) Tj ET\n`;
        objects.push(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`);
    }
    objects.push(`<< /Title (${escape(title)}) /Author (Ada Lovelace; Alan Turing) >>`);
    let pdf = '%PDF-1.7\n';
    const offsets = [0];
    objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf);
}
export const arxivXml = (id = '2401.12345v1') => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/${id}</id><title>Understanding &amp; Evidence</title><author><name>Ada Lovelace</name></author><author><name>Alan Turing</name></author><published>2024-01-23T00:00:00Z</published><summary>A paper about evidence.</summary><link href="https://arxiv.org/pdf/${id}" title="pdf"/></entry></feed>`;
export const crossrefFixture = (doi = '10.1234/evidence') => ({ message: { DOI: doi, title: ['Understanding {Evidence} & Reasoning'], author: [{ given: 'Ada', family: 'Lovelace' }], published: { 'date-parts': [[2024]] }, 'container-title': ['Journal of Reading'], abstract: '<p>Research &amp; reflection.</p>' } });
