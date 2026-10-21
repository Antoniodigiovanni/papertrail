import { execFile } from 'node:child_process';
import { HttpError } from './errors.js';
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
    return new Promise((resolve, reject) => {
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
            const title = /^Title:\s+(.+)/m.exec(stdout)?.[1]?.trim().slice(0, 2000);
            const author = /^Author:\s+(.+)/m.exec(stdout)?.[1]?.trim().slice(0, 1000);
            resolve({ pages, title, authors: author ? author.split(/;\s*/).slice(0, 200) : undefined });
        });
        child.stdin?.on('error', () => { });
        child.stdin?.end(bytes);
    });
}
