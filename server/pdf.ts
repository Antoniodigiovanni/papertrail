import { execFile } from 'node:child_process';
import { SaxesParser } from 'saxes';
import { HttpError } from './errors.js';
export function metadataValue(output: string, field: 'Title' | 'Author'): string | undefined {
    const value = new RegExp(`^${field}:[ \t]*([^\r\n]*)`, 'm').exec(output)?.[1]?.trim();
    if (!value || /^(?:title|subject|author|creator|producer|keywords)\s*:/i.test(value)
        || /^(?:LaTeX(?: with hyperref)?|pdfTeX|LuaTeX|XeTeX|Microsoft Word|untitled|document)$/i.test(value)) return undefined;
    return value.slice(0, field === 'Title' ? 2000 : 1000);
}
export function xmpMetadata(xml: string): { title?: string; authors?: string[] } {
    let title: string | undefined;
    const authors: string[] = [];
    const stack: string[] = [];
    let text = '';
    let kind = '';
    let entryDepth = 0;
    let defaultTitle = false;
    let preferredTitle = false;
    const parser = new SaxesParser({ xmlns: true });
    parser.on('opentag', tag => {
        stack.push(`${tag.uri}|${tag.local}`);
        if (kind && stack.length > entryDepth) kind = '';
        if (tag.uri === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' && tag.local === 'li') {
            const property = stack.at(-3), list = stack.at(-2);
            kind = property === 'http://purl.org/dc/elements/1.1/|title' && list === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#|Alt' ? 'Title'
                : property === 'http://purl.org/dc/elements/1.1/|creator' && ['http://www.w3.org/1999/02/22-rdf-syntax-ns#|Seq', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#|Bag'].includes(list || '') ? 'Author' : '';
            entryDepth = stack.length;
            defaultTitle = Object.values(tag.attributes).some(attribute => attribute.uri === 'http://www.w3.org/XML/1998/namespace' && attribute.local === 'lang' && attribute.value === 'x-default');
            text = '';
        }
    });
    parser.on('text', value => { if (kind) text += value; });
    parser.on('cdata', value => { if (kind) text += value; });
    parser.on('closetag', tag => {
        if (tag.uri === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' && tag.local === 'li' && kind && stack.length === entryDepth) {
            const value = metadataValue(`${kind}: ${text.replace(/[\r\n]+/g, ' ')}`, kind as 'Title' | 'Author');
            if (kind === 'Title' && value && (!title || (defaultTitle && !preferredTitle))) { title = value; preferredTitle = defaultTitle; }
            else if (kind === 'Author' && value && authors.length < 200 && !authors.includes(value)) authors.push(value);
            kind = '';
        }
        stack.pop();
    });
    // No external entities or DTD processing; malformed packets are ignored whole.
    parser.on('doctype', () => { throw new Error('Unsupported metadata DTD'); });
    try { parser.write(xml).close(); } catch { return {}; }
    return { title, authors: authors.length ? authors : undefined };
}
export const MAX_PDF = 40 * 1024 * 1024;
export async function validatePdf(bytes: Buffer): Promise<{
    pages: number;
    title?: string;
    authors?: string[];
}> {
    if (bytes.length > MAX_PDF)
        throw new HttpError(413, 'PDF exceeds the 40 MiB limit.');
    if (bytes.length < 20 || !bytes.subarray(0, 8).toString().startsWith('%PDF-') || !bytes.subarray(-2048).includes(Buffer.from('%%EOF')))
        throw new HttpError(400, 'Choose a valid, complete PDF file.');
    const info = await new Promise<{ pages: number; title?: string; authors?: string[] }>((resolve, reject) => {
        const child = execFile('pdfinfo', ['-'], { timeout: 10000, maxBuffer: 256000 }, (error, stdout) => {
            if (error && ['ENOENT', 'EACCES'].includes(String(error.code)))
                return reject(new HttpError(503, 'Server PDF validation is unavailable. Check the pdfinfo installation and execution permissions, then retry.'));
            if (error)
                return reject(new HttpError(400, 'PDF could not be parsed. Encrypted, damaged or oversized documents are not supported.'));
            if (/^Encrypted:\s+yes/m.test(stdout))
                return reject(new HttpError(400, 'Encrypted PDFs are not supported.'));
            const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1]);
            if (!pages || pages > 10000)
                return reject(new HttpError(400, 'PDF must contain between 1 and 10,000 pages.'));
            const title = metadataValue(stdout, 'Title');
            const author = metadataValue(stdout, 'Author');
            resolve({ pages, title, authors: author ? author.split(';').map(value => value.trim()).filter(Boolean).slice(0, 200) : undefined });
        });
        child.stdin?.on('error', () => { });
        child.stdin?.end(bytes);
    });
    const xmp = await new Promise<string>(resolve => {
        const child = execFile('pdfinfo', ['-meta', '-'], { timeout: 10000, maxBuffer: 256000 }, (error, stdout) => resolve(error ? '' : stdout));
        child.stdin?.on('error', () => {});
        child.stdin?.end(bytes);
    });
    const metadata = xmpMetadata(xmp);
    return { ...info, title: metadata.title || info.title, authors: metadata.authors || info.authors };
}
