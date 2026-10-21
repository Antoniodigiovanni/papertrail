import https from 'node:https';
import dns from 'node:dns';
import { isIP } from 'node:net';
import { SaxesParser } from 'saxes';
import sanitizeHtml from 'sanitize-html';
import { HttpError } from './errors.js';
import { normalizeArxiv, normalizeDoi } from './schema.js';
import type { Metadata } from './store.js';
const hosts = ['api.crossref.org', 'export.arxiv.org', 'arxiv.org'];
export function publicAddress(address: string): boolean {
    if (isIP(address) !== 4)
        return false;
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2)) ||
        (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
export function validateProviderUrl(value: string, allow = hosts): URL {
    if (value.length > 4000)
        throw new HttpError(400, 'Provider URL exceeds the length limit.');
    let url: URL;
    try {
        url = new URL(value);
    }
    catch {
        throw new HttpError(400, 'Invalid provider URL.');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !allow.includes(url.hostname))
        throw new HttpError(400, 'Only HTTPS URLs on approved provider hosts are allowed.');
    return url;
}
export type FetchProvider = (url: string, limit: number) => Promise<Buffer>;
export async function safeFetch(value: string, limit: number, allow = hosts, deadline = Date.now() + 15000, redirects = 0, transport: typeof https.get = https.get, lookup: typeof dns.lookup = dns.lookup): Promise<Buffer> {
    const url = validateProviderUrl(value, allow);
    if (redirects > 3 || deadline <= Date.now())
        throw new HttpError(502, 'Provider request exceeded its redirect or time limit. Try again later.');
    return new Promise<Buffer>((resolve, reject) => {
        const request = transport(url, {
            family: 4,
            headers: { 'User-Agent': 'Papertrail/1.0 (personal research archive)', 'Accept-Encoding': 'identity' },
            lookup: (hostname, _options, callback) => {
                lookup(hostname, { family: 4, all: true }, (error, addresses) => {
                    if (error)
                        return callback(error, '', 4);
                    if (!addresses.length || addresses.some(a => !publicAddress(a.address)))
                        return callback(new Error('Provider DNS resolved to a private or reserved target.'), '', 4);
                    callback(null, addresses[0].address, 4);
                });
            },
        }, response => {
            const status = response.statusCode || 0;
            if ([301, 302, 303, 307, 308].includes(status)) {
                response.resume();
                if (!response.headers.location)
                    return reject(new HttpError(502, 'Provider returned an invalid redirect.'));
                try {
                    safeFetch(new URL(response.headers.location, url).href, limit, allow, deadline, redirects + 1, transport, lookup).then(resolve, reject);
                }
                catch {
                    reject(new HttpError(502, 'Provider returned an invalid redirect destination.'));
                }
                return;
            }
            if (status !== 200) {
                response.resume();
                return reject(new HttpError(502, `Provider returned HTTP ${status}. Retry later or upload a PDF manually.`));
            }
            if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
                response.destroy();
                return reject(new HttpError(502, 'Provider returned an unsupported compressed response.'));
            }
            if (Number(response.headers['content-length'] || 0) > limit) {
                response.destroy();
                return reject(new HttpError(502, 'Provider response exceeds the download limit.'));
            }
            let count = 0;
            const chunks: Buffer[] = [];
            response.on('data', (data: Buffer) => { count += data.length; if (count > limit) {
                response.destroy(new Error('Provider response exceeds the download limit.'));
            }
            else
                chunks.push(data); });
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', () => reject(new HttpError(502, 'Provider download failed or exceeded its limit. Retry or attach a PDF manually.')));
        });
        const timer = setTimeout(() => request.destroy(new Error('Provider request timed out.')), Math.max(1, deadline - Date.now()));
        request.on('close', () => clearTimeout(timer));
        request.on('error', () => { clearTimeout(timer); reject(new HttpError(502, `Could not reach ${url.hostname}. Check server DNS/network connectivity and retry, or upload a PDF manually.`)); });
    });
}
const text = (v: unknown, max = 30000) => sanitizeHtml(String(v ?? ''), { allowedTags: [], allowedAttributes: {} })
    .replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity, key: string) => {
    const basic: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (basic[key])
        return basic[key];
    const value = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
}).replace(/\s+/g, ' ').trim().slice(0, max);
export function parseArxiv(xml: string): {
    meta: Metadata;
    pdfUrl: string;
} {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
        throw new HttpError(502, 'Provider XML contains an unsupported document type.');
    const parser = new SaxesParser({ xmlns: false });
    const stack: string[] = [];
    let inEntry = false;
    let entries = 0;
    const values: Record<string, string> = {};
    let pdfUrl = '';
    parser.on('opentag', tag => {
        stack.push(tag.name);
        if (tag.name === 'entry') {
            inEntry = true;
            entries++;
        }
        if (inEntry && entries === 1 && tag.name === 'link' && tag.attributes.title === 'pdf')
            pdfUrl = String(tag.attributes.href || '');
    });
    const append = (value: string) => {
        if (!inEntry || entries !== 1)
            return;
        const key = stack.slice(stack.indexOf('entry') + 1).join('/');
        values[key] = (values[key] || '') + value;
    };
    parser.on('text', append);
    parser.on('cdata', append);
    parser.on('closetag', tag => { if (tag.name === 'author')
        values.authors = (values.authors || '') + '\n' + (values['author/name'] || '').trim(); if (tag.name === 'author')
        values['author/name'] = ''; if (tag.name === 'entry')
        inEntry = false; stack.pop(); });
    try {
        parser.write(xml).close();
    }
    catch {
        throw new HttpError(502, 'arXiv returned malformed metadata. Retry or upload manually.');
    }
    const arxiv = normalizeArxiv(values.id || '');
    if (!arxiv || !values.title)
        throw new HttpError(502, 'arXiv did not return a matching paper. Check the identifier.');
    // The PDF endpoint is derived from a validated identity, never an arbitrary Atom link.
    pdfUrl = `https://arxiv.org/pdf/${arxiv}`;
    return { meta: { title: text(values.title, 2000), authors: (values.authors || '').split('\n').filter(Boolean).map(v => text(v, 300)), arxiv, year: (values.published || '').slice(0, 4), abstract: text(values.summary), venue: 'arXiv', url: `https://arxiv.org/abs/${arxiv}` }, pdfUrl };
}
export async function importReference(reference: string, fetcher: FetchProvider = safeFetch): Promise<{
    meta: Metadata;
    pdf?: Buffer;
    warning?: string;
}> {
    const arxiv = normalizeArxiv(reference);
    if (arxiv) {
        const existing = await fetcher(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxiv)}`, 2000000);
        const { meta, pdfUrl } = parseArxiv(existing.toString());
        if (arxiv.replace(/v\d+$/, '') !== meta.arxiv?.replace(/v\d+$/, '') || (/v\d+$/.test(arxiv) && arxiv !== meta.arxiv))
            throw new HttpError(502, 'arXiv returned a different identity or version. No PDF was imported.');
        try {
            return { meta, pdf: await fetcher(pdfUrl, 40 * 1024 * 1024) };
        }
        catch (e) {
            return { meta, warning: `Metadata saved. PDF retrieval failed: ${(e as Error).message}` };
        }
    }
    let doi: string;
    try {
        doi = normalizeDoi(reference);
    }
    catch (e) {
        throw new HttpError(400, (e as Error).message);
    }
    let result;
    try {
        result = JSON.parse((await fetcher(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, 2000000)).toString()).message;
    }
    catch (e) {
        if (e instanceof HttpError)
            throw e;
        throw new HttpError(502, 'Crossref returned malformed metadata. Retry later or import a PDF.');
    }
    if (!result || !Array.isArray(result.title) || !result.title[0])
        throw new HttpError(502, 'Crossref did not return a usable reference.');
    let canonical: string;
    try {
        canonical = normalizeDoi(result.DOI);
    }
    catch {
        throw new HttpError(502, 'Crossref returned an invalid DOI.');
    }
    if (canonical !== doi)
        throw new HttpError(502, 'Crossref returned a different DOI. Nothing was imported.');
    const meta: Metadata = { doi, title: text(result.title[0], 2000), authors: (Array.isArray(result.author) ? result.author : []).slice(0, 200).map((a: {
            given?: string;
            family?: string;
            name?: string;
        }) => text(a.name || [a.given, a.family].filter(Boolean).join(' '), 300)).filter(Boolean),
        year: String(result.published?.['date-parts']?.[0]?.[0] || ''), venue: text(result['container-title']?.[0] || '', 1000), abstract: text(result.abstract), url: `https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi,'/')}` };
    const link = (Array.isArray(result.link) ? result.link : []).find((l: {
        URL?: string;
    }) => { try {
        const u = validateProviderUrl(l.URL || '', ['arxiv.org', 'export.arxiv.org']);
        return u.pathname.startsWith('/pdf/');
    }
    catch {
        return false;
    } });
    if (link) {
        try {
            return { meta, pdf: await fetcher(link.URL, 40 * 1024 * 1024) };
        }
        catch (e) {
            return { meta, warning: `Reference saved. PDF unavailable: ${(e as Error).message}` };
        }
    }
    return { meta, warning: 'Reference saved. No PDF is available from an approved open provider. Attach a PDF you have permission to use; DOI import does not bypass publisher access restrictions.' };
}
