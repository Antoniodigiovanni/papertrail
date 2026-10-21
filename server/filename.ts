// Display/download names never participate in PDF storage paths or identity.
export const defaultPdfFilename = (id: string) => `paper-${id}.pdf`;

export function pdfFilenameProblem(value: string): string {
    if (/[<>:"/\\|?*]|\p{Cc}|\p{Cf}|\p{Cs}/u.test(value) || value.includes('..'))
        return 'Use a filename without paths, control characters or reserved punctuation.';
    value = value.trim();
    if (!value || new TextEncoder().encode(value).length > 240) return 'Use a PDF filename of 1–240 UTF-8 bytes.';
    if (value.startsWith('.')) return 'Use a filename without a leading dot.';
    if (!/\.pdf$/i.test(value)) return 'Use a filename ending in .pdf.';
    const stem = value.slice(0, -4);
    if (!stem || /[. ]$/.test(stem) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))
        return 'Use a nonempty filename without a reserved device name or trailing dots/spaces.';
    return '';
}

export const normalizePdfFilename = (value: string) => `${value.trim().slice(0, -4)}.pdf`;

export function pdfContentDisposition(filename: string, id: string, download: boolean): string {
    // An ASCII fallback plus RFC 5987 encoding keeps Unicode and punctuation out
    // of header syntax. Validate again at the response boundary for stored data.
    const safe = pdfFilenameProblem(filename) ? defaultPdfFilename(id) : filename;
    const encoded = encodeURIComponent(safe).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return `${download ? 'attachment' : 'inline'}; filename="${defaultPdfFilename(id)}"; filename*=UTF-8''${encoded}`;
}
